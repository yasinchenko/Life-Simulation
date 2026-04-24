import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  accent?: "teal" | "amber" | "crimson" | "blue" | "purple";
  className?: string;
}

const accentMap: Record<string, string> = {
  teal: "text-[hsl(173,80%,40%)]",
  amber: "text-[hsl(43,100%,50%)]",
  crimson: "text-[hsl(348,83%,47%)]",
  blue: "text-[hsl(210,100%,50%)]",
  purple: "text-[hsl(280,80%,60%)]",
};

export default function StatCard({ label, value, sub, icon: Icon, accent = "teal", className }: StatCardProps) {
  return (
    <div className={cn("bg-card border border-card-border rounded p-4 flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn("w-3.5 h-3.5", accentMap[accent])} />}
      </div>
      <span className={cn("text-2xl font-bold tabular-nums", accentMap[accent])}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}
