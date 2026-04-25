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
  event: "hired" | "fired" | "retired" | "quit" | "promoted";
  businessId: number | null;
  businessName: string | null;
  duration?: number;
}

interface AgentState extends Agent {
  needs: { hunger: number; comfort: number; social: number; health: number; sleep: number; education: number; entertainment: number; faith: number; housingSafety: number; financialSafety: number; physicalSafety: number; socialRating: number };
  needsId: number;
  recentActions: string[];
  jobHistory: JobHistoryEntry[];
  jobStartTick: number | null;
  // careerLevel and ambition come from Agent (DB schema)
  jailedUntilTick: number | null; // in-memory only — resets on restart
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
  totalPublicServicesPaid: number;
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
const PERSONALITIES = ["сангвиник", "холерик", "флегматик", "меланхолик"];

// Career grade salary multipliers: grade 1..5 → ×1.0 / ×1.4 / ×1.9 / ×2.5 / ×3.2
const CAREER_SALARY_MULT = [1.0, 1.4, 1.9, 2.5, 3.2] as const;

// Grade name labels used in UI / job history
const GRADE_LABELS: Record<number, string> = {
  1: "Рабочий",
  2: "Менеджер",
  3: "Руководитель",
  4: "Директор",
  5: "Топ-менеджер",
};

/** Target career grade derived from ambition (20–100) */
function targetGrade(ambition: number): number {
  if (ambition >= 80) return 5;
  if (ambition >= 65) return 4;
  if (ambition >= 50) return 3;
  if (ambition >= 35) return 2;
  return 1;
}

/** Salary for one tick of work considering career level */
function calcSalary(baseSalary: number, careerLevel: number): number {
  const mult = CAREER_SALARY_MULT[Math.min(4, Math.max(0, careerLevel - 1))] ?? 1.0;
  return baseSalary * mult * rand(0.9, 1.1);
}

// Consumer preference matrix per spec v1.6 (Потребительская матрица)
// Index: 0=Санг.Интр  1=Санг.Экстр  2=Хол.Интр  3=Хол.Экстр
//        4=Флег.Интр  5=Флег.Экстр  6=Мел.Интр  7=Мел.Экстр
// Tier: [priceLevel, qualityLevel] where each is "low"|"medium"|"high"
type PriceQualityTier = ["low" | "medium" | "high", "low" | "medium" | "high"];
const CONSUMER_MATRIX: Record<string, PriceQualityTier[]> = {
  food: [
    ["medium", "medium"], // 0 Санг Инт
    ["high",   "high"],   // 1 Санг Экстр
    ["high",   "high"],   // 2 Хол Инт
    ["medium", "high"],   // 3 Хол Экстр
    ["low",    "medium"], // 4 Флег Инт
    ["medium", "medium"], // 5 Флег Экстр
    ["high",   "high"],   // 6 Мел Инт
    ["high",   "medium"], // 7 Мел Экстр
  ],
  park: [ // Развлекательные услуги
    ["low",    "medium"], // 0 Санг Инт
    ["high",   "medium"], // 1 Санг Экстр
    ["low",    "high"],   // 2 Хол Инт
    ["high",   "high"],   // 3 Хол Экстр
    ["low",    "low"],    // 4 Флег Инт
    ["medium", "medium"], // 5 Флег Экстр
    ["low",    "medium"], // 6 Мел Инт
    ["medium", "high"],   // 7 Мел Экстр
  ],
  service: [ // Бытовые товары / услуги
    ["medium", "high"],   // 0 Санг Инт
    ["high",   "high"],   // 1 Санг Экстр
    ["medium", "medium"], // 2 Хол Инт
    ["high",   "high"],   // 3 Хол Экстр
    ["medium", "medium"], // 4 Флег Инт
    ["low",    "medium"], // 5 Флег Экстр
    ["medium", "medium"], // 6 Мел Инт
    ["high",   "high"],   // 7 Мел Экстр
  ],
};

/** Map (personality, socialization) → 0-7 index for CONSUMER_MATRIX */
function getPersonalityIndex(personality: string, socialization: number): number {
  const base: Record<string, number> = { "сангвиник": 0, "холерик": 2, "флегматик": 4, "меланхолик": 6 };
  const b = base[personality] ?? 0;
  return b + (socialization >= 50 ? 1 : 0); // extrovert = +1
}

/** Classify a good into price/quality tier relative to peers of the same type */
function classifyGood(good: GoodState, peers: GoodState[]): PriceQualityTier {
  const prices = peers.map(g => g.currentPrice).sort((a, b) => a - b);
  const pIdx = prices.filter(p => p <= good.currentPrice).length / prices.length;
  const priceLevel: "low" | "medium" | "high" = pIdx < 0.35 ? "low" : pIdx < 0.70 ? "medium" : "high";
  const qualityLevel: "low" | "medium" | "high" = good.quality > 70 ? "high" : good.quality > 40 ? "medium" : "low";
  return [priceLevel, qualityLevel];
}
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
const SCHOOL_BUSINESS_NAMES = ["Школа", "Гимназия", "Лицей", "Колледж", "Университет", "Учебный центр", "Библиотека"];
const PARK_BUSINESS_NAMES = ["Городской парк", "Кинотеатр", "Спортивный клуб", "Торговый центр", "Театр", "Боулинг", "Аквапарк"];
const TEMPLE_BUSINESS_NAMES = ["Церковь", "Мечеть", "Часовня", "Монастырь", "Собор", "Молельный дом"];
const SCHOOL_GOOD_NAMES = ["Урок", "Курс обучения", "Лекция", "Тренинг", "Семинар"];
const PARK_GOOD_NAMES = ["Прогулка", "Сеанс кино", "Тренировка", "Развлечение", "Экскурсия"];
const TEMPLE_GOOD_NAMES = ["Молебен", "Богослужение", "Исповедь", "Медитация", "Обряд"];
const ACTIONS = ["eat", "rest", "sleep", "socialize", "work", "idle", "heal", "study", "relax", "pray"];

// ─── Dialog mood matrix (точно по спецификации v1.6) ───────────────────────
//
// Тиры настроения (шкала настроения 0-100, нейтраль = 50):
//   Счастливый (high)  ≥ 60  ↔ спек +20..+100 на -100..+100
//   Нейтральный (med)  40-59 ↔ спек -20..+20
//   Грустный (low)     < 40  ↔ спек ниже -20
//
// Формат строки: [dInitMood, dRespMood, dFriend]
// Если в строке 2 варианта — это «Рандом» из спека (50/50 выбор).
//
// Источник: лист «Таблица эффектов диалогов жителей» файла v1.6
const MOOD_TIER_HIGH = 60;
const MOOD_TIER_LOW  = 40;
type MoodTier = "high" | "med" | "low";
type DialogOutcome = [dInit: number, dResp: number, dFriend: number];

function getMoodTier(mood: number): MoodTier {
  if (mood >= MOOD_TIER_HIGH) return "high";
  if (mood >= MOOD_TIER_LOW)  return "med";
  return "low";
}

const DIALOG_MATRIX: Record<MoodTier, Record<MoodTier, DialogOutcome[]>> = {
  //          dInit  dResp  dFriend
  high: {
    high: [[ 2,  2,  3]],                     // счастливый×счастливый — позитивный
    med:  [[ 1,  0,  1]],                     // счастливый×нейтральный
    low:  [[ 1,  0,  1], [ 0, -1, -1]],       // счастливый×грустный — РАНДОМ (нейтральный или негативный ответ)
  },
  med: {
    high: [[ 1,  1,  2]],                     // нейтральный×счастливый
    med:  [[ 0,  0,  1]],                     // нейтральный×нейтральный
    low:  [[ 0,  0,  1], [-1, -1, -2]],       // нейтральный×грустный — РАНДОМ
  },
  low: {
    high: [[ 1,  1,  1], [ 0,  0, -1]],       // грустный×счастливый — РАНДОМ (позитивный или нейтральный ответ)
    med:  [[ 0,  0, -1]],                     // грустный×нейтральный
    low:  [[-2, -2, -3]],                     // грустный×грустный — негативный
  },
};
// ───────────────────────────────────────────────────────────────────────────

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
    actions: { work: number; eat: number; rest: number; socialize: number; idle: number; sleep?: number; heal?: number; study?: number; relax?: number; pray?: number };
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
    publicServiceSpend: number;
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
    totalPublicServicesPaid: 0,
  };
  private config: SimulationConfig = { ...DEFAULT_CONFIG };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isTicking = false;
  private syncCounter = 0;
  private lastTickReport: TickDebugReport | null = null;
  private prevAvgPrice = 0;
  private lastBirths = 0;
  private lastDeaths = 0;
  private totalGrantsPaid = 0;
  private lastGrantsIssued = 0;

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
      await this.ensurePublicServices();
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
        totalPublicServicesPaid: row.totalPublicServicesPaid ?? 0,
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
        totalPublicServicesPaid: 0,
      });
    }
  }

  private async loadAgents(): Promise<void> {
    const agentRows = await db.select().from(agentsTable).limit(5000);
    const needsRows = await db.select().from(needsTable);
    const needsMap = new Map<number, { hunger: number; comfort: number; social: number; health: number; sleep: number; education: number; entertainment: number; faith: number; housingSafety: number; financialSafety: number; physicalSafety: number; socialRating: number; id: number }>();
    for (const n of needsRows) {
      needsMap.set(n.agentId, {
        hunger: n.hunger, comfort: n.comfort, social: n.social,
        health: n.health ?? 80, sleep: n.sleep ?? 80,
        education: n.education ?? 70, entertainment: n.entertainment ?? 70, faith: n.faith ?? 60,
        housingSafety: n.housingSafety ?? 80,
        financialSafety: n.financialSafety ?? 80,
        physicalSafety: n.physicalSafety ?? 80,
        socialRating: n.socialRating ?? 50,
        id: n.id,
      });
    }
    this.agents.clear();
    for (const agent of agentRows) {
      const needs = needsMap.get(agent.id) ?? { hunger: 80, comfort: 80, social: 80, health: 80, sleep: 80, education: 70, entertainment: 70, faith: 60, housingSafety: 80, financialSafety: 80, physicalSafety: 80, socialRating: 50, id: 0 };
      let jobHistory: JobHistoryEntry[] = [];
      try { jobHistory = JSON.parse(agent.jobHistory ?? "[]"); } catch { jobHistory = []; }
      // Derive jobStartTick from last "hired" entry in job history
      const lastHired = [...jobHistory].reverse().find(e => e.event === "hired");
      this.agents.set(agent.id, {
        ...agent,
        needs: { hunger: needs.hunger, comfort: needs.comfort, social: needs.social, health: needs.health, sleep: needs.sleep, education: needs.education, entertainment: needs.entertainment, faith: needs.faith, housingSafety: needs.housingSafety, financialSafety: needs.financialSafety, physicalSafety: needs.physicalSafety, socialRating: needs.socialRating },
        needsId: needs.id, recentActions: [], jobHistory,
        jobStartTick: agent.employerId ? (lastHired?.tick ?? 0) : null,
        jailedUntilTick: null,
      });
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

    // Очистка старых записей — запускается в фоне, не блокирует старт
    void db.execute(sql`
      DELETE FROM agent_stat_history
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY tick DESC) AS rn
          FROM agent_stat_history
        ) ranked
        WHERE rn <= ${AGENT_STAT_HISTORY_MAX}
      )
    `).catch(err => logger.warn({ err }, "Background agent_stat_history cleanup failed"));
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

  private async ensurePublicServices(): Promise<void> {
    const existingSchools = Array.from(this.businesses.values()).filter(b => b.type === "school");
    const existingParks = Array.from(this.businesses.values()).filter(b => b.type === "park");
    const existingTemples = Array.from(this.businesses.values()).filter(b => b.type === "temple");
    if (existingSchools.length > 0 && existingParks.length > 0 && existingTemples.length > 0) {
      logger.info({ schools: existingSchools.length, parks: existingParks.length, temples: existingTemples.length }, "Public services already present, skipping");
      return;
    }

    const { baseFoodPrice } = this.config;
    const schoolCount = Math.max(4, Math.floor(this.businesses.size * 0.05));
    const parkCount = Math.max(5, Math.floor(this.businesses.size * 0.06));
    const templeCount = Math.max(3, Math.floor(this.businesses.size * 0.04));

    const bizInserts: Array<{ name: string; type: string; balance: number; productionRate: number; ownerId: null }> = [];
    for (let i = 0; i < schoolCount; i++) {
      bizInserts.push({ name: `${pick(SCHOOL_BUSINESS_NAMES)} №${i + 1}`, type: "school", balance: rand(1500, 5000), productionRate: rand(3, 8), ownerId: null });
    }
    for (let i = 0; i < parkCount; i++) {
      bizInserts.push({ name: `${pick(PARK_BUSINESS_NAMES)} №${i + 1}`, type: "park", balance: rand(1000, 4000), productionRate: rand(4, 10), ownerId: null });
    }
    for (let i = 0; i < templeCount; i++) {
      bizInserts.push({ name: `${pick(TEMPLE_BUSINESS_NAMES)} №${i + 1}`, type: "temple", balance: rand(500, 2000), productionRate: rand(2, 6), ownerId: null });
    }

    const savedBiz = await db.insert(businessesTable).values(bizInserts).returning();
    for (const b of savedBiz) {
      this.businesses.set(b.id, { ...b, employeeCount: 0, firedThisTick: 0, hiredThisTick: 0 });
    }

    const goodInserts = savedBiz.map(b => {
      const typeMap: Record<string, { names: string[]; price: number }> = {
        school: { names: SCHOOL_GOOD_NAMES, price: baseFoodPrice * 1.5 },
        park: { names: PARK_GOOD_NAMES, price: baseFoodPrice * 1.2 },
        temple: { names: TEMPLE_GOOD_NAMES, price: baseFoodPrice * 0.4 },
      };
      const cfg = typeMap[b.type] ?? { names: ["Услуга"], price: baseFoodPrice };
      return {
        name: pick(cfg.names),
        businessId: b.id,
        basePrice: cfg.price,
        currentPrice: cfg.price * (1 + this.config.priceMarkup),
        quality: rand(55, 90),
        demand: rand(20, 50),
        supply: rand(40, 80),
      };
    });

    const savedGoods = await db.insert(goodsTable).values(goodInserts).returning();
    for (const g of savedGoods) this.goods.set(g.id, { ...g });

    logger.info({ schoolCount, parkCount, templeCount, goodsCount: savedGoods.length }, "Public services spawned");
  }

  private async generatePopulation(): Promise<void> {
    const { initialAgents, initialBusinesses, baseFoodPrice, baseSalary } = this.config;
    logger.info({ initialAgents, initialBusinesses }, "Generating population");

    const hospitalBusinessCount = Math.max(5, Math.floor(initialBusinesses * 0.08));
    const farmBusinessCount = Math.max(6, Math.floor(initialBusinesses * 0.08));
    const workshopBusinessCount = Math.max(4, Math.floor(initialBusinesses * 0.06));
    const schoolBusinessCount = Math.max(4, Math.floor(initialBusinesses * 0.05));
    const parkBusinessCount = Math.max(5, Math.floor(initialBusinesses * 0.06));
    const templeBusinessCount = Math.max(3, Math.floor(initialBusinesses * 0.04));
    const remaining = initialBusinesses - hospitalBusinessCount - farmBusinessCount - workshopBusinessCount - schoolBusinessCount - parkBusinessCount - templeBusinessCount;
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
    for (let i = 0; i < schoolBusinessCount; i++) {
      businessInserts.push({ name: `${pick(SCHOOL_BUSINESS_NAMES)} №${i + 1}`, type: "school", balance: rand(1500, 5000), productionRate: rand(3, 8), ownerId: null });
    }
    for (let i = 0; i < parkBusinessCount; i++) {
      businessInserts.push({ name: `${pick(PARK_BUSINESS_NAMES)} №${i + 1}`, type: "park", balance: rand(1000, 4000), productionRate: rand(4, 10), ownerId: null });
    }
    for (let i = 0; i < templeBusinessCount; i++) {
      businessInserts.push({ name: `${pick(TEMPLE_BUSINESS_NAMES)} №${i + 1}`, type: "temple", balance: rand(500, 2000), productionRate: rand(2, 6), ownerId: null });
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
    const schoolBusinessIds = savedBusinesses.filter(b => b.type === "school").map(b => b.id);
    const parkBusinessIds = savedBusinesses.filter(b => b.type === "park").map(b => b.id);
    const templeBusinessIds = savedBusinesses.filter(b => b.type === "temple").map(b => b.id);
    for (const bId of schoolBusinessIds) {
      goodInserts.push({ name: pick(SCHOOL_GOOD_NAMES), businessId: bId, basePrice: baseFoodPrice * 1.5, currentPrice: baseFoodPrice * 1.5 * (1 + this.config.priceMarkup), quality: rand(55, 90), demand: rand(20, 50), supply: rand(40, 80) });
    }
    for (const bId of parkBusinessIds) {
      goodInserts.push({ name: pick(PARK_GOOD_NAMES), businessId: bId, basePrice: baseFoodPrice * 1.2, currentPrice: baseFoodPrice * 1.2 * (1 + this.config.priceMarkup), quality: rand(50, 85), demand: rand(25, 55), supply: rand(40, 75) });
    }
    for (const bId of templeBusinessIds) {
      goodInserts.push({ name: pick(TEMPLE_GOOD_NAMES), businessId: bId, basePrice: baseFoodPrice * 0.4, currentPrice: baseFoodPrice * 0.4 * (1 + this.config.priceMarkup), quality: rand(60, 95), demand: rand(15, 40), supply: rand(50, 90) });
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
        careerLevel: 1,
        ambition: randInt(20, 100),
        strength: rand(30, 90),
        intelligence: rand(30, 90),
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
        education: rand(40, 80),
        entertainment: rand(40, 80),
        faith: rand(30, 70),
        housingSafety: rand(60, 95),
        financialSafety: rand(60, 95),
        physicalSafety: rand(70, 95),
        socialRating: 50,
      }));

      const savedNeeds = await db.insert(needsTable).values(needsInserts).returning();
      const needsMap = new Map<number, typeof savedNeeds[0]>();
      for (const n of savedNeeds) needsMap.set(n.agentId, n);

      for (const agent of saved) {
        const needs = needsMap.get(agent.id);
        if (!needs) continue;
        this.agents.set(agent.id, {
          ...agent,
          needs: { hunger: needs.hunger, comfort: needs.comfort, social: needs.social, health: needs.health ?? 80, sleep: needs.sleep ?? 80, education: needs.education ?? 70, entertainment: needs.entertainment ?? 70, faith: needs.faith ?? 60, housingSafety: needs.housingSafety ?? 80, financialSafety: needs.financialSafety ?? 80, physicalSafety: needs.physicalSafety ?? 80, socialRating: needs.socialRating ?? 50 },
          needsId: needs.id,
          recentActions: [],
          jobHistory: agent.employerId ? [{ tick: 0, event: "hired", businessId: agent.employerId, businessName: this.businesses.get(agent.employerId)?.name ?? null }] : [],
          jobStartTick: agent.employerId ? 0 : null,
          jailedUntilTick: null,
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
      totalPublicServicesPaid: 0,
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

    // ── Daily productivity investments ─────────────────────────────────────────
    // Profitable commercial businesses (food/service/retail) auto-invest when
    // balance exceeds threshold: costs 5000 coins per level gained, cap at 20.
    if (isNewDay) {
      const INVEST_COST = 5000;
      const INVEST_TYPES = new Set(["food", "service", "retail"]);
      for (const biz of this.businesses.values()) {
        if (!INVEST_TYPES.has(biz.type)) continue;
        if (biz.balance <= 0) continue;
        const currentLevel = biz.productivityLevel ?? 0;
        if (currentLevel >= 20) continue;
        const threshold = INVEST_COST * (currentLevel + 1) * 1.5;
        if (biz.balance >= threshold) {
          biz.balance -= INVEST_COST;
          biz.productivityLevel = currentLevel + 1;
        }
      }
    }

    let gdp = 0;
    let taxRevenue = 0;
    let subsidiesPaid = 0;
    let pensionPaid = 0;
    let publicServiceSpend = 0;
    let runningBudget = this.state.governmentBudget;

    const dbgBudgetBefore = runningBudget;
    const dbgBizBalanceBefore = Array.from(this.businesses.values()).reduce((s, b) => s + b.balance, 0);
    let dbgActWork = 0, dbgActEat = 0, dbgActRest = 0, dbgActSocialize = 0, dbgActIdle = 0, dbgActSleep = 0, dbgActHeal = 0, dbgActStudy = 0, dbgActRelax = 0, dbgActPray = 0;
    let dbgMoneyIn = 0, dbgMoneyOut = 0, dbgWagesPaid = 0;
    let dbgSuccessful = 0, dbgFailedNoGoods = 0, dbgFailedNoMoney = 0;
    let dbgPensionRecipients = 0, dbgSubsidyRecipients = 0;
    let dbgSkipped = 0;

    const agentIds = Array.from(this.agents.keys());

    // ── Социальный рейтинг: пересчёт раз в игровой день ────────────────────
    // socialRating = среднее всех шкал дружбы, где агент участвует (A или B)
    if (isNewDay) {
      const ratingAcc = new Map<number, { sum: number; count: number }>();
      for (const [agentIdA, relMap] of this.relations) {
        for (const [agentIdB, level] of relMap) {
          for (const id of [agentIdA, agentIdB]) {
            const acc = ratingAcc.get(id) ?? { sum: 0, count: 0 };
            acc.sum += level;
            acc.count++;
            ratingAcc.set(id, acc);
          }
        }
      }
      for (const [id, acc] of ratingAcc) {
        const agent = this.agents.get(id);
        if (agent) {
          agent.needs.socialRating = clamp(acc.count > 0 ? acc.sum / acc.count : 50);
        }
      }
    }

    // Лимиты сотрудников для публичных служб — они не должны конкурировать
    // с коммерческими бизнесами за трудовые ресурсы
    const PUBLIC_SERVICE_MAX_EMPLOYEES: Record<string, number> = {
      school: 4,   // не более 4 на каждую школу
      park: 3,     // не более 3 на каждый парк
      temple: 2,   // не более 2 на храм
      hospital: 5, // больницы могут держать больше персонала
    };
    // Include businesses with balance > -200 so that recovering businesses can still hire
    const availableBusinessIds = Array.from(this.businesses.values())
      .filter(b => {
        if (b.balance <= -200) return false;
        if (b.type === "farm" || b.type === "workshop") return false;
        const cap = PUBLIC_SERVICE_MAX_EMPLOYEES[b.type];
        if (cap != null && b.employeeCount >= cap) return false;
        return true;
      })
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
            const tenure = agent.jobStartTick != null ? this.state.tick - agent.jobStartTick : undefined;
            agent.jobHistory = [...agent.jobHistory, { tick: this.state.tick, event: "retired", businessId: agent.employerId, businessName: oldBiz?.name ?? null, duration: tenure }];
            agent.employerId = null;
            agent.jobStartTick = null;
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
          const tenure = agent.jobStartTick != null ? this.state.tick - agent.jobStartTick : undefined;
          agent.jobHistory = [...agent.jobHistory, { tick: this.state.tick, event: "fired", businessId: agent.employerId, businessName: employer.name, duration: tenure }];
          agent.employerId = null;
          agent.jobStartTick = null;
        }
      }

      // Voluntary job switching: unhappy employed agents quit to seek better work (3% chance when mood < 35 or money < 30)
      if (!agent.isRetired && agent.employerId != null && Math.random() < 0.03) {
        const isUnhappy = agent.mood < 35 || (agent.money < 30 && agent.needs.hunger < 35);
        if (isUnhappy) {
          const currentBiz = this.businesses.get(agent.employerId);
          if (currentBiz) {
            currentBiz.employeeCount = Math.max(0, currentBiz.employeeCount - 1);
            currentBiz.firedThisTick++;
            const tenure = agent.jobStartTick != null ? this.state.tick - agent.jobStartTick : undefined;
            agent.jobHistory = [...agent.jobHistory, { tick: this.state.tick, event: "quit", businessId: agent.employerId, businessName: currentBiz.name, duration: tenure }];
            agent.employerId = null;
            agent.jobStartTick = null;
          }
        }
      }

      // ── Career advancement (grades 1–5) ─────────────────────────────────
      if (!agent.isRetired) {
        const careerTarget = targetGrade(agent.ambition);
        const tenure = agent.jobStartTick != null ? this.state.tick - agent.jobStartTick : 0;

        if (agent.careerLevel < careerTarget && agent.employerId != null && tenure >= 48) {
          // Ambition-driven promotion attempt at current employer (~4%×ambition per tick)
          // Интеллект даёт бонус к продвижению: intel=50 → +0%, intel=90 → +4%
          const intelligenceBonus = ((agent.intelligence ?? 50) - 50) * 0.001;
          const promotionProb = (agent.ambition / 100) * 0.04 + intelligenceBonus;
          if (Math.random() < promotionProb) {
            agent.careerLevel = Math.min(5, agent.careerLevel + 1);
            const biz = this.businesses.get(agent.employerId);
            agent.jobHistory = [...agent.jobHistory, {
              tick: this.state.tick, event: "promoted",
              businessId: agent.employerId, businessName: biz?.name ?? null,
            }];
            agent.money += agent.careerLevel * rand(8, 15);
            agent.mood = clamp(agent.mood + rand(5, 12));
          } else if (availableBusinessIds.length > 1 && Math.random() < 0.035) {
            // Career-driven job switch: seek better opportunity (spec: "Проверить вакансии")
            const candidates = availableBusinessIds.filter(id => id !== agent.employerId);
            if (candidates.length > 0) {
              const newBizId = pick(candidates);
              const newBiz = this.businesses.get(newBizId);
              if (newBiz) {
                const oldBiz = this.businesses.get(agent.employerId);
                if (oldBiz) { oldBiz.employeeCount = Math.max(0, oldBiz.employeeCount - 1); oldBiz.firedThisTick++; }
                agent.jobHistory = [...agent.jobHistory, {
                  tick: this.state.tick, event: "quit",
                  businessId: agent.employerId, businessName: oldBiz?.name ?? null, duration: tenure,
                }];
                agent.employerId = newBizId;
                agent.jobStartTick = this.state.tick;
                newBiz.employeeCount++;
                newBiz.hiredThisTick++;
                agent.jobHistory = [...agent.jobHistory, {
                  tick: this.state.tick, event: "hired",
                  businessId: newBizId, businessName: newBiz.name,
                }];
              }
            }
          }
        } else if (agent.careerLevel >= careerTarget && agent.employerId != null
            && tenure >= 200 && agent.careerLevel < 5 && Math.random() < 0.002) {
          // Exceptional promotion even when career goal is satisfied (top performers)
          agent.careerLevel = Math.min(5, agent.careerLevel + 1);
          const biz = this.businesses.get(agent.employerId);
          agent.jobHistory = [...agent.jobHistory, {
            tick: this.state.tick, event: "promoted",
            businessId: agent.employerId, businessName: biz?.name ?? null,
          }];
          agent.money += agent.careerLevel * rand(8, 15);
          agent.mood = clamp(agent.mood + rand(3, 8));
        }
      }

      // Job seeking: unemployed, non-retired agents have a 30% chance to find work
      if (!agent.isRetired && agent.employerId == null && availableBusinessIds.length > 0 && Math.random() < 0.30) {
        const newBizId = pick(availableBusinessIds);
        const newBiz = this.businesses.get(newBizId);
        if (newBiz) {
          agent.employerId = newBizId;
          agent.jobStartTick = this.state.tick;
          newBiz.employeeCount++;
          newBiz.hiredThisTick++;
          agent.jobHistory = [...agent.jobHistory, { tick: this.state.tick, event: "hired", businessId: newBizId, businessName: newBiz.name }];
        }
      }

      // ── Robbery (Грабёж) ─────────────────────────────────────────────────
      // Desperate unemployed agent (money < 20, financialSafety < 25) has a
      // small chance to rob a random other agent (spec: "ограбить при фин. кризисе")
      // Сила вора повышает шанс ограбления; Сила жертвы снижает урон по physicalSafety
      const robberyChance = 0.01 + (agent.strength ?? 50) * 0.0001; // 50→1.5%, 90→1.9%
      if (!agent.isRetired
          && agent.jailedUntilTick == null
          && agent.employerId == null
          && agent.money < 20
          && agent.needs.financialSafety < 25
          && Math.random() < robberyChance) {
        const potentialVictims = Array.from(this.agents.values())
          .filter(v => v.id !== agent.id && !v.isRetired && v.jailedUntilTick == null && v.money > 30);
        if (potentialVictims.length > 0) {
          const victim = pick(potentialVictims);
          const stolen = rand(15, 40);
          // Thief gains money, brief mood boost, financialSafety rises
          agent.money += stolen;
          agent.needs.financialSafety = clamp(agent.needs.financialSafety + 25);
          agent.mood = clamp(agent.mood + rand(3, 8));
          agent.currentAction = "rob";
          agent.recentActions = ["rob", ...agent.recentActions].slice(0, 10);
          // Слабый вор (низкая Сила) чаще попадается; сильный — чаще уходит
          const arrestChance = 0.45 - (agent.strength ?? 50) * 0.003; // 50→30%, 90→18%
          if (Math.random() < arrestChance) {
            agent.jailedUntilTick = this.state.tick + 360;
            agent.mood = clamp(agent.mood - rand(20, 35));
          } else {
            // Evaded but mood penalty from guilt
            agent.mood = clamp(agent.mood - rand(5, 10));
          }
          // Жертва с высокой Силой теряет меньше physicalSafety
          const safetyLoss = Math.round(55 - (victim.strength ?? 50) * 0.2); // 50→45, 90→37, 10→53
          victim.money = Math.max(0, victim.money - stolen);
          victim.needs.physicalSafety = clamp(victim.needs.physicalSafety - safetyLoss);
          victim.mood = clamp(victim.mood - rand(8, 15));
          victim.recentActions = ["robbed", ...victim.recentActions].slice(0, 10);
        }
      }

      // Jailed agents skip action processing this tick
      if (agent.jailedUntilTick != null) {
        if (this.state.tick >= agent.jailedUntilTick) {
          agent.jailedUntilTick = null; // Released
          agent.mood = clamp(agent.mood + rand(3, 8));
        } else {
          agent.currentAction = "jailed";
          // Still apply need decay below, but skip criticalNeed action
          agent.needs.hunger = clamp(agent.needs.hunger - needDecayRate * rand(0.5, 1.5));
          agent.needs.comfort = clamp(agent.needs.comfort - needDecayRate * rand(0.3, 1.0));
          agent.needs.sleep = clamp(agent.needs.sleep - 2.5 * rand(0.8, 1.2));
          continue;
        }
      }

      agent.needs.hunger = clamp(agent.needs.hunger - needDecayRate * rand(0.5, 1.5));
      agent.needs.comfort = clamp(agent.needs.comfort - needDecayRate * rand(0.3, 1.0));
      // Общение: по спеку -1 каждые 4 часа ≈ 0.25/тик — не масштабируется needDecayRate
      agent.needs.social = clamp(agent.needs.social - rand(0.15, 0.4));
      agent.needs.sleep = clamp(agent.needs.sleep - 2.5 * rand(0.8, 1.2));
      // Образование: по спеку не расходуется — очень медленное снижение для устойчивости
      agent.needs.education = clamp(agent.needs.education - rand(0.05, 0.15));
      // Развлечения: по спеку -0.5/час ≈ 0.5/тик
      agent.needs.entertainment = clamp(agent.needs.entertainment - rand(0.3, 0.7));
      // Вера: медленный распад
      agent.needs.faith = clamp(agent.needs.faith - rand(0.1, 0.3));

      // Financial safety: decays when low on money, recovers when financially stable
      if (agent.money < 50) {
        agent.needs.financialSafety = clamp(agent.needs.financialSafety - 0.8);
      } else if (agent.money < 100) {
        agent.needs.financialSafety = clamp(agent.needs.financialSafety - 0.4);
      } else {
        agent.needs.financialSafety = clamp(agent.needs.financialSafety + 0.15);
      }

      // Housing safety: decays when unemployed and poor, recovers when employed
      if (!agent.employerId) {
        if (agent.money < 30) {
          agent.needs.housingSafety = clamp(agent.needs.housingSafety - 1.2);
        } else if (agent.money < 100) {
          agent.needs.housingSafety = clamp(agent.needs.housingSafety - 0.5);
        } else {
          agent.needs.housingSafety = clamp(agent.needs.housingSafety - 0.15);
        }
      } else {
        agent.needs.housingSafety = clamp(agent.needs.housingSafety + 0.25);
      }

      // Physical safety: no natural decay — only drops via robbery; slowly self-recovers
      if (agent.needs.physicalSafety < 80) {
        agent.needs.physicalSafety = clamp(agent.needs.physicalSafety + 0.4);
      }

      // Health dynamics
      let healthDelta = 0;
      if (agent.needs.hunger < 30) healthDelta -= 0.8;  // starvation hurts
      if (agent.needs.sleep < 20) healthDelta -= 1.2;   // exhaustion hurts
      if (agent.needs.hunger > 50 && agent.needs.sleep > 50) healthDelta += 0.2; // natural recovery
      // Сила снижает возрастной износ: strength=50 → -0.01, strength=90 → -0.006, strength=10 → -0.014
      healthDelta -= 0.02 - (agent.strength ?? 50) * 0.0002;
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
          // Качество влияет на восстановление здоровья (quality=50 → ×1.0, 100 → ×1.3, 0 → ×0.7)
          const hospQMult = 0.7 + hospitalGood.quality * 0.006;
          agent.needs.health = clamp(agent.needs.health + rand(15, 28) * hospQMult);
          agent.needs.comfort = clamp(agent.needs.comfort + rand(5, 12));
          agent.currentAction = "heal";
          hospitalGood.demand = clamp(hospitalGood.demand + 1, 0, 200);
          // Накопление качества: каждые 1000 монет → +1 балл качества
          hospitalGood.quality = Math.min(100, hospitalGood.quality + hospitalGood.currentPrice / 1000);
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
        const foodGood = this.pickGoodByPreference("food", agent.personality, agent.socialization, agent.money);
        if (foodGood && agent.money >= foodGood.currentPrice) {
          agent.money -= foodGood.currentPrice;
          // Качество влияет на насыщение едой (quality=50 → ×1.0, 100 → ×1.3, 0 → ×0.7)
          const foodQMult = 0.7 + foodGood.quality * 0.006;
          agent.needs.hunger = clamp(agent.needs.hunger + rand(30, 60) * foodQMult);
          agent.currentAction = "eat";
          foodGood.demand = clamp(foodGood.demand + 1, 0, 200);
          // Накопление качества: каждые 1000 монет → +1 балл качества
          foodGood.quality = Math.min(100, foodGood.quality + foodGood.currentPrice / 1000);
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
            const salary = calcSalary(baseSalary, agent.careerLevel);
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
        const serviceGood = this.pickGoodByPreference("service", agent.personality, agent.socialization, agent.money * 0.5);
        if (serviceGood && agent.money >= serviceGood.currentPrice * 0.5) {
          const servicePayment = serviceGood.currentPrice * 0.5;
          agent.money -= servicePayment;
          serviceGood.demand = clamp(serviceGood.demand + 0.5, 0, 200);
          // Накопление качества
          serviceGood.quality = Math.min(100, serviceGood.quality + servicePayment / 1000);
          dbgMoneyOut += servicePayment;
        }
      } else if (criticalNeed === "social") {
        const partnerId = this.pickSocialPartner(agentId, agentIds);
        if (partnerId) {
          const partner = this.agents.get(partnerId);
          if (partner) {
            // ── Матрица диалогов: тир инициатора × тир ответчика (v1.6) ──
            const initTier = getMoodTier(agent.mood);
            const respTier = getMoodTier(partner.mood);
            const outcomes = DIALOG_MATRIX[initTier][respTier];
            // Если 2 варианта — «Рандом» из спека (50/50)
            const [dInit, dResp, dFriend] = outcomes[Math.floor(Math.random() * outcomes.length)];

            // socialInteractionStrength как масштабный коэффициент (default=2 → 1x)
            const s = socialInteractionStrength * 0.5;
            const dMoodInit = dInit * s;
            const dMoodResp = dResp * s;

            agent.needs.social   = clamp(agent.needs.social   + rand(20, 50));
            partner.needs.social = clamp(partner.needs.social + rand(10, 30));

            agent.mood   = clamp(agent.mood   + dMoodInit);
            partner.mood = clamp(partner.mood + dMoodResp);

            // Шкала дружбы: точно по спеку (dFriend), масштабируется
            const friendDelta = dFriend * s * 5;
            this.updateRelation(agentId, partnerId, friendDelta);
            this.updateRelation(partnerId, agentId, friendDelta * 0.5);
          }
        }
        agent.currentAction = "socialize";
      } else if (criticalNeed === "education") {
        // Schools are publicly funded — free for all agents, paid by government budget
        const schoolGood = this.pickAvailableGood("school");
        if (schoolGood) {
          // Фиксированный тариф обслуживания вместо рыночной цены.
          // Рыночная цена (currentPrice) используется только для расчёта качества,
          // но государство платит школе только базовый тариф на содержание.
          const maintenanceCost = 18; // фиксированный тариф за посещение школы
          // Интеллект усиливает усвоение знаний: intel=50 → ×1.0, intel=90 → ×1.4
          const intelFactor = 0.5 + (agent.intelligence ?? 50) / 100;
          // Agent uses service for free
          agent.needs.education = clamp(agent.needs.education + rand(25, 45) * intelFactor);
          agent.needs.comfort = clamp(agent.needs.comfort + rand(3, 8));
          agent.currentAction = "study";
          // Учёба медленно повышает Интеллект (max 100)
          agent.intelligence = Math.min(100, (agent.intelligence ?? 50) + rand(0.1, 0.3));
          schoolGood.demand = clamp(schoolGood.demand + 1, 0, 200);
          schoolGood.supply = clamp(schoolGood.supply - 1, 0, 200);
          // Накопление качества
          schoolGood.quality = Math.min(100, schoolGood.quality + maintenanceCost / 1000);
          // Government pays the school a fixed maintenance fee
          const biz = schoolGood.businessId ? this.businesses.get(schoolGood.businessId) : null;
          if (biz) biz.balance += maintenanceCost;
          runningBudget -= maintenanceCost;
          publicServiceSpend += maintenanceCost;
          gdp += maintenanceCost;
          dbgSuccessful++;
        } else {
          // No school available — self-study at home (intelligence still helps)
          const intelFactorSelf = 0.5 + (agent.intelligence ?? 50) / 100;
          agent.needs.education = clamp(agent.needs.education + rand(8, 15) * intelFactorSelf);
          agent.currentAction = "study";
        }
      } else if (criticalNeed === "entertainment") {
        // Parks are publicly funded — free for all agents, paid by government budget
        // Consumer matrix still applies for quality/tier preference
        const parkGood = this.pickGoodByPreference("park", agent.personality, agent.socialization, Infinity);
        if (parkGood) {
          // Фиксированный тариф обслуживания парка вместо рыночной цены
          const maintenanceCost = 14; // фиксированный тариф за посещение парка
          // Agent uses park for free
          agent.needs.entertainment = clamp(agent.needs.entertainment + rand(25, 45));
          agent.needs.comfort = clamp(agent.needs.comfort + rand(5, 12));
          agent.mood = clamp(agent.mood + rand(1, 4));
          agent.currentAction = "relax";
          parkGood.demand = clamp(parkGood.demand + 1, 0, 200);
          parkGood.supply = clamp(parkGood.supply - 1, 0, 200);
          // Накопление качества
          parkGood.quality = Math.min(100, parkGood.quality + maintenanceCost / 1000);
          // Government pays the park a fixed maintenance fee
          const biz = parkGood.businessId ? this.businesses.get(parkGood.businessId) : null;
          if (biz) biz.balance += maintenanceCost;
          runningBudget -= maintenanceCost;
          publicServiceSpend += maintenanceCost;
          gdp += maintenanceCost;
          dbgSuccessful++;
        } else {
          // No park available — leisure at home
          agent.needs.entertainment = clamp(agent.needs.entertainment + rand(10, 18));
          agent.currentAction = "relax";
        }
      } else if (criticalNeed === "faith") {
        const templeGood = this.pickAvailableGood("temple");
        if (templeGood && agent.money >= templeGood.currentPrice) {
          agent.money -= templeGood.currentPrice;
          agent.needs.faith = clamp(agent.needs.faith + rand(25, 50));
          agent.needs.social = clamp(agent.needs.social + rand(5, 12));
          agent.mood = clamp(agent.mood + rand(0.5, 2));
          agent.currentAction = "pray";
          templeGood.demand = clamp(templeGood.demand + 1, 0, 200);
          templeGood.supply = clamp(templeGood.supply - 1, 0, 200);
          // Накопление качества
          templeGood.quality = Math.min(100, templeGood.quality + templeGood.currentPrice / 1000);
          const biz = templeGood.businessId ? this.businesses.get(templeGood.businessId) : null;
          if (biz) biz.balance += templeGood.currentPrice;
          gdp += templeGood.currentPrice;
          dbgMoneyOut += templeGood.currentPrice;
          dbgSuccessful++;
        } else {
          // Pray at home for free
          agent.needs.faith = clamp(agent.needs.faith + rand(12, 22));
          agent.currentAction = "pray";
        }
      } else if (criticalNeed === "financialSafety") {
        // Financial crisis: prioritise earning money
        if (agent.employerId) {
          // Work urgently for income
          const salary = calcSalary(baseSalary, agent.careerLevel);
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
          agent.needs.financialSafety = clamp(agent.needs.financialSafety + rand(8, 15));
        } else {
          // Unemployed: urgently seek a job — no special subsidy, standard support applies separately
          const availBiz = Array.from(this.businesses.values()).filter(b => b.balance > -200 && b.employeeCount < b.maxEmployees);
          if (availBiz.length > 0) {
            const newBiz = pick(availBiz);
            agent.employerId = newBiz.id;
            agent.jobStartTick = this.state.tick;
            newBiz.employeeCount++;
            agent.jobHistory = [...agent.jobHistory, { tick: this.state.tick, event: "hired", businessId: newBiz.id, businessName: newBiz.name }];
            agent.currentAction = "work";
            agent.needs.financialSafety = clamp(agent.needs.financialSafety + rand(5, 10));
          } else {
            agent.currentAction = "idle";
          }
        }
      } else if (criticalNeed === "housingSafety") {
        // Housing crisis: urgently get a job (income = rent)
        if (agent.employerId) {
          // Already employed — work for stable income
          const salary = calcSalary(baseSalary, agent.careerLevel);
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
          agent.needs.housingSafety = clamp(agent.needs.housingSafety + rand(6, 12));
        } else {
          // No housing: desperately seek employment — no special subsidy, standard support applies separately
          const availBiz = Array.from(this.businesses.values()).filter(b => b.balance > -200 && b.employeeCount < b.maxEmployees);
          if (availBiz.length > 0) {
            const newBiz = pick(availBiz);
            agent.employerId = newBiz.id;
            agent.jobStartTick = this.state.tick;
            newBiz.employeeCount++;
            agent.jobHistory = [...agent.jobHistory, { tick: this.state.tick, event: "hired", businessId: newBiz.id, businessName: newBiz.name }];
            agent.currentAction = "work";
            agent.needs.housingSafety = clamp(agent.needs.housingSafety + rand(5, 10));
          } else {
            agent.currentAction = "idle";
          }
        }
      } else if (criticalNeed === "physicalSafety") {
        // Обращение в полицию: agent reports the robbery (spec: "Обратиться в полицию")
        agent.currentAction = "call_police";
        // Reporting to police gradually restores a sense of safety
        agent.needs.physicalSafety = clamp(agent.needs.physicalSafety + rand(12, 22));
        agent.mood = clamp(agent.mood + rand(3, 7));
      } else if (criticalNeed === "socialRating") {
        // Рейтинг упал — агент активно социализируется, чтобы поднять оценку в глазах других
        const partnerId = this.pickSocialPartner(agentId, agentIds);
        if (partnerId) {
          const partner = this.agents.get(partnerId);
          if (partner) {
            // Инициатор заинтересован произвести впечатление → положительная дельта дружбы
            const friendDelta = rand(3, 8);
            this.updateRelation(agentId, partnerId, friendDelta);
            this.updateRelation(partnerId, agentId, friendDelta * 0.5);
            partner.needs.social = clamp(partner.needs.social + rand(5, 15));
            partner.mood = clamp(partner.mood + rand(1, 4));
          }
        }
        agent.needs.social = clamp(agent.needs.social + rand(15, 35));
        agent.mood = clamp(agent.mood + rand(2, 6));
        agent.currentAction = "socialize";
      } else {
        if (agent.employerId) {
          const salary = calcSalary(baseSalary, agent.careerLevel);
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

      // Настроение конвергирует к "целевому" значению на основе взвешенного
      // среднего потребностей (2% в тик ≈ 1.5 игровых дня до равновесия).
      // Это предотвращает накопление настроения до 100 при удовлетворённых нуждах.
      const moodTarget = clamp(
        50 +
          (agent.needs.hunger - 50) * 0.14 +
          (agent.needs.comfort - 50) * 0.12 +
          (agent.needs.social - 50) * 0.09 +
          (agent.needs.health - 50) * 0.13 +
          (agent.needs.sleep - 50) * 0.12 +
          (agent.needs.education - 50) * 0.05 +
          (agent.needs.entertainment - 50) * 0.07 +
          (agent.needs.faith - 50) * 0.04 +
          (agent.needs.financialSafety - 50) * 0.09 +
          (agent.needs.housingSafety - 50) * 0.06 +
          (agent.needs.physicalSafety - 50) * 0.08 +
          (agent.needs.socialRating - 50) * 0.07
      ); // коэффициенты сумма = 1.06 → небольшое масштабирование вверх при хороших нуждах
      agent.mood = clamp(agent.mood + (moodTarget - agent.mood) * 0.025);

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
      else if (act === "study") dbgActStudy++;
      else if (act === "relax") dbgActRelax++;
      else if (act === "pray") dbgActPray++;
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
    this.state.totalPublicServicesPaid += publicServiceSpend;

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

      // ── Government business grants ─────────────────────────────────────────
      // When unemployment exceeds threshold and budget allows, fund new businesses
      const grantResult = await this.processGovernmentGrants();
      this.totalGrantsPaid += grantResult.totalSpent;
      this.lastGrantsIssued = grantResult.grantsIssued;
      runningBudget = this.state.governmentBudget; // sync after grants deducted
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
          actions: { work: dbgActWork, eat: dbgActEat, rest: dbgActRest, sleep: dbgActSleep, heal: dbgActHeal, socialize: dbgActSocialize, idle: dbgActIdle, study: dbgActStudy, relax: dbgActRelax, pray: dbgActPray },
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
          publicServiceSpend: Math.round(publicServiceSpend),
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
        careerLevel: 1,
        ambition: randInt(20, 100),
        strength: rand(30, 90),
        intelligence: rand(30, 90),
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
      education: rand(50, 80),
      entertainment: rand(50, 80),
      faith: rand(40, 70),
      housingSafety: rand(65, 95),
      financialSafety: rand(60, 90),
      physicalSafety: rand(70, 95),
      socialRating: 50,
    }));
    const savedNeeds = await db.insert(needsTable).values(needsInserts).returning();
    const needsMap = new Map<number, typeof savedNeeds[0]>();
    for (const n of savedNeeds) needsMap.set(n.agentId, n);

    for (const agent of saved) {
      const needs = needsMap.get(agent.id);
      if (!needs) continue;
      this.agents.set(agent.id, {
        ...agent,
        needs: { hunger: needs.hunger, comfort: needs.comfort, social: needs.social, health: needs.health ?? 80, sleep: needs.sleep ?? 80, education: needs.education ?? 70, entertainment: needs.entertainment ?? 70, faith: needs.faith ?? 60, housingSafety: needs.housingSafety ?? 80, financialSafety: needs.financialSafety ?? 80, physicalSafety: needs.physicalSafety ?? 80, socialRating: needs.socialRating ?? 50 },
        needsId: needs.id,
        recentActions: [],
        jobHistory: agent.employerId
          ? [{ tick: this.state.tick, event: "hired", businessId: agent.employerId, businessName: this.businesses.get(agent.employerId)?.name ?? null }]
          : [],
        jobStartTick: agent.employerId ? this.state.tick : null,
        jailedUntilTick: null,
      });
      if (agent.employerId) {
        const biz = this.businesses.get(agent.employerId);
        if (biz) biz.employeeCount++;
      }
    }
  }

  private getCriticalNeed(needs: { hunger: number; comfort: number; social: number; health: number; sleep: number; education: number; entertainment: number; faith: number; housingSafety: number; financialSafety: number; physicalSafety: number; socialRating: number }): string {
    // Priority 1-4: critical physical needs — thresholds aligned with spec v1.6
    if (needs.health < 50) return "health";       // spec: < 60
    if (needs.sleep < 45) return "sleep";          // spec: < 50
    if (needs.hunger < 55) return "hunger";        // spec: < 70
    // Priority 5-7: safety needs (trigger before social/entertainment)
    if (needs.financialSafety < 30) return "financialSafety";
    if (needs.housingSafety < 25) return "housingSafety";
    if (needs.physicalSafety < 45) return "physicalSafety"; // spec: < 50
    // Priority 8+: secondary social/growth needs — individual thresholds per spec
    // socialRating: lower threshold (30) since it moves slowly (daily recalc)
    if (needs.socialRating < 30) return "socialRating";
    const secondary: Array<[string, number]> = [
      ["comfort",       needs.comfort],
      ["social",        needs.social],
      ["entertainment", needs.entertainment],
      ["education",     needs.education],
      ["faith",         needs.faith],
    ];
    const thresholds: Record<string, number> = {
      comfort: 35,
      social: 45,        // decay now much slower, so threshold can be higher
      entertainment: 50, // spec: < 60
      education: 30,
      faith: 30,
    };
    const critical = secondary.filter(([name, v]) => v < (thresholds[name] ?? 30));
    if (critical.length > 0) {
      critical.sort((a, b) => a[1] - b[1]);
      return critical[0][0];
    }
    return "work";
  }

  private pickAvailableGood(type: "food" | "service" | "hospital" | "school" | "park" | "temple"): GoodState | null {
    const relevant = Array.from(this.goods.values()).filter(g => {
      const biz = g.businessId ? this.businesses.get(g.businessId) : null;
      return biz && biz.type === type && g.supply > 0;
    });
    if (relevant.length === 0) return null;
    return pick(relevant);
  }

  /**
   * Pick a good using the consumer preference matrix (spec v1.6).
   * Falls back to pickAvailableGood when no matrix entry exists for this type.
   *
   * Rules (from spec):
   *   85% probability → buy from preferred price/quality tier
   *   15% probability → buy from random available tier
   *   If preferred tier is unaffordable → buy cheapest affordable
   */
  private pickGoodByPreference(
    type: "food" | "service" | "park",
    personality: string,
    socialization: number,
    budget: number,
  ): GoodState | null {
    const peers = Array.from(this.goods.values()).filter(g => {
      const biz = g.businessId ? this.businesses.get(g.businessId) : null;
      return biz && biz.type === type && g.supply > 0;
    });
    if (peers.length === 0) return null;

    const matrixRow = CONSUMER_MATRIX[type];
    if (!matrixRow) return pick(peers.filter(g => g.currentPrice <= budget)) ?? pick(peers);

    const pIdx = getPersonalityIndex(personality, socialization);
    const [prefPrice, prefQuality] = matrixRow[pIdx];

    const preferred = peers.filter(g => {
      const [pl, ql] = classifyGood(g, peers);
      return pl === prefPrice && ql === prefQuality;
    });

    const affordablePreferred = preferred.filter(g => g.currentPrice <= budget);
    const affordableAll = peers.filter(g => g.currentPrice <= budget);

    if (affordablePreferred.length > 0 && Math.random() < 0.85) {
      return pick(affordablePreferred);
    }

    // 15% random tier or preferred unaffordable → random from affordable
    if (affordableAll.length > 0) {
      return pick(affordableAll);
    }

    // Can't afford anything → cheapest available regardless of budget
    return peers.sort((a, b) => a.currentPrice - b.currentPrice)[0] ?? null;
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
    const { priceMarkup } = this.config;

    for (const good of this.goods.values()) {
      const bizType = good.businessId != null ? this.businesses.get(good.businessId)?.type : undefined;
      const base = good.basePrice;

      // ── Equilibrium price (quality-adjusted base) ─────────────────────────
      // Quality premium: ±10% at quality 0/100; neutral at quality 50
      // Качество: ±30% к равновесной цене (quality=50 → ×1.0, 100 → ×1.3, 0 → ×0.7)
      const qualityPremium = (good.quality - 50) / 167;
      const equilibrium = base * (1 + priceMarkup) * (1 + qualityPremium);

      // ── Demand-supply pressure ────────────────────────────────────────────
      // ratio > 1 → demand exceeds supply → price rises
      // ratio < 1 → excess supply → price falls
      // elasticity: 2% of currentPrice per unit of excess ratio per tick
      const supply = Math.max(good.supply, 1);
      const ratio = good.demand / supply;
      const elasticity = 0.02;
      const pressureChange = (ratio - 1) * elasticity * good.currentPrice;

      // ── Mean reversion toward equilibrium ─────────────────────────────────
      // Prevents runaway inflation/deflation; 3% pull per tick
      const reversionRate = 0.03;
      const reversion = (equilibrium - good.currentPrice) * reversionRate;

      // ── Apply combined adjustment with hard floor/ceiling ─────────────────
      // Ceiling: scales with quality (high-quality goods can command higher prices)
      const qualityCeilingMult = 1 + (good.quality - 50) / 100; // quality=100 → ×1.5, quality=50 → ×1.0
      const baseCeiling = (bizType === "food" || bizType === "service" || bizType === "hospital") ? base * 2.5 : base * 3.0;
      const priceCeiling = baseCeiling * qualityCeilingMult;
      const newPrice = good.currentPrice + pressureChange + reversion;
      good.currentPrice = Math.max(base * 0.3, Math.min(priceCeiling, newPrice));

      // ── Supply/demand natural dynamics per business tier ──────────────────
      if (bizType === "farm") {
        // Raw material producers: high output
        good.supply = clamp(good.supply + rand(4, 10), 0, 200);
        good.demand = clamp(good.demand - rand(1, 3), 0, 200);
      } else if (bizType === "workshop") {
        // Manufacturing: steady output
        good.supply = clamp(good.supply + rand(3, 8), 0, 200);
        good.demand = clamp(good.demand - rand(1, 2), 0, 200);
      } else if (bizType === "school" || bizType === "park" || bizType === "temple") {
        // Public services: strong supply regeneration (capacity-based, not stock)
        // High replenishment prevents extreme price spikes for essential services
        good.supply = clamp(good.supply + rand(8, 16), 0, 200);
        good.demand = clamp(good.demand - rand(2, 5), 0, 200);
      } else if (bizType === "hospital") {
        // Healthcare: moderate supply recovery
        good.supply = clamp(good.supply + rand(4, 8), 0, 200);
        good.demand = clamp(good.demand - rand(1, 3), 0, 200);
      } else {
        // Consumer goods (food/service/retail): moderate replenishment
        // Productivity bonus: each invested level adds 0.1 × employeeCount extra supply
        const ownerBiz = good.businessId != null ? this.businesses.get(good.businessId) : null;
        const prodLevel = ownerBiz?.productivityLevel ?? 0;
        const empCount = ownerBiz?.employeeCount ?? 0;
        const prodBonus = Math.floor(prodLevel * 0.1 * empCount);
        good.supply = clamp(good.supply + rand(1, 4) + prodBonus, 0, 200);
        good.demand = clamp(good.demand - rand(1, 3), 0, 200);
      }
    }
  }

  private updateBusinesses(): void {
    for (const biz of this.businesses.values()) {
      if (biz.balance < 0) biz.balance = Math.max(biz.balance + biz.productionRate * 5, 0);
    }
  }

  private async processGovernmentGrants(): Promise<{ grantsIssued: number; totalSpent: number }> {
    const GRANT_AMOUNT = 3000;
    const MAX_GRANTS_PER_DAY = 3;
    const UNEMPLOYMENT_THRESHOLD = 0.28; // 28% unemployment triggers grants

    if (this.state.governmentBudget < GRANT_AMOUNT * 2) {
      return { grantsIssued: 0, totalSpent: 0 };
    }

    const workingAge = Array.from(this.agents.values()).filter(
      a => !a.isRetired && a.age >= 18 && a.age <= 65
    );
    const unemployed = workingAge.filter(a => a.employerId == null);
    const unemploymentRate = workingAge.length > 0 ? unemployed.length / workingAge.length : 0;

    if (unemploymentRate < UNEMPLOYMENT_THRESHOLD) {
      return { grantsIssued: 0, totalSpent: 0 };
    }

    // Pick candidates: unemployed, not jailed, low money, sorted by highest ambition
    const candidates = unemployed
      .filter(a => a.money < 300 && a.jailedUntilTick == null)
      .sort((a, b) => (b.ambition ?? 50) - (a.ambition ?? 50))
      .slice(0, MAX_GRANTS_PER_DAY);

    if (candidates.length === 0) return { grantsIssued: 0, totalSpent: 0 };

    let grantsIssued = 0;
    let totalSpent = 0;
    const { baseFoodPrice } = this.config;

    const foodCount = Array.from(this.businesses.values()).filter(b => b.type === "food").length;
    const serviceCount = Array.from(this.businesses.values()).filter(b => b.type === "service").length;

    for (const agent of candidates) {
      if (this.state.governmentBudget < GRANT_AMOUNT) break;

      const isFood = grantsIssued % 2 === 0;
      const bizType = isFood ? "food" : "service";
      const bizNum = isFood ? (foodCount + grantsIssued + 1) : (serviceCount + grantsIssued + 1);
      const bizName = isFood
        ? `${pick(FOOD_BUSINESS_NAMES)} №${bizNum}`
        : `${pick(SERVICE_BUSINESS_NAMES)} №${bizNum}`;

      const [newBiz] = await db.insert(businessesTable).values({
        name: bizName,
        type: bizType,
        balance: GRANT_AMOUNT,
        productionRate: rand(4, 12),
        ownerId: agent.id,
        productivityLevel: 0,
      }).returning();

      this.businesses.set(newBiz.id, {
        ...newBiz,
        employeeCount: 1,
        firedThisTick: 0,
        hiredThisTick: 1,
      });

      const goodName = isFood ? pick(FOOD_GOOD_NAMES) : pick(SERVICE_GOOD_NAMES);
      const goodPrice = isFood ? baseFoodPrice : baseFoodPrice * 1.5;
      const [newGood] = await db.insert(goodsTable).values({
        name: goodName,
        businessId: newBiz.id,
        basePrice: goodPrice,
        currentPrice: goodPrice * (1 + this.config.priceMarkup),
        quality: rand(40, 70),
        demand: rand(15, 40),
        supply: rand(20, 50),
      }).returning();
      this.goods.set(newGood.id, { ...newGood });

      agent.employerId = newBiz.id;
      agent.jobStartTick = this.state.tick;
      agent.jobHistory = [
        ...agent.jobHistory,
        { tick: this.state.tick, event: "hired", businessId: newBiz.id, businessName: bizName },
      ];
      agent.money += 200; // small cash stipend alongside the grant

      this.state.governmentBudget -= GRANT_AMOUNT;
      grantsIssued++;
      totalSpent += GRANT_AMOUNT;

      logger.debug({ agentId: agent.id, bizName, bizType, unemploymentRate: Math.round(unemploymentRate * 100) }, "Government grant issued");
    }

    return { grantsIssued, totalSpent };
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
            careerLevel: agent.careerLevel,
            ambition: agent.ambition,
            strength: agent.strength,
            intelligence: agent.intelligence,
          })
          .where(eq(agentsTable.id, agent.id));
        await db.update(needsTable)
          .set({ hunger: agent.needs.hunger, comfort: agent.needs.comfort, social: agent.needs.social, health: agent.needs.health, sleep: agent.needs.sleep, education: agent.needs.education, entertainment: agent.needs.entertainment, faith: agent.needs.faith, housingSafety: agent.needs.housingSafety, financialSafety: agent.needs.financialSafety, physicalSafety: agent.needs.physicalSafety, socialRating: agent.needs.socialRating })
          .where(eq(needsTable.agentId, agent.id));
      }
    }

    const goodsArray = Array.from(this.goods.values());
    for (const good of goodsArray) {
      await db.update(goodsTable)
        .set({ currentPrice: good.currentPrice, demand: good.demand, supply: good.supply, quality: good.quality })
        .where(eq(goodsTable.id, good.id));
    }

    const bizArray = Array.from(this.businesses.values());
    for (const biz of bizArray) {
      await db.update(businessesTable)
        .set({ balance: biz.balance, productivityLevel: biz.productivityLevel ?? 0 })
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
      // Удаляем лишние строки сразу после вставки (только для затронутых агентов)
      const agentIds = dbRows.map(r => r.agentId);
      void db.execute(sql`
        DELETE FROM agent_stat_history
        WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY tick DESC) AS rn
            FROM agent_stat_history
            WHERE agent_id = ANY(${agentIds}::int[])
          ) ranked
          WHERE rn > ${AGENT_STAT_HISTORY_MAX}
        )
      `).catch(() => {});
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
        totalPublicServicesPaid: this.state.totalPublicServicesPaid,
        updatedAt: new Date(),
      }).where(eq(simStateTable.id, existing.id));
    }
  }

  private getAggregateStats() {
    const agents = Array.from(this.agents.values());
    if (agents.length === 0) return { avgMood: 0, avgWealth: 0, unemploymentRate: 0 };
    const avgMood = agents.reduce((s, a) => s + a.mood, 0) / agents.length;
    const avgWealth = agents.reduce((s, a) => s + a.money, 0) / agents.length;
    // Безработица = только среди трудоспособных (не пенсионеры)
    const workingAge = agents.filter(a => !a.isRetired);
    const employed = workingAge.filter(a => a.employerId != null).length;
    const unemploymentRate = workingAge.length > 0
      ? ((workingAge.length - employed) / workingAge.length) * 100
      : 0;
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
        isRetired: a.isRetired,
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
        education: Math.round(agent.needs.education * 10) / 10,
        entertainment: Math.round(agent.needs.entertainment * 10) / 10,
        faith: Math.round(agent.needs.faith * 10) / 10,
        housingSafety: Math.round(agent.needs.housingSafety * 10) / 10,
        financialSafety: Math.round(agent.needs.financialSafety * 10) / 10,
        physicalSafety: Math.round(agent.needs.physicalSafety * 10) / 10,
        socialRating: Math.round(agent.needs.socialRating * 10) / 10,
      },
      // Career info
      employerName: agent.employerId ? (this.businesses.get(agent.employerId)?.name ?? null) : null,
      jobStartTick: agent.jobStartTick,
      jobTenure: agent.employerId && agent.jobStartTick != null ? this.state.tick - agent.jobStartTick : null,
      totalJobs: agent.jobHistory.filter(e => e.event === "hired").length,
      promotions: agent.jobHistory.filter(e => e.event === "promoted").length,
      careerLevel: agent.careerLevel,
      ambition: Math.round(agent.ambition),
      targetCareerLevel: targetGrade(agent.ambition),
      strength: Math.round((agent.strength ?? 50) * 10) / 10,
      intelligence: Math.round((agent.intelligence ?? 50) * 10) / 10,
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
      productivityLevel: b.productivityLevel ?? 0,
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

  getNeedsStats() {
    const agents = Array.from(this.agents.values());
    const n = agents.length;
    if (n === 0) {
      const empty = { avg: 0, criticalPct: 0, lowPct: 0 };
      return {
        hunger: empty, comfort: empty, health: empty, sleep: empty,
        social: empty, education: empty, entertainment: empty, faith: empty,
        financialSafety: empty, housingSafety: empty, physicalSafety: empty, socialRating: empty,
      };
    }
    type NeedKey = keyof typeof agents[0]["needs"];
    const keys: NeedKey[] = [
      "hunger", "comfort", "health", "sleep", "social", "education",
      "entertainment", "faith", "financialSafety", "housingSafety",
      "physicalSafety", "socialRating",
    ];
    const result: Record<string, { avg: number; criticalPct: number; lowPct: number }> = {};
    for (const key of keys) {
      let sum = 0, critical = 0, low = 0;
      for (const a of agents) {
        const v = a.needs[key];
        sum += v;
        if (v < 25) critical++;
        else if (v < 50) low++;
      }
      result[key] = {
        avg: Math.round((sum / n) * 10) / 10,
        criticalPct: Math.round((critical / n) * 1000) / 10,
        lowPct: Math.round((low / n) * 1000) / 10,
      };
    }
    return result;
  }

  getGovernment() {
    const workingAge = Array.from(this.agents.values()).filter(a => !a.isRetired && a.age >= 18 && a.age <= 65);
    const unemployed = workingAge.filter(a => a.employerId == null);
    const unemploymentRate = workingAge.length > 0 ? unemployed.length / workingAge.length : 0;
    return {
      budget: Math.round(this.state.governmentBudget * 100) / 100,
      totalTaxCollected: Math.round(this.state.totalTaxCollected * 100) / 100,
      totalSubsidiesPaid: Math.round(this.state.totalSubsidiesPaid * 100) / 100,
      totalPensionPaid: Math.round(this.state.totalPensionPaid * 100) / 100,
      totalPublicServicesPaid: Math.round(this.state.totalPublicServicesPaid * 100) / 100,
      taxRate: this.config.taxRate,
      subsidyAmount: this.config.subsidyAmount,
      pensionRate: this.config.pensionRate,
      totalGrantsPaid: Math.round(this.totalGrantsPaid * 100) / 100,
      grantsIssuedLastDay: this.lastGrantsIssued,
      unemploymentRatePct: Math.round(unemploymentRate * 1000) / 10,
      grantThresholdPct: 28,
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
