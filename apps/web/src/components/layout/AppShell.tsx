import { useState, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({
  children,
  title,
}: {
  children?: ReactNode;
  title?: string;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Mobile scrim */}
      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      ) : null}

      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={title}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
        <main className="min-w-0 flex-1">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}

/** Standard page container: max width, consistent padding, optional header. */
export function Page({
  title,
  description,
  actions,
  children,
  bleed,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Skip the inner padding — used by full-bleed screens like the inbox. */
  bleed?: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      {!bleed ? (
        <div className="border-b border-border bg-surface/40 px-5 py-4">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-fg">
                {title}
              </h1>
              {description ? (
                <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
              ) : null}
            </div>
            {actions ? (
              <div className="flex flex-wrap items-center gap-2">{actions}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={bleed ? "min-h-0 flex-1" : "mx-auto w-full max-w-[1400px] flex-1 p-5"}>
        {children}
      </div>
    </div>
  );
}
