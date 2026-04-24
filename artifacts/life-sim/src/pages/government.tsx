import {
  useGetGovernment,
  getGetGovernmentQueryKey,
} from "@workspace/api-client-react";
import { Landmark, TrendingDown, TrendingUp, Percent } from "lucide-react";
import StatCard from "@/components/stat-card";

export default function GovernmentPage() {
  const { data: gov, isLoading } = useGetGovernment({
    query: { queryKey: getGetGovernmentQueryKey(), refetchInterval: 15000 },
  });

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-base font-semibold text-foreground">Государство</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Бюджет, налоги и субсидии</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-card border border-card-border rounded animate-pulse" />
          ))}
        </div>
      ) : gov ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Бюджет"
              value={gov.budget.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              sub="единиц"
              icon={Landmark}
              accent="teal"
            />
            <StatCard
              label="Всего собрано налогов"
              value={gov.totalTaxCollected.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              sub="за всё время"
              icon={TrendingUp}
              accent="blue"
            />
            <StatCard
              label="Субсидии выплачено"
              value={gov.totalSubsidiesPaid.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              sub="за всё время"
              icon={TrendingDown}
              accent="crimson"
            />
            <StatCard
              label="Ставка налога"
              value={`${(gov.taxRate * 100).toFixed(1)}%`}
              sub={`от дохода агентов`}
              icon={Percent}
              accent="amber"
            />
          </div>

          <div className="bg-card border border-card-border rounded p-4 space-y-4">
            <h2 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Параметры</h2>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <p className="text-muted-foreground">Размер субсидии</p>
                <p className="font-medium text-foreground text-base">{gov.subsidyAmount.toFixed(0)} ед.</p>
                <p className="text-[10px] text-muted-foreground">выплачивается агентам с нулевым балансом за тик</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">Налоговая ставка</p>
                <p className="font-medium text-foreground text-base">{(gov.taxRate * 100).toFixed(1)}%</p>
                <p className="text-[10px] text-muted-foreground">удерживается с каждой зарплаты</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-card-border rounded p-4">
            <h2 className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-3">Баланс</h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Собрано налогов</span>
                <span className="text-[hsl(173,80%,40%)] tabular-nums">+{gov.totalTaxCollected.toFixed(0)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Выплачено субсидий</span>
                <span className="text-[hsl(348,83%,47%)] tabular-nums">-{gov.totalSubsidiesPaid.toFixed(0)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="font-medium text-foreground">Итого бюджет</span>
                <span className={`tabular-nums font-medium ${gov.budget >= 0 ? "text-[hsl(173,80%,40%)]" : "text-[hsl(348,83%,47%)]"}`}>
                  {gov.budget.toFixed(0)}
                </span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Нет данных</p>
      )}
    </div>
  );
}

