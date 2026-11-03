import { useState, type FormEvent } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  Compass, FileText, HelpCircle, Home, Images, LogOut, Map as MapIcon, Menu, Plus, Receipt, Search, Settings, CheckSquare, ChevronsUpDown, User,
} from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api";
import LiveLocationBanner from "@/components/LiveLocationBanner";
import WhatsNewDialog from "@/components/WhatsNewDialog";
import { actions, useApp } from "@/lib/store";
import { Avatar, Logo } from "@/components/common";
import { NotificationsBell } from "@/components/Notifications";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Overview", icon: Home, end: true },
  { to: "/app/trips", label: "My Trips", icon: MapIcon },
  { to: "/app/explore", label: "Explore", icon: Compass },
  { to: "/app/expenses", label: "Expenses", icon: Receipt },
  { to: "/app/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/app/memories", label: "Memories", icon: Images },
  { to: "/app/documents", label: "Shared Documents", icon: FileText },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

const TITLES: [RegExp, string][] = [
  [/^\/app\/trips\/new/, "Create trip"],
  [/^\/app\/trips\/.+/, "Trip workspace"],
  [/^\/app\/trips/, "My Trips"],
  [/^\/app\/explore/, "Explore"],
  [/^\/app\/expenses/, "Expenses"],
  [/^\/app\/tasks/, "Tasks"],
  [/^\/app\/memories/, "Memories"],
  [/^\/app\/documents/, "Shared Documents"],
  [/^\/app\/settings/, "Settings"],
  [/^\/app/, "Overview"],
];

