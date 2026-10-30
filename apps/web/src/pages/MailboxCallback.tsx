import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody } from "@/components/ui/Card";
import { api, USE_MOCKS } from "@/lib/api";

/**
 * Callback page for the hosted OAuth flow.
 *
 * mailcore redirects the browser here with `?account=...&state=new|existing`
 * after a successful consent. We forward those params to the api, which fetches
 * the account from mailcore, creates (or updates) our mailbox row, and
 * computes an initial health score.
 */
export function MailboxCallbackPage() {
  const [params] = useSearchParams();
  const account = params.get("account");
  const state = (params.get("state") as "new" | "existing" | null) ?? "new";

  const [status, setStatus] = useState<"working" | "success" | "error">("working");
  const [message, setMessage] = useState("Finalising your mailbox…");
  const [mailboxId, setMailboxId] = useState<string | null>(null);

  useEffect(() => {
    if (!account) {
      setStatus("error");
      setMessage("The mail server did not return an account id. Try connecting again.");
      return;
    }

    if (USE_MOCKS) {
      setStatus("error");
      setMessage(
        "The callback requires the real API. Set VITE_USE_MOCKS=false and run the Hono api.",
      );
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await api.post<{
          data: { mailbox: { id: string; email: string; status: string } };
        }>(
          "/mailboxes/callback",
          { account, state },
        );
        if (cancelled) return;
        setMailboxId(result.data.mailbox.id);
        setStatus("success");
        setMessage(`Connected ${result.data.mailbox.email}.`);
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Something went wrong finalising the connection.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account, state]);

  return (
    <Page title="Connecting mailbox">
      <Card>
        <CardBody className="flex flex-col items-center justify-center gap-4 py-16">
          {status === "working" ? (
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
          ) : status === "success" ? (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
              <Mail className="h-6 w-6" />
            </div>
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
              <Mail className="h-6 w-6" />
            </div>
          )}

          <div className="text-center">
            <h2 className="text-base font-semibold text-fg">
              {status === "working"
                ? "Connecting…"
                : status === "success"
                  ? "Mailbox connected"
                  : "Connection failed"}
            </h2>
            <p className="mt-1 max-w-sm text-sm text-fg-muted">{message}</p>
          </div>

          {status === "success" && mailboxId ? (
            <Link
              to="/mailboxes"
              className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-accent-fg hover:opacity-90"
            >
              View mailbox
            </Link>
          ) : status === "error" ? (
            <Link
              to="/mailboxes"
              className="inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-fg hover:bg-surface-muted"
            >
              Back to mailboxes
            </Link>
          ) : null}
        </CardBody>
      </Card>
    </Page>
  );
}
