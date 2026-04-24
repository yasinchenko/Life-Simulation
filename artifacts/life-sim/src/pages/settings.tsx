import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetConfig,
  getGetConfigQueryKey,
  useUpdateConfig,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Save } from "lucide-react";

interface SettingField {
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  displayMultiplier?: number;
}

const FIELDS: SettingField[] = [
  {
    key: "taxRate",
    label: "Ставка налога",
    description: "Доля дохода, удерживаемая государством с каждой зарплаты агента",
    min: 0,
    max: 1,
    step: 0.01,
    format: v => `${(v * 100).toFixed(0)}%`,
  },
  {
    key: "needDecayRate",
    label: "Скорость убывания потребностей",
    description: "На сколько пунктов снижается каждая потребность за один тик (0 = не убывает)",
    min: 0,
    max: 20,
    step: 0.5,
    format: v => `${v.toFixed(1)} пт/тик`,
  },
  {
    key: "tickIntervalMs",
    label: "Длительность тика (секунд)",
    description: "Реальное время одного игрового часа. По умолчанию 60 секунд = 1 минута",
    min: 10000,
    max: 300000,
    step: 5000,
    format: v => `${(v / 1000).toFixed(0)} сек`,
  },
  {
    key: "initialAgents",
    label: "Начальное число агентов",
    description: "Сколько жителей генерируется при сбросе симуляции",
    min: 100,
    max: 5000,
    step: 100,
    format: v => v.toFixed(0),
  },
  {
    key: "initialBusinesses",
    label: "Начальное число бизнесов",
    description: "Сколько предприятий создаётся при сбросе (60% — еда, 40% — сервис)",
    min: 10,
    max: 500,
    step: 10,
    format: v => v.toFixed(0),
  },
  {
    key: "baseFoodPrice",
    label: "Базовая цена еды",
    description: "Базовая стоимость продовольственных товаров до наценки",
    min: 1,
    max: 100,
    step: 1,
    format: v => `${v.toFixed(0)} ед.`,
  },
  {
    key: "baseSalary",
    label: "Базовая зарплата",
    description: "Сколько агент зарабатывает за тик работы (до налогов)",
    min: 1,
    max: 500,
    step: 5,
    format: v => `${v.toFixed(0)} ед./тик`,
  },
  {
    key: "subsidyAmount",
    label: "Размер субсидии",
    description: "Сумма, которую государство выплачивает агентам с нулевым балансом",
    min: 0,
    max: 200,
    step: 5,
    format: v => `${v.toFixed(0)} ед.`,
  },
  {
    key: "socialInteractionStrength",
    label: "Сила социального взаимодействия",
    description: "Насколько сильно общение влияет на настроение агентов",
    min: 0,
    max: 10,
    step: 0.5,
    format: v => `×${v.toFixed(1)}`,
  },
  {
    key: "priceMarkup",
    label: "Наценка бизнеса",
    description: "Процент, который бизнес добавляет к базовой цене товара",
    min: 0,
    max: 1,
    step: 0.05,
    format: v => `${(v * 100).toFixed(0)}%`,
  },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useGetConfig({
    query: { queryKey: getGetConfigQueryKey() },
  });

  const [values, setValues] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (config) {
      setValues({
        taxRate: config.taxRate,
        needDecayRate: config.needDecayRate,
        tickIntervalMs: config.tickIntervalMs,
        initialAgents: config.initialAgents,
        initialBusinesses: config.initialBusinesses,
        baseFoodPrice: config.baseFoodPrice,
        baseSalary: config.baseSalary,
        subsidyAmount: config.subsidyAmount,
        socialInteractionStrength: config.socialInteractionStrength,
        priceMarkup: config.priceMarkup,
      });
      setDirty(false);
    }
  }, [config]);

  const mutation = useUpdateConfig({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetConfigQueryKey() });
        toast.success("Настройки применены");
        setDirty(false);
      },
      onError: () => {
        toast.error("Ошибка при сохранении настроек");
      },
    },
  });

  const handleChange = (key: string, value: number) => {
    setValues(v => ({ ...v, [key]: value }));
    setDirty(true);
  };

  const handleApply = () => {
    mutation.mutate({ data: values });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 bg-card border border-card-border rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">Настройки симуляции</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Параметры применяются к живой симуляции немедленно</p>
        </div>
        <button
          onClick={handleApply}
          disabled={!dirty || mutation.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded text-xs font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          <Save className="w-3.5 h-3.5" />
          {mutation.isPending ? "Применяется..." : "Применить"}
        </button>
      </div>

      <div className="space-y-3">
        {FIELDS.map(field => {
          const value = values[field.key] ?? 0;
          return (
            <div key={field.key} className="bg-card border border-card-border rounded p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <label className="text-xs font-medium text-foreground">{field.label}</label>
                  <p className="text-[10px] text-muted-foreground mt-0.5 max-w-xs">{field.description}</p>
                </div>
                <span className="text-xs font-bold text-primary tabular-nums">
                  {field.format ? field.format(value) : value}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground w-12 text-right tabular-nums shrink-0">
                  {field.format ? field.format(field.min) : field.min}
                </span>
                <input
                  type="range"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={value}
                  onChange={e => handleChange(field.key, parseFloat(e.target.value))}
                  className="flex-1 h-1 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
                />
                <span className="text-[10px] text-muted-foreground w-12 tabular-nums shrink-0">
                  {field.format ? field.format(field.max) : field.max}
                </span>
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={value}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) handleChange(field.key, Math.max(field.min, Math.min(field.max, v)));
                  }}
                  className="w-20 text-xs text-right bg-input border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary"
                />
              </div>
            </div>
          );
        })}
      </div>

      {dirty && (
        <div className="bg-[hsl(43,100%,50%)]/10 border border-[hsl(43,100%,50%)]/30 rounded p-3 text-xs text-[hsl(43,100%,50%)]">
          Есть несохранённые изменения. Нажмите «Применить» для вступления в силу.
        </div>
      )}
    </div>
  );
}
