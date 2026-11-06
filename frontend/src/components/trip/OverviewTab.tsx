import JoinRequestsPanel from "./JoinRequestsPanel";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Lock, Plus, Trash2, Unlock, Users, Vote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarStack, EmptyState, Field, Progress, Stat } from "@/components/common";
import { useTripAccess } from "@/lib/access";
import { actions, saved, useApp } from "@/lib/store";
import { ago, fmtDate, money, todayISO, totalSpent, tripDays, tripStatus, uid } from "@/lib/format";
import type { Poll, PollCategory, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

const POLL_LABEL: Record<PollCategory, string> = { destination: "Destination", dates: "Travel dates", activity: "Activity", restaurant: "Restaurant", hotel: "Hotel" };

export function PollCard({ trip, poll, compact = false }: { trip: Trip; poll: Poll; compact?: boolean }) {
  const access = useTripAccess(trip);
  const me = access.me;
  const total = poll.options.reduce((s, o) => s + o.votes.length, 0);
  const max = Math.max(0, ...poll.options.map((o) => o.votes.length));
  const voters = new Set(poll.options.flatMap((o) => o.votes)).size;
  const people = Object.fromEntries(trip.members.map((m) => [m.id, m]));
  const vote = (optionId: string) => {
    if (poll.closed || !access.canContribute) return;
    const had = poll.options.find((o) => o.votes.includes(me));
    actions.vote(trip.id, poll.id, optionId);
    saved(had?.id === optionId ? "Vote removed" : had ? "Vote changed" : "Vote cast");
  };
  return (
    <div className="rounded-2xl border border-line bg-card p-4 sm:p-5" data-testid={`poll-card-${poll.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sage-ink">{POLL_LABEL[poll.category]} poll {poll.closed && "· closed"}</p>
          <h3 className="mt-1 font-semibold">{poll.question}</h3>
          <p className="mt-0.5 text-xs text-ink-muted">{voters} of {trip.members.length} voted · by {people[poll.createdBy]?.name.split(" ")[0] ?? "someone"} {ago(poll.createdAt)}</p>
        </div>
        {!compact && access.canModerate(poll.createdBy) && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => { actions.upsert(trip.id, "polls", { ...poll, closed: !poll.closed }, { text: `${poll.closed ? "reopened" : "closed"} the poll “${poll.question}”`, kind: "vote" }); saved(poll.closed ? "Poll reopened" : "Poll closed"); }}
            aria-label={poll.closed ? "Reopen poll" : "Close poll"}
            data-testid={`poll-toggle-close-${poll.id}`}
          >
            {poll.closed ? <Unlock className="size-4" /> : <Lock className="size-4" />}
          </Button>
        )}
      </div>
      <Progress value={(voters / Math.max(1, trip.members.length)) * 100} className="mt-3 h-1" tone="coral" />
      <div className={cn("mt-4 grid gap-2", !compact && poll.options.some((o) => o.image) && "sm:grid-cols-3")}>
        {poll.options.map((o) => {
          const mine = o.votes.includes(me);
          const pct = total ? Math.round((o.votes.length / total) * 100) : 0;
          const leading = o.votes.length === max && max > 0;
          return (
            <button
              key={o.id}
              onClick={() => vote(o.id)}
              disabled={poll.closed || !access.canContribute}
              className={cn("group relative overflow-hidden rounded-xl border text-left transition-[border-color,box-shadow] duration-150", mine ? "border-forest ring-2 ring-forest/15" : access.canContribute ? "border-line hover:border-forest/40" : "border-line", (poll.closed || !access.canContribute) && "cursor-default")}
              aria-pressed={mine}
              data-testid={`poll-option-${o.id}`}
            >
              {o.image && !compact && <img src={o.image} alt={o.label} className="h-24 w-full object-cover" loading="lazy" />}
              <div className="relative p-3">
                <div className="absolute inset-y-0 left-0 bg-sage/70 transition-[width] duration-500" style={{ width: `${pct}%` }} />
                <div className="relative flex items-center gap-2">
                  <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border transition-colors", mine ? "border-forest bg-forest text-white" : "border-line bg-card")}>{mine && <Check className="size-3" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{o.label} {leading && <span className="ml-1 rounded-full bg-coral px-1.5 py-px text-[10px] font-semibold text-white">Leading</span>}</span>
                    {(o.description || o.cost) && <span className="block truncate text-xs text-ink-muted">{o.description}{o.cost ? ` · ~${money(o.cost, trip.currency)}` : ""}</span>}
                  </span>
                  <span className="num text-sm font-semibold" data-testid={`poll-option-votes-${o.id}`}>{o.votes.length}</span>
                </div>
                {o.votes.length > 0 && <div className="relative mt-2 flex -space-x-1.5">{o.votes.map((v) => <Avatar key={v} person={people[v]} size={18} />)}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function NewPollDialog({ trip, open, onOpenChange, onCreated }: { trip: Trip; open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (p: Poll) => void }) {
  const me = useApp((s) => s.user.id);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<PollCategory>("activity");
  const [opts, setOpts] = useState(["", ""]);
  const [err, setErr] = useState<string>();
  const create = () => {
    const clean = opts.map((o) => o.trim()).filter(Boolean);
    if (q.trim().length < 3) return setErr("Add a question");
    if (clean.length < 2) return setErr("Add at least two options");
    const poll: Poll = { id: uid("poll"), question: q.trim(), category: cat, createdBy: me, createdAt: new Date().toISOString(), closed: false, options: clean.map((label) => ({ id: uid("o"), label, votes: [] })) };
    actions.upsert(trip.id, "polls", poll, { text: `started a poll “${poll.question}”`, kind: "vote" }, true);
    onCreated?.(poll);
    saved("Poll created");
    setQ(""); setOpts(["", ""]); setErr(undefined);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-poll-dialog">
        <DialogHeader><DialogTitle>Start a group decision</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <Field label="Question" htmlFor="poll-q" error={err}><Input id="poll-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which hotel should we book?" data-testid="new-poll-question-input" /></Field>
          <Field label="Type">
            <Select value={cat} onValueChange={(v) => setCat(v as PollCategory)}>
              <SelectTrigger className="w-full" data-testid="new-poll-category-select"><SelectValue>{(v) => POLL_LABEL[v as PollCategory]}</SelectValue></SelectTrigger>
              <SelectContent>{Object.entries(POLL_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid gap-2">
            {opts.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} data-testid={`new-poll-option-input-${i}`} />
                {opts.length > 2 && <Button variant="ghost" size="icon" onClick={() => setOpts(opts.filter((_, j) => j !== i))} aria-label="Remove option"><Trash2 className="size-4" /></Button>}
              </div>
            ))}
            {opts.length < 6 && <Button variant="outline" size="sm" className="w-fit" onClick={() => setOpts([...opts, ""])} data-testid="new-poll-add-option-button"><Plus className="size-3.5" /> Add option</Button>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} data-testid="new-poll-create-button">Create poll</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function OverviewTab({ trip, onManageMembers }: { trip: Trip; onManageMembers: () => void }) {
  const access = useTripAccess(trip);
  const me = access.me;
  const [newPoll, setNewPoll] = useState(false);
  const spent = totalSpent(trip);
  const openTasks = trip.tasks.filter((t) => !t.done);
  const today = todayISO();
  const people = Object.fromEntries(trip.members.map((m) => [m.id, m]));
  const status = tripStatus(trip);
  const base = `/app/trips/${trip.id}`;

  return (
    <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
      <div className="grid content-start gap-6">
        {access.canAdmin && !!trip.leaveRequests?.length && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-coral bg-coral-soft p-4 text-sm text-[#8A3B22]" data-testid="leave-requests-notice">
            <span>{trip.leaveRequests.length === 1 ? "Someone has asked to leave this trip." : `${trip.leaveRequests.length} people have asked to leave this trip.`}</span>
            <Button size="sm" variant="outline" onClick={onManageMembers} data-testid="leave-requests-review">Review</Button>
          </section>
        )}
        {access.canAdmin && trip.visibility === "public" && <JoinRequestsPanel trip={trip} />}
        {trip.description && <p className="text-[15px] leading-relaxed text-ink-muted" data-testid="trip-description">{trip.description}</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Trip length" value={`${tripDays(trip)} days`} hint={`${trip.activities.length} activities planned`} testId="overview-stat-length" />
          <Stat label="Spent so far" value={money(spent, trip.currency)} hint={trip.budget ? `of ${money(trip.budget, trip.currency)} budget` : "No budget set"} testId="overview-stat-spent" />
          <Stat label="Open tasks" value={openTasks.length} hint={`${trip.tasks.filter((t) => t.done).length} done`} testId="overview-stat-tasks" />
          <Stat label="Packed" value={`${Math.round((trip.packing.filter((p) => p.packed).length / Math.max(1, trip.packing.length)) * 100)}%`} hint={`${trip.packing.length} items`} testId="overview-stat-packed" />
        </div>
        {(status === "completed" || status === "archived") && (
          <Link to={`${base}/replay`} className="group flex items-center gap-4 overflow-hidden rounded-2xl border border-coral/30 bg-coral-soft p-4 transition-colors hover:bg-[#ffe6dc]" data-testid="overview-replay-banner">
            <div className="flex -space-x-3">{trip.photos.slice(0, 3).map((p) => <img key={p.id} src={p.url} alt="" className="size-12 rounded-xl object-cover ring-2 ring-coral-soft" />)}</div>
            <div className="flex-1"><p className="font-semibold">Relive it with Trip Replay</p><p className="text-sm text-ink-muted">Route, photos, spend and highlights - as a scrapbook.</p></div>
            <ArrowRight className="size-5 text-coral transition-transform group-hover:translate-x-1" />
          </Link>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Vote className="size-4 text-sage-ink" /> Group decisions</h2>
            {access.canContribute && <Button size="sm" variant="outline" className="rounded-lg" onClick={() => setNewPoll(true)} data-testid="overview-new-poll-button"><Plus className="size-3.5" /> New poll</Button>}
          </div>
          {trip.polls.length === 0 ? (
            <EmptyState icon={Vote} title="No decisions to make… yet" body="Start a poll for destinations, dates, hotels or restaurants." action={access.canContribute && <Button onClick={() => setNewPoll(true)} data-testid="overview-empty-new-poll">Start a poll</Button>} />
          ) : (
            <div className="grid gap-4">{trip.polls.map((p) => <PollCard key={p.id} trip={trip} poll={p} />)}</div>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-card">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="text-base font-semibold">Coming up</h2>
            <Link to={`${base}/itinerary`} className="text-sm font-medium text-forest hover:underline" data-testid="overview-itinerary-link">Full itinerary</Link>
          </div>
          {trip.activities.length === 0 ? <p className="px-5 py-8 text-center text-sm text-ink-muted">No activities yet. {access.canContribute && <Link to={`${base}/itinerary`} className="font-medium text-forest">Plan day 1 →</Link>}</p> : (
            <ul className="divide-y">
              {trip.activities.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-center gap-4 px-5 py-3">
                  <span className="num w-14 shrink-0 text-xs font-semibold text-sage-ink">Day {a.day + 1}<br /><span className="font-normal text-ink-muted">{a.start}</span></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.title}</span><span className="block truncate text-xs text-ink-muted">{a.location}</span></span>
                  <AvatarStack people={a.assignees.map((x) => people[x]).filter(Boolean)} size={22} max={3} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid content-start gap-6">
        <section className="rounded-2xl border border-line bg-card" data-testid="overview-members">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Users className="size-4 text-sage-ink" /> Members <span className="num text-ink-muted">{trip.members.length}</span></h2>
            <Button size="sm" variant="ghost" onClick={onManageMembers} data-testid="overview-manage-members-button">{access.canAdmin ? "Manage" : "View"}</Button>
          </div>
          <ul className="grid gap-3 p-5">
            {trip.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3">
                <Avatar person={m} size={34} ring={false} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{m.name}{m.id === me && " (you)"}</span><span className="block text-xs capitalize text-ink-muted">{m.role}</span></span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-line bg-card">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="text-base font-semibold">Open tasks</h2>
            <Link to={`${base}/tasks`} className="text-sm font-medium text-forest hover:underline" data-testid="overview-tasks-link">All tasks</Link>
          </div>
          <ul className="grid gap-3 p-5">
            {openTasks.length === 0 && <li className="text-center text-sm text-ink-muted">All done ✨</li>}
            {openTasks.slice(0, 4).map((t) => (
              <li key={t.id} className="flex items-center gap-3">
                <Avatar person={people[t.assignee]} size={26} ring={false} />
                <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                <span className={cn("text-xs", t.due < today ? "font-medium text-destructive" : "text-ink-muted")}>{t.due < today ? "Overdue" : fmtDate(t.due, "dd MMM")}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-line bg-card" data-testid="trip-activity-feed">
          <h2 className="border-b px-5 py-4 text-base font-semibold">Activity</h2>
          <ul className="grid gap-4 p-5">
            {trip.events.length === 0 && <li className="text-sm text-ink-muted">Nothing yet.</li>}
            {trip.events.slice(0, 8).map((e) => (
              <li key={e.id} className="flex gap-3">
                <Avatar person={people[e.actorId]} size={26} ring={false} />
                <p className="text-[13px] leading-snug"><b className="font-semibold">{e.actorId === me ? "You" : people[e.actorId]?.name.split(" ")[0] ?? "Someone"}</b> {e.text}<span className="block text-xs text-ink-muted">{ago(e.at)}</span></p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <NewPollDialog trip={trip} open={newPoll} onOpenChange={setNewPoll} />
    </div>
  );
}