function AccountMenu({ onHelp, compact = false }: { onHelp: () => void; compact?: boolean }) {
  const user = useApp((s) => s.user);
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn("flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors duration-150", compact ? "w-auto p-1 hover:bg-muted" : "hover:bg-white/10")}
        data-testid={compact ? "header-account-menu-button" : "sidebar-account-menu-button"}
        aria-label="Account menu"
      >
        <Avatar person={user} size={compact ? 32 : 36} ring={false} />
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">{user.name}</span>
              <span className="block truncate text-xs text-[#A2BEB4]">{user.email}</span>
            </span>
            <ChevronsUpDown className="size-4 text-[#A2BEB4]" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "end" : "start"} side={compact ? "bottom" : "top"} className="w-56">
        <DropdownMenuGroup><DropdownMenuLabel>{user.name}</DropdownMenuLabel></DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/app/settings")} data-testid="account-menu-profile"><User /> Profile & settings</DropdownMenuItem>
        <DropdownMenuItem onClick={onHelp} data-testid="account-menu-help"><HelpCircle /> Help & support</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => void actions.signOut()}
          data-testid="account-menu-sign-out"
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="grid gap-0.5" aria-label="Primary">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150",
              isActive ? "bg-sidebar-accent text-white" : "text-[#C5D6CF] hover:bg-white/5 hover:text-white",
            )
          }
          data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-coral" />}
              <Icon className="size-[18px]" />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppShell() {
  const { waking, mustConfirmEmail, loading, offline, offlineCopy, authed, onboarded, emailVerified, emailEnabled, email } = useApp((s) => ({ waking: s.waking, mustConfirmEmail: s.mustConfirmEmail, loading: s.loading, offline: s.offline, offlineCopy: s.offlineCopy, authed: s.authed, onboarded: s.onboarded, emailVerified: s.emailVerified, emailEnabled: s.emailEnabled, email: s.user.email }));
  const location = useLocation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const [whatsNew, setWhatsNew] = useState(false);
  const [q, setQ] = useState("");

  if (loading) {
    return (
      <div className="grid min-h-dvh place-content-center justify-items-center gap-3 bg-background" data-testid="app-loading">
        <Logo />
        {waking && <p className="text-sm text-ink-muted" role="status" data-testid="app-waking">Waking TripOS up. This can take up to a minute.</p>}
      </div>
    );
  }
  if (!authed) return <Navigate to="/login" replace />;
  if (mustConfirmEmail) return <Navigate to="/confirm-email" replace />;
  if (!onboarded) return <Navigate to="/onboarding" replace />;

  const title = TITLES.find(([re]) => re.test(location.pathname))?.[1] ?? "TripOS";
  const search = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/app/trips?q=${encodeURIComponent(q.trim())}`);
  };

  const sectionKey = location.pathname.split("/").slice(0, 4).join("/");

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-background">
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col bg-sidebar px-4 py-5 lg:flex" data-testid="desktop-sidebar">
          <Link to="/app" className="px-2" aria-label="TripOS home"><Logo light /></Link>
          <Link to="/app/trips/new" className={cn(buttonVariants({ size: "lg" }), "mt-6 h-11 w-full rounded-xl bg-coral text-white hover:bg-[#e97a56]")} data-testid="sidebar-create-trip-button">
            <Plus className="size-4" /> Create Trip
          </Link>
          <div className="mt-6 flex-1 overflow-y-auto no-scrollbar"><SideNav /></div>
          <button onClick={() => setHelp(true)} className="mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#C5D6CF] transition-colors hover:bg-white/5 hover:text-white" data-testid="sidebar-help-button">
            <HelpCircle className="size-[18px]" /> Help & support
          </button>
          <div className="border-t border-sidebar-border pt-3"><AccountMenu onHelp={() => setHelp(true)} /></div>
        </aside>

        <div className="lg:pl-[260px]">
          {/* Header */}
          <header className="sticky top-0 z-20 border-b border-line/80 bg-background/85 backdrop-blur-md">
            <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
              <Link to="/app" className="lg:hidden" aria-label="TripOS home"><Logo /></Link>
              <div className="hidden min-w-0 lg:block">
                <p className="text-xs text-ink-muted" data-testid="header-breadcrumb">
                  TripOS <span className="mx-1">/</span> <span className="text-ink">{title}</span>
                </p>
              </div>
              <form onSubmit={search} className="ml-auto hidden w-full max-w-xs md:block" role="search">
                <label className="relative block">
                  <span className="sr-only">Search trips</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search trips, destinations…"
                    className="h-10 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-forest focus:ring-3 focus:ring-forest/10"
                    data-testid="header-search-input"
                  />
                </label>
              </form>
              <div className="ml-auto flex items-center gap-1 md:ml-0">
                <NotificationsBell />
                <div className="hidden lg:block"><AccountMenu compact onHelp={() => setHelp(true)} /></div>
                <button className="grid size-10 place-items-center rounded-xl hover:bg-muted lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu" data-testid="mobile-menu-button">
                  <Menu className="size-5" />
                </button>
              </div>
            </div>
          </header>

          {offline && <p className="bg-coral-soft px-4 py-2 text-center text-sm font-medium text-[#8A3B22]" role="status" data-testid="offline-banner">{offlineCopy ? "You're offline, viewing what was last saved on this device." : "You're offline."} Your changes will be saved when you reconnect, so keep this app open.</p>}
          <LiveLocationBanner />
          {!emailVerified && emailEnabled && (
            <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-sage px-4 py-2 text-center text-sm text-forest" role="status" data-testid="verify-email-banner">
              <span>Check {email} for a link to verify your email. You'll need it to accept or send email invites.</span>
              <button className="font-semibold underline" onClick={() => void actions.resendVerification().then(() => toast.success("Verification email sent"), (e) => toast.error(apiErrorMessage(e)))} data-testid="verify-email-resend">Send it again</button>
            </p>
          )}
          <main className="mx-auto max-w-[1440px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12">
            <motion.div
              key={sectionKey}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <Outlet />
            </motion.div>
          </main>
        </div>

        {/* Mobile bottom navigation */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Mobile" data-testid="mobile-bottom-nav">
          <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
            {[
              { to: "/app", label: "Home", icon: Home, end: true },
              { to: "/app/trips", label: "Trips", icon: MapIcon },
              { to: "/app/trips/new", label: "Create", icon: Plus, primary: true },
              { to: "/app/expenses", label: "Expenses", icon: Receipt },
              { to: "/app/memories", label: "Memories", icon: Images },
            ].map(({ to, label, icon: Icon, end, primary }) =>
              primary ? (
                <Link key={to} to={to} className="mx-auto grid size-12 -translate-y-3 place-items-center rounded-2xl bg-forest text-white shadow-lg shadow-forest/25 transition-transform active:scale-95" aria-label="Create trip" data-testid="mobile-nav-create">
                  <Icon className="size-5" />
                </Link>
              ) : (
                <NavLink
                  key={to}
                  to={to}
                  end={end || to === "/app/trips"}
                  className={({ isActive }) => cn("flex flex-col items-center gap-1 text-[11px] font-medium transition-colors", isActive ? "text-forest" : "text-ink-muted")}
                  data-testid={`mobile-nav-${label.toLowerCase()}`}
                >
                  <Icon className="size-5" />
                  {label}
                </NavLink>
              ),
            )}
          </div>
        </nav>

        <Sheet open={drawer} onOpenChange={setDrawer}>
          <SheetContent side="left" className="w-[290px] border-0 bg-sidebar p-5 text-white" data-testid="mobile-drawer">
            <SheetHeader className="p-0">
              <SheetTitle><Logo light /></SheetTitle>
            </SheetHeader>
            <div className="mt-4"><SideNav onNavigate={() => setDrawer(false)} /></div>
            <div className="mt-auto border-t border-sidebar-border pt-3"><AccountMenu onHelp={() => setHelp(true)} /></div>
          </SheetContent>
        </Sheet>

        <Dialog open={help} onOpenChange={setHelp}>
          <DialogContent data-testid="help-dialog">
            <DialogHeader>
              <DialogTitle>Help & support</DialogTitle>
              <DialogDescription>Quick tips to get the most out of TripOS.</DialogDescription>
            </DialogHeader>
            <ul className="grid gap-3 text-sm">
              <li><b>Create a trip</b> from the sidebar, then invite friends from the trip header.</li>
              <li><b>Split expenses</b> equally or by custom amounts - the Settle up view suggests the fewest transfers.</li>
              <li><b>Drag activities</b> in the itinerary to reorder your day.</li>
              <li><b>Everything stays in sync.</b> Changes your crew makes appear on your screen as they happen.</li>
            </ul>
            <button type="button" className={cn(buttonVariants({ variant: "outline" }), "mt-2")} onClick={() => { setHelp(false); setWhatsNew(true); }} data-testid="help-whats-new-button">See what's new</button>
            <a href="mailto:support@tripos.app" className={buttonVariants({ variant: "outline" })} data-testid="help-contact-link">Email support@tripos.app</a>
          </DialogContent>
        </Dialog>
        <WhatsNewDialog reopened={whatsNew} onClose={() => setWhatsNew(false)} />
      </div>
    </TooltipProvider>
  );
}
