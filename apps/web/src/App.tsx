import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { DashboardPage } from "@/pages/Dashboard";
import { CampaignsPage } from "@/pages/Campaigns";
import { CampaignDetailPage } from "@/pages/CampaignDetail";
import { InboxPage } from "@/pages/Inbox";
import { LeadsPage } from "@/pages/Leads";
import { ListsPage } from "@/pages/Lists";
import { MailboxesPage } from "@/pages/Mailboxes";
import { AnalyticsPage } from "@/pages/Analytics";
import { SettingsPage } from "@/pages/Settings";
import { LoginPage } from "@/pages/Login";
import { MailboxCallbackPage } from "@/pages/MailboxCallback";
import { NotFoundPage } from "@/pages/NotFound";

export function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/mailboxes/callback" element={<MailboxCallbackPage />} />

      {/* The public home page is a static page served by the edge (Caddy),
          not a route here — "/" never boots the SPA. If one ever does (a
          client-side navigation to "/"), send it to the dashboard rather
          than a blank screen. */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Protected routes */}
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/campaigns/:campaignId" element={<CampaignDetailPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/lists" element={<ListsPage />} />
        <Route path="/mailboxes" element={<MailboxesPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
