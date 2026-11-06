import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Archive, ArchiveRestore, CalendarDays, ChevronLeft, Copy, CopyPlus, LogOut, MapPin, MoreHorizontal, Pencil, Play, Share2, Trash2, UserPlus, Users } from "lucide-react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { toast } from "sonner";
import { apiErrorMessage, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarStack, ConfirmDialog, Field, StatusBadge, Tip } from "@/components/common";
import { useTripAccess } from "@/lib/access";
import { actions, inviteLink, saved, useApp, useTrip } from "@/lib/store";
import { CURRENCIES, daysUntil, fmtRange, hasAmounts, isTripFull, joinedCount, tripStatus, uid } from "@/lib/format";
import { ParticipantLimitField, participantLimitError } from "@/components/trip/ParticipantLimitField";
import { TripVisibilityFields, type VisibilityDraft } from "@/components/trip/TripVisibilityFields";
import { LeaveRequestActions, LeaveTripDialog } from "@/components/trip/LeaveTrip";
import { InvitePeople, type PickedPerson } from "@/components/trip/InvitePeople";
import type { Member, Role, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";
import OverviewTab from "@/components/trip/OverviewTab";
import ItineraryTab from "@/components/trip/ItineraryTab";
import ExpensesTab from "@/components/trip/ExpensesTab";
import TasksTab from "@/components/trip/TasksTab";
import PackingTab from "@/components/trip/PackingTab";
import DocumentsTab from "@/components/trip/DocumentsTab";
import MapTab from "@/components/trip/MapTab";
import ChatTab from "@/components/trip/ChatTab";
import MemoriesTab from "@/components/trip/MemoriesTab";

const TABS = [
  ["overview", "Overview"], ["itinerary", "Itinerary"], ["expenses", "Expenses"], ["tasks", "Tasks"], ["packing", "Packing"],
  ["documents", "Documents"], ["map", "Map"], ["chat", "Chat"], ["memories", "Memories"],
] as const;
type TabKey = (typeof TABS)[number][0];

function MembersDialog({ trip, open, onOpenChange }: { trip: Trip; open: boolean; onOpenChange: (o: boolean) => void }) {
  const access = useTripAccess(trip);
  const me = access.me;
  const emailVerified = useApp((s) => s.emailVerified);
  const emailEnabled = useApp((s) => s.emailEnabled);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string>();
  const [removing, setRemoving] = useState<Member>();
  const [inviting, setInviting] = useState<string>();
  const full = isTripFull(trip);
  const onTrip = new Set(trip.members.map((m) => m.id));
  const invitePerson = (p: PickedPerson) => {
    if (full) return toast.error("This trip is full. Raise the limit to invite more people.");
    setInviting(p.id);
    void apiPost(`/trips/${trip.id}/members`, { userId: p.id })
      .then(() => { saved(`${p.name} invited`, { description: "They'll see the invitation in TripOS." }); return actions.refreshTrip(trip.id); }, (error) => toast.error(apiErrorMessage(error)))
      .finally(() => setInviting(undefined));
  };
  const link = inviteLink(trip);
  const invite = () => {
    if (full) return setErr("This trip is full. Raise the limit to invite more people.");
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setErr("Enter a valid email address");
    if (trip.members.some((m) => m.email === v)) return setErr("This person is already on the trip");
    const m: Member = { id: uid("p"), name: v.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), email: v, avatar: "", role: "member", status: "invited" };
    actions.upsert(trip.id, "members", m, { text: `invited ${m.name}`, kind: "member" });
    saved(`${m.name} invited`, { description: "We've emailed them an invitation." });
    setEmail("");
    setErr(undefined);
  };
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg" data-testid="members-dialog">
          <DialogHeader>
            <DialogTitle>Trip members</DialogTitle>
            <DialogDescription>{access.canAdmin ? "Invite people, change roles or remove members." : "Everyone on this trip."}</DialogDescription>
          </DialogHeader>
          {access.canAdmin && !emailVerified && <p className="rounded-xl bg-coral-soft px-3 py-2 text-sm text-[#8A3B22]" data-testid="members-verify-note">{emailEnabled ? "Verify your email to invite people by email. You can still share the link below." : "Email invites aren't available yet. Share the link below instead."}</p>}
          {full && <p className="rounded-xl bg-coral-soft px-3 py-2 text-sm text-[#8A3B22]" data-testid="members-full-note">This trip is full, so nobody new can join, even with the link. {access.canAdmin ? "Raise the limit in Edit trip to make room." : ""}</p>}
          {access.canAdmin && emailVerified && <Field label="Invite travellers">
            <InvitePeople added={onTrip} busyId={inviting} onPick={invitePerson} />
          </Field>}
          {access.canAdmin && emailVerified && <Field label="Or invite someone new by email" htmlFor="inv-email" error={err}>
            <div className="flex gap-2">
              <Input id="inv-email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && invite()} placeholder="friend@email.com" className="h-10 rounded-xl" data-testid="members-invite-email-input" />
              <Button onClick={invite} className="h-10 rounded-xl" data-testid="members-invite-send-button">Invite</Button>
            </div>
          </Field>}
          {link && (
            <button onClick={() => { void navigator.clipboard?.writeText(link).catch(() => {}); toast.success("Invite link copied", { description: "Anyone with the link can join." }); }} className="flex items-center gap-2 rounded-xl bg-muted/70 px-3 py-2 text-left text-sm text-ink-muted hover:bg-muted" data-testid="members-copy-link-button">
              <Copy className="size-4" /> <span className="truncate">{link}</span>
            </button>
          )}
          <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
            {trip.members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-0" data-testid={`member-row-${m.id}`}>
                <Avatar person={m} size={34} ring={false} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{m.name}{m.id === me && " (you)"}</p><p className="truncate text-xs text-ink-muted">{m.status === "invited" ? `Invited${m.email ? ` · ${m.email}` : ""}` : m.email}</p>{access.canAdmin && <LeaveRequestActions trip={trip} member={m} />}</div>
                <Select value={m.role} onValueChange={(v) => { actions.upsert(trip.id, "members", { ...m, role: v as Role }); saved(`${m.name.split(" ")[0]} is now ${v}`); }} disabled={!access.canManageMember(m)}>
                  <SelectTrigger size="sm" className="w-28 rounded-lg capitalize" data-testid={`member-role-select-${m.id}`}><SelectValue>{(v) => <span className="capitalize">{v as string}</span>}</SelectValue></SelectTrigger>
                  <SelectContent>{access.grantableRoles.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}</SelectContent>
                </Select>
                {access.canManageMember(m) && (
                  <button onClick={() => setRemoving(m)} className="rounded-md p-1.5 text-ink-muted hover:bg-muted hover:text-destructive" aria-label={`Remove ${m.name}`} data-testid={`member-remove-${m.id}`}><Trash2 className="size-4" /></button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(undefined)}
        title={`Remove ${removing?.name}?`}
        body="They'll lose access to this trip. Expenses they're part of stay in the history."
        confirmLabel="Remove member"
        onConfirm={() => {
          if (!removing) return;
          actions.remove(trip.id, "members", removing.id, { text: `removed ${removing.name}`, kind: "member" });
          saved(`${removing.name} removed`);
        }}
      />
    </>
  );
}

/** Takes the plan and packing lists into a new trip, leaving the people and money behind. */
function CopyTripDialog({ trip, open, onOpenChange }: { trip: Trip; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(`${trip.name} again`);
  const [startDate, setStartDate] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (name.trim().length < 3) return setErr("Name must be at least 3 characters");
    if (!startDate) return setErr("Pick a start date");
    setErr(undefined);
    setBusy(true);
    try {
      const id = await actions.copyTrip(trip.id, { id: uid("trip"), name: name.trim(), startDate });
      onOpenChange(false);
      toast.success("New trip created from this one");
      navigate(`/app/trips/${id}`);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="copy-trip-dialog">
        <DialogHeader>
          <DialogTitle>Start a new trip from this one</DialogTitle>
          <DialogDescription>Brings the itinerary, map places, budget and packing lists. Members, expenses, tasks, chat, documents and photos stay here. You'll be the owner.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Trip name" htmlFor="copy-name"><Input id="copy-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="copy-trip-name-input" /></Field>
          <Field label="Starts on" htmlFor="copy-start" error={err}><Input id="copy-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="copy-trip-start-input" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={() => void create()} data-testid="copy-trip-submit">{busy ? "Creating..." : "Create trip"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTripDialog({ trip, open, onOpenChange }: { trip: Trip; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [f, setF] = useState({ name: trip.name, destination: trip.destination, description: trip.description, startDate: trip.startDate, endDate: trip.endDate, budget: String(trip.budget || ""), currency: trip.currency });
  const [err, setErr] = useState<Record<string, string>>({});
  const joined = joinedCount(trip);
  const [limit, setLimit] = useState({ enabled: trip.maxParticipants != null, value: trip.maxParticipants == null ? "" : String(trip.maxParticipants) });
  const emailVerified = useApp((s) => s.emailVerified);
  const sharingOf = (t: Trip): VisibilityDraft => ({ visibility: t.visibility ?? "private", category: t.category ?? "", travelStyle: t.travelStyle ?? "", showBudget: !!t.showBudget, showPlan: !!t.showPlan });
  const [sharing, setSharing] = useState<VisibilityDraft>(() => sharingOf(trip));
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (open) setSharing(sharingOf(trip));
    if (open) setLimit({ enabled: trip.maxParticipants != null, value: trip.maxParticipants == null ? "" : String(trip.maxParticipants) });
    if (open) setF({ name: trip.name, destination: trip.destination, description: trip.description, startDate: trip.startDate, endDate: trip.endDate, budget: String(trip.budget || ""), currency: trip.currency });
    // Only when it opens: a live update arriving while someone types must not wipe what they've typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = (confirmed = false) => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 3) e.name = "Name must be at least 3 characters";
    if (!f.destination.trim()) e.destination = "Destination is required";
    if (!f.startDate || !f.endDate || f.endDate < f.startDate) e.endDate = "End date must be on or after the start date";
    else {
      const left = trip.activities.filter((a) => a.day >= differenceInCalendarDays(parseISO(f.endDate), parseISO(f.startDate)) + 1).length;
      if (left) e.endDate = `${left} planned ${left === 1 ? "activity is" : "activities are"} after these dates. Move or delete ${left === 1 ? "it" : "them"} first.`;
    }
    const limitProblem = participantLimitError(limit.enabled, limit.value, joined);
    if (limitProblem) e.maxParticipants = limitProblem;
    setErr(e);
    if (Object.keys(e).length) return;
    // Changing who can find a trip is explained first, so nothing is exposed by accident.
    if (sharing.visibility !== (trip.visibility ?? "private") && !confirmed) return setConfirming(true);
    setConfirming(false);
    actions.patchTrip(trip.id, { ...f, name: f.name.trim(), budget: +f.budget || 0, maxParticipants: limit.enabled ? +limit.value : null, ...sharing }, sharing.visibility !== (trip.visibility ?? "private") ? (sharing.visibility === "public" ? "made the trip public" : "made the trip private") : "updated trip details");
    saved("Trip details saved");
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-lg" data-testid="edit-trip-dialog">
        <DialogHeader><DialogTitle>Edit trip</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <Field label="Trip name" htmlFor="et-name" error={err.name}><Input id="et-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="edit-trip-name-input" /></Field>
          <Field label="Destination" htmlFor="et-dest" error={err.destination}><Input id="et-dest" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} data-testid="edit-trip-destination-input" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start" htmlFor="et-s"><Input id="et-s" type="date" value={f.startDate} onChange={(e) => { const startDate = e.target.value; setF({ ...f, startDate, ...(startDate && f.endDate < startDate ? { endDate: startDate } : {}) }); }} data-testid="edit-trip-start-input" /></Field>
            <Field label="End" htmlFor="et-e" error={err.endDate}><Input id="et-e" type="date" min={f.startDate || undefined} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} data-testid="edit-trip-end-input" /></Field>
          </div>
          <div className="grid grid-cols-[1fr_150px] gap-3">
            <Field label="Budget" htmlFor="et-b"><Input id="et-b" inputMode="numeric" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value.replace(/[^\d.]/g, "") })} className="num" data-testid="edit-trip-budget-input" /></Field>
            <Field label="Currency">
              <Select value={f.currency} disabled={hasAmounts(trip)} onValueChange={(v) => setF({ ...f, currency: v as string })}>
                <SelectTrigger className="w-full" data-testid="edit-trip-currency-select"><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Description" htmlFor="et-d"><Textarea id="et-d" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid="edit-trip-description-input" /></Field>
          <TripVisibilityFields value={sharing} canPublish={emailVerified} onChange={(next) => { setSharing(next); setConfirming(false); }} />
          <ParticipantLimitField enabled={limit.enabled} value={limit.value} minimum={joined} error={err.maxParticipants} onChange={setLimit} />
        </div>
        {confirming && (
          <div className="grid gap-3 rounded-xl border border-coral bg-coral-soft p-4 text-sm text-[#8A3B22]" role="alertdialog" aria-label="Change who can find this trip?" data-testid="visibility-confirm">
            <p className="font-semibold">{sharing.visibility === "public" ? "Make this trip public?" : "Make this trip private?"}</p>
            <p>{sharing.visibility === "public" ? "It will appear in Explore, showing only its name, destination, dates, description and what you've chosen above. People can ask to join, and nobody joins without your approval. Anyone you accept can see everything shared on the trip." : "This removes it from public discovery, and from any links to its public page. Waiting requests stay unanswered."} Existing participants stay unless you remove them.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)} data-testid="visibility-confirm-no">Not now</Button>
              <Button onClick={() => save(true)} data-testid="visibility-confirm-yes">{sharing.visibility === "public" ? "Make public" : "Make private"}</Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="edit-trip-cancel-button">Cancel</Button>
          <Button onClick={() => save()} data-testid="edit-trip-save-button">Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TripWorkspace() {
  const { id, tab = "overview" } = useParams();
  const trip = useTrip(id);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [members, setMembers] = useState(params.get("invite") === "1");
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const access = useTripAccess(trip ?? { members: [] });

  useEffect(() => {
    if (params.get("invite") === "1") {
      setMembers(true);
      params.delete("invite");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  if (!trip) return <Navigate to="/app/trips" replace />;
  if (!TABS.some(([k]) => k === tab)) return <Navigate to={`/app/trips/${trip.id}`} replace />;
  const status = tripStatus(trip);
  const until = daysUntil(trip.startDate);
  const share = () => {
    const link = inviteLink(trip);
    if (!link) return toast.error("Only the trip's owner and admins can share the invite link");
    void navigator.clipboard?.writeText(link).catch(() => {});
    toast.success("Invite link copied", { description: "Anyone with the link can join this trip." });
  };

  return (
    <div>
      <Link to="/app/trips" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink" data-testid="trip-back-to-trips"><ChevronLeft className="size-4" /> My Trips</Link>
      {/* Header */}
      <section className="relative overflow-hidden rounded-3xl bg-forest-deep text-white" data-testid="trip-header">
        <img src={trip.cover} alt={trip.destination} className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/10" />
        <div className="relative flex min-h-[220px] flex-col justify-end gap-4 p-5 sm:min-h-[260px] sm:p-7 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={status} className="bg-white/95" />
              {trip.visibility === "public" && <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold text-white" data-testid="trip-header-public">Public</span>}
              {trip.maxParticipants != null && <span className={cn("num rounded-full px-2.5 py-0.5 text-xs font-semibold", isTripFull(trip) ? "bg-white text-forest" : "bg-white/20 text-white")} data-testid="trip-header-capacity">{isTripFull(trip) ? "Trip Full" : `${joinedCount(trip)} of ${trip.maxParticipants} joined`}</span>}
              {status === "upcoming" && <span className="num rounded-full bg-coral px-2.5 py-0.5 text-xs font-semibold" data-testid="trip-header-countdown">{until} day{until === 1 ? "" : "s"} to go</span>}
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-[32px]" data-testid="trip-header-name">{trip.name}</h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/85">
              <span className="flex items-center gap-1.5"><MapPin className="size-4" />{trip.destination}</span>
              <span className="flex items-center gap-1.5"><CalendarDays className="size-4" />{fmtRange(trip.startDate, trip.endDate)}{trip.flexibleDates && " · flexible"}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setMembers(true)} className="mr-1 rounded-full" aria-label="Manage members" data-testid="trip-header-members-button"><AvatarStack people={trip.members} size={32} max={5} /></button>
            <Button onClick={() => setMembers(true)} className="h-9 rounded-xl bg-white text-forest hover:bg-sage" data-testid="trip-invite-button">{access.canAdmin ? <><UserPlus className="size-4" /> Invite</> : <><Users className="size-4" /> Members</>}</Button>
            {access.canAdmin && <Tip label="Edit trip"><Button size="icon" onClick={() => setEdit(true)} className="size-9 rounded-xl bg-white/15 text-white backdrop-blur hover:bg-white/25" aria-label="Edit trip" data-testid="trip-edit-button"><Pencil className="size-4" /></Button></Tip>}
            <Tip label="Use as a template"><Button size="icon" onClick={() => setCopying(true)} className="size-9 rounded-xl bg-white/15 text-white backdrop-blur hover:bg-white/25" aria-label="Use as a template" data-testid="trip-copy-button"><CopyPlus className="size-4" /></Button></Tip>
            {access.canAdmin && <Tip label="Share"><Button size="icon" onClick={share} className="size-9 rounded-xl bg-white/15 text-white backdrop-blur hover:bg-white/25" aria-label="Share trip" data-testid="trip-share-button"><Share2 className="size-4" /></Button></Tip>}
            <DropdownMenu>
              <DropdownMenuTrigger className="grid size-9 place-items-center rounded-xl bg-white/15 backdrop-blur transition-colors hover:bg-white/25" aria-label="More actions" data-testid="trip-more-menu-button"><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {(status === "completed" || status === "archived") && <DropdownMenuItem onClick={() => navigate(`/app/trips/${trip.id}/replay`)} data-testid="trip-menu-replay"><Play /> Trip Replay</DropdownMenuItem>}
                {access.canAdmin && <DropdownMenuItem
                  onClick={() => { actions.patchTrip(trip.id, { archived: !trip.archived }, trip.archived ? "restored the trip" : "archived the trip"); saved(trip.archived ? "Trip restored" : "Trip archived"); }}
                  data-testid="trip-menu-archive"
                >
                  {trip.archived ? <><ArchiveRestore /> Restore trip</> : <><Archive /> Archive trip</>}
                </DropdownMenuItem>}
                <DropdownMenuItem onClick={() => setLeaving(true)} data-testid="trip-menu-leave"><LogOut /> {trip.leaveRequests?.some((r) => r.userId === access.me) ? "Leave request sent" : "Leave trip"}</DropdownMenuItem>
                {access.isOwner && <DropdownMenuSeparator />}
                {access.isOwner && <DropdownMenuItem variant="destructive" onClick={() => setDel(true)} data-testid="trip-menu-delete"><Trash2 /> Delete trip</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <nav className="no-scrollbar sticky top-16 z-10 -mx-4 mt-4 flex gap-1 overflow-x-auto border-b border-line bg-background/90 px-4 backdrop-blur sm:mx-0 sm:px-0" aria-label="Trip sections" data-testid="trip-tabs">
        {TABS.map(([k, label]) => (
          <NavLink
            key={k}
            to={k === "overview" ? `/app/trips/${trip.id}` : `/app/trips/${trip.id}/${k}`}
            end
            className={({ isActive }) => cn("relative shrink-0 px-3 py-3 text-sm font-medium transition-colors duration-150", isActive ? "text-forest" : "text-ink-muted hover:text-ink")}
            data-testid={`trip-tab-${k}`}
          >
            {({ isActive }) => (
              <>
                {label}
                {isActive && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-forest" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6 animate-rise" key={tab}>
        {(() => {
          switch (tab as TabKey) {
            case "itinerary": return <ItineraryTab trip={trip} />;
            case "expenses": return <ExpensesTab trip={trip} />;
            case "tasks": return <TasksTab trip={trip} />;
            case "packing": return <PackingTab trip={trip} />;
            case "documents": return <DocumentsTab trip={trip} />;
            case "map": return <MapTab trip={trip} />;
            case "chat": return <ChatTab trip={trip} />;
            case "memories": return <MemoriesTab trip={trip} />;
            default: return <OverviewTab trip={trip} onManageMembers={() => setMembers(true)} />;
          }
        })()}
      </div>

      <MembersDialog trip={trip} open={members} onOpenChange={setMembers} />
      <EditTripDialog trip={trip} open={edit} onOpenChange={setEdit} />
      {leaving && <LeaveTripDialog trip={trip} open onClose={() => setLeaving(false)} onDeleteTrip={() => setDel(true)} />}
      <CopyTripDialog trip={trip} open={copying} onOpenChange={setCopying} />
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={`Delete “${trip.name}”?`}
        body="This permanently removes the trip, its itinerary, expenses, documents and chat for everyone. This can't be undone."
        confirmLabel="Delete trip"
        onConfirm={() => { actions.deleteTrip(trip.id); saved("Trip deleted"); navigate("/app/trips"); }}
      />
    </div>
  );
}
