import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useListAgents,
  useGetConfig,
  useGetSimulationState,
  getListAgentsQueryKey,
  getGetSimulationStateQueryKey,
  type ListAgentsQueryResult,
} from "@workspace/api-client-react";

import { ChevronUp, ChevronDown, BarChart2, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

type AgentItem = NonNullable<ListAgentsQueryResult>["agents"][number];

type SortBy = "name" | "age" | "mood" | "money" | "currentAction";
type SortDir = "asc" | "desc";
type GroupBy = "personality" | "employment" | "ageGroup";
type ViewMode = "table" | "analysis";

const ACTION_LABELS: Record<string, string> = {
  eat: "Ест",
  rest: "Отдыхает",
  sleep: "Спит",
  heal: "Лечится",
  socialize: "Общается",
  work: "Работает",
  idle: "Простаивает",
  study: "Учится",
  relax: "Развлекается",
  pray: "Молится",
};

const ACTION_COLORS: Record<string, string> = {
  eat: "text-[hsl(43,100%,50%)]",
  rest: "text-[hsl(173,80%,40%)]",
  sleep: "text-[hsl(220,70%,60%)]",
  heal: "text-[hsl(0,80%,60%)]",
  socialize: "text-[hsl(280,80%,60%)]",
  work: "text-[hsl(210,100%,50%)]",
  idle: "text-muted-foreground",
  study: "text-[hsl(270,70%,60%)]",
  relax: "text-[hsl(120,60%,45%)]",
  pray: "text-[hsl(35,90%,55%)]",
};

const ACTION_BG: Record<string, string> = {
  eat: "bg-[hsl(43,100%,50%)]",
  rest: "bg-[hsl(173,80%,40%)]",
  sleep: "bg-[hsl(220,70%,60%)]",
  heal: "bg-[hsl(0,80%,60%)]",
  socialize: "bg-[hsl(280,80%,60%)]",
  work: "bg-[hsl(210,100%,50%)]",
  idle: "bg-muted-foreground/50",
  study: "bg-[hsl(270,70%,60%)]",
  relax: "bg-[hsl(120,60%,45%)]",
  pray: "bg-[hsl(35,90%,55%)]",
};

const GROUP_BY_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "personality", label: "Личность" },
  { key: "employment",  label: "Занятость" },
  { key: "ageGroup",    label: "Возраст" },
];

interface PopulationGroup {
  label: string;
  count: number;
  pct: number;
  avgMood: number;
  avgMoney: number;
  avgAge: number;
  employedCount: number;
  topAction: string;
  topActionKey: string;
}
interface PopulationGroupsResponse {
  groupBy: GroupBy;
  total: number;
  groups: PopulationGroup[];
}

interface NeedStat {
  avg: number;
  criticalPct: number;
  lowPct: number;
}
interface NeedsStats {
  hunger: NeedStat;
  comfort: NeedStat;
  health: NeedStat;
  sleep: NeedStat;
  social: NeedStat;
  education: NeedStat;
  entertainment: NeedStat;
  faith: NeedStat;
  financialSafety: NeedStat;
  housingSafety: NeedStat;
  physicalSafety: NeedStat;
  socialRating: NeedStat;
  wellbeing: NeedStat;
}

const NEED_META: { key: keyof NeedsStats; label: string; color: string }[] = [
  { key: "hunger",          label: "Голод",               color: "hsl(43,100%,50%)"  },
  { key: "health",          label: "Здоровье",            color: "hsl(348,83%,52%)"  },
  { key: "sleep",           label: "Сон",                 color: "hsl(220,70%,60%)"  },
  { key: "comfort",         label: "Комфорт",             color: "hsl(173,80%,40%)"  },
  { key: "social",          label: "Общение",             color: "hsl(280,80%,60%)"  },
  { key: "financialSafety", label: "Фин. безопасность",   color: "hsl(160,60%,45%)"  },
  { key: "physicalSafety",  label: "Физ. безопасность",   color: "hsl(0,70%,55%)"    },
  { key: "housingSafety",   label: "Безопасность жилья",  color: "hsl(25,90%,55%)"   },
  { key: "entertainment",   label: "Развлечения",         color: "hsl(120,55%,45%)"  },
  { key: "education",       label: "Образование",         color: "hsl(270,70%,60%)"  },
  { key: "faith",           label: "Вера",                color: "hsl(35,90%,55%)"   },
  { key: "socialRating",    label: "Соц. рейтинг",        color: "hsl(210,100%,55%)" },
  { key: "wellbeing",       label: "Благосостояние",      color: "hsl(170,70%,45%)"  },
];

