import { db } from "@workspace/db";
import {
  agentsTable,
  needsTable,
  relationsTable,
  businessesTable,
  goodsTable,
  simStateTable,
  simConfigTable,
  statsHistoryTable,
  type Agent,
  type Needs,
  type Business,
  type Good,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

export interface SimulationConfig {
  taxRate: number;
  needDecayRate: number;
  tickIntervalMs: number;
  initialAgents: number;
  initialBusinesses: number;
  baseFoodPrice: number;
  baseSalary: number;
  subsidyAmount: number;
  socialInteractionStrength: number;
  priceMarkup: number;
}

const DEFAULT_CONFIG: SimulationConfig = {
  taxRate: 0.15,
  needDecayRate: 5,
  tickIntervalMs: 60000,
  initialAgents: 1000,
  initialBusinesses: 80,
  baseFoodPrice: 10,
  baseSalary: 50,
  subsidyAmount: 20,
  socialInteractionStrength: 2,
  priceMarkup: 0.2,
};

interface AgentState extends Agent {
  needs: { hunger: number; comfort: number; social: number };
  needsId: number;
}

interface BusinessState extends Business {
  employeeCount: number;
}

interface GoodState extends Good {}

interface SimState {
  tick: number;
  running: boolean;
  gameHour: number;
  gameDay: number;
  governmentBudget: number;
  totalTaxCollected: number;
  totalSubsidiesPaid: number;
}

const MALE_NAMES = [
  "Александр", "Дмитрий", "Михаил", "Иван", "Сергей", "Андрей", "Алексей",
  "Владимир", "Артём", "Николай", "Павел", "Антон", "Максим", "Денис",
  "Роман", "Пётр", "Игорь", "Виктор", "Тимур", "Даниил", "Константин",
];
const FEMALE_NAMES = [
  "Мария", "Анна", "Елена", "Ольга", "Наталья", "Ирина", "Татьяна",
  "Светлана", "Юлия", "Екатерина", "Алина", "Дарья", "Ксения", "Валерия",
  "Виктория", "Людмила", "Нина", "Алёна", "Марина", "Вера",
];
const PERSONALITIES = ["активный", "спокойный", "общительный", "замкнутый", "трудолюбивый", "ленивый", "амбициозный"];
const FOOD_BUSINESS_NAMES = ["Пекарня", "Кафе", "Столовая", "Ресторан", "Фермерское хозяйство", "Супермаркет", "Закусочная"];
const SERVICE_BUSINESS_NAMES = ["Парикмахерская", "Мастерская", "Магазин", "Сервисный центр", "Прачечная", "Ателье", "Аптека"];
const FOOD_GOOD_NAMES = ["Хлеб", "Молоко", "Мясо", "Овощи", "Фрукты", "Рыба", "Крупа"];
const SERVICE_GOOD_NAMES = ["Одежда", "Инструменты", "Бытовая химия", "Электроника", "Мебель"];
const ACTIONS = ["eat", "rest", "socialize", "work", "idle"];

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

class SimulationEngine {
  private agents: Map<number, AgentState> = new Map();
  private businesses: Map<number, BusinessState> = new Map();
  private goods: Map<number, GoodState> = new Map();
  private state: SimState = {
    tick: 0,
    running: false,
    gameHour: 0,
    gameDay: 1,
    governmentBudget: 10000,
    totalTaxCollected: 0,
    totalSubsidiesPaid: 0,
  };
  private config: SimulationConfig = { ...DEFAULT_CONFIG };
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncCounter = 0;

  async initialize(): Promise<void> {
    logger.info("Initializing simulation engine...");
    await this.loadConfig();
    await this.loadState();
    await this.loadAgents();
    await this.loadBusinesses();
    await this.loadGoods();

    if (this.agents.size === 0) {
      logger.info("No agents found, generating initial population...");
      await this.generatePopulation();
    }

    if (this.state.running) {
      logger.info("Resuming simulation from saved state");
      this.startTimer();
    }

    logger.info({ agentCount: this.agents.size, businessCount: this.businesses.size }, "Simulation engine initialized");
  }

  private async loadConfig(): Promise<void> {
    const rows = await db.select().from(simConfigTable);
    if (rows.length === 0) {
      await this.saveConfig();
      return;
    }
    const configMap: Record<string, string> = {};
    for (const row of rows) {
      configMap[row.key] = row.value;
    }
    this.config = {
      taxRate: parseFloat(configMap.taxRate ?? String(DEFAULT_CONFIG.taxRate)),
      needDecayRate: parseFloat(configMap.needDecayRate ?? String(DEFAULT_CONFIG.needDecayRate)),
      tickIntervalMs: parseInt(configMap.tickIntervalMs ?? String(DEFAULT_CONFIG.tickIntervalMs)),
      initialAgents: parseInt(configMap.initialAgents ?? String(DEFAULT_CONFIG.initialAgents)),
      initialBusinesses: parseInt(configMap.initialBusinesses ?? String(DEFAULT_CONFIG.initialBusinesses)),
      baseFoodPrice: parseFloat(configMap.baseFoodPrice ?? String(DEFAULT_CONFIG.baseFoodPrice)),
      baseSalary: parseFloat(configMap.baseSalary ?? String(DEFAULT_CONFIG.baseSalary)),
      subsidyAmount: parseFloat(configMap.subsidyAmount ?? String(DEFAULT_CONFIG.subsidyAmount)),
      socialInteractionStrength: parseFloat(configMap.socialInteractionStrength ?? String(DEFAULT_CONFIG.socialInteractionStrength)),
      priceMarkup: parseFloat(configMap.priceMarkup ?? String(DEFAULT_CONFIG.priceMarkup)),
    };
  }

  private async saveConfig(): Promise<void> {
    for (const [key, value] of Object.entries(this.config)) {
      await db
        .insert(simConfigTable)
        .values({ key, value: String(value) })
        .onConflictDoUpdate({ target: simConfigTable.key, set: { value: String(value) } });
    }
  }

  private async loadState(): Promise<void> {
    const [row] = await db.select().from(simStateTable).limit(1);
    if (row) {
      this.state = {
        tick: row.tick,
        running: row.running,
        gameHour: row.gameHour,
        gameDay: row.gameDay,
        governmentBudget: row.governmentBudget,
        totalTaxCollected: row.totalTaxCollected,
        totalSubsidiesPaid: row.totalSubsidiesPaid,
      };
    } else {
      await db.insert(simStateTable).values({
        tick: 0,
        running: false,
        gameHour: 0,
        gameDay: 1,
        governmentBudget: 10000,
        totalTaxCollected: 0,
        totalSubsidiesPaid: 0,
      });
    }
  }

  private async loadAgents(): Promise<void> {
    const agentRows = await db.select().from(agentsTable).limit(5000);
    const needsRows = await db.select().from(needsTable);
    const needsMap = new Map<number, { hunger: number; comfort: number; social: number; id: number }>();
    for (const n of needsRows) {
      needsMap.set(n.agentId, { hunger: n.hunger, comfort: n.comfort, social: n.social, id: n.id });
    }
    this.agents.clear();
    for (const agent of agentRows) {
      const needs = needsMap.get(agent.id) ?? { hunger: 80, comfort: 80, social: 80, id: 0 };
      this.agents.set(agent.id, { ...agent, needs: { hunger: needs.hunger, comfort: needs.comfort, social: needs.social }, needsId: needs.id });
    }
  }

  private async loadBusinesses(): Promise<void> {
    const rows = await db.select().from(businessesTable);
    this.businesses.clear();
    const employeeCounts = new Map<number, number>();
    for (const agent of this.agents.values()) {
      if (agent.employerId != null) {
        employeeCounts.set(agent.employerId, (employeeCounts.get(agent.employerId) ?? 0) + 1);
      }
    }
    for (const b of rows) {
      this.businesses.set(b.id, { ...b, employeeCount: employeeCounts.get(b.id) ?? 0 });
    }
  }

  private async loadGoods(): Promise<void> {
    const rows = await db.select().from(goodsTable);
    this.goods.clear();
    for (const g of rows) {
      this.goods.set(g.id, { ...g });
    }
  }

  private async generatePopulation(): Promise<void> {
    const { initialAgents, initialBusinesses, baseFoodPrice, baseSalary } = this.config;
    logger.info({ initialAgents, initialBusinesses }, "Generating population");

    const foodBusinessCount = Math.floor(initialBusinesses * 0.6);
    const serviceBusinessCount = initialBusinesses - foodBusinessCount;

    const businessInserts = [];
    for (let i = 0; i < foodBusinessCount; i++) {
      businessInserts.push({
        name: `${pick(FOOD_BUSINESS_NAMES)} №${i + 1}`,
        type: "food",
        balance: rand(1000, 5000),
        productionRate: rand(5, 20),
        ownerId: null,
      });
    }
    for (let i = 0; i < serviceBusinessCount; i++) {
      businessInserts.push({
        name: `${pick(SERVICE_BUSINESS_NAMES)} №${i + 1}`,
        type: "service",
        balance: rand(800, 4000),
        productionRate: rand(3, 15),
        ownerId: null,
      });
    }

    const savedBusinesses = await db.insert(businessesTable).values(businessInserts).returning();
    for (const b of savedBusinesses) {
      this.businesses.set(b.id, { ...b, employeeCount: 0 });
    }

    const foodBusinessIds = savedBusinesses.filter(b => b.type === "food").map(b => b.id);
    const serviceBusinessIds = savedBusinesses.filter(b => b.type === "service").map(b => b.id);

    const goodInserts = [];
    for (const bId of foodBusinessIds) {
      const goodName = pick(FOOD_GOOD_NAMES);
      goodInserts.push({
        name: goodName,
        businessId: bId,
        basePrice: baseFoodPrice,
        currentPrice: baseFoodPrice * (1 + this.config.priceMarkup),
        quality: rand(30, 90),
        demand: rand(40, 80),
        supply: rand(40, 80),
      });
    }
    for (const bId of serviceBusinessIds) {
      const goodName = pick(SERVICE_GOOD_NAMES);
      goodInserts.push({
        name: goodName,
        businessId: bId,
        basePrice: baseFoodPrice * 2,
        currentPrice: baseFoodPrice * 2 * (1 + this.config.priceMarkup),
        quality: rand(30, 90),
        demand: rand(30, 70),
        supply: rand(30, 70),
      });
    }

    const savedGoods = await db.insert(goodsTable).values(goodInserts).returning();
    for (const g of savedGoods) {
      this.goods.set(g.id, g);
    }

    const BATCH_SIZE = 200;
    const allBizIds = savedBusinesses.map(b => b.id);
    const agentInserts = [];
    for (let i = 0; i < initialAgents; i++) {
      const gender = Math.random() < 0.5 ? "male" : "female";
      const name = gender === "male" ? pick(MALE_NAMES) : pick(FEMALE_NAMES);
      const employerId = Math.random() < 0.7 ? pick(allBizIds) : null;
      agentInserts.push({
        name,
        gender,
        age: randInt(18, 70),
        mood: rand(40, 80),
        money: rand(50, 500),
        personality: pick(PERSONALITIES),
        socialization: rand(30, 80),
        currentAction: "idle",
        employerId,
        locationX: rand(0, 1000),
        locationY: rand(0, 1000),
      });
    }

    for (let i = 0; i < agentInserts.length; i += BATCH_SIZE) {
      const batch = agentInserts.slice(i, i + BATCH_SIZE);
      const saved = await db.insert(agentsTable).values(batch).returning();

      const needsInserts = saved.map(a => ({
        agentId: a.id,
        hunger: rand(50, 95),
        comfort: rand(50, 95),
        social: rand(50, 95),
      }));

      const savedNeeds = await db.insert(needsTable).values(needsInserts).returning();
      const needsMap = new Map<number, typeof savedNeeds[0]>();
      for (const n of savedNeeds) needsMap.set(n.agentId, n);

      for (const agent of saved) {
        const needs = needsMap.get(agent.id);
        if (!needs) continue;
        this.agents.set(agent.id, {
          ...agent,
          needs: { hunger: needs.hunger, comfort: needs.comfort, social: needs.social },
          needsId: needs.id,
        });
        if (agent.employerId) {
          const biz = this.businesses.get(agent.employerId);
          if (biz) biz.employeeCount++;
        }
      }
    }

    const allAgentIds = Array.from(this.agents.keys());
    const relationInserts = [];
    const relCount = Math.min(initialAgents * 3, 5000);
    for (let i = 0; i < relCount; i++) {
      const idA = pick(allAgentIds);
      let idB = pick(allAgentIds);
      while (idB === idA) idB = pick(allAgentIds);
      relationInserts.push({
        agentIdA: idA,
        agentIdB: idB,
        friendshipLevel: rand(10, 70),
      });
    }
    if (relationInserts.length > 0) {
      await db.insert(relationsTable).values(relationInserts);
    }

    logger.info({ agents: this.agents.size, businesses: this.businesses.size, goods: this.goods.size }, "Population generated");
  }

  async start(): Promise<void> {
    if (this.state.running) return;
    this.state.running = true;
    await this.persistState();
    this.startTimer();
    logger.info("Simulation started");
  }

  async stop(): Promise<void> {
    if (!this.state.running) return;
    this.state.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.persistState();
    logger.info("Simulation stopped");
  }

  async reset(): Promise<void> {
    await this.stop();
    logger.info("Resetting simulation...");

    await db.delete(statsHistoryTable);
    await db.delete(relationsTable);
    await db.delete(needsTable);
    await db.delete(agentsTable);
    await db.delete(goodsTable);
    await db.delete(businessesTable);

    this.agents.clear();
    this.businesses.clear();
    this.goods.clear();

    this.state = {
      tick: 0,
      running: false,
      gameHour: 0,
      gameDay: 1,
      governmentBudget: 10000,
      totalTaxCollected: 0,
      totalSubsidiesPaid: 0,
    };
    await this.persistState();
    await this.generatePopulation();
    logger.info("Simulation reset complete");
  }

  private startTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.tick().catch(err => {
        logger.error({ err }, "Tick error");
      });
    }, this.config.tickIntervalMs);
  }

  private async tick(): Promise<void> {
    if (!this.state.running) return;
    const startTime = Date.now();

    this.state.tick++;
    this.state.gameHour = (this.state.gameHour + 1) % 24;
    if (this.state.gameHour === 0) this.state.gameDay++;

    const { taxRate, needDecayRate, subsidyAmount, baseSalary, socialInteractionStrength } = this.config;

    let gdp = 0;
    let taxRevenue = 0;
    let subsidiesPaid = 0;

    const agentIds = Array.from(this.agents.keys());

    for (const agentId of agentIds) {
      const agent = this.agents.get(agentId);
      if (!agent) continue;

      agent.needs.hunger = clamp(agent.needs.hunger - needDecayRate * rand(0.5, 1.5));
      agent.needs.comfort = clamp(agent.needs.comfort - needDecayRate * rand(0.3, 1.0));
      agent.needs.social = clamp(agent.needs.social - needDecayRate * rand(0.4, 1.2));

      const criticalNeed = this.getCriticalNeed(agent.needs);
      let income = 0;

      if (criticalNeed === "hunger") {
        const foodGood = this.pickAvailableGood("food");
        if (foodGood && agent.money >= foodGood.currentPrice) {
          agent.money -= foodGood.currentPrice;
          agent.needs.hunger = clamp(agent.needs.hunger + rand(30, 60));
          agent.currentAction = "eat";
          foodGood.demand = clamp(foodGood.demand + 1, 0, 200);
          const bizId = foodGood.businessId;
          if (bizId) {
            const biz = this.businesses.get(bizId);
            if (biz) biz.balance += foodGood.currentPrice;
          }
          gdp += foodGood.currentPrice;
        } else if (!foodGood || agent.money < (foodGood?.currentPrice ?? 0)) {
          agent.currentAction = "work";
          if (agent.employerId) {
            const salary = baseSalary * rand(0.8, 1.2);
            const tax = salary * taxRate;
            income = salary - tax;
            agent.money += income;
            taxRevenue += tax;
            gdp += salary;
            const biz = this.businesses.get(agent.employerId);
            if (biz) biz.balance -= salary;
          }
        }
      } else if (criticalNeed === "comfort") {
        agent.needs.comfort = clamp(agent.needs.comfort + rand(20, 40));
        agent.currentAction = "rest";
        const serviceGood = this.pickAvailableGood("service");
        if (serviceGood && agent.money >= serviceGood.currentPrice * 0.5) {
          agent.money -= serviceGood.currentPrice * 0.5;
          serviceGood.demand = clamp(serviceGood.demand + 0.5, 0, 200);
        }
      } else if (criticalNeed === "social") {
        const partnerId = this.pickSocialPartner(agentId, agentIds);
        if (partnerId) {
          const partner = this.agents.get(partnerId);
          if (partner) {
            const interaction = rand(-1, 3);
            agent.needs.social = clamp(agent.needs.social + rand(20, 50));
            partner.needs.social = clamp(partner.needs.social + rand(10, 30));
            agent.mood = clamp(agent.mood + interaction * socialInteractionStrength);
            partner.mood = clamp(partner.mood + interaction * socialInteractionStrength * 0.5);
          }
        }
        agent.currentAction = "socialize";
      } else {
        if (agent.employerId) {
          const salary = baseSalary * rand(0.8, 1.2);
          const tax = salary * taxRate;
          income = salary - tax;
          agent.money += income;
          taxRevenue += tax;
          gdp += salary;
          const biz = this.businesses.get(agent.employerId);
          if (biz) biz.balance -= salary;
          agent.currentAction = "work";
        } else {
          agent.currentAction = "idle";
        }
      }

      agent.mood = clamp(
        agent.mood +
          (agent.needs.hunger - 50) * 0.01 +
          (agent.needs.comfort - 50) * 0.01 +
          (agent.needs.social - 50) * 0.005
      );

      if (agent.money <= 0) {
        agent.money += subsidyAmount;
        subsidiesPaid += subsidyAmount;
      }
    }

    this.state.governmentBudget += taxRevenue - subsidiesPaid;
    this.state.totalTaxCollected += taxRevenue;
    this.state.totalSubsidiesPaid += subsidiesPaid;

    this.updateGoodPrices();
    this.updateBusinesses();

    const elapsed = Date.now() - startTime;
    logger.debug({ tick: this.state.tick, elapsed, agentCount: this.agents.size }, "Tick complete");

    this.syncCounter++;
    if (this.syncCounter >= 1) {
      this.syncCounter = 0;
      await this.syncToDB(gdp);
    }
  }

  private getCriticalNeed(needs: { hunger: number; comfort: number; social: number }): string {
    const threshold = 30;
    if (needs.hunger < threshold && needs.hunger <= needs.comfort && needs.hunger <= needs.social) return "hunger";
    if (needs.comfort < threshold && needs.comfort <= needs.social) return "comfort";
    if (needs.social < threshold) return "social";
    return "work";
  }

  private pickAvailableGood(type: "food" | "service"): GoodState | null {
    const relevant = Array.from(this.goods.values()).filter(g => {
      const biz = g.businessId ? this.businesses.get(g.businessId) : null;
      return biz && biz.type === type;
    });
    if (relevant.length === 0) return null;
    return pick(relevant);
  }

  private pickSocialPartner(agentId: number, allIds: number[]): number | null {
    const candidates = allIds.filter(id => id !== agentId);
    if (candidates.length === 0) return null;
    return pick(candidates);
  }

  private updateGoodPrices(): void {
    for (const good of this.goods.values()) {
      const demandFactor = (good.demand - 50) / 100;
      const { baseFoodPrice, priceMarkup } = this.config;
      const base = good.businessId
        ? (this.businesses.get(good.businessId)?.type === "food" ? baseFoodPrice : baseFoodPrice * 2)
        : baseFoodPrice;
      good.currentPrice = Math.max(1, base * (1 + priceMarkup) + base * demandFactor);
      good.demand = clamp(good.demand - rand(0, 2), 0, 200);
      good.supply = clamp(good.supply + rand(0, 3), 0, 200);
    }
  }

  private updateBusinesses(): void {
    for (const biz of this.businesses.values()) {
      if (biz.balance < 0) biz.balance = Math.max(biz.balance + biz.productionRate * 5, 0);
    }
  }

  private async syncToDB(gdp: number): Promise<void> {
    await this.persistState();

    const BATCH_SIZE = 100;
    const agentArray = Array.from(this.agents.values());
    for (let i = 0; i < agentArray.length; i += BATCH_SIZE) {
      const batch = agentArray.slice(i, i + BATCH_SIZE);
      for (const agent of batch) {
        await db.update(agentsTable)
          .set({ mood: agent.mood, money: agent.money, currentAction: agent.currentAction })
          .where(eq(agentsTable.id, agent.id));
        await db.update(needsTable)
          .set({ hunger: agent.needs.hunger, comfort: agent.needs.comfort, social: agent.needs.social })
          .where(eq(needsTable.agentId, agent.id));
      }
    }

    const goodsArray = Array.from(this.goods.values());
    for (const good of goodsArray) {
      await db.update(goodsTable)
        .set({ currentPrice: good.currentPrice, demand: good.demand, supply: good.supply })
        .where(eq(goodsTable.id, good.id));
    }

    const bizArray = Array.from(this.businesses.values());
    for (const biz of bizArray) {
      await db.update(businessesTable)
        .set({ balance: biz.balance })
        .where(eq(businessesTable.id, biz.id));
    }

    const { avgMood, avgWealth, unemploymentRate } = this.getAggregateStats();
    await db.insert(statsHistoryTable).values({
      tick: this.state.tick,
      gameHour: this.state.gameHour,
      gameDay: this.state.gameDay,
      avgMood,
      gdp,
      population: this.agents.size,
      avgWealth,
      unemploymentRate,
      governmentBudget: this.state.governmentBudget,
    });
  }

  private async persistState(): Promise<void> {
    const [existing] = await db.select().from(simStateTable).limit(1);
    if (existing) {
      await db.update(simStateTable).set({
        tick: this.state.tick,
        running: this.state.running,
        gameHour: this.state.gameHour,
        gameDay: this.state.gameDay,
        governmentBudget: this.state.governmentBudget,
        totalTaxCollected: this.state.totalTaxCollected,
        totalSubsidiesPaid: this.state.totalSubsidiesPaid,
        updatedAt: new Date(),
      }).where(eq(simStateTable.id, existing.id));
    }
  }

  private getAggregateStats() {
    const agents = Array.from(this.agents.values());
    if (agents.length === 0) return { avgMood: 0, avgWealth: 0, unemploymentRate: 0 };
    const avgMood = agents.reduce((s, a) => s + a.mood, 0) / agents.length;
    const avgWealth = agents.reduce((s, a) => s + a.money, 0) / agents.length;
    const employed = agents.filter(a => a.employerId != null).length;
    const unemploymentRate = ((agents.length - employed) / agents.length) * 100;
    return { avgMood, avgWealth, unemploymentRate };
  }

  getSimulationState() {
    const { avgMood, avgWealth, unemploymentRate } = this.getAggregateStats();
    const gdp = Array.from(this.businesses.values()).reduce((s, b) => s + b.balance, 0);
    return {
      tick: this.state.tick,
      running: this.state.running,
      gameHour: this.state.gameHour,
      gameDay: this.state.gameDay,
      population: this.agents.size,
      avgMood: Math.round(avgMood * 10) / 10,
      gdp: Math.round(gdp),
      unemploymentRate: Math.round(unemploymentRate * 10) / 10,
      governmentBudget: Math.round(this.state.governmentBudget * 100) / 100,
      totalTaxCollected: Math.round(this.state.totalTaxCollected * 100) / 100,
      avgWealth: Math.round(avgWealth * 100) / 100,
    };
  }

  getAgents(page: number, limit: number, sortBy?: string, sortDir?: string, filterAction?: string) {
    let agents = Array.from(this.agents.values());
    if (filterAction) {
      agents = agents.filter(a => a.currentAction === filterAction);
    }
    if (sortBy) {
      agents.sort((a, b) => {
        const aVal = (a as any)[sortBy] ?? 0;
        const bVal = (b as any)[sortBy] ?? 0;
        const cmp = typeof aVal === "string" ? aVal.localeCompare(bVal) : aVal - bVal;
        return sortDir === "desc" ? -cmp : cmp;
      });
    }
    const total = agents.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    return {
      agents: agents.slice(offset, offset + limit).map(a => ({
        id: a.id,
        name: a.name,
        gender: a.gender,
        age: a.age,
        mood: Math.round(a.mood * 10) / 10,
        money: Math.round(a.money * 100) / 100,
        personality: a.personality,
        socialization: a.socialization,
        currentAction: a.currentAction,
        employerId: a.employerId,
      })),
      total,
      page,
      limit,
      totalPages,
    };
  }

  getAgent(id: number) {
    const agent = this.agents.get(id);
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      gender: agent.gender,
      age: agent.age,
      mood: Math.round(agent.mood * 10) / 10,
      money: Math.round(agent.money * 100) / 100,
      personality: agent.personality,
      socialization: agent.socialization,
      currentAction: agent.currentAction,
      employerId: agent.employerId,
      needs: {
        hunger: Math.round(agent.needs.hunger * 10) / 10,
        comfort: Math.round(agent.needs.comfort * 10) / 10,
        social: Math.round(agent.needs.social * 10) / 10,
      },
    };
  }

  async getAgentRelations(agentId: number) {
    const rows = await db
      .select()
      .from(relationsTable)
      .where(eq(relationsTable.agentIdA, agentId))
      .limit(20);
    return rows.map(r => {
      const other = this.agents.get(r.agentIdB);
      return {
        otherId: r.agentIdB,
        otherName: other?.name ?? `Агент ${r.agentIdB}`,
        friendshipLevel: Math.round(r.friendshipLevel * 10) / 10,
      };
    });
  }

  getBusinesses() {
    return Array.from(this.businesses.values()).map(b => ({
      id: b.id,
      name: b.name,
      type: b.type,
      balance: Math.round(b.balance * 100) / 100,
      productionRate: b.productionRate,
      employeeCount: b.employeeCount,
      ownerId: b.ownerId,
    }));
  }

  getGoods() {
    return Array.from(this.goods.values()).map(g => ({
      id: g.id,
      name: g.name,
      basePrice: Math.round(g.basePrice * 100) / 100,
      currentPrice: Math.round(g.currentPrice * 100) / 100,
      quality: g.quality,
      demand: Math.round(g.demand * 10) / 10,
      supply: Math.round(g.supply * 10) / 10,
    }));
  }

  getGovernment() {
    return {
      budget: Math.round(this.state.governmentBudget * 100) / 100,
      totalTaxCollected: Math.round(this.state.totalTaxCollected * 100) / 100,
      totalSubsidiesPaid: Math.round(this.state.totalSubsidiesPaid * 100) / 100,
      taxRate: this.config.taxRate,
      subsidyAmount: this.config.subsidyAmount,
    };
  }

  getConfig(): SimulationConfig {
    return { ...this.config };
  }

  async updateConfig(updates: Partial<SimulationConfig>): Promise<SimulationConfig> {
    this.config = { ...this.config, ...updates };
    await this.saveConfig();
    if (this.state.running && updates.tickIntervalMs != null) {
      this.startTimer();
    }
    return this.config;
  }

  getStatsSummary() {
    const agents = Array.from(this.agents.values());
    if (agents.length === 0) {
      return {
        totalAgents: 0,
        totalBusinesses: this.businesses.size,
        totalGoods: this.goods.size,
        employedAgents: 0,
        unemployedAgents: 0,
        avgMood: 0,
        avgWealth: 0,
        gdp: 0,
        richestAgent: null,
        happiestAgent: null,
        mostPopularGood: null,
      };
    }
    const employed = agents.filter(a => a.employerId != null);
    const avgMood = agents.reduce((s, a) => s + a.mood, 0) / agents.length;
    const avgWealth = agents.reduce((s, a) => s + a.money, 0) / agents.length;
    const richest = agents.reduce((max, a) => a.money > max.money ? a : max, agents[0]);
    const happiest = agents.reduce((max, a) => a.mood > max.mood ? a : max, agents[0]);
    const goodsSorted = Array.from(this.goods.values()).sort((a, b) => b.demand - a.demand);
    const gdp = Array.from(this.businesses.values()).reduce((s, b) => s + b.balance, 0);
    return {
      totalAgents: agents.length,
      totalBusinesses: this.businesses.size,
      totalGoods: this.goods.size,
      employedAgents: employed.length,
      unemployedAgents: agents.length - employed.length,
      avgMood: Math.round(avgMood * 10) / 10,
      avgWealth: Math.round(avgWealth * 100) / 100,
      gdp: Math.round(gdp),
      richestAgent: richest?.name ?? null,
      happiestAgent: happiest?.name ?? null,
      mostPopularGood: goodsSorted[0]?.name ?? null,
    };
  }

  getTopAgents() {
    const agents = Array.from(this.agents.values());
    const byWealth = [...agents].sort((a, b) => b.money - a.money).slice(0, 10).map(a => ({
      id: a.id, name: a.name, gender: a.gender, age: a.age,
      mood: Math.round(a.mood * 10) / 10, money: Math.round(a.money * 100) / 100,
      personality: a.personality, socialization: a.socialization, currentAction: a.currentAction, employerId: a.employerId,
    }));
    const byMood = [...agents].sort((a, b) => b.mood - a.mood).slice(0, 10).map(a => ({
      id: a.id, name: a.name, gender: a.gender, age: a.age,
      mood: Math.round(a.mood * 10) / 10, money: Math.round(a.money * 100) / 100,
      personality: a.personality, socialization: a.socialization, currentAction: a.currentAction, employerId: a.employerId,
    }));
    return { byWealth, byMood };
  }
}

export const simulationEngine = new SimulationEngine();
