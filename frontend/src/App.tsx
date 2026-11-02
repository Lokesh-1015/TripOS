import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import Landing from "@/pages/Landing";
import { ConfirmEmail, ForgotPassword, Login, Onboarding, ResetPassword, Signup, VerifyEmail } from "@/pages/Auth";
import AppShell from "@/components/AppShell";
import Dashboard from "@/pages/Dashboard";
import Trips from "@/pages/Trips";
import CreateTrip from "@/pages/CreateTrip";
import TripWorkspace from "@/pages/TripWorkspace";
import TripReplay from "@/pages/TripReplay";
import Explore from "@/pages/Explore";
import Settings from "@/pages/Settings";
import Join from "@/pages/Join";
import { DocumentsHub, ExpensesHub, MemoriesHub, TasksHub } from "@/pages/Hubs";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route path="/verify-email/:token" element={<VerifyEmail />} />
        <Route path="/confirm-email" element={<ConfirmEmail />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/join/:code" element={<Join />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="trips" element={<Trips />} />
          <Route path="trips/new" element={<CreateTrip />} />
          <Route path="trips/:id/replay" element={<TripReplay />} />
          <Route path="trips/:id/:tab?" element={<TripWorkspace />} />
          <Route path="explore" element={<Explore />} />
          <Route path="expenses" element={<ExpensesHub />} />
          <Route path="tasks" element={<TasksHub />} />
          <Route path="memories" element={<MemoriesHub />} />
          <Route path="documents" element={<DocumentsHub />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster richColors position="bottom-right" mobileOffset={{ bottom: 88 }} />
    </>
  );
}
