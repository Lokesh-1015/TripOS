import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { ArrowRight, ImagePlus, Images, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Avatar, ConfirmDialog, EmptyState } from "@/components/common";
import { apiErrorMessage, uploadFile } from "@/lib/api";
import { useTripAccess } from "@/lib/access";
import { actions, saved } from "@/lib/store";
import { tripDays, tripStatus, uid, todayISO } from "@/lib/format";
import type { Photo, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function MemoriesTab({ trip }: { trip: Trip }) {
  const access = useTripAccess(trip);
  const me = access.me;
  const [album, setAlbum] = useState("All");
  const [view, setView] = useState<Photo>();
  const [deleting, setDeleting] = useState<Photo>();
  const ref = useRef<HTMLInputElement>(null);
  const people = Object.fromEntries(trip.members.map((m) => [m.id, m]));
  const albums = ["All", ...Array.from(new Set(trip.photos.map((p) => p.album)))];
  const photos = trip.photos.filter((p) => album === "All" || p.album === album);
  const days = Array.from(new Set(photos.map((p) => p.day))).sort((a, b) => a - b);
  const status = tripStatus(trip);
  const contributors = Array.from(new Set(trip.photos.map((p) => p.authorId)));

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    const today = todayISO();
    const day = today < trip.startDate ? 0 : Math.min(tripDays(trip) - 1, Math.max(0, Math.round((parseISO(today).getTime() - parseISO(trip.startDate).getTime()) / 86400000)));
    const targetAlbum = album === "All" ? "Uploads" : album;
    void Promise.allSettled(Array.from(files).slice(0, 10).map(async (f) => {
      const { url } = await uploadFile(f, { tripId: trip.id, visibility: "shared", photo: f.type.startsWith("image/") });
      actions.upsert(trip.id, "photos", { id: uid("ph"), url, caption: f.name.replace(/\.[^.]+$/, ""), authorId: me, day, album: targetAlbum, kind: f.type.startsWith("video") ? "video" : "photo" }, { text: "added a photo to Memories", kind: "memory" });
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
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
        <EmptyState icon={Images} title={status === "upcoming" ? "Memories start here" : "No photos yet"} body={status === "upcoming" ? "Once the trip begins, everyone's photos land in one shared gallery." : "Upload the first photo from the trip."} action={access.canContribute && <Button onClick={() => ref.current?.click()} data-testid="memories-empty-upload">Upload photos</Button>} testId="memories-empty-state" />
      ) : (
        days.map((d) => (
          <section key={d} data-testid={`memories-day-${d}`}>
            <h3 className="mb-3 text-sm font-semibold">Day {d + 1} <span className="font-normal text-ink-muted">· {format(addDays(parseISO(trip.startDate), d), "EEEE, dd MMM")}</span></h3>
            <div className="grid auto-rows-[150px] grid-cols-2 gap-3 sm:auto-rows-[180px] md:grid-cols-4">
              {photos.filter((p) => p.day === d).map((p, i) => (
                <button key={p.id} onClick={() => setView(p)} className={cn("group relative overflow-hidden rounded-2xl bg-muted", i % 5 === 0 && "col-span-2 row-span-2")} data-testid={`memory-photo-${p.id}`}>
                  {p.kind === "video" ? <video src={p.url} preload="metadata" muted className="size-full object-cover" /> : <img src={p.url} alt={p.caption} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" loading="lazy" />}
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
                <div className="flex-1"><DialogTitle className="text-sm">{view.caption}</DialogTitle><DialogDescription className="text-xs">{people[view.authorId]?.name ?? "Former member"} · Day {view.day + 1} · {view.album}</DialogDescription></div>
                {access.canModerate(view.authorId) && <Button variant="ghost" size="icon-sm" onClick={() => { setDeleting(view); setView(undefined); }} aria-label="Delete photo" data-testid="memory-delete-button"><Trash2 /></Button>}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)} title="Delete this photo?" body="It will be removed from the shared gallery for everyone." confirmLabel="Delete photo" onConfirm={() => { if (deleting) { actions.remove(trip.id, "photos", deleting.id); saved("Photo deleted"); } }} />
    </div>
  );
}
