import { Bell, Menu, Moon, Search, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Stat";
import { cn } from "@/lib/cn";

const THEME_KEY = "mailrung.theme";

function readInitialDark(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.classList.contains("dark");
}

export function Topbar({
  onToggleSidebar,
  title,
}: {
  onToggleSidebar: () => void;
  title?: string;
}) {
  const [dark, setDark] = useState(readInitialDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      // Storage may be unavailable; the class still applies for this session.
    }
  }, [dark]);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onToggleSidebar}
        aria-label="Toggle navigation"
      >
        <Menu className="h-4 w-4" />
      </Button>

      {title ? (
        <h1 className="truncate text-sm font-semibold text-fg">{title}</h1>
      ) : null}

      <div className="flex flex-1 items-center justify-end gap-2">
        <div className="relative hidden md:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            placeholder="Search campaigns, leads, replies…"
            className={cn(
              "h-8 w-64 rounded-lg border border-border bg-surface-muted pl-8 pr-3 text-xs text-fg",
              "placeholder:text-fg-subtle focus:border-accent focus:outline-none",
              "focus:ring-2 focus:ring-[var(--ring)]",
            )}
          />
        </div>

        <Button variant="ghost" size="icon" aria-label="Notifications">
          <span className="relative">
            <Bell className="h-4 w-4" />
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDark((d) => !d)}
          aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          aria-pressed={dark}
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <div className="ml-1 flex items-center gap-2 border-l border-border pl-2">
          <Avatar initials="HE" />
          <div className="hidden leading-tight sm:block">
            <p className="text-xs font-medium text-fg">Haroon Ehsan</p>
            <p className="text-[10px] text-fg-subtle">Admin</p>
          </div>
        </div>
      </div>
    </header>
  );
}
