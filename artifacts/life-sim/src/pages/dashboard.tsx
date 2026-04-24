import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSimulationState,
  getGetSimulationStateQueryKey,
  useGetStatsHistory,
  getGetStatsHistoryQueryKey,
  getGetStatsSummaryQueryKey,
  useGetStatsSummary,
  useGetTopAgents,
  getGetTopAgentsQueryKey,
  type Agent,
  type TopAgentsResponse,
} from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

import { Users, TrendingUp, AlertTriangle, Coins, Heart, Clock, Landmark, Trophy, Settings } from "lucide-react";
import StatCard from "@/components/stat-card";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useLocation } from "wouter";

interface AgentStatSnapshot {
  tick: number;
  money: number;
  mood: number;
  age: number;
  socialization: number;
}

export default function Dashboard() {
  const [, navigate] = useLocation();

  const { data: state, isLoading } = useGetSimulationState({
    query: {
      queryKey: getGetSimulationStateQueryKey(),
      refetchInterval: 5000,
    },
  });

  const running = state?.running ?? false;

  const { data: history } = useGetStatsHistory({ limit: 60 }, {
    query: {
      queryKey: getGetStatsHistoryQueryKey({ limit: 60 }),
      refetchInterval: running ? 7000 : 60000,
    },
  });

  const { data: summary } = useGetStatsSummary({
    query: {
      queryKey: getGetStatsSummaryQueryKey(),
      refetchInterval: running ? 7000 : 30000,
    },
  });

  const { data: topAgents } = useGetTopAgents({
    query: {
      queryKey: getGetTopAgentsQueryKey(),
      refetchInterval: running ? 7000 : 30000,
    },
  });

  const chartData = history?.map(h => ({
    tick: h.tick,
    mood: Math.round(h.avgMood * 10) / 10,
    gdp: Math.round(h.gdp / 1000),
    population: h.population,
    wealth: Math.round(h.avgWealth * 10) / 10,
    unemployment: Math.round(h.unemploymentRate * 10) / 10,
    govBudget: Math.round(h.governmentBudget),
  })) ?? [];

  const last20 = chartData.slice(-20);
  const sparklines = {
    population: last20.map(d => d.population),
    mood: last20.map(d => d.mood),
    gdp: last20.map(d => d.gdp),
    unemployment: last20.map(d => d.unemployment),
    govBudget: last20.map(d => d.govBudget),
    wealth: last20.map(d => d.wealth),
  };

  const formatGameTime = () => {
    if (!state) return "--:--";
    const h = String(state.gameHour).padStart(2, "0");
    return `День ${state.gameDay}, ${h}:00`;
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-semibold text-foreground">Дашборд симуляции</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isLoading ? "Загрузка..." : `Тик #${state?.tick ?? 0} · ${formatGameTime()}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border",
            running
              ? "bg-[hsl(173,80%,40%)]/10 border-[hsl(173,80%,40%)]/30 text-[hsl(173,80%,40%)]"
              : "bg-[hsl(348,83%,47%)]/10 border-[hsl(348,83%,47%)]/30 text-[hsl(348,83%,47%)]"
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full", running ? "bg-[hsl(173,80%,40%)] animate-pulse" : "bg-[hsl(348,83%,47%)]")} />
            {running ? "РАБОТАЕТ" : "ОСТАНОВЛЕНА"}
          </div>
          <Link
            href="/settings"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded text-xs font-medium hover:opacity-90 border border-border transition-opacity"
          >
            <Settings className="w-3 h-3" />
            Управление
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <StatCard label="Население" value={state?.population?.toLocaleString() ?? "--"} icon={Users} accent="teal" sparklineData={sparklines.population} running={running} />
        <StatCard label="Ср. настроение" value={state?.avgMood?.toFixed(1) ?? "--"} sub="из 100" icon={Heart} accent="amber" sparklineData={sparklines.mood} running={running} />
        <StatCard label="ВВП (капитал)" value={state ? `${Math.round(state.gdp / 1000)}K` : "--"} icon={TrendingUp} accent="blue" sparklineData={sparklines.gdp} running={running} />
        <StatCard label="Безработица" value={state ? `${state.unemploymentRate.toFixed(1)}%` : "--"} icon={AlertTriangle} accent="crimson" sparklineData={sparklines.unemployment} running={running} />
        <StatCard label="Бюджет гос-ва" value={state ? `${Math.round(state.governmentBudget).toLocaleString()}` : "--"} icon={Landmark} accent="purple" sparklineData={sparklines.govBudget} running={running} />
        <StatCard label="Ср. богатство" value={state ? `${state.avgWealth.toFixed(0)}` : "--"} icon={Coins} accent="teal" sparklineData={sparklines.wealth} running={running} />
      </div>

      {summary && (
        <div className="bg-card border border-card-border rounded p-4">
          <h2 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-3">Сводка</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <p className="text-muted-foreground">Богатейший</p>
              <p className="font-medium text-foreground truncate">{summary.richestAgent ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Счастливейший</p>
              <p className="font-medium text-foreground truncate">{summary.happiestAgent ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Популярный товар</p>
              <p className="font-medium text-foreground truncate">{summary.mostPopularGood ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Трудоустроено</p>
              <p className="font-medium text-foreground">{summary.employedAgents} / {summary.totalAgents}</p>
            </div>
          </div>
        </div>
      )}

      {topAgents && (
        <UnifiedLeaderboard
          topAgents={topAgents}
          running={running}
          onRowClick={(id) => navigate(`/agents/${id}`)}
        />
      )}

      {chartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Среднее настроение" data={chartData} dataKey="mood" color="hsl(43,100%,50%)" domain={[0, 100]} running={running} />
          <ChartCard title="ВВП (тыс. ед.)" data={chartData} dataKey="gdp" color="hsl(173,80%,40%)" running={running} />
          <ChartCard title="Население" data={chartData} dataKey="population" color="hsl(210,100%,50%)" running={running} />
          <ChartCard title="Среднее богатство" data={chartData} dataKey="wealth" color="hsl(280,80%,60%)" running={running} />
        </div>
      )}

      {chartData.length === 0 && !isLoading && (
        <div className="bg-card border border-card-border rounded p-8 text-center">
          <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Данные появятся после первого тика симуляции</p>
          <p className="text-xs text-muted-foreground mt-1">Каждый тик = 1 игровой час = 1 минута реального времени</p>
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, data, dataKey, color, domain, running }: {
  title: string;
  data: Record<string, number>[];
  dataKey: string;
  color: string;
  domain?: [number, number];
  running: boolean;
}) {
  return (
    <div className="bg-card border border-card-border rounded p-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">{title}</h3>
        {running && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider bg-[hsl(173,80%,40%)]/15 text-[hsl(173,80%,40%)] border border-[hsl(173,80%,40%)]/25">
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(173,80%,40%)] animate-pulse inline-block" />
            LIVE
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(225,10%,20%)" />
          <XAxis dataKey="tick" tick={{ fontSize: 9, fill: "hsl(210,10%,60%)" }} tickLine={false} />
          <YAxis domain={domain} tick={{ fontSize: 9, fill: "hsl(210,10%,60%)" }} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "hsl(225,15%,7%)", border: "1px solid hsl(225,10%,20%)", borderRadius: 4, fontSize: 11 }}
            labelStyle={{ color: "hsl(210,20%,90%)" }}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={true}
            animationDuration={600}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

type LeaderboardStat = "wealth" | "mood" | "age" | "socialization";

const LEADERBOARD_STATS: { key: LeaderboardStat; label: string; valueLabel: string; getValue: (a: Agent) => string; historyKey: keyof AgentStatSnapshot; color: string }[] = [
  { key: "wealth", label: "Богатство", valueLabel: "Средства", getValue: (a) => Math.round(a.money).toLocaleString(), historyKey: "money", color: "hsl(173,80%,40%)" },
  { key: "mood", label: "Настроение", valueLabel: "Настр.", getValue: (a) => a.mood.toFixed(1), historyKey: "mood", color: "hsl(43,100%,50%)" },
  { key: "age", label: "Возраст", valueLabel: "Лет", getValue: (a) => String(a.age), historyKey: "age", color: "hsl(210,100%,60%)" },
  { key: "socialization", label: "Общение", valueLabel: "Социал.", getValue: (a) => a.socialization.toFixed(1), historyKey: "socialization", color: "hsl(280,80%,65%)" },
];

type RankChange = { direction: "up" | "down"; expiresAt: number };

function SparklineTooltip({ history, statKey, color, agentName }: {
  history: AgentStatSnapshot[];
  statKey: keyof AgentStatSnapshot;
  color: string;
  agentName: string;
}) {
  if (history.length < 2) {
    return (
      <div className="text-[10px] text-muted-foreground px-1">
        Недостаточно данных
      </div>
    );
  }

  const values = history.map(h => h[statKey] as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const W = 140;
  const H = 48;
  const pad = 4;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * innerW;
    const y = pad + (1 - (v - min) / range) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const lastVal = values[values.length - 1];
  const firstVal = values[0];
  const trend = lastVal - firstVal;

  return (
    <div>
      <p className="text-[10px] font-medium text-foreground mb-1.5 truncate max-w-[140px]">{agentName}</p>
      <svg width={W} height={H} className="block">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {values.map((v, i) => {
          if (i !== values.length - 1) return null;
          const x = pad + (i / (values.length - 1)) * innerW;
          const y = pad + (1 - (v - min) / range) * innerH;
          return <circle key={i} cx={x} cy={y} r={2.5} fill={color} />;
        })}
      </svg>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px] text-muted-foreground">
          {typeof firstVal === "number" ? (Number.isInteger(firstVal) ? firstVal.toLocaleString() : firstVal.toFixed(1)) : firstVal}
        </span>
        <span className={cn("text-[9px] font-semibold", trend >= 0 ? "text-[hsl(173,80%,40%)]" : "text-[hsl(348,83%,47%)]")}>
          {trend >= 0 ? "+" : ""}{typeof trend === "number" ? (Number.isInteger(trend) ? Math.round(trend).toLocaleString() : trend.toFixed(1)) : trend}
        </span>
        <span className="text-[9px] text-muted-foreground">
          {typeof lastVal === "number" ? (Number.isInteger(lastVal) ? lastVal.toLocaleString() : lastVal.toFixed(1)) : lastVal}
        </span>
      </div>
    </div>
  );
}

function UnifiedLeaderboard({ topAgents, running, onRowClick }: {
  topAgents: TopAgentsResponse;
  running: boolean;
  onRowClick: (id: number) => void;
}) {
  const [activeStat, setActiveStat] = useState<LeaderboardStat>("wealth");
  const medalColors = ["hsl(43,100%,50%)", "hsl(210,10%,70%)", "hsl(30,80%,50%)"];

  const statConfig = LEADERBOARD_STATS.find(s => s.key === activeStat)!;
  const entries: Agent[] =
    activeStat === "wealth" ? topAgents.byWealth :
    activeStat === "mood" ? topAgents.byMood :
    activeStat === "age" ? topAgents.byAge :
    topAgents.bySocialization;

  const prevRanksRef = useRef<Map<string, Map<number, number>>>(new Map());
  const [rankChanges, setRankChanges] = useState<Map<string, Map<number, RankChange>>>(new Map());
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hoveredAgentId, setHoveredAgentId] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [agentHistory, setAgentHistory] = useState<Map<number, AgentStatSnapshot[]>>(new Map());
  const fetchingRef = useRef<Set<number>>(new Set());

  const fetchHistory = useCallback(async (id: number) => {
    if (fetchingRef.current.has(id)) return;
    fetchingRef.current.add(id);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const res = await fetch(`${base}/api/agents/${id}/stat-history`);
      if (res.ok) {
        const data: AgentStatSnapshot[] = await res.json();
        setAgentHistory(prev => new Map(prev).set(id, data));
      }
    } catch {
    } finally {
      fetchingRef.current.delete(id);
    }
  }, []);

  const handleRowMouseEnter = useCallback((agent: Agent, e: React.MouseEvent) => {
    setHoveredAgentId(agent.id);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltipPos({ x: rect.right + 8, y: rect.top });
    fetchHistory(agent.id);
  }, [fetchHistory]);

  const handleRowMouseLeave = useCallback(() => {
    setHoveredAgentId(null);
    setTooltipPos(null);
  }, []);

  useEffect(() => {
    setRankChanges(new Map());
  }, [activeStat]);

  useEffect(() => {
    const key = activeStat;
    const prevRanks = prevRanksRef.current.get(key);
    const nowRanks = new Map(entries.map((a, i) => [a.id, i]));

    if (prevRanks && prevRanks.size > 0) {
      const changes = new Map<number, RankChange>();
      const expiresAt = Date.now() + 3000;

      entries.forEach((agent, currentRank) => {
        const prevRank = prevRanks.get(agent.id);
        if (prevRank !== undefined && prevRank !== currentRank) {
          changes.set(agent.id, {
            direction: currentRank < prevRank ? "up" : "down",
            expiresAt,
          });
        }
      });

      if (changes.size > 0) {
        setRankChanges(prev => {
          const statMap = new Map(prev.get(key) ?? []);
          changes.forEach((v, k) => statMap.set(k, v));
          const next = new Map(prev);
          next.set(key, statMap);
          return next;
        });

        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = setTimeout(() => {
          const now = Date.now();
          setRankChanges(prev => {
            const statMap = prev.get(key);
            if (!statMap) return prev;
            const nextStatMap = new Map<number, RankChange>();
            statMap.forEach((v, k) => { if (v.expiresAt > now) nextStatMap.set(k, v); });
            const next = new Map(prev);
            next.set(key, nextStatMap);
            return next;
          });
        }, 3100);
      }
    }

    prevRanksRef.current.set(key, nowRanks);
  }, [entries, activeStat]);

  useEffect(() => {
    return () => { if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current); };
  }, []);

  const hoveredHistory = hoveredAgentId != null ? agentHistory.get(hoveredAgentId) : undefined;
  const hoveredAgent = hoveredAgentId != null ? entries.find(a => a.id === hoveredAgentId) : undefined;

  return (
    <div className="bg-card border border-card-border rounded p-4 relative">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Trophy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <h3 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Лидеры</h3>
        {running && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider bg-[hsl(173,80%,40%)]/15 text-[hsl(173,80%,40%)] border border-[hsl(173,80%,40%)]/25">
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(173,80%,40%)] animate-pulse inline-block" />
            LIVE
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 flex-wrap">
          {LEADERBOARD_STATS.map(s => (
            <button
              key={s.key}
              onClick={() => setActiveStat(s.key)}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-medium border transition-colors",
                activeStat === s.key
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-transparent border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between px-2 mb-1">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Житель</span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">{statConfig.valueLabel}</span>
      </div>
      <ol className="space-y-1">
        {entries.map((agent, i) => {
          const statMap = rankChanges.get(activeStat);
          const change = statMap?.get(agent.id);
          const isExpired = change && change.expiresAt <= Date.now();
          const activeChange = change && !isExpired ? change : null;
          return (
            <li key={agent.id}>
              <button
                onClick={() => onRowClick(agent.id)}
                onMouseEnter={(e) => handleRowMouseEnter(agent, e)}
                onMouseLeave={handleRowMouseLeave}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors text-left group",
                  activeChange?.direction === "up" && "animate-rank-up",
                  activeChange?.direction === "down" && "animate-rank-down",
                )}
              >
                <span
                  className="w-4 text-center text-[10px] font-bold shrink-0"
                  style={{ color: i < 3 ? medalColors[i] : "hsl(210,10%,50%)" }}
                >
                  {i + 1}
                </span>
                <span className="flex-1 text-xs text-foreground group-hover:text-primary truncate">
                  {agent.name}
                </span>
                {activeChange && (
                  <span
                    className={cn(
                      "text-[10px] font-bold shrink-0 animate-rank-arrow",
                      activeChange.direction === "up"
                        ? "text-[hsl(173,80%,40%)]"
                        : "text-[hsl(348,83%,47%)]"
                    )}
                  >
                    {activeChange.direction === "up" ? "↑" : "↓"}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{statConfig.getValue(agent)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {hoveredAgentId != null && tooltipPos && (
        <div
          className="fixed z-50 bg-card border border-card-border rounded p-3 shadow-lg pointer-events-none"
          style={{
            left: Math.min(tooltipPos.x, window.innerWidth - 180),
            top: Math.max(8, tooltipPos.y - 20),
          }}
        >
          {hoveredHistory && hoveredHistory.length >= 2 ? (
            <SparklineTooltip
              history={hoveredHistory}
              statKey={statConfig.historyKey}
              color={statConfig.color}
              agentName={hoveredAgent?.name ?? ""}
            />
          ) : (
            <div>
              <p className="text-[10px] font-medium text-foreground mb-1 truncate max-w-[140px]">{hoveredAgent?.name}</p>
              <p className="text-[10px] text-muted-foreground">История накапливается...</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
