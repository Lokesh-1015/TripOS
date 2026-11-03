import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, CheckCircle2, Circle, Compass, Plus, Receipt, UserPlus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants, Button } from "@/components/ui/button";
import { Avatar, AvatarStack, EmptyState, Progress, StatusBadge } from "@/components/common";
import { TripCard } from "@/components/TripCard";
import { apiErrorMessage } from "@/lib/api";
import { actions, saved, useApp } from "@/lib/store";
import { ago, CATEGORY_COLOR, daysUntil, fmtDate, fmtRange, money, todayISO, totalSpent, tripStatus } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { user, trips, notifications } = useApp((s) => s);
  const navigate = useNavigate();
  const active = trips.filter((t) => !t.archived);
  const upcoming = active.filter((t) => tripStatus(t) === "upcoming").sort((a, b) => a.startDate.localeCompare(b.startDate));
  const ongoing = active.filter((t) => tripStatus(t) === "ongoing");
  const recent = active.filter((t) => tripStatus(t) === "completed").sort((a, b) => b.endDate.localeCompare(a.endDate));
  const next = ongoing[0] ?? upcoming[0];
  const today = todayISO();

  const myTasks = active
    .flatMap((t) => t.tasks.filter((k) => k.assignee === user.id && !k.done).map((k) => ({ ...k, trip: t })))
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 5);
  const expenses = active
    .flatMap((t) => t.expenses.map((e) => ({ ...e, trip: t })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  const events = active
    .flatMap((t) => t.events.map((e) => ({ ...e, trip: t })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);
  const invites = notifications.filter((n) => n.kind === "invite");
  const people = Object.fromEntries(trips.flatMap((t) => t.members).map((m) => [m.id, m]));
  const otherTrips = [...ongoing, ...upcoming, ...recent].filter((t) => t.id !== next?.id).slice(0, 4);
  const roleOn = (t: { members: { id: string; role: string }[] }) => t.members.find((m) => m.id === user.id)?.role ?? "viewer";
  // With no trip to act on, only offer finding a destination.
  const nextRole = next ? roleOn(next) : "viewer";
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="grid gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-ink-muted">{fmtDate(today, "EEEE, dd MMMM")}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]" data-testid="dashboard-welcome">{greet}, {user.name.split(" ")[0]}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/explore" className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-xl")} data-testid="dashboard-explore-button"><Compass className="size-4" /> Get inspired</Link>
          <Link to="/app/trips/new" className={cn(buttonVariants(), "h-10 rounded-xl")} data-testid="dashboard-create-trip-button"><Plus className="size-4" /> Create trip</Link>
        </div>
      </div>

      {/* Hero: next trip */}
      {next ? (
        <section className="grid overflow-hidden rounded-3xl border border-line bg-card lg:grid-cols-[1.25fr_1fr]" data-testid="dashboard-next-trip">
          <Link to={`/app/trips/${next.id}`} className="group relative min-h-[240px] overflow-hidden">
            <img src={next.cover} alt={next.destination} className="absolute inset-0 size-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6 text-white">
              <StatusBadge status={tripStatus(next)} className="bg-white/95" />
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">{next.name}</h2>
              <p className="mt-1 text-sm text-white/85">{next.destination} · {fmtRange(next.startDate, next.endDate)}</p>
            </div>
          </Link>
          <div className="flex flex-col gap-5 p-6">
            <div className="flex items-baseline gap-2">
              <span className="num text-5xl font-semibold tracking-tight text-forest" data-testid="dashboard-countdown">{Math.max(0, daysUntil(next.startDate))}</span>
              <span className="text-sm text-ink-muted">days to go</span>
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-xs text-ink-muted">
                <span>Budget used</span>
                <span className="num">{money(totalSpent(next), next.currency)} / {money(next.budget, next.currency)}</span>
              </div>
              <Progress value={(totalSpent(next) / Math.max(1, next.budget)) * 100} />
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                ["Tasks left", next.tasks.filter((t) => !t.done).length],
                ["Activities", next.activities.length],
                ["Packed", `${Math.round((next.packing.filter((p) => p.packed).length / Math.max(1, next.packing.length)) * 100)}%`],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-muted/70 px-2 py-3">
                  <p className="num text-lg font-semibold">{v}</p>
                  <p className="text-[11px] text-ink-muted">{l}</p>
                </div>
              ))}
            </div>
            <div className="mt-auto flex items-center justify-between">
              <AvatarStack people={next.members} />
              <Link to={`/app/trips/${next.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-forest hover:underline" data-testid="dashboard-open-next-trip">Open workspace <ArrowRight className="size-4" /></Link>
            </div>
          </div>
        </section>
      ) : (
        <EmptyState icon={Compass} title="No upcoming trips" body="Start planning your next adventure with your crew." action={<Button onClick={() => navigate("/app/trips/new")} data-testid="dashboard-empty-create">Create a trip</Button>} />
      )}

      {/* Invitations */}
      {invites.length > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl border border-coral/30 bg-coral-soft/60 p-4 sm:flex-row sm:items-center" data-testid="dashboard-invitations">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-coral text-white"><UserPlus className="size-5" /></span>
          <div className="flex-1">
            <p className="text-sm font-semibold">{invites[0].title}</p>
            <p className="text-xs text-ink-muted">{invites[0].body} · {ago(invites[0].at)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-xl bg-card" onClick={() => { actions.dismissNotification(invites[0].id); toast("Invitation declined"); }} data-testid="dashboard-invite-decline">Decline</Button>
            <Button className="rounded-xl" onClick={() => { void actions.acceptInvite(invites[0].id).then((id) => { toast.success("You joined the trip"); navigate(`/app/trips/${id}`); }, (e) => toast.error(apiErrorMessage(e))); }} data-testid="dashboard-invite-accept">Accept invite</Button>
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="grid content-start gap-6">
          {/* Trips */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Your trips</h2>
              <Link to="/app/trips" className="text-sm font-medium text-forest hover:underline" data-testid="dashboard-all-trips-link">View all</Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {otherTrips.map((t) => <TripCard key={t.id} trip={t} />)}
            </div>
            {otherTrips.length === 0 && <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted" data-testid="dashboard-trips-empty">{next ? "Your other trips will show up here." : "Trips you create or join will show up here."}</p>}
          </section>

          {/* Recent expenses */}
          <section className="rounded-2xl border border-line bg-card">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-semibold"><Receipt className="size-4 text-sage-ink" /> Recent expenses</h2>
              <Link to="/app/expenses" className="text-sm font-medium text-forest hover:underline" data-testid="dashboard-expenses-link">All expenses</Link>
            </div>
            {expenses.length === 0 && <p className="px-5 py-8 text-center text-sm text-ink-muted" data-testid="dashboard-expenses-empty">No expenses yet. Anything your crew logs will appear here.</p>}
            <ul className="divide-y">
              {expenses.map((e) => (
                <li key={e.id}>
                  <Link to={`/app/trips/${e.trip.id}/expenses`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50" data-testid={`dashboard-expense-${e.id}`}>
                    <span className="size-2.5 rounded-full" style={{ background: CATEGORY_COLOR[e.category] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{e.title}</span>
                      <span className="block text-xs text-ink-muted">{e.trip.name} · paid by {people[e.paidBy]?.name.split(" ")[0]} · {fmtDate(e.date, "dd MMM")}</span>
                    </span>
                    <span className="num text-sm font-semibold">{money(e.amount, e.trip.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="grid content-start gap-6">
          {/* Tasks */}
          <section className="rounded-2xl border border-line bg-card" data-testid="dashboard-pending-tasks">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-semibold"><CalendarClock className="size-4 text-sage-ink" /> Your pending tasks</h2>
              <Link to="/app/tasks" className="text-sm font-medium text-forest hover:underline" data-testid="dashboard-tasks-link">See all</Link>
            </div>
            {myTasks.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">Nothing on your plate 🎉</p>
            ) : (
              <ul className="divide-y">
                {myTasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 px-5 py-3">
                    <button
                      disabled={roleOn(t.trip) === "viewer"}
                      className="mt-0.5 text-ink-muted transition-colors enabled:hover:text-forest"
                      onClick={() => {
                        actions.upsert(t.trip.id, "tasks", { ...t, trip: undefined, done: true, status: "done" } as never, { text: `completed “${t.title}”`, kind: "task" });
                        saved("Task completed");
                      }}
                      aria-label={`Mark ${t.title} complete`}
                      data-testid={`dashboard-task-complete-${t.id}`}
                    >
                      <Circle className="size-[18px]" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{t.title}</p>
                      <p className={cn("text-xs", t.due < today ? "font-medium text-destructive" : "text-ink-muted")}>{t.trip.name} · {t.due < today ? "Overdue" : `Due ${fmtDate(t.due, "dd MMM")}`}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Quick actions */}
          <section className="grid grid-cols-2 gap-3">
            {[
              ...(nextRole === "viewer" ? [] : [
                [Wallet, "Add expense", next ? `/app/trips/${next.id}/expenses?new=1` : "/app/trips"],
                [CheckCircle2, "Add task", next ? `/app/trips/${next.id}/tasks?new=1` : "/app/trips"],
              ]),
              ...(nextRole === "viewer" || nextRole === "member" ? [] : [[UserPlus, "Invite friends", next ? `/app/trips/${next.id}?invite=1` : "/app/trips"]]),
              [Compass, "Find a trip to join", "/app/explore"],
            ].map(([Icon, label, to]) => {
              const I = Icon as typeof Wallet;
              return (
                <Link key={label as string} to={to as string} className="group flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-forest/30" data-testid={`quick-action-${(label as string).toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className="grid size-9 place-items-center rounded-xl bg-sage text-forest"><I className="size-4" /></span>
                  <span className="text-sm font-medium">{label as string}</span>
                </Link>
              );
            })}
          </section>

          {/* Activity */}
          <section className="rounded-2xl border border-line bg-card" data-testid="dashboard-recent-activity">
            <h2 className="border-b px-5 py-4 text-base font-semibold">Recent activity</h2>
            {events.length === 0 && <p className="px-5 py-8 text-center text-sm text-ink-muted" data-testid="dashboard-activity-empty">Nothing yet. Your crew's updates will appear here.</p>}
            <ul className={cn("grid gap-4", events.length > 0 && "p-5")}>
              {events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <Avatar person={people[e.actorId]} size={28} ring={false} />
                  <p className="text-[13px] leading-snug">
                    <b className="font-semibold">{e.actorId === user.id ? "You" : people[e.actorId]?.name.split(" ")[0]}</b> {e.text}
                    <span className="block text-xs text-ink-muted">{e.trip.name} · {ago(e.at)}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
