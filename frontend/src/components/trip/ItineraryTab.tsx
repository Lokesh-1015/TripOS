import { useEffect, useMemo, useState, type DragEvent } from "react";
import { addDays, format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, BedDouble, CalendarPlus, Clock, Coffee, Flag, GripVertical, MapPin, MessageSquare, Paperclip, Pencil, Plane, Plus, Send, SortAsc, Trash2, Utensils, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarStack, ConfirmDialog, EmptyState, Field, Tip } from "@/components/common";
import { useTripAccess } from "@/lib/access";
import { actions, saved } from "@/lib/store";
import { ago, money, tripDays, uid } from "@/lib/format";
import { overlapsWith } from "@/lib/planning";
import { apiErrorMessage, uploadFile } from "@/lib/api";
import type { Activity, ActivityType, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

const ACTIVITY_TYPES: Record<ActivityType, { label: string; icon: typeof Flag }> = {
  travel: { label: "Travel", icon: Plane },
  activity: { label: "Activity", icon: Flag },
  meal: { label: "Meal", icon: Utensils },
  stay: { label: "Stay", icon: BedDouble },
  free: { label: "Free time", icon: Coffee },
};

const blank = (day: number, members: string[]): Activity => ({ id: "", day, type: "activity", title: "", start: "10:00", end: "11:00", location: "", description: "", cost: 0, notes: "", assignees: members, comments: [], attachments: [] });

function ActivityDialog({ trip, value, onClose }: { trip: Trip; value: Activity | null; onClose: () => void }) {
  const [a, setA] = useState<Activity | null>(value);
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => {
    setA(value);
    setErr({});
  }, [value]);
  if (!a) return null;
  const days = tripDays(trip);
  const clashes = a.end > a.start ? overlapsWith(a, trip.activities) : [];
  const save = () => {
    const e: Record<string, string> = {};
    if (a.title.trim().length < 2) e.title = "Give the activity a title";
    if (a.end <= a.start) e.end = "End time must be after start time";
    if (a.cost < 0 || Number.isNaN(a.cost)) e.cost = "Cost can't be negative";
    setErr(e);
    if (Object.keys(e).length) return;
    const isNew = !a.id;
    const item = { ...a, id: a.id || uid("act"), title: a.title.trim() };
    actions.upsert(trip.id, "activities", item, { text: `${isNew ? "added" : "updated"} “${item.title}” on day ${item.day + 1}`, kind: "itinerary" });
    saved(isNew ? "Activity added" : "Activity updated");
    onClose();
  };
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-testid="activity-dialog">
        <DialogHeader><DialogTitle>{a.id ? "Edit activity" : "Add activity"}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <Field label="Title" htmlFor="act-title" error={err.title}><Input id="act-title" value={a.title} onChange={(e) => setA({ ...a, title: e.target.value })} placeholder="Sunrise hike" data-testid="activity-title-input" /></Field>
          <Field label="Type">
            <Select value={a.type} onValueChange={(v) => setA({ ...a, type: v as ActivityType })}>
              <SelectTrigger className="w-full" data-testid="activity-type-select"><SelectValue>{(v) => ACTIVITY_TYPES[v as ActivityType].label}</SelectValue></SelectTrigger>
              <SelectContent>{Object.entries(ACTIVITY_TYPES).map(([k, t]) => <SelectItem key={k} value={k}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Day">
              <Select value={String(a.day)} onValueChange={(v) => setA({ ...a, day: +v })}>
                <SelectTrigger className="w-full" data-testid="activity-day-select"><SelectValue>{(v) => `Day ${+(v as string) + 1}`}</SelectValue></SelectTrigger>
                <SelectContent>{Array.from({ length: days }, (_, i) => <SelectItem key={i} value={String(i)}>Day {i + 1} · {format(addDays(parseISO(trip.startDate), i), "dd MMM")}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Start" htmlFor="act-start"><Input id="act-start" type="time" value={a.start} onChange={(e) => setA({ ...a, start: e.target.value })} data-testid="activity-start-input" /></Field>
            <Field label="End" htmlFor="act-end" error={err.end}><Input id="act-end" type="time" value={a.end} onChange={(e) => setA({ ...a, end: e.target.value })} data-testid="activity-end-input" /></Field>
          </div>
          <div className="grid grid-cols-[1fr_130px] gap-3">
            <Field label="Location" htmlFor="act-loc"><Input id="act-loc" value={a.location} onChange={(e) => setA({ ...a, location: e.target.value })} data-testid="activity-location-input" /></Field>
            <Field label={`Est. cost (${trip.currency})`} htmlFor="act-cost" error={err.cost}><Input id="act-cost" inputMode="numeric" value={a.cost || ""} onChange={(e) => setA({ ...a, cost: +e.target.value.replace(/[^\d.]/g, "") || 0 })} className="num" data-testid="activity-cost-input" /></Field>
          </div>
          {trip.places.length > 0 && (
            <Field label="Place on the map" hint="Trip Replay follows these, day by day">
              <Select value={a.placeId ?? "none"} onValueChange={(v) => {
                const place = trip.places.find((p) => p.id === v);
                setA({ ...a, placeId: place?.id ?? null, location: a.location || place?.name || "" });
              }}>
                <SelectTrigger className="w-full" data-testid="activity-place-select"><SelectValue>{(v) => trip.places.find((p) => p.id === v)?.name ?? "Not linked"}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked</SelectItem>
                  {trip.places.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          {clashes.length > 0 && <p className="rounded-xl bg-coral-soft px-3 py-2 text-sm text-[#8A3B22]" role="status" data-testid="activity-conflict-warning">This overlaps with {clashes.map((c) => `“${c.title}” (${c.start}-${c.end})`).join(", ")}. You can still save it.</p>}
          <Field label="Description" htmlFor="act-desc"><Textarea id="act-desc" value={a.description} onChange={(e) => setA({ ...a, description: e.target.value })} rows={2} data-testid="activity-description-input" /></Field>
          <Field label="Notes" htmlFor="act-notes"><Input id="act-notes" value={a.notes} onChange={(e) => setA({ ...a, notes: e.target.value })} placeholder="Bring cash, book ahead…" data-testid="activity-notes-input" /></Field>
          <Field label="Who's going">
            <div className="flex flex-wrap gap-2">
              {trip.members.map((m) => {
                const on = a.assignees.includes(m.id);
                return (
                  <label key={m.id} className={cn("flex cursor-pointer items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors", on ? "border-forest bg-sage" : "border-line")}>
                    <Checkbox checked={on} onCheckedChange={(c) => setA({ ...a, assignees: c ? [...a.assignees, m.id] : a.assignees.filter((x) => x !== m.id) })} className="sr-only" data-testid={`activity-assignee-${m.id}`} />
                    <Avatar person={m} size={22} ring={false} /> {m.name.split(" ")[0]}
                  </label>
                );
              })}
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} data-testid="activity-save-button">{a.id ? "Save changes" : "Add to itinerary"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ItineraryTab({ trip }: { trip: Trip }) {
  const { canContribute } = useTripAccess(trip);
  const days = tripDays(trip);
  const [day, setDay] = useState(0);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [deleting, setDeleting] = useState<Activity>();
  const [open, setOpen] = useState<string>();
  const [comment, setComment] = useState("");
  const [dragId, setDragId] = useState<string>();
  const [overId, setOverId] = useState<string>();
  const people = Object.fromEntries(trip.members.map((m) => [m.id, m]));
  const list = useMemo(() => trip.activities.filter((a) => a.day === day), [trip.activities, day]);
  const dayCost = list.reduce((s, a) => s + a.cost, 0);

  const reorder = (next: Activity[]) => {
    actions.reorderActivities(trip.id, day, next.map((a) => a.id));
  };
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[idx], next[j]] = [next[j], next[idx]];
    reorder(next);
  };
  const onDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    const next = list.filter((a) => a.id !== dragId);
    const idx = next.findIndex((a) => a.id === targetId);
    next.splice(idx < 0 ? next.length : list.findIndex((a) => a.id === dragId) < list.findIndex((a) => a.id === targetId) ? idx + 1 : idx, 0, list.find((a) => a.id === dragId)!);
    reorder(next);
    setDragId(undefined);
    setOverId(undefined);
    saved("Itinerary reordered");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      {/* Day navigation */}
      <nav className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0" aria-label="Trip days" data-testid="itinerary-day-nav">
        {Array.from({ length: days }, (_, i) => {
          const date = addDays(parseISO(trip.startDate), i);
          const n = trip.activities.filter((a) => a.day === i).length;
          return (
            <button
              key={i}
              onClick={() => setDay(i)}
              className={cn("flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors duration-150", day === i ? "border-forest bg-forest text-white" : "border-line bg-card hover:border-forest/40")}
              aria-current={day === i}
              data-testid={`itinerary-day-${i}`}
            >
              <span className={cn("num grid size-9 place-items-center rounded-lg text-sm font-semibold", day === i ? "bg-white/15" : "bg-sage text-forest")}>{format(date, "dd")}</span>
              <span>
                <span className="block text-sm font-semibold">Day {i + 1}</span>
                <span className={cn("block text-xs", day === i ? "text-white/75" : "text-ink-muted")}>{format(date, "EEE, MMM")} · {n} plan{n === 1 ? "" : "s"}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Day {day + 1} · {format(addDays(parseISO(trip.startDate), day), "EEEE, dd MMMM")}</h2>
            <p className="text-sm text-ink-muted">{list.length} activities · est. <span className="num">{money(dayCost, trip.currency)}</span> {canContribute && "· drag to reorder"}</p>
          </div>
          <div className="flex gap-2">
            {canContribute && list.length > 1 && (
              <Button variant="outline" className="rounded-xl" onClick={() => { reorder([...list].sort((a, b) => a.start.localeCompare(b.start))); saved("Sorted by start time"); }} data-testid="itinerary-sort-button"><SortAsc className="size-4" /> Sort by time</Button>
            )}
            {canContribute && <Button className="rounded-xl" onClick={() => setEditing(blank(day, trip.members.map((m) => m.id)))} data-testid="itinerary-add-activity-button"><Plus className="size-4" /> Add activity</Button>}
          </div>
        </div>

        {list.length === 0 ? (
          <EmptyState icon={CalendarPlus} title="A blank day - full of possibilities" body="Add a hike, a café, a long lunch or simply ‘rest day’. Your crew will see it instantly." action={canContribute && <Button onClick={() => setEditing(blank(day, trip.members.map((m) => m.id)))} data-testid="itinerary-empty-add">Plan this day</Button>} testId="itinerary-empty-state" />
        ) : (
          <ol className="relative grid gap-3 pl-6 before:absolute before:bottom-4 before:left-[7px] before:top-4 before:w-px before:bg-line" data-testid="itinerary-timeline">
            {list.map((a, idx) => (
              <li
                key={a.id}
                draggable={canContribute}
                onDragStart={() => setDragId(a.id)}
                onDragEnd={() => { setDragId(undefined); setOverId(undefined); }}
                onDragOver={(e) => { e.preventDefault(); setOverId(a.id); }}
                onDrop={(e) => onDrop(e, a.id)}
                className={cn("relative transition-opacity", dragId === a.id && "opacity-40")}
                data-testid={`activity-card-${a.id}`}
              >
                <span className="absolute -left-6 top-5 grid size-[15px] place-items-center rounded-full border-2 border-forest bg-card" />
                <div className={cn("rounded-2xl border bg-card p-4 transition-[border-color,box-shadow] duration-150", overId === a.id && dragId !== a.id ? "border-forest shadow-[0_0_0_3px_rgba(23,76,60,.08)]" : "border-line")}>
                  <div className="flex items-start gap-3">
                    {canContribute && <GripVertical className="mt-0.5 hidden size-4 shrink-0 cursor-grab text-ink-muted sm:block" aria-hidden />}
                    <div className="min-w-0 flex-1">
                      <p className="num flex items-center gap-1.5 text-xs font-semibold text-sage-ink"><Clock className="size-3.5" /> {a.start} - {a.end}
                        <span className="ml-1 inline-flex items-center gap-1 font-sans font-medium" data-testid={`activity-type-${a.id}`}>{(() => { const T = ACTIVITY_TYPES[a.type]; return <><T.icon className="size-3.5" /> {T.label}</>; })()}</span>
                      </p>
                      <h3 className="mt-1 font-semibold">{a.title}</h3>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
                        {a.location && <span className="flex items-center gap-1" data-testid={`activity-location-${a.id}`}><MapPin className={cn("size-3.5", a.placeId && "text-coral")} />{a.location}</span>}
                        {overlapsWith(a, trip.activities).length > 0 && <span className="flex items-center gap-1 font-medium text-[#8A3B22]" data-testid={`activity-conflict-${a.id}`}><Clock className="size-3.5" />Overlaps with {overlapsWith(a, trip.activities).map((c) => c.title).join(", ")}</span>}
                        {a.cost > 0 && <span className="num flex items-center gap-1"><Wallet className="size-3.5" />{money(a.cost, trip.currency)}</span>}
                        {a.attachments.length > 0 && <span className="flex items-center gap-1"><Paperclip className="size-3.5" />{a.attachments.length}</span>}
                        {a.comments.length > 0 && <span className="flex items-center gap-1"><MessageSquare className="size-3.5" />{a.comments.length}</span>}
                      </div>
                      {a.description && <p className="mt-2 text-sm text-ink-muted">{a.description}</p>}
                      {a.notes && <p className="mt-2 rounded-lg bg-[#FFF8E6] px-2.5 py-1.5 text-xs text-[#7A5A12]">📝 {a.notes}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <AvatarStack people={a.assignees.map((x) => people[x]).filter(Boolean)} size={22} max={3} />
                      {canContribute && <div className="flex gap-0.5">
                        <Tip label="Move up"><Button variant="ghost" size="icon-xs" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move up" data-testid={`activity-move-up-${a.id}`}><ArrowUp /></Button></Tip>
                        <Tip label="Move down"><Button variant="ghost" size="icon-xs" onClick={() => move(idx, 1)} disabled={idx === list.length - 1} aria-label="Move down" data-testid={`activity-move-down-${a.id}`}><ArrowDown /></Button></Tip>
                        <Tip label="Edit"><Button variant="ghost" size="icon-xs" onClick={() => setEditing(a)} aria-label="Edit activity" data-testid={`activity-edit-${a.id}`}><Pencil /></Button></Tip>
                        <Tip label="Delete"><Button variant="ghost" size="icon-xs" onClick={() => setDeleting(a)} aria-label="Delete activity" data-testid={`activity-delete-${a.id}`}><Trash2 /></Button></Tip>
                      </div>}
                    </div>
                  </div>
                  <button onClick={() => setOpen(open === a.id ? undefined : a.id)} className="mt-3 text-xs font-medium text-forest hover:underline" data-testid={`activity-toggle-details-${a.id}`}>
                    {open === a.id ? "Hide details" : `Comments & attachments (${a.comments.length + a.attachments.length})`}
                  </button>
                  {open === a.id && (
                    <div className="mt-3 grid gap-3 border-t pt-3 animate-rise">
                      <div className="flex flex-wrap gap-2">
                        {a.attachments.map((f, i) => f.url ? <a key={i} href={f.url} download={f.name} className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs hover:underline" data-testid={`activity-attachment-${a.id}`}><Paperclip className="size-3" />{f.name}</a> : <span key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs"><Paperclip className="size-3" />{f.name}</span>)}
                        {canContribute && <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1 text-xs text-ink-muted hover:text-ink" data-testid={`activity-attach-${a.id}`}>
                          <Plus className="size-3" /> Attach file
                          <input type="file" className="sr-only" onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) void uploadFile(f, { tripId: trip.id, visibility: "shared" }).then(({ url }) => { actions.addAttachment(trip.id, a.id, f.name, url); saved(`${f.name} attached`); }, (error) => toast.error(apiErrorMessage(error)));
                          }} />
                        </label>}
                      </div>
                      {a.comments.map((c) => (
                        <div key={c.id} className="flex gap-2"><Avatar person={people[c.authorId]} size={24} ring={false} /><p className="rounded-xl bg-muted px-3 py-2 text-[13px]"><b>{people[c.authorId]?.name.split(" ")[0]}</b> {c.text}<span className="ml-2 text-[11px] text-ink-muted">{ago(c.at)}</span></p></div>
                      ))}
                      {canContribute && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!comment.trim()) return; actions.addComment(trip.id, a.id, comment.trim(), { text: `commented on “${a.title}”`, kind: "itinerary" }); setComment(""); }}>
                        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" className="h-9" data-testid={`activity-comment-input-${a.id}`} />
                        <Button size="icon" type="submit" className="size-9" aria-label="Post comment" data-testid={`activity-comment-send-${a.id}`}><Send className="size-4" /></Button>
                      </form>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <ActivityDialog trip={trip} value={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)} title={`Delete “${deleting?.title}”?`} body="This removes the activity, its comments and attachments for everyone." confirmLabel="Delete activity" onConfirm={() => { if (deleting) { actions.remove(trip.id, "activities", deleting.id, { text: `removed “${deleting.title}” from the itinerary`, kind: "itinerary" }); saved("Activity deleted"); } }} />
    </div>
  );
}
