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
  agentStatHistoryTable,
  type Agent,
  type Needs,
  type Business,
  type Good,
} from "@workspace/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
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
  pensionRate: number;
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
  pensionRate: 0.6,
};

const AGENT_SORT_KEYS = ["name", "age", "mood", "money", "currentAction"] as const;
type AgentSortKey = typeof AGENT_SORT_KEYS[number];

interface JobHistoryEntry {
  tick: number;
  event: "hired" | "fired" | "retired";
  businessId: number | null;
  businessName: string | null;
}

interface AgentState extends Agent {
  needs: { hunger: number; comfort: number; social: number; health: number; sleep: number };
  needsId: number;
  recentActions: string[];
  jobHistory: JobHistoryEntry[];
}

interface BusinessState extends Business {
  employeeCount: number;
  firedThisTick: number;
  hiredThisTick: number;
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
  totalPensionPaid: number;
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
const FOOD_BUSINESS_NAMES = ["Пекарня", "Кафе", "Столовая", "Ресторан", "Супермаркет", "Закусочная", "Продуктовый"];
const SERVICE_BUSINESS_NAMES = ["Парикмахерская", "Магазин", "Сервисный центр", "Прачечная", "Ателье", "Аптека", "Химчистка"];
const HOSPITAL_BUSINESS_NAMES = ["Городская больница", "Поликлиника", "Медицинский центр", "Амбулатория", "Клиника здоровья", "Медпункт"];
const FARM_BUSINESS_NAMES = ["Агроферма", "Молочная ферма", "Птицефабрика", "Зерновое хозяйство", "Овощная ферма", "Животноводческий комплекс", "Тепличный комбинат"];
const WORKSHOP_BUSINESS_NAMES = ["Производственный цех", "Фабрика материалов", "Завод комплектующих", "Цех упаковки", "Текстильная фабрика", "Химический завод"];
const FOOD_GOOD_NAMES = ["Хлеб", "Молоко", "Мясо", "Овощи", "Фрукты", "Рыба", "Крупа"];
const SERVICE_GOOD_NAMES = ["Одежда", "Инструменты", "Бытовая химия", "Электроника", "Мебель"];
const HOSPITAL_GOOD_NAMES = ["Лечение", "Медосмотр", "Операция", "Консультация врача", "Физиотерапия"];
const RAW_FOOD_GOOD_NAMES = ["Зерно", "Сырое молоко", "Овощи с поля", "Яйца", "Мясо сырое", "Мука", "Корм"];
const RAW_MATERIAL_GOOD_NAMES = ["Детали", "Запчасти", "Сырьё", "Химикаты", "Ткань", "Металл"];
const ACTIONS = ["eat", "rest", "sleep", "socialize", "work", "idle", "heal"];

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

const AGENT_STAT_HISTORY_MAX = 20;

interface AgentStatSnapshot {
  tick: number;
  money: number;
  mood: number;
  age: number;
  socialization: number;
}

export interface TickDebugReport {
  tick: number;
  elapsedMs: number;
  computedAt: number;
  agents: {
    processed: number;
    skipped: number;
    actions: { work: number; eat: number; rest: number; socialize: number; idle: number };
    moneyIn: number;
    moneyOut: number;
  };
  businesses: {
    total: number;
    active: number;
    unprofitable: number;
    staffless: number;
    employed: number;
    hired: number;
    fired: number;
    balanceBefore: number;
    balanceAfter: number;
    wagesPaid: number;
  };
  government: {
    budgetBefore: number;
    budgetAfter: number;
    taxRevenue: number;
    pensionsPaid: number;
    subsidiesPaid: number;
    pensionRecipients: number;
    subsidyRecipients: number;
  };
  market: {
    totalDemand: number;
    totalSupply: number;
    avgPrice: number;
    priceChangePct: number;
    bigPriceSpikes: number;
    successfulPurchases: number;
    failedNoGoods: number;
    failedNoMoney: number;
  };
  integrity: {
    negativeMoneyAgents: number;
    nanValues: number;
    totalMoneyAgents: number;
    totalMoneyBusinesses: number;
    governmentBudget: number;
    orphanedGoods: number;
  };
  chain: {
    b2bSuccess: number;
    b2bFail: number;
    farmSupplyTotal: number;
    workshopSupplyTotal: number;
    foodSupplyTotal: number;
    serviceSupplyTotal: number;
  };
}

class SimulationEngine {
  private agents: Map<number, AgentState> = new Map();
  private businesses: Map<number, BusinessState> = new Map();
  private goods: Map<number, GoodState> = new Map();
  /** agentIdA → Map<agentIdB, friendshipLevel> */
  private relations: Map<number, Map<number, number>> = new Map();
  private dirtyRelations: Set<string> = new Set();
  /** Tracks "agentIdA:agentIdB" pairs that already have a DB row (safe to UPDATE) */
  private persistedRelations: Set<string> = new Set();
  /** Per-agent stat history: last N snapshots keyed by agent id */
  private agentStatHistory: Map<number, AgentStatSnapshot[]> = new Map();
  private state: SimState = {
    tick: 0,
    running: false,
    gameHour: 0,
    gameDay: 1,
    governmentBudget: 10000,
    totalTaxCollected: 0,
    totalSubsidiesPaid: 0,
    totalPensionPaid: 0,
  };
  private config: SimulationConfig = { ...DEFAULT_CONFIG };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isTicking = false;
  private syncCounter = 0;
  private lastTickReport: TickDebugReport | null = null;
  private prevAvgPrice = 0;
  private lastBirths = 0;
  private lastDeaths = 0;

