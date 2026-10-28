import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Catch-all for URLs the router does not know. The app's own home page is a
 * static landing page served by the edge (Caddy), so the SPA only ever boots
 * on a sub-path — this is what a mistyped one lands on.
 */
export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Compass className="h-6 w-6" />
      </div>
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-fg">
          Page not found
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          That URL does not exist in this workspace.
        </p>
      </div>
      <Link
        to="/dashboard"
        className={cn(
          "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5",
          "bg-accent text-sm font-medium text-accent-fg transition-colors",
          "hover:opacity-90",
        )}
      >
        Back to dashboard
      </Link>
    </div>
  );
}
