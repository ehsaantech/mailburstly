import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Lock, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Input";
import { useAuth } from "@/lib/auth";
import { Brand } from "@/components/layout/Brand";

export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const from =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname ??
    "/dashboard";

  // No defaults: this page is linked from the public home page, so it must
  // not hand out the seed credentials to whoever lands on it.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
          {/* A plain anchor, not <Link>: "/" is a static page served by the
              edge, and a client-side navigation would stay inside the SPA. */}
          <a href="/" className="rounded-xl">
            <Brand size="h-6" />
          </a>
          <p className="text-sm text-fg-muted">Sign in to your workspace</p>
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
          Mail Burstly · No sign-up · Contact your admin for access
        </p>
      </div>
    </div>
  );
}