function needBarColor(avg: number): string {
  if (avg < 25) return "hsl(348,83%,52%)";
  if (avg < 50) return "hsl(43,100%,50%)";
  if (avg < 75) return "hsl(173,80%,40%)";
  return "hsl(142,70%,45%)";
}

function needStatusLabel(avg: number): { text: string; cls: string } {
  if (avg < 25) return { text: "критично",   cls: "text-[hsl(348,83%,52%)]" };
  if (avg < 50) return { text: "низко",      cls: "text-[hsl(43,100%,50%)]" };
  if (avg < 75) return { text: "норма",      cls: "text-[hsl(173,80%,40%)]" };
  return              { text: "хорошо",     cls: "text-[hsl(142,70%,45%)]" };
}

export default function AgentsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterAction, setFilterAction] = useState<string>("");
  const [groupBy, setGroupBy] = useState<GroupBy>("personality");
  const [groupData, setGroupData] = useState<PopulationGroupsResponse | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupSortCol, setGroupSortCol] = useState<keyof PopulationGroup>("count");
  const [groupSortDir, setGroupSortDir] = useState<"asc" | "desc">("desc");
  const [needsStats, setNeedsStats] = useState<NeedsStats | null>(null);

  const { data: simState } = useGetSimulationState({
    query: {
      queryKey: getGetSimulationStateQueryKey(),
      refetchInterval: 5000,
    },
  });
  const running = simState?.running ?? false;

  const { data: config } = useGetConfig();
  const tickIntervalMs = config?.tickIntervalMs ?? 60000;

  const { data, isLoading } = useListAgents(
    { page, limit: 50, sortBy, sortDir, filterAction: filterAction || undefined },
    { query: { queryKey: getListAgentsQueryKey({ page, limit: 50, sortBy, sortDir, filterAction: filterAction || undefined }), refetchInterval: running ? 7000 : tickIntervalMs } }
  );

  const fetchGroups = useCallback(async () => {
    setGroupLoading(true);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const res = await fetch(`${base}/api/stats/population-groups?groupBy=${groupBy}`);
      if (res.ok) setGroupData(await res.json());
    } catch {
    } finally {
      setGroupLoading(false);
    }
  }, [groupBy]);

  const fetchNeeds = useCallback(async () => {
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const res = await fetch(`${base}/api/stats/needs`);
      if (res.ok) setNeedsStats(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (viewMode === "analysis") {
      fetchGroups();
      fetchNeeds();
      const interval = running ? 8000 : 60000;
      const id1 = setInterval(fetchGroups, interval);
      const id2 = setInterval(fetchNeeds, interval);
      return () => { clearInterval(id1); clearInterval(id2); };
    }
  }, [viewMode, fetchGroups, fetchNeeds, running]);

  const handleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
    setPage(1);
  };

  const handleGroupSort = (col: keyof PopulationGroup) => {
    if (groupSortCol === col) {
      setGroupSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setGroupSortCol(col);
      setGroupSortDir("desc");
    }
  };

  const sortedGroups = groupData?.groups ? [...groupData.groups].sort((a, b) => {
    const av = a[groupSortCol] as number | string;
    const bv = b[groupSortCol] as number | string;
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return groupSortDir === "desc" ? -cmp : cmp;
  }) : [];

  const maxMoney = sortedGroups.length ? Math.max(...sortedGroups.map(g => g.avgMoney)) : 1;

  const SortIcon = ({ col }: { col: SortBy }) => {
    if (sortBy !== col) return <span className="w-3 h-3 inline-block" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />;
  };

  const GSortIcon = ({ col }: { col: keyof PopulationGroup }) => {
    if (groupSortCol !== col) return <span className="w-3 h-3 inline-block opacity-0" />;
    return groupSortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />;
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-foreground">Жители</h1>
            {running && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider bg-[hsl(173,80%,40%)]/15 text-[hsl(173,80%,40%)] border border-[hsl(173,80%,40%)]/25">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(173,80%,40%)] animate-pulse inline-block" />
                LIVE
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data ? `${data.total.toLocaleString()} агентов · стр. ${data.page} из ${data.totalPages}` : "Загрузка..."}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-secondary border border-border rounded overflow-hidden">
            <button
              onClick={() => setViewMode("table")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors",
                viewMode === "table"
                  ? "bg-[hsl(173,80%,40%)]/15 text-[hsl(173,80%,40%)]"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Table2 className="w-3.5 h-3.5" />
              Таблица
            </button>
            <button
              onClick={() => setViewMode("analysis")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors",
                viewMode === "analysis"
                  ? "bg-[hsl(173,80%,40%)]/15 text-[hsl(173,80%,40%)]"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              Анализ
            </button>
          </div>

          {viewMode === "table" && (
            <select
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); setPage(1); }}
              className="bg-secondary text-secondary-foreground text-xs px-2 py-1.5 rounded border border-border outline-none"
            >
              <option value="">Все действия</option>
              {Object.entries(ACTION_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          )}

          {viewMode === "analysis" && (
            <div className="flex items-center gap-1">
              {GROUP_BY_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setGroupBy(opt.key)}
                  className={cn(
                    "px-2.5 py-1.5 rounded text-xs font-medium border transition-colors",
                    groupBy === opt.key
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-transparent border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewMode === "table" && (
        <>
          <div className="bg-card border border-card-border rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {([
                    ["name", "Имя"],
                    ["age", "Возраст"],
                    ["mood", "Настроение"],
                    ["money", "Деньги"],
                    ["currentAction", "Действие"],
                  ] as [SortBy, string][]).map(([col, label]) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      className="text-left px-3 py-2.5 text-[10px] font-medium tracking-widest uppercase text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    >
                      {label} <SortIcon col={col} />
                    </th>
                  ))}
                  <th className="text-left px-3 py-2.5 text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Профессия</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-3 py-2">
                          <div className="h-3 bg-muted rounded animate-pulse" style={{ width: `${40 + Math.random() * 40}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (data?.agents ?? []).map(agent => (
                  <AgentRow key={agent.id} agent={agent} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded disabled:opacity-40 hover:opacity-90"
            >
              Назад
            </button>
            <span className="text-xs text-muted-foreground">Страница {page} из {data?.totalPages ?? "?"}</span>
            <button
              onClick={() => setPage(p => Math.min(data?.totalPages ?? p, p + 1))}
              disabled={!data || page >= data.totalPages}
              className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded disabled:opacity-40 hover:opacity-90"
            >
              Вперёд
            </button>
          </div>
        </>
      )}

      {viewMode === "analysis" && (
        <div className="space-y-4">
          {groupLoading && !groupData && (
            <div className="bg-card border border-card-border rounded p-8 text-center text-muted-foreground text-xs">
              Загрузка данных...
            </div>
          )}

          {/* ── Удовлетворённость потребностей ─────────────────────────────── */}
          {needsStats && <NeedsPanel stats={needsStats} />}

          {groupData && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard label="Всего жителей" value={groupData.total.toLocaleString()} color="hsl(173,80%,40%)" />
                <SummaryCard label="Групп" value={String(groupData.groups.length)} color="hsl(43,100%,50%)" />
                <SummaryCard label="Ср. богатство" value={groupData.total > 0 ? Math.round(groupData.groups.reduce((s, g) => s + g.avgMoney * g.count, 0) / groupData.total).toLocaleString() : "—"} color="hsl(210,100%,55%)" />
                <SummaryCard label="Ср. настроение" value={groupData.total > 0 ? (groupData.groups.reduce((s, g) => s + g.avgMood * g.count, 0) / groupData.total).toFixed(1) : "—"} color="hsl(280,80%,62%)" />
              </div>

              <div className="bg-card border border-card-border rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {([
                        ["label",        "Группа",          "text-left"],
                        ["count",        "Кол-во",          "text-right"],
                        ["pct",          "Доля, %",         "text-right"],
                        ["avgMood",      "Ср. настроение",  "text-right"],
                        ["avgMoney",     "Ср. богатство",   "text-right"],
                        ["avgAge",       "Ср. возраст",     "text-right"],
                        ["employedCount","Занято",          "text-right"],
                        ["topAction",    "Топ действие",    "text-left"],
                      ] as [keyof PopulationGroup, string, string][]).map(([col, label, align]) => (
                        <th
                          key={col}
                          onClick={() => handleGroupSort(col)}
                          className={cn(
                            "px-3 py-2.5 text-[10px] font-medium tracking-widest uppercase text-muted-foreground cursor-pointer hover:text-foreground select-none",
                            align
                          )}
                        >
                          {label} <GSortIcon col={col} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGroups.map((group, i) => {
                      const employedPct = group.count > 0 ? Math.round((group.employedCount / group.count) * 100) : 0;
                      return (
                        <tr key={group.label} className={cn("border-b border-border/50", i % 2 === 0 ? "" : "bg-muted/10")}>
                          <td className="px-3 py-2.5 font-medium text-foreground">{group.label}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{group.count}</td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
                                <div className="h-full bg-[hsl(173,80%,40%)] rounded-full" style={{ width: `${group.pct}%` }} />
                              </div>
                              <span className="text-muted-foreground tabular-nums">{group.pct}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${group.avgMood}%`, background: `hsl(${43 + (group.avgMood - 50) * 1.3},100%,50%)` }}
                                />
                              </div>
                              <span className={cn("tabular-nums font-medium", group.avgMood >= 80 ? "text-[hsl(173,80%,40%)]" : group.avgMood >= 50 ? "text-[hsl(43,100%,50%)]" : "text-[hsl(348,83%,52%)]")}>
                                {group.avgMood}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
                                <div
                                  className="h-full bg-[hsl(210,100%,55%)] rounded-full"
                                  style={{ width: `${maxMoney > 0 ? (group.avgMoney / maxMoney) * 100 : 0}%` }}
                                />
                              </div>
                              <span className="tabular-nums text-foreground">{group.avgMoney.toLocaleString()}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">{group.avgAge}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={cn("tabular-nums", employedPct >= 60 ? "text-[hsl(173,80%,40%)]" : employedPct >= 30 ? "text-[hsl(43,100%,50%)]" : "text-[hsl(348,83%,52%)]")}>
                              {group.employedCount} <span className="text-muted-foreground font-normal">({employedPct}%)</span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={cn("font-medium", ACTION_COLORS[group.topActionKey] ?? "text-muted-foreground")}>
                              {group.topAction}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bg-card border border-card-border rounded p-4">
                <h3 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-3">
                  Богатство по группам
                </h3>
                <div className="space-y-2">
                  {[...sortedGroups].sort((a, b) => b.avgMoney - a.avgMoney).map(group => (
                    <div key={group.label} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-32 shrink-0 truncate">{group.label}</span>
                      <div className="flex-1 h-4 bg-muted/40 rounded overflow-hidden">
                        <div
                          className={cn("h-full rounded transition-all duration-500", ACTION_BG[group.topActionKey] ?? "bg-[hsl(210,100%,55%)]")}
                          style={{ width: `${maxMoney > 0 ? (group.avgMoney / maxMoney) * 100 : 0}%`, opacity: 0.75 }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-foreground w-16 text-right shrink-0">
                        {group.avgMoney.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">
                        {group.pct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NeedsPanel({ stats }: { stats: NeedsStats }) {
  const sorted = [...NEED_META].sort((a, b) => stats[a.key].avg - stats[b.key].avg);

  const overallAvg = Math.round(
    NEED_META.reduce((s, m) => s + stats[m.key].avg, 0) / NEED_META.length * 10
  ) / 10;
  const criticalCount = sorted.filter(m => stats[m.key].avg < 25).length;
  const lowCount = sorted.filter(m => stats[m.key].avg >= 25 && stats[m.key].avg < 50).length;

  return (
    <div className="bg-card border border-card-border rounded overflow-hidden">
      <div className="px-4 pt-3.5 pb-2 border-b border-border flex items-center justify-between gap-4">
        <h3 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
          Удовлетворённость потребностей
        </h3>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10px] text-muted-foreground">
            Среднее:{" "}
            <span className="font-semibold tabular-nums" style={{ color: needBarColor(overallAvg) }}>
              {overallAvg}
            </span>
          </span>
          {criticalCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[hsl(348,83%,52%)]/15 text-[hsl(348,83%,52%)] border border-[hsl(348,83%,52%)]/25">
              {criticalCount} крит.
            </span>
          )}
          {lowCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[hsl(43,100%,50%)]/15 text-[hsl(43,100%,50%)] border border-[hsl(43,100%,50%)]/25">
              {lowCount} низко
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/40">
        {[sorted.slice(0, 6), sorted.slice(6)].map((col, ci) => (
          <div key={ci} className="divide-y divide-border/30">
            {col.map((meta) => {
              const s = stats[meta.key];
              const status = needStatusLabel(s.avg);
              return (
                <div key={meta.key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: meta.color, boxShadow: `0 0 5px ${meta.color}80` }}
                  />
                  <span className="text-xs text-muted-foreground w-36 shrink-0 truncate">{meta.label}</span>
                  <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden min-w-0">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${s.avg}%`, background: needBarColor(s.avg) }}
                    />
                  </div>
                  <span className="text-xs tabular-nums font-semibold w-8 text-right shrink-0 text-foreground">
                    {s.avg}
                  </span>
                  <span className={cn("text-[10px] w-14 text-right shrink-0 font-medium", status.cls)}>
                    {status.text}
                  </span>
                  {s.criticalPct > 0 && (
                    <span className="text-[10px] text-[hsl(348,83%,52%)] tabular-nums w-12 text-right shrink-0">
                      {s.criticalPct}% крит
                    </span>
                  )}
                  {s.criticalPct === 0 && s.lowPct > 0 && (
                    <span className="text-[10px] text-[hsl(43,100%,50%)] tabular-nums w-12 text-right shrink-0">
                      {s.lowPct}% низко
                    </span>
                  )}
                  {s.criticalPct === 0 && s.lowPct === 0 && (
                    <span className="w-12 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-card border border-card-border rounded px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-semibold tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentItem }) {
  const [, navigate] = useLocation();

  return (
    <tr
      className="border-b border-border/50 hover:bg-accent/30 cursor-pointer transition-colors"
      onClick={() => navigate(`/agents/${agent.id}`)}
    >
      <td className="px-3 py-2 font-medium text-foreground">{agent.name}</td>
      <td className="px-3 py-2 text-muted-foreground">{agent.age}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-[hsl(43,100%,50%)] rounded-full"
              style={{ width: `${agent.mood}%` }}
            />
          </div>
          <span className="text-muted-foreground">{agent.mood}</span>
        </div>
      </td>
      <td className="px-3 py-2 tabular-nums text-foreground">{agent.money.toFixed(0)}</td>
      <td className={cn("px-3 py-2 font-medium", ACTION_COLORS[agent.currentAction] ?? "text-muted-foreground")}>
        {ACTION_LABELS[agent.currentAction] ?? agent.currentAction}
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {agent.personality}
      </td>
    </tr>
  );
}
