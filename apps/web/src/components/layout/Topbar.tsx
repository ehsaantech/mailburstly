import { Bell, Menu, Moon, Search, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Stat";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Link } from "react-router-dom";

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
  const [showNotifications, setShowNotifications] = useState(false);

  const unreadQuery = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => api.get<{ data: { count: number } }>("/notifications/unread-count"),
    refetchInterval: 15_000,
  });
  const listQuery = useQuery({
    queryKey: ["notifications", "dropdown"],
    queryFn: () =>
      api.get<{
        data: {
          items: Array<{ id: string; title: string; body?: string | null; conversationId?: string | null; createdAt: string; readAt?: string | null }>;
        };
      }>("/notifications?limit=10"),
    enabled: showNotifications,
  });
  const unreadCount = unreadQuery.data?.data?.count ?? 0;

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

        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            onClick={() => {
              setShowNotifications((v) => !v);
            }}
          >
            <span className="relative">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger-soft text-[9px] font-semibold text-danger">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
            </span>
          </Button>

          {showNotifications ? (
            <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
              <div className="border-b border-border px-3 py-2 text-xs font-semibold text-fg-muted">
                Notifications
              </div>
              {listQuery.isLoading ? (
                <div className="p-4 text-xs text-fg-subtle">Loading…</div>
              ) : (listQuery.data?.data?.items ?? []).length === 0 ? (
                <div className="p-4 text-xs text-fg-subtle">No notifications.</div>
              ) : (
                (listQuery.data?.data?.items ?? []).map((n) => (
                  <Link
                    key={n.id}
                    to={n.conversationId ? `/inbox?conversation=${n.conversationId}` : "/inbox"}
                    onClick={() => {
                      setShowNotifications(false);
                      void api.post(`/notifications/${n.id}/read`);
                      unreadQuery.refetch();
                    }}
                    className="block border-b border-border px-3 py-2 text-sm transition-colors hover:bg-surface-muted"
                  >
                    <p className="font-medium text-fg">{n.title}</p>
                    {n.body ? <p className="mt-0.5 truncate text-xs text-fg-muted">{n.body}</p> : null}
                    <p className="mt-0.5 text-[10px] text-fg-subtle">{typeof n.createdAt === "string" ? n.createdAt.replace("T", " ").slice(0, 16) : ""}</p>
                  </Link>
                ))
              )}
              <div className="px-3 py-2 text-right">
                <button
                  className="text-xs text-fg-muted hover:text-fg"
                  onClick={() => {
                    void api.post("/notifications/read-all");
                    unreadQuery.refetch();
                    listQuery.refetch();
                  }}
                >
                  Mark all read
                </button>
              </div>
            </div>
          ) : null}
        </div>

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
