import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListAgents,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { ChevronUp, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type SortBy = "name" | "age" | "mood" | "money" | "currentAction";
type SortDir = "asc" | "desc";

const ACTION_LABELS: Record<string, string> = {
  eat: "Ест",
  rest: "Отдыхает",
  socialize: "Общается",
  work: "Работает",
  idle: "Простаивает",
};

const ACTION_COLORS: Record<string, string> = {
  eat: "text-[hsl(43,100%,50%)]",
  rest: "text-[hsl(173,80%,40%)]",
  socialize: "text-[hsl(280,80%,60%)]",
  work: "text-[hsl(210,100%,50%)]",
  idle: "text-muted-foreground",
};

export default function AgentsPage() {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterAction, setFilterAction] = useState<string>("");

  const { data, isLoading } = useListAgents(
    { page, limit: 50, sortBy, sortDir, filterAction: filterAction || undefined },
    { query: { queryKey: getListAgentsQueryKey({ page, limit: 50, sortBy, sortDir, filterAction: filterAction || undefined }), refetchInterval: 10000 } }
  );

  const handleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
    setPage(1);
  };

  const SortIcon = ({ col }: { col: SortBy }) => {
    if (sortBy !== col) return <span className="w-3 h-3 inline-block" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />;
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">Жители</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data ? `${data.total.toLocaleString()} агентов · стр. ${data.page} из ${data.totalPages}` : "Загрузка..."}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

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
    </div>
  );
}

function AgentRow({ agent }: { agent: any }) {
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
