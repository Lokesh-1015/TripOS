import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import Landing from "@/pages/Landing";
import { ConfirmEmail, ForgotPassword, Login, Onboarding, ResetPassword, Signup, VerifyEmail } from "@/pages/Auth";
import AppShell from "@/components/AppShell";
import { PageLoading } from "@/components/PageLoading";

// The landing and sign-in pages load straight away. Everything else loads when it's first opened, so the
// first visit downloads far less. Installed copies still have every page offline, as they're all cached.
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType<any>>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Trips = lazy(() => import("@/pages/Trips"));
const CreateTrip = lazy(() => import("@/pages/CreateTrip"));
const TripWorkspace = lazy(() => import("@/pages/TripWorkspace"));
const TripReplay = lazy(() => import("@/pages/TripReplay"));
const Explore = lazy(() => import("@/pages/Explore"));
const Settings = lazy(() => import("@/pages/Settings"));
const Join = lazy(() => import("@/pages/Join"));
const People = lazy(() => import("@/pages/People"));
const Feed = lazy(() => import("@/pages/Feed"));
const PostPage = named(() => import("@/pages/Feed"), "PostPage");
const PublicTripPage = lazy(() => import("@/pages/PublicTrip"));
const Profile = lazy(() => import("@/pages/Profile"));
const AdminReports = lazy(() => import("@/pages/AdminReports"));
const Privacy = named(() => import("@/pages/Legal"), "Privacy");
const Terms = named(() => import("@/pages/Legal"), "Terms");
const Contact = named(() => import("@/pages/Legal"), "Contact");
const ExpensesHub = named(() => import("@/pages/Hubs"), "ExpensesHub");
const TasksHub = named(() => import("@/pages/Hubs"), "TasksHub");
const MemoriesHub = named(() => import("@/pages/Hubs"), "MemoriesHub");
const DocumentsHub = named(() => import("@/pages/Hubs"), "DocumentsHub");

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <>
      <Suspense fallback={<PageLoading fullScreen />}>
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
        <Route path="/t/:id" element={<PublicTripPage standalone />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="trips" element={<Trips />} />
          <Route path="trips/new" element={<CreateTrip />} />
          <Route path="trips/:id/replay" element={<TripReplay />} />
          <Route path="trips/:id/:tab?" element={<TripWorkspace />} />
          <Route path="explore" element={<Explore />} />
          <Route path="explore/:id" element={<PublicTripPage />} />
          <Route path="expenses" element={<ExpensesHub />} />
          <Route path="tasks" element={<TasksHub />} />
          <Route path="memories" element={<MemoriesHub />} />
          <Route path="documents" element={<DocumentsHub />} />
          <Route path="settings" element={<Settings />} />
          <Route path="people" element={<People />} />
          <Route path="feed" element={<Feed />} />
          <Route path="posts/:id" element={<PostPage />} />
          <Route path="u/:username" element={<Profile />} />
          <Route path="admin/reports" element={<AdminReports />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      <Toaster richColors position="bottom-right" mobileOffset={{ bottom: 88 }} />
    </>
  );
}
