import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Lock, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Input";
import { useAuth } from "@/lib/auth";
import { LogoMark } from "@/components/layout/Sidebar";

export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";

  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("change-me-admin-password");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <LogoMark className="h-7 w-7" />
          </span>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight text-fg">
              Mailrung
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              Sign in to your workspace
            </p>
          </div>
        </div>

        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Email" htmlFor="login-email">
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
                  <Input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="pl-9"
                    required
                    autoFocus
                  />
                </div>
              </Field>

              <Field label="Password" htmlFor="login-password">
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
                  <Input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-9"
                    required
                  />
                </div>
              </Field>

              {error ? (
                <div className="rounded-lg border border-[var(--danger)]/25 bg-danger-soft px-3 py-2 text-xs text-fg-muted">
                  {error}
                </div>
              ) : null}

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                loading={submitting}
                type="submit"
              >
                <Send className="h-4 w-4" />
                Sign in
              </Button>
            </form>
          </CardBody>
        </Card>

        <p className="mt-6 text-center text-[11px] text-fg-subtle">
          Internal tool · No sign-up · Contact your admin for access
        </p>
      </div>
    </div>
  );
}