import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { ArrowRight, CalendarDays, ImagePlus, Images, MapPin, Play, Share2, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, ConfirmDialog, EmptyState } from "@/components/common";
import { apiErrorMessage, uploadFile } from "@/lib/api";
import { useTripAccess } from "@/lib/access";
import { actions, saved, useApp } from "@/lib/store";
import { CreatePostDialog } from "@/components/posts";
import { tripDays, tripStatus, uid, todayISO } from "@/lib/format";
import type { Photo, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_AT_ONCE = 20;
const NONE = "none";

/** Choosing a date first: review the photos, caption them and say what they're from before they're saved. */
function AddToDateDialog({ trip, files, day, onClose, onSave }: { trip: Trip; files: File[]; day: number; onClose: () => void; onSave: (items: { file: File; caption: string }[], links: { placeId?: string; activityId?: string }) => void }) {
  const [captions, setCaptions] = useState<string[]>(() => files.map(() => ""));
  const [placeId, setPlaceId] = useState(NONE);
  const [activityId, setActivityId] = useState(NONE);
  const [previews] = useState(() => files.map((f) => URL.createObjectURL(f)));
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);
  const activities = trip.activities.filter((a) => a.day === day);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" data-testid="memories-add-dialog">
        <DialogHeader>
          <DialogTitle>Add to {format(addDays(parseISO(trip.startDate), day), "EEEE, dd MMM")}</DialogTitle>
          <DialogDescription>Captions and details are optional.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-3">
              {f.type.startsWith("video") ? <video src={previews[i]} muted className="size-16 shrink-0 rounded-xl object-cover" /> : <img src={previews[i]} alt="" className="size-16 shrink-0 rounded-xl object-cover" />}
              <Input value={captions[i]} maxLength={500} onChange={(e) => setCaptions(captions.map((c, j) => (j === i ? e.target.value : c)))} placeholder="Add a caption" aria-label={`Caption for ${f.name}`} data-testid={`memories-add-caption-${i}`} />
            </div>
          ))}
        </div>
        {(activities.length > 0 || trip.places.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {activities.length > 0 && (
              <Select value={activityId} onValueChange={(v) => setActivityId(v as string)}>
                <SelectTrigger className="w-full" aria-label="Activity" data-testid="memories-add-activity"><SelectValue>{(v) => (v === NONE ? "No activity" : activities.find((a) => a.id === v)?.title)}</SelectValue></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>No activity</SelectItem>{activities.map((a) => <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {trip.places.length > 0 && (
              <Select value={placeId} onValueChange={(v) => setPlaceId(v as string)}>
                <SelectTrigger className="w-full" aria-label="Place" data-testid="memories-add-place"><SelectValue>{(v) => (v === NONE ? "No place" : trip.places.find((p) => p.id === v)?.name)}</SelectValue></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>No place</SelectItem>{trip.places.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(files.map((file, i) => ({ file, caption: captions[i].trim() })), { placeId: placeId === NONE ? undefined : placeId, activityId: activityId === NONE ? undefined : activityId })} data-testid="memories-add-save">Save {files.length > 1 ? `${files.length} memories` : "memory"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MemoriesTab({ trip }: { trip: Trip }) {
  const access = useTripAccess(trip);
  const me = access.me;
  const [album, setAlbum] = useState("All");
  const [view, setView] = useState<Photo>();
  const [sharing, setSharing] = useState<Photo>();
  const emailVerified = useApp((s) => s.emailVerified);
  const [deleting, setDeleting] = useState<Photo>();
  const ref = useRef<HTMLInputElement>(null);
  const people = Object.fromEntries(trip.members.map((m) => [m.id, m]));
  const albums = ["All", ...Array.from(new Set(trip.photos.map((p) => p.album)))];
  const [date, setDate] = useState<number | "all" | "other">("all");
  const [highlightsOnly, setHighlightsOnly] = useState(false);
  const [adding, setAdding] = useState<File[]>();
  const tripLength = tripDays(trip);
  const dates = Array.from({ length: tripLength }, (_, d) => d);
  // A change to the trip's dates can leave photos beyond its last day. They stay easy to find.
  const hasOther = trip.photos.some((p) => p.day >= tripLength);
  const dayTitle = (d: number) => trip.activities.filter((a) => a.day === d).sort((a, b) => a.start.localeCompare(b.start))[0]?.title;
  const photos = trip.photos.filter((p) => (album === "All" || p.album === album) && (!highlightsOnly || p.highlight) && (date === "all" || (date === "other" ? p.day >= tripLength : p.day === date)));
  const hasHighlights = trip.photos.some((p) => p.highlight);
  const days = Array.from(new Set(photos.map((p) => p.day))).sort((a, b) => a - b);
  const status = tripStatus(trip);
  const contributors = Array.from(new Set(trip.photos.map((p) => p.authorId)));
  const viewActivity = view?.activityId ? trip.activities.find((a) => a.id === view.activityId) : undefined;
  const viewPlace = view?.placeId ? trip.places.find((p) => p.id === view.placeId) : undefined;

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    if (typeof date === "number") return setAdding(Array.from(files).slice(0, MAX_AT_ONCE));
    const today = todayISO();
    const day = today < trip.startDate ? 0 : Math.min(tripDays(trip) - 1, Math.max(0, Math.round((parseISO(today).getTime() - parseISO(trip.startDate).getTime()) / 86400000)));
    save(Array.from(files).slice(0, MAX_AT_ONCE).map((file) => ({ file, caption: file.name.replace(/\.[^.]+$/, "") })), day);
  };

  const save = (items: { file: File; caption: string }[], day: number, links: { placeId?: string; activityId?: string } = {}) => {
    const targetAlbum = album === "All" ? "Uploads" : album;
    void Promise.allSettled(items.map(async ({ file: f, caption }) => {
      const { url } = await uploadFile(f, { tripId: trip.id, visibility: "shared", photo: f.type.startsWith("image/") });
      actions.upsert(trip.id, "photos", { id: uid("ph"), url, caption, authorId: me, day, album: targetAlbum, kind: f.type.startsWith("video") ? "video" : "photo", ...links }, { text: "added a photo to Memories", kind: "memory" });
    })).then((results) => {
      const added = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (added) toast.success(`${added} file${added > 1 ? "s" : ""} added`);
      if (failed) toast.error(apiErrorMessage(failed.reason));
    });
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      {(status === "completed" || status === "archived") && (
        <Link to={`/app/trips/${trip.id}/replay`} className="group relative flex min-h-36 items-end overflow-hidden rounded-2xl bg-forest-deep p-5 text-white" data-testid="memories-replay-link">
          {trip.photos[0] && <img src={trip.photos[0].url} alt="" className="absolute inset-0 size-full object-cover opacity-50 transition-transform duration-700 group-hover:scale-105" />}
          <div className="absolute inset-0 bg-gradient-to-r from-forest-deep/90 to-transparent" />
          <div className="relative flex w-full items-end justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-coral">Trip Replay</p><p className="mt-1 text-xl font-semibold">Relive {trip.name} as a scrapbook</p></div>
            <span className="grid size-11 place-items-center rounded-full bg-coral transition-transform group-hover:translate-x-1"><ArrowRight className="size-5" /></span>
          </div>
        </Link>
      )}
      <nav className="no-scrollbar flex gap-2 overflow-x-auto pb-1" aria-label="Trip dates" data-testid="memories-dates">
        <button onClick={() => setDate("all")} className={cn("flex w-24 shrink-0 flex-col justify-between rounded-2xl border p-3 text-left transition-colors", date === "all" ? "border-forest bg-forest text-white" : "border-line bg-card hover:border-forest/40")} data-testid="memories-date-all">
          <CalendarDays className="size-4" />
          <span className="mt-3 text-sm font-semibold">All dates</span>
        </button>
        {dates.map((d) => {
          const count = trip.photos.filter((p) => p.day === d).length;
          return (
            <button key={d} onClick={() => setDate(d)} className={cn("flex w-36 shrink-0 flex-col rounded-2xl border p-3 text-left transition-colors", date === d ? "border-forest bg-forest text-white" : "border-line bg-card hover:border-forest/40")} data-testid={`memories-date-${d}`}>
              <span className="text-sm font-semibold">{format(addDays(parseISO(trip.startDate), d), "dd MMMM")}</span>
              <span className={cn("mt-0.5 truncate text-xs", date === d ? "text-white/80" : "text-ink-muted")}>{dayTitle(d) ?? `Day ${d + 1}`}</span>
              <span className={cn("num mt-1.5 text-xs", date === d ? "text-white/80" : "text-ink-muted")} data-testid={`memories-date-count-${d}`}>{count === 1 ? "1 memory" : `${count} memories`}</span>
            </button>
          );
        })}
        {hasOther && (
          <button onClick={() => setDate("other")} className={cn("flex w-28 shrink-0 flex-col justify-between rounded-2xl border p-3 text-left transition-colors", date === "other" ? "border-forest bg-forest text-white" : "border-line bg-card hover:border-forest/40")} data-testid="memories-date-other">
            <Images className="size-4" />
            <span className="mt-3 text-sm font-semibold">Other photos</span>
          </button>
        )}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
          {hasHighlights && (
            <button onClick={() => setHighlightsOnly(!highlightsOnly)} aria-pressed={highlightsOnly} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors", highlightsOnly ? "border-coral bg-coral text-white" : "border-line bg-card text-ink-muted hover:text-ink")} data-testid="memories-highlights">
              <Star className="size-3.5" /> Highlights
            </button>
          )}
          {albums.map((a) => (
            <button key={a} onClick={() => setAlbum(a)} className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors", album === a ? "border-forest bg-forest text-white" : "border-line bg-card text-ink-muted hover:text-ink")} data-testid={`memories-album-${a.toLowerCase().replace(/\s+/g, "-")}`}>
              {a} <span className="num opacity-70">{a === "All" ? trip.photos.length : trip.photos.filter((p) => p.album === a).length}</span>
            </button>
          ))}
        </div>
        {contributors.length > 0 && <span className="hidden items-center gap-2 text-xs text-ink-muted sm:flex">{contributors.length} contributors <span className="flex -space-x-1.5">{contributors.map((c) => <Avatar key={c} person={people[c]} size={22} />)}</span></span>}
        {access.canContribute && <Button className="rounded-xl" onClick={() => ref.current?.click()} data-testid="memories-upload-button"><ImagePlus className="size-4" /> Upload</Button>}
        <input ref={ref} type="file" accept="image/*,video/*" multiple className="sr-only" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} data-testid="memories-file-input" />
      </div>

      {photos.length === 0 ? (
        <EmptyState icon={Images} title={typeof date === "number" ? `Nothing from ${format(addDays(parseISO(trip.startDate), date), "dd MMMM")} yet` : status === "upcoming" ? "Memories start here" : "No photos yet"} body={typeof date === "number" ? "Add the first photos from this day." : status === "upcoming" ? "Once the trip begins, everyone's photos land in one shared gallery." : "Upload the first photo from the trip."} testId="memories-empty-state" />
      ) : (
        days.map((d) => (
          <section key={d} data-testid={`memories-day-${d}`}>
            <h3 className="mb-3 text-sm font-semibold">{d >= tripLength ? "Other photos" : <>Day {d + 1} <span className="font-normal text-ink-muted">· {format(addDays(parseISO(trip.startDate), d), "EEEE, dd MMM")}{dayTitle(d) ? ` · ${dayTitle(d)}` : ""}</span></>}</h3>
            <div className="grid auto-rows-[150px] grid-cols-2 gap-3 sm:auto-rows-[180px] md:grid-cols-4">
              {photos.filter((p) => p.day === d).map((p, i) => (
                <button key={p.id} onClick={() => setView(p)} className={cn("group relative overflow-hidden rounded-2xl bg-muted", i % 5 === 0 && "col-span-2 row-span-2")} data-testid={`memory-photo-${p.id}`}>
                  {p.kind === "video" ? <video src={p.url} preload="metadata" muted className="size-full object-cover" /> : <img src={p.url} alt={p.caption} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" loading="lazy" />}
                  {p.highlight && <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-coral text-white" title="Highlight"><Star className="size-3.5" /></span>}
                  {p.kind === "video" && <span className="absolute inset-0 grid place-items-center"><span className="grid size-12 place-items-center rounded-full bg-black/45 text-white backdrop-blur"><Play className="size-5 translate-x-px" /></span></span>}
                  <span className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/60 to-transparent p-2.5 text-left text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <Avatar person={people[p.authorId]} size={20} ring={false} /> <span className="truncate">{p.caption}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(undefined)}>
        <DialogContent className="max-w-3xl p-0 sm:max-w-3xl" data-testid="memory-lightbox">
          {view && (
            <>
              <div className="relative">
                {view.kind === "video" ? <video src={view.url} controls className="max-h-[70dvh] w-full rounded-t-xl" /> : <img src={view.url} alt={view.caption} className="max-h-[70dvh] w-full rounded-t-xl object-cover" />}
              </div>
              <div className="flex items-center gap-3 p-4">
                <Avatar person={people[view.authorId]} size={32} ring={false} />
                <div className="min-w-0 flex-1">
                  {access.canModerate(view.authorId) ? (<>
                    <Input value={view.caption} maxLength={500} placeholder="Add a caption" onChange={(e) => setView({ ...view, caption: e.target.value })} onBlur={() => actions.upsert(trip.id, "photos", view)} className="h-8" aria-label="Caption" data-testid="memory-caption-input" />
                    <DialogTitle className="sr-only">{view.caption || "Photo"}</DialogTitle></>
                  ) : (
                    <DialogTitle className="text-sm">{view.caption}</DialogTitle>
                  )}
                  <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs">
                    {people[view.authorId]?.name ?? "Former member"} · Day {view.day + 1} · {view.album}
                    {viewActivity && <span data-testid="memory-activity">· {viewActivity.title}</span>}
                    {viewPlace && <span className="inline-flex items-center gap-0.5" data-testid="memory-place">· <MapPin className="size-3" /> {viewPlace.name}</span>}
                  </DialogDescription>
                </div>
                {view.authorId === me && view.kind === "photo" && emailVerified && <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setSharing(view); setView(undefined); }} data-testid="memory-share-as-post"><Share2 className="size-3.5" /> Share as post</Button>}
                {access.canModerate(view.authorId) && <Button variant="ghost" size="icon-sm" aria-pressed={!!view.highlight} onClick={() => { const next = { ...view, highlight: !view.highlight }; setView(next); actions.upsert(trip.id, "photos", next); }} aria-label={view.highlight ? "Remove highlight" : "Mark as highlight"} data-testid="memory-highlight-button"><Star className={cn(view.highlight && "fill-coral text-coral")} /></Button>}
                {access.canModerate(view.authorId) && <Button variant="ghost" size="icon-sm" onClick={() => { setDeleting(view); setView(undefined); }} aria-label="Delete photo" data-testid="memory-delete-button"><Trash2 /></Button>}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {sharing && <CreatePostDialog open onClose={() => setSharing(undefined)} defaultVisibility="friends" memory={{ photoId: sharing.id, url: sharing.url, caption: sharing.caption, tripId: trip.id }} />}
      {adding && typeof date === "number" && <AddToDateDialog trip={trip} files={adding} day={date} onClose={() => setAdding(undefined)} onSave={(items, links) => { setAdding(undefined); save(items, date, links); }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)} title="Delete this photo?" body="It will be removed from the shared gallery for everyone." confirmLabel="Delete photo" onConfirm={() => { if (deleting) { actions.remove(trip.id, "photos", deleting.id); saved("Photo deleted"); } }} />
    </div>
  );
}