  async initialize(): Promise<void> {
    logger.info("Initializing simulation engine...");
    await this.loadConfig();
    await this.loadState();
    await this.loadAgents();
    await this.loadBusinesses();
    await this.loadGoods();
    await this.loadRelations();
    await this.loadAgentStatHistory();

    if (this.agents.size === 0) {
      logger.info("No agents found, generating initial population...");
      await this.generatePopulation();
      logger.info("Auto-starting simulation after initial population generation");
      await this.start();
    } else {
      await this.ensureHospitals();
      await this.ensureFarms();
      if (this.state.running) {
        logger.info("Resuming simulation from saved state");
        this.startTimer();
      }
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
      pensionRate: parseFloat(configMap.pensionRate ?? String(DEFAULT_CONFIG.pensionRate)),
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
        // Floor at 0 — negative budgets from old buggy code are reset on restart
        governmentBudget: Math.max(0, row.governmentBudget),
        totalTaxCollected: row.totalTaxCollected,
        totalSubsidiesPaid: row.totalSubsidiesPaid,
        totalPensionPaid: row.totalPensionPaid,
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
        totalPensionPaid: 0,
      });
    }
  }

  private async loadAgents(): Promise<void> {
    const agentRows = await db.select().from(agentsTable).limit(5000);
    const needsRows = await db.select().from(needsTable);
    const needsMap = new Map<number, { hunger: number; comfort: number; social: number; health: number; sleep: number; id: number }>();
    for (const n of needsRows) {
      needsMap.set(n.agentId, { hunger: n.hunger, comfort: n.comfort, social: n.social, health: n.health ?? 80, sleep: n.sleep ?? 80, id: n.id });
    }
    this.agents.clear();
    for (const agent of agentRows) {
      const needs = needsMap.get(agent.id) ?? { hunger: 80, comfort: 80, social: 80, health: 80, sleep: 80, id: 0 };
      let jobHistory: JobHistoryEntry[] = [];
      try { jobHistory = JSON.parse(agent.jobHistory ?? "[]"); } catch { jobHistory = []; }
      this.agents.set(agent.id, { ...agent, needs: { hunger: needs.hunger, comfort: needs.comfort, social: needs.social, health: needs.health, sleep: needs.sleep }, needsId: needs.id, recentActions: [], jobHistory });
    }
  }

  private async loadRelations(): Promise<void> {
    const rows = await db.select().from(relationsTable);
    this.relations.clear();
    this.dirtyRelations.clear();
    this.persistedRelations.clear();
    for (const r of rows) {
      let relMap = this.relations.get(r.agentIdA);
      if (!relMap) {
        relMap = new Map();
        this.relations.set(r.agentIdA, relMap);
      }
      relMap.set(r.agentIdB, r.friendshipLevel);
      this.persistedRelations.add(`${r.agentIdA}:${r.agentIdB}`);
    }
  }

  private async loadAgentStatHistory(): Promise<void> {
    this.agentStatHistory.clear();
    const rows = await db.execute(sql`
      SELECT agent_id, tick, money, mood, age, socialization
      FROM (
        SELECT agent_id, tick, money, mood, age, socialization,
               ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY tick DESC) AS rn
        FROM agent_stat_history
      ) ranked
      WHERE rn <= ${AGENT_STAT_HISTORY_MAX}
      ORDER BY agent_id, tick ASC
    `);
    for (const row of rows.rows) {
      const agentId = Number(row.agent_id);
      const snapshot: AgentStatSnapshot = {
        tick: Number(row.tick),
        money: Number(row.money),
        mood: Number(row.mood),
        age: Number(row.age),
        socialization: Number(row.socialization),
      };
      const history = this.agentStatHistory.get(agentId) ?? [];
      history.push(snapshot);
      this.agentStatHistory.set(agentId, history);
    }
    logger.info({ agentCount: this.agentStatHistory.size }, "Loaded agent stat history from DB");

    await db.execute(sql`
      DELETE FROM agent_stat_history
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY tick DESC) AS rn
          FROM agent_stat_history
        ) ranked
        WHERE rn <= ${AGENT_STAT_HISTORY_MAX}
      )
    `);
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
      this.businesses.set(b.id, { ...b, employeeCount: employeeCounts.get(b.id) ?? 0, firedThisTick: 0, hiredThisTick: 0 });
    }
  }

  private async loadGoods(): Promise<void> {
    const rows = await db.select().from(goodsTable);
    this.goods.clear();
    for (const g of rows) {
      this.goods.set(g.id, { ...g });
    }
  }

  private async ensureHospitals(): Promise<void> {
    const existingHospitals = Array.from(this.businesses.values()).filter(b => b.type === "hospital");
    if (existingHospitals.length > 0) {
      logger.info({ count: existingHospitals.length }, "Hospitals already present, skipping creation");
      return;
    }

    const { baseFoodPrice } = this.config;
    const hospitalCount = Math.max(5, Math.floor(this.businesses.size * 0.12));
    logger.info({ hospitalCount }, "No hospitals found — spawning hospitals for existing world");

    const businessInserts = [];
    for (let i = 0; i < hospitalCount; i++) {
      businessInserts.push({
        name: `${pick(HOSPITAL_BUSINESS_NAMES)} №${i + 1}`,
        type: "hospital",
        balance: rand(2000, 8000),
        productionRate: rand(2, 10),
        ownerId: null,
      });
    }

    const savedBiz = await db.insert(businessesTable).values(businessInserts).returning();
    for (const b of savedBiz) {
      this.businesses.set(b.id, { ...b, employeeCount: 0, firedThisTick: 0, hiredThisTick: 0 });
    }

    const goodInserts = savedBiz.map(b => ({
      name: pick(HOSPITAL_GOOD_NAMES),
      businessId: b.id,
      basePrice: baseFoodPrice * 3,
      currentPrice: baseFoodPrice * 3 * (1 + this.config.priceMarkup),
      quality: rand(50, 95),
      demand: rand(20, 50),
      supply: rand(30, 60),
    }));

    const savedGoods = await db.insert(goodsTable).values(goodInserts).returning();
    for (const g of savedGoods) {
      this.goods.set(g.id, { ...g });
    }

    logger.info({ hospitalCount, goodsCount: savedGoods.length }, "Hospitals spawned successfully");
  }

  private async ensureFarms(): Promise<void> {
    const existingFarms = Array.from(this.businesses.values()).filter(b => b.type === "farm");
    const existingWorkshops = Array.from(this.businesses.values()).filter(b => b.type === "workshop");
    if (existingFarms.length > 0 && existingWorkshops.length > 0) {
      logger.info({ farmCount: existingFarms.length, workshopCount: existingWorkshops.length }, "Raw producers already present, skipping");
      return;
    }

    const { baseFoodPrice } = this.config;
    const farmCount = Math.max(6, Math.floor(this.businesses.size * 0.08));
    const workshopCount = Math.max(4, Math.floor(this.businesses.size * 0.06));
    logger.info({ farmCount, workshopCount }, "Spawning raw producers for production chains");

    const bizInserts = [];
    for (let i = 0; i < farmCount; i++) {
      bizInserts.push({
        name: `${pick(FARM_BUSINESS_NAMES)} №${i + 1}`,
        type: "farm",
        balance: rand(3000, 9000),
        productionRate: rand(8, 20),
        ownerId: null,
      });
    }
    for (let i = 0; i < workshopCount; i++) {
      bizInserts.push({
        name: `${pick(WORKSHOP_BUSINESS_NAMES)} №${i + 1}`,
        type: "workshop",
        balance: rand(2000, 7000),
        productionRate: rand(6, 15),
        ownerId: null,
      });
    }

    const savedBiz = await db.insert(businessesTable).values(bizInserts).returning();
    for (const b of savedBiz) {
      this.businesses.set(b.id, { ...b, employeeCount: 0, firedThisTick: 0, hiredThisTick: 0 });
    }

    const goodInserts = savedBiz.map(b => {
      const isF = b.type === "farm";
      return {
        name: isF ? pick(RAW_FOOD_GOOD_NAMES) : pick(RAW_MATERIAL_GOOD_NAMES),
        businessId: b.id,
        basePrice: baseFoodPrice * (isF ? 0.5 : 0.8),
        currentPrice: baseFoodPrice * (isF ? 0.5 : 0.8),
        quality: rand(isF ? 60 : 50, 90),
        demand: rand(30, 60),
        supply: rand(60, 100),
      };
    });

    const savedGoods = await db.insert(goodsTable).values(goodInserts).returning();
    for (const g of savedGoods) this.goods.set(g.id, { ...g });

    logger.info({ farmCount, workshopCount, goodsCount: savedGoods.length }, "Raw producers spawned for production chains");
  }

  private async generatePopulation(): Promise<void> {
    const { initialAgents, initialBusinesses, baseFoodPrice, baseSalary } = this.config;
    logger.info({ initialAgents, initialBusinesses }, "Generating population");

    const hospitalBusinessCount = Math.max(5, Math.floor(initialBusinesses * 0.10));
    const farmBusinessCount = Math.max(6, Math.floor(initialBusinesses * 0.10));
    const workshopBusinessCount = Math.max(4, Math.floor(initialBusinesses * 0.07));
    const remaining = initialBusinesses - hospitalBusinessCount - farmBusinessCount - workshopBusinessCount;
    const foodBusinessCount = Math.floor(remaining * 0.60);
    const serviceBusinessCount = remaining - foodBusinessCount;

    const businessInserts = [];
    for (let i = 0; i < farmBusinessCount; i++) {
      businessInserts.push({
        name: `${pick(FARM_BUSINESS_NAMES)} №${i + 1}`,
        type: "farm",
        balance: rand(3000, 9000),
        productionRate: rand(8, 20),
        ownerId: null,
      });
    }
    for (let i = 0; i < workshopBusinessCount; i++) {
      businessInserts.push({
        name: `${pick(WORKSHOP_BUSINESS_NAMES)} №${i + 1}`,
        type: "workshop",
        balance: rand(2000, 7000),
        productionRate: rand(6, 15),
        ownerId: null,
      });
    }
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
    for (let i = 0; i < hospitalBusinessCount; i++) {
      businessInserts.push({
        name: `${pick(HOSPITAL_BUSINESS_NAMES)} №${i + 1}`,
        type: "hospital",
        balance: rand(2000, 8000),
        productionRate: rand(2, 10),
        ownerId: null,
      });
    }

    const savedBusinesses = await db.insert(businessesTable).values(businessInserts).returning();
    for (const b of savedBusinesses) {
      this.businesses.set(b.id, { ...b, employeeCount: 0, firedThisTick: 0, hiredThisTick: 0 });
    }

    const foodBusinessIds = savedBusinesses.filter(b => b.type === "food").map(b => b.id);
    const serviceBusinessIds = savedBusinesses.filter(b => b.type === "service").map(b => b.id);
    const hospitalBusinessIds = savedBusinesses.filter(b => b.type === "hospital").map(b => b.id);
    const farmBusinessIds = savedBusinesses.filter(b => b.type === "farm").map(b => b.id);
    const workshopBusinessIds = savedBusinesses.filter(b => b.type === "workshop").map(b => b.id);

    const goodInserts = [];
    for (const bId of farmBusinessIds) {
      goodInserts.push({
        name: pick(RAW_FOOD_GOOD_NAMES),
        businessId: bId,
        basePrice: baseFoodPrice * 0.5,
        currentPrice: baseFoodPrice * 0.5,
        quality: rand(60, 90),
        demand: rand(30, 60),
        supply: rand(60, 100),
      });
    }
    for (const bId of workshopBusinessIds) {
      goodInserts.push({
        name: pick(RAW_MATERIAL_GOOD_NAMES),
        businessId: bId,
        basePrice: baseFoodPrice * 0.8,
        currentPrice: baseFoodPrice * 0.8,
        quality: rand(50, 85),
        demand: rand(25, 55),
        supply: rand(50, 90),
      });
    }
    for (const bId of foodBusinessIds) {
      goodInserts.push({
        name: pick(FOOD_GOOD_NAMES),
        businessId: bId,
        basePrice: baseFoodPrice,
        currentPrice: baseFoodPrice * (1 + this.config.priceMarkup),
        quality: rand(30, 90),
        demand: rand(40, 80),
        supply: rand(40, 80),
      });
    }
    for (const bId of serviceBusinessIds) {
      goodInserts.push({
        name: pick(SERVICE_GOOD_NAMES),
        businessId: bId,
        basePrice: baseFoodPrice * 2,
        currentPrice: baseFoodPrice * 2 * (1 + this.config.priceMarkup),
        quality: rand(30, 90),
        demand: rand(30, 70),
        supply: rand(30, 70),
      });
    }
    for (const bId of hospitalBusinessIds) {
      goodInserts.push({
        name: pick(HOSPITAL_GOOD_NAMES),
        businessId: bId,
        basePrice: baseFoodPrice * 3,
        currentPrice: baseFoodPrice * 3 * (1 + this.config.priceMarkup),
        quality: rand(50, 95),
        demand: rand(20, 50),
        supply: rand(30, 60),
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
        health: rand(60, 90),
        sleep: rand(50, 90),
      }));

      const savedNeeds = await db.insert(needsTable).values(needsInserts).returning();
      const needsMap = new Map<number, typeof savedNeeds[0]>();
      for (const n of savedNeeds) needsMap.set(n.agentId, n);

      for (const agent of saved) {
        const needs = needsMap.get(agent.id);
        if (!needs) continue;
        this.agents.set(agent.id, {
          ...agent,
          needs: { hunger: needs.hunger, comfort: needs.comfort, social: needs.social, health: needs.health ?? 80, sleep: needs.sleep ?? 80 },
          needsId: needs.id,
          recentActions: [],
          jobHistory: agent.employerId ? [{ tick: 0, event: "hired", businessId: agent.employerId, businessName: this.businesses.get(agent.employerId)?.name ?? null }] : [],
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
      const level = rand(10, 70);
      relationInserts.push({ agentIdA: idA, agentIdB: idB, friendshipLevel: level });
    }
    if (relationInserts.length > 0) {
      await db.insert(relationsTable).values(relationInserts);
      for (const r of relationInserts) {
        let relMap = this.relations.get(r.agentIdA);
        if (!relMap) { relMap = new Map(); this.relations.set(r.agentIdA, relMap); }
        relMap.set(r.agentIdB, r.friendshipLevel);
        this.persistedRelations.add(`${r.agentIdA}:${r.agentIdB}`);
      }
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
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.persistState();
    logger.info("Simulation stopped");
  }

  private async waitForTickComplete(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (this.isTicking && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async reset(): Promise<void> {
    await this.stop();
    await this.waitForTickComplete();
    logger.info("Resetting simulation...");

    await db.delete(statsHistoryTable);
    await db.delete(agentStatHistoryTable);
    await db.delete(relationsTable);
    await db.delete(needsTable);
    await db.delete(agentsTable);
    await db.delete(goodsTable);
    await db.delete(businessesTable);

    this.agents.clear();
    this.businesses.clear();
    this.goods.clear();
    this.relations.clear();
    this.dirtyRelations.clear();
    this.persistedRelations.clear();
    this.agentStatHistory.clear();

    this.state = {
      tick: 0,
      running: false,
      gameHour: 0,
      gameDay: 1,
      governmentBudget: 10000,
      totalTaxCollected: 0,
      totalSubsidiesPaid: 0,
      totalPensionPaid: 0,
    };
    await this.persistState();
    await this.generatePopulation();
    await this.start();
    logger.info("Simulation reset complete");
  }

  private startTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduleNextTick();
  }

  private scheduleNextTick(): void {
    if (!this.state.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.isTicking) {
        this.scheduleNextTick();
        return;
      }
      this.isTicking = true;
      this.tick()
        .catch(err => { logger.error({ err }, "Tick error"); })
        .finally(() => {
          this.isTicking = false;
          this.scheduleNextTick();
        });
    }, this.config.tickIntervalMs);
  }

  private async tick(): Promise<void> {
    if (!this.state.running) return;
    const startTime = Date.now();

    this.state.tick++;
    this.state.gameHour = (this.state.gameHour + 1) % 24;
    if (this.state.gameHour === 0) this.state.gameDay++;

    for (const biz of this.businesses.values()) {
      biz.firedThisTick = 0;
      biz.hiredThisTick = 0;
    }

    const { taxRate, needDecayRate, subsidyAmount, baseSalary, socialInteractionStrength, pensionRate } = this.config;

    const isNewDay = this.state.gameHour === 0;
    const dailyDeaths: number[] = [];
    // Dynamic birth rate: high when far from 1000-agent target, drops at capacity
    const popTarget = 1000;
    const birthRate = this.agents.size < popTarget
      ? Math.max(0.04, 0.08 * (1 - this.agents.size / popTarget)) // 8% → 4% as pop grows
      : 0.003; // maintenance rate above target
    const plannedBirths = isNewDay ? Math.max(2, Math.round(this.agents.size * birthRate)) : 0;

    let gdp = 0;
    let taxRevenue = 0;
    let subsidiesPaid = 0;
    let pensionPaid = 0;
    let runningBudget = this.state.governmentBudget;

    const dbgBudgetBefore = runningBudget;
    const dbgBizBalanceBefore = Array.from(this.businesses.values()).reduce((s, b) => s + b.balance, 0);
    let dbgActWork = 0, dbgActEat = 0, dbgActRest = 0, dbgActSocialize = 0, dbgActIdle = 0, dbgActSleep = 0, dbgActHeal = 0;
    let dbgMoneyIn = 0, dbgMoneyOut = 0, dbgWagesPaid = 0;
    let dbgSuccessful = 0, dbgFailedNoGoods = 0, dbgFailedNoMoney = 0;
    let dbgPensionRecipients = 0, dbgSubsidyRecipients = 0;
    let dbgSkipped = 0;

    const agentIds = Array.from(this.agents.keys());

    // Include businesses with balance > -200 so that recovering businesses can still hire
    const availableBusinessIds = Array.from(this.businesses.values())
      .filter(b => b.balance > -200 && b.type !== "farm" && b.type !== "workshop")
      .map(b => b.id);

    for (const agentId of agentIds) {
      const agent = this.agents.get(agentId);
      if (!agent) continue;

      // Age progression + retirement + death: once per game day
      if (isNewDay) {
        agent.age++;

        // Retirement: agents at or above 65 who aren't yet retired
        if (!agent.isRetired && agent.age >= 65) {
          if (agent.employerId != null) {
            const oldBiz = this.businesses.get(agent.employerId);
            if (oldBiz) oldBiz.employeeCount = Math.max(0, oldBiz.employeeCount - 1);
            agent.jobHistory = [...agent.jobHistory, { tick: this.state.tick, event: "retired", businessId: agent.employerId, businessName: oldBiz?.name ?? null }];
            agent.employerId = null;
          } else {
            agent.jobHistory = [...agent.jobHistory, { tick: this.state.tick, event: "retired", businessId: null, businessName: null }];
          }
          agent.isRetired = true;
        }

        // Death: retired agents have an age-based daily mortality chance
        if (agent.isRetired) {
          const deathChance = Math.min((agent.age - 64) * 0.005, 0.5);
          if (Math.random() < deathChance) {
            dailyDeaths.push(agentId);
            dbgSkipped++;
            continue; // skip all further processing for this agent
          }
        }
      }

      // Death from health reaching zero (any agent, any tick)
      if (agent.needs.health <= 0) {
        dailyDeaths.push(agentId);
        dbgSkipped++;
        continue;
      }

      // Pension: once per game day only (not every tick)
      if (isNewDay && agent.isRetired) {
        const pensionAmount = baseSalary * pensionRate;
        if (runningBudget >= pensionAmount) {
          agent.money += pensionAmount;
          pensionPaid += pensionAmount;
          runningBudget -= pensionAmount;
          dbgPensionRecipients++;
          dbgMoneyIn += pensionAmount;
        }
      }

      // Firing: if employer's balance is below zero, fire this agent (50% chance to spread out firings)
      if (!agent.isRetired && agent.employerId != null) {
        const employer = this.businesses.get(agent.employerId);
        if (employer && employer.balance < 0 && Math.random() < 0.5) {
          employer.employeeCount = Math.max(0, employer.employeeCount - 1);
          employer.firedThisTick++;
          agent.jobHistory = [...agent.jobHistory, { tick: this.state.tick, event: "fired", businessId: agent.employerId, businessName: employer.name }];
          agent.employerId = null;
        }
      }

      // Job seeking: unemployed, non-retired agents have a 30% chance to find work
      if (!agent.isRetired && agent.employerId == null && availableBusinessIds.length > 0 && Math.random() < 0.30) {
        const newBizId = pick(availableBusinessIds);
        const newBiz = this.businesses.get(newBizId);
        if (newBiz) {
          agent.employerId = newBizId;
          newBiz.employeeCount++;
          newBiz.hiredThisTick++;
          agent.jobHistory = [...agent.jobHistory, { tick: this.state.tick, event: "hired", businessId: newBizId, businessName: newBiz.name }];
        }
      }

      agent.needs.hunger = clamp(agent.needs.hunger - needDecayRate * rand(0.5, 1.5));
      agent.needs.comfort = clamp(agent.needs.comfort - needDecayRate * rand(0.3, 1.0));
      agent.needs.social = clamp(agent.needs.social - needDecayRate * rand(0.4, 1.2));
      agent.needs.sleep = clamp(agent.needs.sleep - 2.5 * rand(0.8, 1.2));

      // Health dynamics
      let healthDelta = 0;
      if (agent.needs.hunger < 30) healthDelta -= 0.8;  // starvation hurts
      if (agent.needs.sleep < 20) healthDelta -= 1.2;   // exhaustion hurts
      if (agent.needs.hunger > 50 && agent.needs.sleep > 50) healthDelta += 0.2; // natural recovery
      healthDelta -= 0.01; // slow aging wear (reduced to prevent unnecessary deaths)
      agent.needs.health = clamp(agent.needs.health + healthDelta);

      const criticalNeed = this.getCriticalNeed(agent.needs);
      let income = 0;

      if (criticalNeed === "sleep") {
        // Agent sleeps: recover sleep, boost health a little
        agent.needs.sleep = clamp(agent.needs.sleep + rand(22, 35));
        agent.needs.health = clamp(agent.needs.health + 0.3);
        agent.currentAction = "sleep";
      } else if (criticalNeed === "health") {
        // Try to visit a hospital; fall back to home rest if unavailable or unaffordable
        const hospitalGood = this.pickAvailableGood("hospital");
        if (hospitalGood && agent.money >= hospitalGood.currentPrice) {
          agent.money -= hospitalGood.currentPrice;
          agent.needs.health = clamp(agent.needs.health + rand(15, 28));
          agent.needs.comfort = clamp(agent.needs.comfort + rand(5, 12));
          agent.currentAction = "heal";
          hospitalGood.demand = clamp(hospitalGood.demand + 1, 0, 200);
          const bizId = hospitalGood.businessId;
          if (bizId) {
            const biz = this.businesses.get(bizId);
            if (biz) biz.balance += hospitalGood.currentPrice;
          }
          gdp += hospitalGood.currentPrice;
          dbgMoneyOut += hospitalGood.currentPrice;
          dbgSuccessful++;
        } else {
          // No hospital available or can't afford → rest at home
          agent.needs.sleep = clamp(agent.needs.sleep + rand(10, 18));
          agent.needs.comfort = clamp(agent.needs.comfort + rand(5, 12));
          agent.needs.health = clamp(agent.needs.health + 0.3);
          agent.currentAction = "rest";
        }
      } else if (criticalNeed === "hunger") {
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
          dbgMoneyOut += foodGood.currentPrice;
          dbgSuccessful++;
        } else if (!foodGood || agent.money < (foodGood?.currentPrice ?? 0)) {
          if (!foodGood) dbgFailedNoGoods++;
          else dbgFailedNoMoney++;
          if (agent.employerId) {
            agent.currentAction = "work";
            const salary = baseSalary * rand(0.8, 1.2);
            const tax = salary * taxRate;
            income = salary - tax;
            agent.money += income;
            taxRevenue += tax;
            runningBudget += tax;
            gdp += salary;
            const biz = this.businesses.get(agent.employerId);
            if (biz) biz.balance -= salary;
            dbgMoneyIn += income;
            dbgWagesPaid += salary;
          } else {
            agent.currentAction = "idle";
          }
        }
      } else if (criticalNeed === "comfort") {
        agent.needs.comfort = clamp(agent.needs.comfort + rand(20, 40));
        agent.currentAction = "rest";
        const serviceGood = this.pickAvailableGood("service");
        if (serviceGood && agent.money >= serviceGood.currentPrice * 0.5) {
          agent.money -= serviceGood.currentPrice * 0.5;
          serviceGood.demand = clamp(serviceGood.demand + 0.5, 0, 200);
          dbgMoneyOut += serviceGood.currentPrice * 0.5;
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
            // Update friendship levels based on quality of interaction
            this.updateRelation(agentId, partnerId, interaction * 5);
            this.updateRelation(partnerId, agentId, interaction * 2.5);
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
          runningBudget += tax;
          gdp += salary;
          const biz = this.businesses.get(agent.employerId);
          if (biz) biz.balance -= salary;
          agent.currentAction = "work";
          dbgMoneyIn += income;
          dbgWagesPaid += salary;
        } else {
          agent.currentAction = "idle";
        }
      }

      agent.mood = clamp(
        agent.mood +
          (agent.needs.hunger - 50) * 0.01 +
          (agent.needs.comfort - 50) * 0.01 +
          (agent.needs.social - 50) * 0.005 +
          (agent.needs.health - 50) * 0.008 +
          (agent.needs.sleep - 50) * 0.005
      );

      // Subsidy: once per game day only, capped at subsidyAmount per day
      if (isNewDay && agent.money <= 10 && runningBudget >= subsidyAmount) {
        agent.money += subsidyAmount;
        subsidiesPaid += subsidyAmount;
        runningBudget -= subsidyAmount;
        dbgSubsidyRecipients++;
      }

      // Count action for debug report
      const act = agent.currentAction;
      if (act === "work") dbgActWork++;
      else if (act === "eat") dbgActEat++;
      else if (act === "rest") dbgActRest++;
      else if (act === "socialize") dbgActSocialize++;
      else if (act === "sleep") dbgActSleep++;
      else if (act === "heal") dbgActHeal++;
      else dbgActIdle++;

      // Track recent actions (keep last 10)
      agent.recentActions.push(agent.currentAction);
      if (agent.recentActions.length > 10) agent.recentActions.shift();
    }

    // Budget is already tracked via runningBudget throughout the tick
    this.state.governmentBudget = runningBudget;
    this.state.totalTaxCollected += taxRevenue;
    this.state.totalSubsidiesPaid += subsidiesPaid;
    this.state.totalPensionPaid += pensionPaid;

    // Process daily lifecycle: remove dead agents, spawn newborns
    if (isNewDay) {
      if (dailyDeaths.length > 0) {
        for (const deadId of dailyDeaths) {
          const deadAgent = this.agents.get(deadId);
          if (!deadAgent) continue;
          // Employer headcount
          if (deadAgent.employerId) {
            const biz = this.businesses.get(deadAgent.employerId);
            if (biz) biz.employeeCount = Math.max(0, biz.employeeCount - 1);
          }
          // Remove from memory
          this.agents.delete(deadId);
          this.relations.delete(deadId);
          for (const relMap of this.relations.values()) relMap.delete(deadId);
          this.dirtyRelations.delete(`${deadId}:`);
        }
        this.lastDeaths = dailyDeaths.length;
        await this.purgeDeadAgents(dailyDeaths);
        logger.info({ count: dailyDeaths.length, population: this.agents.size }, "Agents died");
      } else if (isNewDay) {
        this.lastDeaths = 0;
      }

      if (plannedBirths > 0) {
        this.lastBirths = plannedBirths;
        await this.spawnNewAgents(plannedBirths);
        logger.info({ count: plannedBirths, population: this.agents.size }, "New agents born");
      } else if (isNewDay) {
        this.lastBirths = 0;
      }
    }

    const prevGoodPrices = new Map(Array.from(this.goods.entries()).map(([id, g]) => [id, g.currentPrice]));
    const chainResult = this.processProductionChains();
    this.updateGoodPrices();
    this.updateBusinesses();

    // Corporate tax: once per game day, 5% of profitable business balance
    if (isNewDay) {
      let corpTax = 0;
      for (const biz of this.businesses.values()) {
        if (biz.balance > 500) {
          const tax = biz.balance * 0.05;
          biz.balance -= tax;
          corpTax += tax;
        }
      }
      runningBudget += corpTax;
      taxRevenue += corpTax;
      this.state.governmentBudget = runningBudget;
      this.state.totalTaxCollected += corpTax;
    }

    const elapsed = Date.now() - startTime;
    logger.debug({ tick: this.state.tick, elapsed, agentCount: this.agents.size }, "Tick complete");

    // Compute tick debug report
    {
      const goodsArr = Array.from(this.goods.values());
      const totalDemand = goodsArr.reduce((s, g) => s + g.demand, 0);
      const totalSupply = goodsArr.reduce((s, g) => s + g.supply, 0);
      const avgPrice = goodsArr.length > 0 ? goodsArr.reduce((s, g) => s + g.currentPrice, 0) / goodsArr.length : 0;
      const priceChangePct = this.prevAvgPrice > 0 ? ((avgPrice - this.prevAvgPrice) / this.prevAvgPrice) * 100 : 0;
      const bigPriceSpikes = goodsArr.filter(g => {
        const prev = prevGoodPrices.get(g.id) ?? 0;
        return prev > 0 && Math.abs(g.currentPrice - prev) / prev > 0.2;
      }).length;
      this.prevAvgPrice = avgPrice;

      const bizArr = Array.from(this.businesses.values());
      const bizBalanceAfter = bizArr.reduce((s, b) => s + b.balance, 0);
      const totalHired = bizArr.reduce((s, b) => s + b.hiredThisTick, 0);
      const totalFired = bizArr.reduce((s, b) => s + b.firedThisTick, 0);
      const totalEmployed = bizArr.reduce((s, b) => s + b.employeeCount, 0);

      const agentsArr = Array.from(this.agents.values());
      const negativeMoneyAgents = agentsArr.filter(a => a.money < 0).length;
      const nanValues = agentsArr.filter(a => !isFinite(a.money) || !isFinite(a.mood)).length;
      const totalMoneyAgents = agentsArr.reduce((s, a) => s + a.money, 0);
      const totalMoneyBusinesses = bizArr.reduce((s, b) => s + b.balance, 0);
      const orphanedGoods = goodsArr.filter(g => g.businessId != null && !this.businesses.has(g.businessId)).length;

      this.lastTickReport = {
        tick: this.state.tick,
        elapsedMs: elapsed,
        computedAt: Date.now(),
        agents: {
          processed: agentIds.length - dbgSkipped,
          skipped: dbgSkipped,
          actions: { work: dbgActWork, eat: dbgActEat, rest: dbgActRest, sleep: dbgActSleep, heal: dbgActHeal, socialize: dbgActSocialize, idle: dbgActIdle },
          moneyIn: Math.round(dbgMoneyIn),
          moneyOut: Math.round(dbgMoneyOut),
        },
        businesses: {
          total: bizArr.length,
          active: bizArr.filter(b => b.balance > 0).length,
          unprofitable: bizArr.filter(b => b.balance < 0).length,
          staffless: bizArr.filter(b => b.employeeCount === 0).length,
          employed: totalEmployed,
          hired: totalHired,
          fired: totalFired,
          balanceBefore: Math.round(dbgBizBalanceBefore),
          balanceAfter: Math.round(bizBalanceAfter),
          wagesPaid: Math.round(dbgWagesPaid),
        },
        government: {
          budgetBefore: Math.round(dbgBudgetBefore),
          budgetAfter: Math.round(this.state.governmentBudget),
          taxRevenue: Math.round(taxRevenue),
          pensionsPaid: Math.round(pensionPaid),
          subsidiesPaid: Math.round(subsidiesPaid),
          pensionRecipients: dbgPensionRecipients,
          subsidyRecipients: dbgSubsidyRecipients,
        },
        market: {
          totalDemand: Math.round(totalDemand),
          totalSupply: Math.round(totalSupply),
          avgPrice: Math.round(avgPrice * 10) / 10,
          priceChangePct: Math.round(priceChangePct * 10) / 10,
          bigPriceSpikes,
          successfulPurchases: dbgSuccessful,
          failedNoGoods: dbgFailedNoGoods,
          failedNoMoney: dbgFailedNoMoney,
        },
        integrity: {
          negativeMoneyAgents,
          nanValues,
          totalMoneyAgents: Math.round(totalMoneyAgents),
          totalMoneyBusinesses: Math.round(totalMoneyBusinesses),
          governmentBudget: Math.round(this.state.governmentBudget),
          orphanedGoods,
        },
        chain: {
          b2bSuccess: chainResult.b2bSuccess,
          b2bFail: chainResult.b2bFail,
          farmSupplyTotal: Math.round(goodsArr.filter(g => {
            const biz = g.businessId != null ? this.businesses.get(g.businessId) : null;
            return biz?.type === "farm";
          }).reduce((s, g) => s + g.supply, 0)),
          workshopSupplyTotal: Math.round(goodsArr.filter(g => {
            const biz = g.businessId != null ? this.businesses.get(g.businessId) : null;
            return biz?.type === "workshop";
          }).reduce((s, g) => s + g.supply, 0)),
          foodSupplyTotal: Math.round(goodsArr.filter(g => {
            const biz = g.businessId != null ? this.businesses.get(g.businessId) : null;
            return biz?.type === "food";
          }).reduce((s, g) => s + g.supply, 0)),
          serviceSupplyTotal: Math.round(goodsArr.filter(g => {
            const biz = g.businessId != null ? this.businesses.get(g.businessId) : null;
            return biz?.type === "service";
          }).reduce((s, g) => s + g.supply, 0)),
        },
      };
    }

    this.syncCounter++;
    if (this.syncCounter >= 1) {
      this.syncCounter = 0;
      await this.syncToDB(gdp);
    }
  }

  private async purgeDeadAgents(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await db.delete(agentStatHistoryTable).where(inArray(agentStatHistoryTable.agentId, ids));
    await db.delete(needsTable).where(inArray(needsTable.agentId, ids));
    await db.delete(relationsTable).where(
      or(inArray(relationsTable.agentIdA, ids), inArray(relationsTable.agentIdB, ids))
    );
    await db.delete(agentsTable).where(inArray(agentsTable.id, ids));
    // Clean up persisted relation keys
    for (const id of ids) {
      for (const key of Array.from(this.persistedRelations)) {
        if (key.startsWith(`${id}:`) || key.endsWith(`:${id}`)) {
          this.persistedRelations.delete(key);
        }
      }
    }
  }

  private async spawnNewAgents(count: number): Promise<void> {
    if (count <= 0) return;
    const availableBusinessIds = Array.from(this.businesses.values())
      .filter(b => b.balance > -200 && b.type !== "farm" && b.type !== "workshop")
      .map(b => b.id);

    const newAgentData = [];
    for (let i = 0; i < count; i++) {
      const gender = Math.random() < 0.5 ? "male" : "female";
      const name = gender === "male" ? pick(MALE_NAMES) : pick(FEMALE_NAMES);
      const employerId = availableBusinessIds.length > 0 && Math.random() < 0.5
        ? pick(availableBusinessIds) : null;
      newAgentData.push({
        name, gender,
        age: randInt(18, 25),
        mood: rand(50, 80),
        money: rand(20, 100),
        personality: pick(PERSONALITIES),
        socialization: rand(30, 70),
        currentAction: "idle" as const,
        employerId,
        locationX: rand(0, 1000),
        locationY: rand(0, 1000),
      });
    }

    const saved = await db.insert(agentsTable).values(newAgentData).returning();
    if (saved.length === 0) return;

    const needsInserts = saved.map(a => ({
      agentId: a.id,
      hunger: rand(60, 90),
      comfort: rand(60, 90),
      social: rand(60, 90),
      health: rand(65, 90),
      sleep: rand(55, 90),
    }));
    const savedNeeds = await db.insert(needsTable).values(needsInserts).returning();
    const needsMap = new Map<number, typeof savedNeeds[0]>();
    for (const n of savedNeeds) needsMap.set(n.agentId, n);

    for (const agent of saved) {
      const needs = needsMap.get(agent.id);
      if (!needs) continue;
      this.agents.set(agent.id, {
        ...agent,
        needs: { hunger: needs.hunger, comfort: needs.comfort, social: needs.social, health: needs.health ?? 80, sleep: needs.sleep ?? 80 },
        needsId: needs.id,
        recentActions: [],
        jobHistory: agent.employerId
          ? [{ tick: this.state.tick, event: "hired", businessId: agent.employerId, businessName: this.businesses.get(agent.employerId)?.name ?? null }]
          : [],
      });
      if (agent.employerId) {
        const biz = this.businesses.get(agent.employerId);
        if (biz) biz.employeeCount++;
      }
    }
  }

  private getCriticalNeed(needs: { hunger: number; comfort: number; social: number; health: number; sleep: number }): string {
    // Priority order: health < 20 → must rest; sleep < 25 → sleep; hunger < 30; comfort < 30; social < 30
    if (needs.health < 20) return "health";
    if (needs.sleep < 25) return "sleep";
    const threshold = 30;
    if (needs.hunger < threshold && needs.hunger <= needs.comfort && needs.hunger <= needs.social) return "hunger";
    if (needs.comfort < threshold && needs.comfort <= needs.social) return "comfort";
    if (needs.social < threshold) return "social";
    return "work";
  }

  private pickAvailableGood(type: "food" | "service" | "hospital"): GoodState | null {
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

  private updateRelation(agentIdA: number, agentIdB: number, delta: number): void {
    let relMap = this.relations.get(agentIdA);
    if (!relMap) {
      relMap = new Map();
      this.relations.set(agentIdA, relMap);
    }
    const current = relMap.get(agentIdB) ?? 50;
    const next = clamp(current + delta);
    relMap.set(agentIdB, next);
    this.dirtyRelations.add(`${agentIdA}:${agentIdB}`);
  }

  private processProductionChains(): { b2bSuccess: number; b2bFail: number } {
    let b2bSuccess = 0, b2bFail = 0;

    const farmGoods = Array.from(this.goods.values()).filter(g => {
      const biz = g.businessId != null ? this.businesses.get(g.businessId) : null;
      return biz?.type === "farm";
    });
    const workshopGoods = Array.from(this.goods.values()).filter(g => {
      const biz = g.businessId != null ? this.businesses.get(g.businessId) : null;
      return biz?.type === "workshop";
    });

    // Food businesses buy raw ingredients from farms
    for (const biz of this.businesses.values()) {
      if (biz.type !== "food") continue;
      const farmGood = farmGoods.find(g => g.supply > 20) ?? null;
      const consumerGood = Array.from(this.goods.values()).find(g => g.businessId === biz.id) ?? null;

      if (farmGood && biz.balance >= farmGood.currentPrice) {
        const cost = farmGood.currentPrice;
        biz.balance -= cost;
        const farmBiz = farmGood.businessId != null ? this.businesses.get(farmGood.businessId) : null;
        if (farmBiz) farmBiz.balance += cost;
        farmGood.supply = clamp(farmGood.supply - 8, 0, 200);
        farmGood.demand = clamp(farmGood.demand + 1.5, 0, 200);
        if (consumerGood) {
          consumerGood.supply = clamp(consumerGood.supply + 7, 0, 200);
          consumerGood.quality = clamp(consumerGood.quality + 0.3, 0, 100);
        }
        b2bSuccess++;
      } else {
        if (consumerGood) {
          consumerGood.supply = clamp(consumerGood.supply - 2, 0, 200);
          consumerGood.quality = clamp(consumerGood.quality - 0.4, 0, 100);
        }
        b2bFail++;
      }
    }

    // Service businesses buy raw materials from workshops
    for (const biz of this.businesses.values()) {
      if (biz.type !== "service") continue;
      const wsGood = workshopGoods.find(g => g.supply > 15) ?? null;
      const consumerGood = Array.from(this.goods.values()).find(g => g.businessId === biz.id) ?? null;

      if (wsGood && biz.balance >= wsGood.currentPrice) {
        const cost = wsGood.currentPrice;
        biz.balance -= cost;
        const wsBiz = wsGood.businessId != null ? this.businesses.get(wsGood.businessId) : null;
        if (wsBiz) wsBiz.balance += cost;
        wsGood.supply = clamp(wsGood.supply - 6, 0, 200);
        wsGood.demand = clamp(wsGood.demand + 1, 0, 200);
        if (consumerGood) {
          consumerGood.supply = clamp(consumerGood.supply + 5, 0, 200);
          consumerGood.quality = clamp(consumerGood.quality + 0.2, 0, 100);
        }
        b2bSuccess++;
      } else {
        if (consumerGood) {
          consumerGood.supply = clamp(consumerGood.supply - 1, 0, 200);
          consumerGood.quality = clamp(consumerGood.quality - 0.2, 0, 100);
        }
        b2bFail++;
      }
    }

    return { b2bSuccess, b2bFail };
  }

  private updateGoodPrices(): void {
    for (const good of this.goods.values()) {
      const demandFactor = (good.demand - 50) / 100;
      const { baseFoodPrice, priceMarkup } = this.config;
      const bizType = good.businessId != null ? this.businesses.get(good.businessId)?.type : undefined;

      const priceMultiplier =
        bizType === "food" ? 1 :
        bizType === "hospital" ? 3 :
        bizType === "farm" ? 0.5 :
        bizType === "workshop" ? 0.8 :
        2; // service
      const base = baseFoodPrice * priceMultiplier;
      // Quality premium: ±10% based on quality deviation from 50
      const qualityPremium = (good.quality - 50) / 500;
      good.currentPrice = Math.max(1, base * (1 + priceMarkup) * (1 + qualityPremium) + base * demandFactor);

      // Supply dynamics differ by business tier
      if (bizType === "farm") {
        // Farms grow supply naturally (crops)
        good.supply = clamp(good.supply + rand(3, 8), 0, 200);
        good.demand = clamp(good.demand - rand(0, 1), 0, 200);
      } else if (bizType === "workshop") {
        // Workshops produce at moderate pace
        good.supply = clamp(good.supply + rand(2, 6), 0, 200);
        good.demand = clamp(good.demand - rand(0, 1), 0, 200);
      } else {
        // Consumer goods: chain provides main supply boost; natural slow growth
        good.supply = clamp(good.supply + rand(0, 2), 0, 200);
        good.demand = clamp(good.demand - rand(0, 2), 0, 200);
      }
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
          .set({
            age: agent.age,
            mood: agent.mood,
            money: agent.money,
            currentAction: agent.currentAction,
            employerId: agent.employerId,
            isRetired: agent.isRetired,
            jobHistory: JSON.stringify(agent.jobHistory.slice(-50)),
          })
          .where(eq(agentsTable.id, agent.id));
        await db.update(needsTable)
          .set({ hunger: agent.needs.hunger, comfort: agent.needs.comfort, social: agent.needs.social, health: agent.needs.health, sleep: agent.needs.sleep })
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

    // Sync dirty relations to DB (up to 500 per tick to avoid flooding)
    const dirtyKeys = Array.from(this.dirtyRelations).slice(0, 500);
    for (const key of dirtyKeys) {
      const [aStr, bStr] = key.split(":");
      const agentIdA = parseInt(aStr, 10);
      const agentIdB = parseInt(bStr, 10);
      const level = this.relations.get(agentIdA)?.get(agentIdB);
      if (level !== undefined) {
        if (this.persistedRelations.has(key)) {
          await db.update(relationsTable)
            .set({ friendshipLevel: level })
            .where(and(
              eq(relationsTable.agentIdA, agentIdA),
              eq(relationsTable.agentIdB, agentIdB),
            ));
        } else {
          await db.insert(relationsTable).values({ agentIdA, agentIdB, friendshipLevel: level });
          this.persistedRelations.add(key);
        }
      }
      this.dirtyRelations.delete(key);
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

    const currentTick = this.state.tick;
    const dbRows: { agentId: number; tick: number; money: number; mood: number; age: number; socialization: number }[] = [];
    for (const agent of this.agents.values()) {
      const snapshot: AgentStatSnapshot = {
        tick: currentTick,
        money: Math.round(agent.money * 100) / 100,
        mood: Math.round(agent.mood * 10) / 10,
        age: agent.age,
        socialization: Math.round(agent.socialization * 10) / 10,
      };
      const history = this.agentStatHistory.get(agent.id) ?? [];
      history.push(snapshot);
      if (history.length > AGENT_STAT_HISTORY_MAX) history.shift();
      this.agentStatHistory.set(agent.id, history);
      dbRows.push({ agentId: agent.id, tick: currentTick, money: snapshot.money, mood: snapshot.mood, age: snapshot.age, socialization: snapshot.socialization });
    }
    if (dbRows.length > 0) {
      await db.insert(agentStatHistoryTable).values(dbRows);
    }
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
        totalPensionPaid: this.state.totalPensionPaid,
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

  getLastTickReport(): TickDebugReport | null {
    return this.lastTickReport;
  }

  getPopulationBreakdown() {
    const agents = Array.from(this.agents.values());
    const total = agents.length;

    const employed = agents.filter(a => a.employerId != null && !a.isRetired).length;
    const unemployed = agents.filter(a => a.employerId == null && !a.isRetired).length;
    const retired = agents.filter(a => !!a.isRetired).length;

    const youth  = agents.filter(a => a.age <= 30).length;
    const adult  = agents.filter(a => a.age >= 31 && a.age <= 50).length;
    const mature = agents.filter(a => a.age >= 51 && a.age <= 65).length;
    const elder  = agents.filter(a => a.age > 65).length;

    const personalityCounts: Record<string, number> = {};
    for (const a of agents) {
      personalityCounts[a.personality] = (personalityCounts[a.personality] ?? 0) + 1;
    }

    const actionCounts: Record<string, number> = {};
    for (const a of agents) {
      actionCounts[a.currentAction] = (actionCounts[a.currentAction] ?? 0) + 1;
    }

    return {
      total,
      byEmployment: { employed, unemployed, retired },
      byAge: { youth, adult, mature, elder },
      byPersonality: personalityCounts,
      byAction: actionCounts,
    };
  }

  getPopulationGroups(groupBy: "personality" | "employment" | "ageGroup") {
    const agents = Array.from(this.agents.values());
    const total = agents.length;

    const ACTION_RU: Record<string, string> = { work: "Работает", eat: "Ест", rest: "Отдыхает", socialize: "Общается", idle: "Простаивает" };

    const getGroupKey = (a: AgentState): string => {
      if (groupBy === "personality") return a.personality;
      if (groupBy === "employment") {
        if (a.isRetired) return "Пенсионеры";
        if (a.employerId != null) return "Работающие";
        return "Безработные";
      }
      if (a.age <= 30) return "18–30 (молодёжь)";
      if (a.age <= 50) return "31–50 (взрослые)";
      if (a.age <= 65) return "51–65 (зрелые)";
      return "66+ (пожилые)";
    };

    const groups = new Map<string, AgentState[]>();
    for (const a of agents) {
      const key = getGroupKey(a);
      const arr = groups.get(key) ?? [];
      arr.push(a);
      groups.set(key, arr);
    }

    const rows = Array.from(groups.entries()).map(([label, members]) => {
      const count = members.length;
      const avgMood  = members.reduce((s, a) => s + a.mood, 0) / count;
      const avgMoney = members.reduce((s, a) => s + a.money, 0) / count;
      const avgAge   = members.reduce((s, a) => s + a.age, 0) / count;
      const employedCount = members.filter(a => a.employerId != null && !a.isRetired).length;
      const actionFreq: Record<string, number> = {};
      for (const a of members) actionFreq[a.currentAction] = (actionFreq[a.currentAction] ?? 0) + 1;
      const topAction = Object.entries(actionFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "idle";
      return {
        label,
        count,
        pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
        avgMood:  Math.round(avgMood * 10) / 10,
        avgMoney: Math.round(avgMoney),
        avgAge:   Math.round(avgAge),
        employedCount,
        topAction: ACTION_RU[topAction] ?? topAction,
        topActionKey: topAction,
      };
    });

    rows.sort((a, b) => b.count - a.count);
    return { groupBy, total, groups: rows };
  }

  getAgents(page: number, limit: number, sortBy?: string, sortDir?: string, filterAction?: string) {
    let agents = Array.from(this.agents.values());
    if (filterAction) {
      agents = agents.filter(a => a.currentAction === filterAction);
    }
    if (sortBy && (AGENT_SORT_KEYS as readonly string[]).includes(sortBy)) {
      const key = sortBy as AgentSortKey;
      agents.sort((a, b) => {
        const aVal = a[key] ?? 0;
        const bVal = b[key] ?? 0;
        const cmp = typeof aVal === "string" ? (aVal as string).localeCompare(bVal as string) : (aVal as number) - (bVal as number);
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
      isRetired: agent.isRetired,
      recentActions: [...agent.recentActions],
      jobHistory: [...agent.jobHistory].reverse().slice(0, 20),
      needs: {
        hunger: Math.round(agent.needs.hunger * 10) / 10,
        comfort: Math.round(agent.needs.comfort * 10) / 10,
        social: Math.round(agent.needs.social * 10) / 10,
        health: Math.round(agent.needs.health * 10) / 10,
        sleep: Math.round(agent.needs.sleep * 10) / 10,
      },
    };
  }

  getAgentRelations(agentId: number) {
    const relMap = this.relations.get(agentId);
    if (!relMap) return [];
    const entries = Array.from(relMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    return entries.map(([otherId, friendshipLevel]) => {
      const other = this.agents.get(otherId);
      return {
        otherId,
        otherName: other?.name ?? `Агент ${otherId}`,
        friendshipLevel: Math.round(friendshipLevel * 10) / 10,
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
      firedThisTick: b.firedThisTick,
      hiredThisTick: b.hiredThisTick,
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
      totalPensionPaid: Math.round(this.state.totalPensionPaid * 100) / 100,
      taxRate: this.config.taxRate,
      subsidyAmount: this.config.subsidyAmount,
      pensionRate: this.config.pensionRate,
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
    const bizArr = Array.from(this.businesses.values());
    const goodsArr = Array.from(this.goods.values());
    const marketBalance = bizArr.reduce((s, b) => s + b.balance, 0);
    const profitableBusinesses = bizArr.filter(b => b.balance > 0).length;
    const unprofitableBusinesses = bizArr.filter(b => b.balance < 0).length;
    const totalDemand = goodsArr.reduce((s, g) => s + g.demand, 0);
    const totalSupply = goodsArr.reduce((s, g) => s + g.supply, 0);
    if (agents.length === 0) {
      return {
        totalAgents: 0,
        totalBusinesses: this.businesses.size,
        totalGoods: this.goods.size,
        employedAgents: 0,
        unemployedAgents: 0,
        avgMood: 0,
        avgWealth: 0,
        avgHealth: 0,
        avgSleep: 0,
        gdp: 0,
        richestAgent: null,
        happiestAgent: null,
        mostPopularGood: null,
        birthsLastTick: this.lastBirths,
        deathsLastTick: this.lastDeaths,
        profitableBusinesses,
        unprofitableBusinesses,
        marketBalance: Math.round(marketBalance),
        totalDemand: Math.round(totalDemand),
        totalSupply: Math.round(totalSupply),
      };
    }
    const employed = agents.filter(a => a.employerId != null);
    const avgMood = agents.reduce((s, a) => s + a.mood, 0) / agents.length;
    const avgWealth = agents.reduce((s, a) => s + a.money, 0) / agents.length;
    const avgHealth = agents.reduce((s, a) => s + a.needs.health, 0) / agents.length;
    const avgSleep = agents.reduce((s, a) => s + a.needs.sleep, 0) / agents.length;
    const richest = agents.reduce((max, a) => a.money > max.money ? a : max, agents[0]);
    const happiest = agents.reduce((max, a) => a.mood > max.mood ? a : max, agents[0]);
    const goodsSorted = [...goodsArr].sort((a, b) => b.demand - a.demand);
    return {
      totalAgents: agents.length,
      totalBusinesses: this.businesses.size,
      totalGoods: this.goods.size,
      employedAgents: employed.length,
      unemployedAgents: agents.length - employed.length,
      avgMood: Math.round(avgMood * 10) / 10,
      avgWealth: Math.round(avgWealth * 100) / 100,
      avgHealth: Math.round(avgHealth * 10) / 10,
      avgSleep: Math.round(avgSleep * 10) / 10,
      gdp: Math.round(marketBalance),
      richestAgent: richest?.name ?? null,
      happiestAgent: happiest?.name ?? null,
      mostPopularGood: goodsSorted[0]?.name ?? null,
      birthsLastTick: this.lastBirths,
      deathsLastTick: this.lastDeaths,
      profitableBusinesses,
      unprofitableBusinesses,
      marketBalance: Math.round(marketBalance),
      totalDemand: Math.round(totalDemand),
      totalSupply: Math.round(totalSupply),
    };
  }

  getTopAgents(limit = 10) {
    const agents = Array.from(this.agents.values());
    const n = Math.max(1, Math.min(100, limit));
    const mapAgent = (a: AgentState) => ({
      id: a.id, name: a.name, gender: a.gender, age: a.age,
      mood: Math.round(a.mood * 10) / 10, money: Math.round(a.money * 100) / 100,
      personality: a.personality, socialization: Math.round(a.socialization * 10) / 10,
      currentAction: a.currentAction, employerId: a.employerId,
    });
    const byWealth = [...agents].sort((a, b) => b.money - a.money).slice(0, n).map(mapAgent);
    const byMood = [...agents].sort((a, b) => b.mood - a.mood).slice(0, n).map(mapAgent);
    const byAge = [...agents].sort((a, b) => b.age - a.age).slice(0, n).map(mapAgent);
    const bySocialization = [...agents].sort((a, b) => b.socialization - a.socialization).slice(0, n).map(mapAgent);
    return { byWealth, byMood, byAge, bySocialization };
  }

  getAgentStatHistory(id: number): AgentStatSnapshot[] {
    return this.agentStatHistory.get(id) ?? [];
  }
}

export const simulationEngine = new SimulationEngine();
