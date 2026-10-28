import { NavLink } from "react-router-dom";
import {
  BarChart3,
  Inbox,
  LayoutDashboard,
  Mail,
  Send,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Brand } from "@/components/layout/Brand";
import { conversations } from "@/mocks/data";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Inbox;
  end?: boolean;
  badge?: number;
}

const primaryNav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/campaigns", label: "Campaigns", icon: Send },
  { to: "/inbox", label: "Inbox", icon: Inbox },
];

const dataNav: NavItem[] = [
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/lists", label: "Lists", icon: Mail },
  { to: "/mailboxes", label: "Mailboxes", icon: Mail },
];

const insightNav: NavItem[] = [
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function Sidebar({
  open,
  onNavigate,
}: {
  open: boolean;
  onNavigate?: () => void;
}) {
  const unread = conversations.filter((c) => !c.isRead).length;

  const withBadges = primaryNav.map((item) =>
    item.to === "/inbox" ? { ...item, badge: unread } : item,
  );

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-surface",
        "transition-transform duration-200 lg:static lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <Brand size="h-3.5" />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <NavGroup items={withBadges} onNavigate={onNavigate} />
        <div className="my-3 border-t border-border" />
        <NavGroup items={dataNav} onNavigate={onNavigate} label="Data" />
        <div className="my-3 border-t border-border" />
        <NavGroup items={insightNav} onNavigate={onNavigate} />
      </nav>

      <div className="shrink-0 border-t border-border p-2">
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent-soft text-accent"
                : "text-fg-muted hover:bg-surface-muted hover:text-fg",
            )
          }
        >
          <Settings className="h-4 w-4" />
          Settings
        </NavLink>
      </div>
    </aside>
  );
}

function NavGroup({
  items,
  onNavigate,
  label,
}: {
  items: NavItem[];
  onNavigate?: () => void;
  label?: string;
}) {
  return (
    <div>
      {label ? (
        <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          {label}
        </p>
      ) : null}
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent-soft text-accent"
                    : "text-fg-muted hover:bg-surface-muted hover:text-fg",
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge ? (
                <span className="tabular rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-fg">
                  {item.badge}
                </span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
