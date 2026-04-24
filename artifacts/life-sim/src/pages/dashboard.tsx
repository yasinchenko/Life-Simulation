import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSimulationState,
  getGetSimulationStateQueryKey,
  useStartSimulation,
  useStopSimulation,
  useResetSimulation,
  useGetStatsHistory,
  getGetStatsHistoryQueryKey,
  getGetStatsSummaryQueryKey,
  useGetStatsSummary,
  useGetTopAgents,
  getGetTopAgentsQueryKey,
  type Agent,
} from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Play, Square, RotateCcw, Users, TrendingUp, AlertTriangle, Coins, Heart, Clock, Landmark, Trophy, Smile } from "lucide-react";
import StatCard from "@/components/stat-card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function Dashboard() {
  const qc = useQueryClient();
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

  const startMutation = useStartSimulation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetSimulationStateQueryKey() });
        toast.success("Симуляция запущена");
      },
    },
  });

  const stopMutation = useStopSimulation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetSimulationStateQueryKey() });
        toast.info("Симуляция остановлена");
      },
    },
  });

  const resetMutation = useResetSimulation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetSimulationStateQueryKey() });
        toast.success("Симуляция сброшена");
      },
    },
  });

  const chartData = history?.map(h => ({
    tick: h.tick,
    mood: Math.round(h.avgMood * 10) / 10,
    gdp: Math.round(h.gdp / 1000),
    population: h.population,
    wealth: Math.round(h.avgWealth * 10) / 10,
  })) ?? [];

  const formatGameTime = () => {
    if (!state) return "--:--";
    const h = String(state.gameHour).padStart(2, "0");
    return `День ${state.gameDay}, ${h}:00`;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">Дашборд симуляции</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isLoading ? "Загрузка..." : `Тик #${state?.tick ?? 0} · ${formatGameTime()}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border",
            running
              ? "bg-[hsl(173,80%,40%)]/10 border-[hsl(173,80%,40%)]/30 text-[hsl(173,80%,40%)]"
              : "bg-[hsl(348,83%,47%)]/10 border-[hsl(348,83%,47%)]/30 text-[hsl(348,83%,47%)]"
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full", running ? "bg-[hsl(173,80%,40%)] animate-pulse" : "bg-[hsl(348,83%,47%)]")} />
            {running ? "РАБОТАЕТ" : "ОСТАНОВЛЕНА"}
          </div>

          {!running ? (
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Play className="w-3 h-3" />
              Запустить
            </button>
          ) : (
            <button
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Square className="w-3 h-3" />
              Остановить
            </button>
          )}

          <button
            onClick={() => {
              if (confirm("Сбросить симуляцию? Все данные будут очищены.")) {
                resetMutation.mutate();
              }
            }}
            disabled={resetMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded text-xs font-medium hover:opacity-90 disabled:opacity-50"
          >
            <RotateCcw className="w-3 h-3" />
            Сброс
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Население" value={state?.population?.toLocaleString() ?? "--"} icon={Users} accent="teal" />
        <StatCard label="Ср. настроение" value={state?.avgMood?.toFixed(1) ?? "--"} sub="из 100" icon={Heart} accent="amber" />
        <StatCard label="ВВП (капитал)" value={state ? `${Math.round(state.gdp / 1000)}K` : "--"} icon={TrendingUp} accent="blue" />
        <StatCard label="Безработица" value={state ? `${state.unemploymentRate.toFixed(1)}%` : "--"} icon={AlertTriangle} accent="crimson" />
        <StatCard label="Бюджет гос-ва" value={state ? `${Math.round(state.governmentBudget).toLocaleString()}` : "--"} icon={Landmark} accent="purple" />
        <StatCard label="Ср. богатство" value={state ? `${state.avgWealth.toFixed(0)}` : "--"} icon={Coins} accent="teal" />
      </div>

      {summary && (
        <div className="bg-card border border-card-border rounded p-4">
          <h2 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-3">Сводка</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <p className="text-muted-foreground">Богатейший</p>
              <p className="font-medium text-foreground">{summary.richestAgent ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Счастливейший</p>
              <p className="font-medium text-foreground">{summary.happiestAgent ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Популярный товар</p>
              <p className="font-medium text-foreground">{summary.mostPopularGood ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Трудоустроено</p>
              <p className="font-medium text-foreground">{summary.employedAgents} / {summary.totalAgents}</p>
            </div>
          </div>
        </div>
      )}

      {topAgents && (topAgents.byWealth.length > 0 || topAgents.byMood.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LeaderboardCard
            title="Богатейшие жители"
            icon={Trophy}
            entries={topAgents.byWealth}
            valueLabel="Средства"
            getValue={(a) => `${Math.round(a.money).toLocaleString()}`}
            running={running}
            onRowClick={(id) => navigate(`/agents/${id}`)}
          />
          <LeaderboardCard
            title="Счастливейшие жители"
            icon={Smile}
            entries={topAgents.byMood}
            valueLabel="Настроение"
            getValue={(a) => `${a.mood.toFixed(1)}`}
            running={running}
            onRowClick={(id) => navigate(`/agents/${id}`)}
          />
        </div>
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

function LeaderboardCard({ title, icon: Icon, entries, valueLabel, getValue, running, onRowClick }: {
  title: string;
  icon: React.ElementType;
  entries: Agent[];
  valueLabel: string;
  getValue: (a: Agent) => string;
  running: boolean;
  onRowClick: (id: number) => void;
}) {
  const medalColors = ["hsl(43,100%,50%)", "hsl(210,10%,70%)", "hsl(30,80%,50%)"];

  return (
    <div className="bg-card border border-card-border rounded p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <h3 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">{title}</h3>
        {running && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider bg-[hsl(173,80%,40%)]/15 text-[hsl(173,80%,40%)] border border-[hsl(173,80%,40%)]/25">
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(173,80%,40%)] animate-pulse inline-block" />
            LIVE
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">{valueLabel}</span>
      </div>
      <ol className="space-y-1">
        {entries.map((agent, i) => (
          <li key={agent.id}>
            <button
              onClick={() => onRowClick(agent.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors text-left group"
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
              <span className="text-[10px] text-muted-foreground shrink-0">{agent.age} л.</span>
              <span className="text-xs font-medium text-foreground shrink-0 tabular-nums">{getValue(agent)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
