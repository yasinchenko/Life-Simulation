import {
  useListBusinesses,
  getListBusinessesQueryKey,
  useListGoods,
  getListGoodsQueryKey,
} from "@workspace/api-client-react";
import { Building2, Package } from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = { food: "Еда", service: "Сервис" };
const TYPE_COLORS: Record<string, string> = {
  food: "text-[hsl(43,100%,50%)]",
  service: "text-[hsl(173,80%,40%)]",
};

export default function EconomyPage() {
  const { data: businesses, isLoading: bizLoading } = useListBusinesses({
    query: { queryKey: getListBusinessesQueryKey(), refetchInterval: 15000 },
  });

  const { data: goods, isLoading: goodsLoading } = useListGoods({
    query: { queryKey: getListGoodsQueryKey(), refetchInterval: 15000 },
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-base font-semibold text-foreground">Экономика</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {businesses?.length ?? 0} бизнесов · {goods?.length ?? 0} товаров
        </p>
      </div>

      <div className="bg-card border border-card-border rounded overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Бизнесы</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Название</th>
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Тип</th>
              <th className="text-right px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Баланс</th>
              <th className="text-right px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Сотрудники</th>
              <th className="text-right px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Производство/тик</th>
            </tr>
          </thead>
          <tbody>
            {bizLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-3 py-2">
                      <div className="h-3 bg-muted rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : (businesses ?? []).map(biz => (
              <tr key={biz.id} className="border-b border-border/50 hover:bg-accent/20">
                <td className="px-3 py-2 font-medium text-foreground">{biz.name}</td>
                <td className={cn("px-3 py-2 font-medium", TYPE_COLORS[biz.type] ?? "text-muted-foreground")}>
                  {TYPE_LABELS[biz.type] ?? biz.type}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[hsl(173,80%,40%)]">{biz.balance.toFixed(0)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-foreground">{biz.employeeCount}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{biz.productionRate.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-card border border-card-border rounded overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Package className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Товары</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Товар</th>
              <th className="text-right px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Баз. цена</th>
              <th className="text-right px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Текущая цена</th>
              <th className="text-right px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Качество</th>
              <th className="text-right px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Спрос</th>
              <th className="text-right px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Предложение</th>
            </tr>
          </thead>
          <tbody>
            {goodsLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-3 py-2">
                      <div className="h-3 bg-muted rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : (goods ?? []).map(good => {
              const priceDiff = good.currentPrice - good.basePrice;
              return (
                <tr key={good.id} className="border-b border-border/50 hover:bg-accent/20">
                  <td className="px-3 py-2 font-medium text-foreground">{good.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{good.basePrice.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={priceDiff > 0 ? "text-[hsl(348,83%,47%)]" : "text-[hsl(173,80%,40%)]"}>
                      {good.currentPrice.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{good.quality.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[hsl(43,100%,50%)]">{good.demand.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[hsl(210,100%,50%)]">{good.supply.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
