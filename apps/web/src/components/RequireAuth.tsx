import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { LoadingBlock } from "@/components/ui/Feedback";

/**
 * Wraps a route so it only renders for authenticated users.
 * Unauthenticated visitors are redirected to /login, with the original
 * location preserved so we can send them back after a successful login.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingBlock label="Checking session" />;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}