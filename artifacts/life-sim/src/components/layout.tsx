import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Activity, Users, BarChart2, Landmark, Settings, Server } from "lucide-react";

const NAV = [
  { href: "/", label: "Дашборд", icon: Activity },
  { href: "/agents", label: "Жители", icon: Users },
  { href: "/economy", label: "Экономика", icon: BarChart2 },
  { href: "/government", label: "Государство", icon: Landmark },
  { href: "/settings", label: "Настройки", icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="dark flex h-screen bg-background text-foreground overflow-hidden">
      <aside className="w-52 shrink-0 border-r border-border flex flex-col bg-sidebar">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
          <Server className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-sidebar-foreground tracking-wide uppercase">LifeSim</span>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? location === href : location.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-sidebar-border">
          <p className="text-[10px] text-muted-foreground">Life Simulation v1.0</p>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
