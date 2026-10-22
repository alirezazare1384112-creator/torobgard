"use client";

import * as React from "react";
import { Bot, Home as HomeIcon, Moon, Route, Search, Store, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/**
 * Slim top navigation. No search box in the bar (search is its own tab).
 * Tabs: home | assistant | search | shops | trip  + theme toggle.
 */

export type NavBarView = "home" | "assistant" | "search" | "shops" | "trip";

const TABS: { id: NavBarView; label: string; icon: React.ReactNode }[] = [
  { id: "home", label: "خانه", icon: <HomeIcon className="size-4" aria-hidden /> },
  { id: "assistant", label: "دستیار خرید", icon: <Bot className="size-4" aria-hidden /> },
  { id: "search", label: "جست‌وجو", icon: <Search className="size-4" aria-hidden /> },
  { id: "shops", label: "فروشگاه‌ها", icon: <Store className="size-4" aria-hidden /> },
  { id: "trip", label: "برنامهٔ خرید", icon: <Route className="size-4" aria-hidden /> },
];

function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="size-11" aria-hidden />;
  const isDark = (resolvedTheme ?? theme) === "dark";
  return (
    <Button variant="outline" size="icon" className="size-10 shrink-0" aria-label={isDark ? "تغییر به حالت روشن" : "تغییر به حالت تیره"} onClick={() => setTheme(isDark ? "light" : "dark")}>
      {isDark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </Button>
  );
}

export function TopNav({ view, onView }: { view: NavBarView; onView: (v: NavBarView) => void; }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2.5">
        {/* Logo */}
        <button type="button" onClick={() => onView("home")} className="flex shrink-0 items-center gap-2" aria-label="ترب‌گرد — خانه">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="size-5" aria-hidden />
          </span>
          <span className="hidden text-lg font-extrabold tracking-tight sm:inline">ترب‌گرد</span>
        </button>

        {/* Tabs — desktop */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="نماها">
          {TABS.map((t) => (
            <Button key={t.id} variant={view === t.id ? "secondary" : "ghost"} size="sm" className="min-h-9 gap-1.5" onClick={() => onView(t.id)}>
              {t.icon}
              {t.label}
            </Button>
          ))}
        </nav>

        <ThemeToggle />
      </div>

      {/* Tabs — mobile (5 tabs fit, no scroll needed) */}
      <nav className="md:hidden" aria-label="نماها">
        <ul className="mx-auto flex max-w-6xl items-center justify-center gap-1 px-2 pb-2">
          {TABS.map((t) => (
            <li key={t.id}>
              <Button variant={view === t.id ? "secondary" : "ghost"} size="sm" className="min-h-10 min-w-10 gap-1 px-2.5" onClick={() => onView(t.id)} aria-label={t.label}>
                {t.icon}
                <span className="text-[11px]">{t.label}</span>
              </Button>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
