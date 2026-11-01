// Cross-trip hubs reachable from the sidebar: Expenses, Tasks, Memories, Shared Documents.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileText, Images, ListTodo, Lock, Play, Receipt, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, EmptyState, PageHeader, Progress, Stat } from "@/components/common";
import { TaskRow } from "@/components/trip/TasksTab";
import { DocIcon, DOC_LABEL } from "@/components/trip/DocumentsTab";
import { useApp } from "@/lib/store";
import { balances, CATEGORY_COLOR, fmtDate, fmtRange, money, todayISO, totalSpent, tripStatus } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { Trip } from "@/lib/types";

const activeTrips = (trips: Trip[]) => trips.filter((t) => !t.archived);

export function ExpensesHub() {
  const trips = useApp((s) => s.trips);
  const me = useApp((s) => s.user.id);
  const list = activeTrips(trips);
  const rows = list.map((t) => ({ t, spent: totalSpent(t), bal: balances(t.members, t.expenses, t.settlements)[me] ?? 0 }));
  const owe = rows.filter((r) => r.bal < -0.009 && r.t.currency === "INR").reduce((s, r) => s - r.bal, 0);
  const get = rows.filter((r) => r.bal > 0.009 && r.t.currency === "INR").reduce((s, r) => s + r.bal, 0);
  const recent = list.flatMap((t) => t.expenses.map((e) => ({ e, t }))).sort((a, b) => b.e.date.localeCompare(a.e.date)).slice(0, 10);
  return (
    <div>
      <PageHeader title="Expenses" subtitle="Your balances and spending across every trip." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="You owe" value={<span className="text-[#C2462F]">{money(owe)}</span>} hint="Across all trips (INR)" testId="hub-expenses-owe" />
        <Stat label="You're owed" value={<span className="text-[#1E7B58]">{money(get)}</span>} hint="Across all trips (INR)" testId="hub-expenses-owed" />
        <Stat label="Trips tracked" value={rows.length} testId="hub-expenses-trips" />
        <Stat label="Total logged" value={money(rows.filter((r) => r.t.currency === "INR").reduce((s, r) => s + r.spent, 0))} testId="hub-expenses-total" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <section className="divide-y rounded-2xl border border-line bg-card">
          {rows.map(({ t, spent, bal }) => (
            <Link key={t.id} to={`/app/trips/${t.id}/expenses`} className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50" data-testid={`hub-expense-trip-${t.id}`}>
              <img src={t.cover} alt="" className="size-14 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.name}</p>
                <p className="num text-xs text-ink-muted">{money(spent, t.currency)} spent{t.budget ? ` of ${money(t.budget, t.currency)}` : ""}</p>
                {t.budget > 0 && <Progress value={(spent / t.budget) * 100} className="mt-2 h-1.5" />}
              </div>
              <span className={cn("num text-right text-sm font-semibold", bal > 0.009 ? "text-[#1E7B58]" : bal < -0.009 ? "text-[#C2462F]" : "text-ink-muted")}>
                {bal > 0.009 ? `+${money(bal, t.currency)}` : bal < -0.009 ? `−${money(-bal, t.currency)}` : "Settled"}
              </span>
              <ArrowRight className="size-4 text-ink-muted" />
            </Link>
          ))}
        </section>
        <section className="rounded-2xl border border-line bg-card">
          <h2 className="border-b px-5 py-4 font-semibold">Latest expenses</h2>
          <ul className="divide-y">
            {recent.map(({ e, t }) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                <span className="size-2.5 rounded-full" style={{ background: CATEGORY_COLOR[e.category] }} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm">{e.title}</span><span className="text-xs text-ink-muted">{t.name} · {fmtDate(e.date, "dd MMM")}</span></span>
                <span className="num text-sm font-medium">{money(e.amount, t.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function TasksHub() {
  const trips = useApp((s) => s.trips);
  const me = useApp((s) => s.user.id);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [show, setShow] = useState<"open" | "done">("open");
  const list = activeTrips(trips);
  const today = todayISO();
  const tasks = list.flatMap((t) => t.tasks.map((k) => ({ k, t }))).filter(({ k }) => (scope === "all" || k.assignee === me) && (show === "done" ? k.done : !k.done)).sort((a, b) => a.k.due.localeCompare(b.k.due));
  const mine = list.flatMap((t) => t.tasks).filter((k) => k.assignee === me);
  return (
    <div>
      <PageHeader title="Tasks" subtitle="Everything you've signed up for, across all trips." />
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Assigned to you" value={mine.filter((k) => !k.done).length} testId="hub-tasks-open" />
        <Stat label="Overdue" value={<span className="text-destructive">{mine.filter((k) => !k.done && k.due < today).length}</span>} testId="hub-tasks-overdue" />
        <Stat label="Completed" value={mine.filter((k) => k.done).length} testId="hub-tasks-done" />
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {([["mine", "My tasks"], ["all", "Everyone's"]] as const).map(([k, l]) => <button key={k} onClick={() => setScope(k)} className={cn("rounded-full border px-3.5 py-1.5 text-sm font-medium", scope === k ? "border-forest bg-forest text-white" : "border-line bg-card text-ink-muted")} data-testid={`hub-tasks-scope-${k}`}>{l}</button>)}
        <span className="mx-1 w-px bg-line" />
        {([["open", "Open"], ["done", "Completed"]] as const).map(([k, l]) => <button key={k} onClick={() => setShow(k)} className={cn("rounded-full border px-3.5 py-1.5 text-sm font-medium", show === k ? "border-forest bg-forest text-white" : "border-line bg-card text-ink-muted")} data-testid={`hub-tasks-show-${k}`}>{l}</button>)}
      </div>
      {tasks.length === 0 ? <EmptyState icon={ListTodo} title="Nothing here" body="No tasks match this view." /> : (
        <ul className="divide-y rounded-2xl border border-line bg-card" data-testid="hub-tasks-list">
          {tasks.map(({ k, t }) => <TaskRow key={`${t.id}-${k.id}`} trip={t} task={k} showTrip />)}
        </ul>
      )}
    </div>
  );
}

export function MemoriesHub() {
  const trips = useApp((s) => s.trips);
  const withPhotos = trips.filter((t) => t.photos.length > 0 || tripStatus(t) === "completed");
  return (
    <div>
      <PageHeader title="Memories" subtitle="Shared galleries and Trip Replays from your journeys." />
      {withPhotos.length === 0 ? <EmptyState icon={Images} title="No memories yet" body="Photos from your trips will appear here." /> : (
        <div className="grid gap-6">
          {withPhotos.map((t) => (
            <section key={t.id} className="overflow-hidden rounded-2xl border border-line bg-card" data-testid={`hub-memories-trip-${t.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div><h2 className="font-semibold">{t.name}</h2><p className="text-xs text-ink-muted">{fmtRange(t.startDate, t.endDate)} · {t.photos.length} photos</p></div>
                <div className="flex gap-2">
                  <Link to={`/app/trips/${t.id}/memories`} className="rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-muted" data-testid={`hub-memories-gallery-${t.id}`}>Gallery</Link>
                  {tripStatus(t) !== "upcoming" && tripStatus(t) !== "ongoing" && <Link to={`/app/trips/${t.id}/replay`} className="inline-flex items-center gap-1.5 rounded-xl bg-coral px-3 py-2 text-sm font-medium text-white hover:bg-[#e97a56]" data-testid={`hub-memories-replay-${t.id}`}><Play className="size-3.5" /> Trip Replay</Link>}
                </div>
              </div>
              <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pb-5">
                {t.photos.map((p) => <img key={p.id} src={p.url} alt={p.caption} className="h-36 w-52 shrink-0 rounded-xl object-cover" loading="lazy" />)}
                {t.photos.length === 0 && <p className="text-sm text-ink-muted">No photos uploaded yet.</p>}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function DocumentsHub() {
  const trips = useApp((s) => s.trips);
  const me = useApp((s) => s.user.id);
  const [q, setQ] = useState("");
  const [trip, setTrip] = useState("all");
  const docs = useMemo(() => trips.flatMap((t) => t.documents.filter((d) => d.visibility === "shared" || d.uploadedBy === me).map((d) => ({ d, t })))
    .filter(({ d, t }) => (trip === "all" || t.id === trip) && (!q || d.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.d.uploadedAt.localeCompare(a.d.uploadedAt)), [trips, me, q, trip]);
  return (
    <div>
      <PageHeader title="Shared Documents" subtitle="Every ticket, booking and contact across your trips." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1"><span className="sr-only">Search</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all documents" className="h-10 pl-9" data-testid="hub-documents-search-input" /></label>
        <Select value={trip} onValueChange={setTrip}>
          <SelectTrigger className="h-10 sm:w-56" data-testid="hub-documents-trip-filter"><SelectValue>{(v) => (v === "all" ? "All trips" : trips.find((t) => t.id === v)?.name)}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="all">All trips</SelectItem>{trips.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {docs.length === 0 ? <EmptyState icon={FileText} title="No documents found" body="Upload documents from a trip's Documents tab." /> : (
        <ul className="divide-y rounded-2xl border border-line bg-card" data-testid="hub-documents-list">
          {docs.map(({ d, t }) => (
            <li key={d.id}>
              <Link to={`/app/trips/${t.id}/documents`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50" data-testid={`hub-document-${d.id}`}>
                <DocIcon type={d.fileType} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{d.name}</span><span className="block truncate text-xs text-ink-muted">{t.name} · {DOC_LABEL[d.category]} · {fmtDate(d.uploadedAt, "dd MMM")}</span></span>
                {d.visibility === "private" ? <span className="flex items-center gap-1 rounded-full bg-coral-soft px-2 py-0.5 text-[11px] font-medium text-[#8A3B22]"><Lock className="size-3" /> Private</span> : <Avatar person={t.members.find((m) => m.id === d.uploadedBy)} size={24} ring={false} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-muted"><Receipt className="size-3.5" /> Tip: private documents are visible only to you, even inside shared trips.</p>
    </div>
  );
}
