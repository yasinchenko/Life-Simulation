import { useParams, useLocation } from "wouter";
import {
  useGetAgent,
  getGetAgentQueryKey,
  type AgentDetail,
  type AgentRelation,
  type JobHistoryEntry,
} from "@workspace/api-client-react";
import { ArrowLeft, User, Heart, Coffee, Users, Briefcase, LogIn, LogOut, Sunset, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ACTION_LABELS: Record<string, string> = {
  eat: "Ест",
  rest: "Отдыхает",
  socialize: "Общается",
  work: "Работает",
  idle: "Простаивает",
};

const ACTION_COLORS: Record<string, string> = {
  eat: "bg-[hsl(43,100%,50%)]/10 text-[hsl(43,100%,50%)] border-[hsl(43,100%,50%)]/30",
  rest: "bg-[hsl(173,80%,40%)]/10 text-[hsl(173,80%,40%)] border-[hsl(173,80%,40%)]/30",
  socialize: "bg-[hsl(280,80%,60%)]/10 text-[hsl(280,80%,60%)] border-[hsl(280,80%,60%)]/30",
  work: "bg-[hsl(210,100%,50%)]/10 text-[hsl(210,100%,50%)] border-[hsl(210,100%,50%)]/30",
  idle: "bg-muted/50 text-muted-foreground border-border",
};

function NeedsBar({ label, value, icon: Icon, color }: { label: string; value: number; icon: LucideIcon; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="w-3 h-3" />
          {label}
        </div>
        <span className="font-medium tabular-nums" style={{ color }}>{value.toFixed(0)}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const agentId = parseInt(id ?? "0", 10);

  const { data: agent, isLoading } = useGetAgent(agentId, {
    query: {
      queryKey: getGetAgentQueryKey(agentId),
      enabled: !!agentId,
      refetchInterval: 10000,
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 w-48 bg-muted rounded animate-pulse" />
        <div className="h-32 bg-card border border-card-border rounded animate-pulse" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Агент не найден</p>
        <button onClick={() => navigate("/agents")} className="mt-3 text-xs text-primary">Назад к списку</button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <button
        onClick={() => navigate("/agents")}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-3 h-3" /> Назад к жителям
      </button>

      <div className="bg-card border border-card-border rounded p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-primary/10 border border-primary/20 flex items-center justify-center">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground">{agent.name}</h1>
              <p className="text-xs text-muted-foreground">{agent.gender === "male" ? "Мужчина" : "Женщина"} · {agent.age} лет · {agent.personality}</p>
            </div>
          </div>
          <span className={cn("px-2 py-1 text-[10px] font-medium rounded border", ACTION_COLORS[agent.currentAction] ?? ACTION_COLORS.idle)}>
            {ACTION_LABELS[agent.currentAction] ?? agent.currentAction}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-5">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Настроение</p>
            <p className="text-xl font-bold text-[hsl(43,100%,50%)]">{agent.mood.toFixed(1)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Деньги</p>
            <p className="text-xl font-bold text-[hsl(173,80%,40%)]">{agent.money.toFixed(0)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Социализация</p>
            <p className="text-xl font-bold text-foreground">{agent.socialization.toFixed(0)}</p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded p-4 space-y-4">
        <h2 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Потребности</h2>
        <NeedsBar label="Голод" value={agent.needs.hunger} icon={Coffee} color="hsl(43,100%,50%)" />
        <NeedsBar label="Комфорт" value={agent.needs.comfort} icon={Heart} color="hsl(173,80%,40%)" />
        <NeedsBar label="Общение" value={agent.needs.social} icon={Users} color="hsl(280,80%,60%)" />
      </div>

      <div className="bg-card border border-card-border rounded p-4">
        <h2 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-2">Работа</h2>
        {agent.isRetired ? (
          <div className="flex items-center gap-2 text-xs">
            <Sunset className="w-3.5 h-3.5 text-[hsl(43,100%,50%)]" />
            <span className="text-[hsl(43,100%,50%)] font-medium">На пенсии</span>
          </div>
        ) : agent.employerId != null ? (
          <div className="flex items-center gap-2 text-xs">
            <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-foreground">Бизнес #{agent.employerId}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs">
            <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Безработный</span>
          </div>
        )}
      </div>

      {agent.recentActions && agent.recentActions.length > 0 && (
        <div className="bg-card border border-card-border rounded p-4">
          <h2 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-3">
            Последние действия
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {[...agent.recentActions].reverse().map((action, i) => (
              <span
                key={i}
                className={cn(
                  "px-2 py-0.5 text-[10px] rounded border",
                  i === 0
                    ? ACTION_COLORS[action] ?? "bg-muted/50 text-muted-foreground border-border"
                    : "bg-muted/30 text-muted-foreground border-border/50"
                )}
              >
                {ACTION_LABELS[action] ?? action}
              </span>
            ))}
          </div>
        </div>
      )}

      {agent.jobHistory && agent.jobHistory.length > 0 && (
        <div className="bg-card border border-card-border rounded p-4">
          <h2 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-3">
            История работы ({agent.jobHistory.length})
          </h2>
          <div className="space-y-2">
            {agent.jobHistory.map((entry: JobHistoryEntry, i: number) => {
              const isHired = entry.event === "hired";
              const isFired = entry.event === "fired";
              const isRetiredEvent = entry.event === "retired";
              return (
                <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-2">
                    {isHired && <LogIn className="w-3 h-3 text-[hsl(173,80%,40%)] shrink-0" />}
                    {isFired && <LogOut className="w-3 h-3 text-destructive shrink-0" />}
                    {isRetiredEvent && <Sunset className="w-3 h-3 text-[hsl(43,100%,50%)] shrink-0" />}
                    <span className={cn(
                      "font-medium",
                      isHired && "text-[hsl(173,80%,40%)]",
                      isFired && "text-destructive",
                      isRetiredEvent && "text-[hsl(43,100%,50%)]",
                    )}>
                      {isHired ? "Нанят" : isFired ? "Уволен" : "Выход на пенсию"}
                    </span>
                    {entry.businessName && (
                      <span className="text-muted-foreground">· {entry.businessName}</span>
                    )}
                  </div>
                  <span className="text-muted-foreground tabular-nums text-[10px]">тик {entry.tick}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {agent.relations && agent.relations.length > 0 && (
        <div className="bg-card border border-card-border rounded p-4">
          <h2 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-3">
            Связи ({agent.relations.length})
          </h2>
          <div className="space-y-2">
            {agent.relations.map((rel: AgentRelation) => (
              <div key={rel.otherId} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                <span className="text-foreground">{rel.otherName}</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[hsl(173,80%,40%)] rounded-full"
                      style={{ width: `${rel.friendshipLevel}%` }}
                    />
                  </div>
                  <span className="text-muted-foreground tabular-nums w-8 text-right">{rel.friendshipLevel.toFixed(0)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
