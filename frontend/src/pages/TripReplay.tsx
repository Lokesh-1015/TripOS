import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ChevronLeft, Images, MapPin, Pause, Play, Sparkles, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarStack, Progress } from "@/components/common";
import { MapFallback } from "@/components/trip/MapTab";
import { useTripAccess } from "@/lib/access";
import { routeStops } from "@/lib/planning";
import { actions, saved, useTrip } from "@/lib/store";
import { CATEGORY_COLOR, CATEGORY_LABEL, fmtRange, money, round2, totalSpent, tripDays, tripStatus } from "@/lib/format";
import type { ExpenseCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

const TripMap = lazy(() => import("@/components/trip/TripMap"));

export default function TripReplay() {
  const { id } = useParams();
  const trip = useTrip(id);
  const reduce = useReducedMotion();
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const days = trip ? tripDays(trip) : 1;
  const access = useTripAccess(trip ?? { members: [] });
  const [highlight, setHighlight] = useState("");

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setDay((d) => {
      if (d >= days - 1) { setPlaying(false); return d; }
      return d + 1;
    }), 2600);
    return () => clearInterval(t);
  }, [playing, days]);

  if (!trip) return <Navigate to="/app/trips" replace />;
  const status = tripStatus(trip);
  if (status === "upcoming" || status === "ongoing") {
    return (
      <div className="mx-auto max-w-lg py-16 text-center" data-testid="replay-not-ready">
        <Sparkles className="mx-auto size-8 text-coral" />
        <h1 className="mt-4 text-xl font-semibold">Trip Replay unlocks after the trip</h1>
        <p className="mt-2 text-sm text-ink-muted">Once {trip.name} wraps up, TripOS turns it into a scrapbook of your route, photos and highlights.</p>
        <Link to={`/app/trips/${trip.id}`} className="mt-6 inline-block text-sm font-semibold text-forest hover:underline">Back to trip</Link>
      </div>
    );
  }

  const spent = totalSpent(trip);
  const { stops, followsItinerary } = routeStops(trip);
  const people = Object.fromEntries(trip.members.map((m) => [m.id, m]));
  const dayActs = trip.activities.filter((a) => a.day === day);
  const dayPhotos = trip.photos.filter((p) => p.day === day);
  const byCat = Object.entries(trip.expenses.reduce<Record<string, number>>((a, e) => ({ ...a, [e.category]: (a[e.category] ?? 0) + e.amount }), {})).sort((a, b) => b[1] - a[1]);
  const participation = trip.members.map((m) => ({
    m,
    photos: trip.photos.filter((p) => p.authorId === m.id).length,
    paid: round2(trip.expenses.filter((e) => e.paidBy === m.id).reduce((s, e) => s + e.amount, 0)),
    activities: trip.activities.filter((a) => a.assignees.includes(m.id)).length,
  }));
  const topPhotographer = [...participation].sort((a, b) => b.photos - a.photos)[0];
  const topPayer = [...participation].sort((a, b) => b.paid - a.paid)[0];

  return (
    <div className="mx-auto max-w-6xl" data-testid="trip-replay">
      <Link to={`/app/trips/${trip.id}/memories`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink" data-testid="replay-back-link"><ChevronLeft className="size-4" /> {trip.name}</Link>

      {/* Cover */}
      <section className="relative overflow-hidden rounded-3xl bg-forest-deep text-white">
        <img src={trip.cover} alt="" className="absolute inset-0 size-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-t from-forest-deep via-forest-deep/40 to-transparent" />
        <div className="relative px-6 pb-8 pt-28 sm:px-10 sm:pt-40">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-coral">Trip Replay</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl" data-testid="replay-title">{trip.name}</h1>
          <p className="mt-2 text-white/80">{trip.destination} · {fmtRange(trip.startDate, trip.endDate)}</p>
          <div className="mt-6 flex items-center gap-3"><AvatarStack people={trip.members} size={34} max={6} /><span className="text-sm text-white/80">{trip.members.map((m) => m.name.split(" ")[0]).join(", ")}</span></div>
        </div>
      </section>

      {/* Stats */}
      <section className="-mt-6 grid grid-cols-2 gap-3 px-3 sm:grid-cols-4 sm:px-6" data-testid="replay-stats">
        {[["Days together", days], ["Places visited", trip.places.length], ["Photos shared", trip.photos.length], ["Total spent", money(spent, trip.currency)]].map(([l, v]) => (
          <div key={l as string} className="relative rounded-2xl border border-line bg-card p-4 shadow-[0_12px_30px_-18px_rgba(23,76,60,.35)]">
            <p className="num text-2xl font-semibold text-forest">{v}</p>
            <p className="text-xs text-ink-muted">{l}</p>
          </div>
        ))}
      </section>

      {/* Interactive timeline */}
      <section className="mt-10" data-testid="replay-timeline">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">The journey, day by day</h2>
          <Button variant="outline" className="rounded-xl" onClick={() => { if (!playing && day >= days - 1) setDay(0); setPlaying(!playing); if (!playing) toast("Replay playing", { description: "Sit back — we'll step through each day." }); }} data-testid="replay-play-button">
            {playing ? <><Pause className="size-4" /> Pause</> : <><Play className="size-4" /> Play replay</>}
          </Button>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: days }, (_, i) => (
            <button key={i} onClick={() => { setPlaying(false); setDay(i); }} className={cn("shrink-0 rounded-xl border px-4 py-2 text-sm font-medium transition-colors", day === i ? "border-forest bg-forest text-white" : "border-line bg-card hover:border-forest/40")} data-testid={`replay-day-${i}`}>
              Day {i + 1} <span className="ml-1 text-xs opacity-70">{format(addDays(parseISO(trip.startDate), i), "dd MMM")}</span>
            </button>
          ))}
        </div>
        <Progress value={((day + 1) / days) * 100} className="mt-3 h-1" tone="coral" />
        <AnimatePresence mode="wait">
          <motion.div key={day} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -6 }} transition={{ duration: 0.3 }} className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.3fr]">
            <ol className="grid content-start gap-3">
              {dayActs.length === 0 && <li className="rounded-2xl border border-dashed border-line p-6 text-sm text-ink-muted">A slow day — no plans logged. The best kind.</li>}
              {dayActs.map((a) => (
                <li key={a.id} className="flex gap-3 rounded-2xl border border-line bg-card p-4">
                  <span className="num w-12 shrink-0 text-xs font-semibold text-sage-ink">{a.start}</span>
                  <div><p className="font-medium">{a.title}</p><p className="flex items-center gap-1 text-xs text-ink-muted"><MapPin className="size-3" />{a.location}</p></div>
                </li>
              ))}
            </ol>
            <div className="grid grid-cols-2 gap-3">
              {dayPhotos.length === 0 && <div className="col-span-2 grid h-48 place-items-center rounded-2xl bg-muted text-sm text-ink-muted"><Images className="size-6" /></div>}
              {dayPhotos.map((p, i) => (
                <figure key={p.id} className={cn("overflow-hidden rounded-2xl bg-card p-2 shadow-sm ring-1 ring-line", i === 0 && dayPhotos.length % 2 === 1 && "col-span-2", i % 2 ? "rotate-[0.8deg]" : "-rotate-[0.8deg]")}>
                  <img src={p.url} alt={p.caption} className="aspect-[4/3] w-full rounded-xl object-cover" />
                  <figcaption className="flex items-center gap-2 px-1 pt-2 text-xs text-ink-muted"><Avatar person={people[p.authorId]} size={18} ring={false} /> {p.caption}</figcaption>
                </figure>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section data-testid="replay-route">
          <h2 className="mb-3 text-xl font-semibold tracking-tight">The route</h2>
          {stops.length > 0 && <p className="mb-3 text-sm text-ink-muted" data-testid="replay-route-note">{followsItinerary ? "In the order of your itinerary, day by day." : "In the order places were saved. Link activities to places to follow your days."}</p>}
          {stops.some((p) => p.lat != null)
            ? <Suspense fallback={<MapFallback className="aspect-[16/11] w-full" />}><TripMap places={stops} route className="aspect-[16/11] w-full" /></Suspense>
            : <p className="rounded-2xl border border-line bg-muted p-8 text-center text-sm text-ink-muted" data-testid="replay-no-route">No places were saved on the map for this trip, so there's no route to show.</p>}
          <ol className="mt-3 flex flex-wrap gap-2 text-sm">
            {stops.map((p, i) => <li key={p.id} className="rounded-full bg-sage px-3 py-1 text-forest"><span className="num font-semibold">{i + 1}</span> {p.name}</li>)}
          </ol>
        </section>
        <section className="grid content-start gap-6">
          <div className="rounded-2xl border border-line bg-card p-5" data-testid="replay-spend">
            <h3 className="flex items-center gap-2 font-semibold"><Wallet className="size-4 text-sage-ink" /> Where the money went</h3>
            <p className="num mt-2 text-3xl font-semibold">{money(spent, trip.currency)}</p>
            <p className="text-xs text-ink-muted">{money(round2(spent / Math.max(1, trip.members.length)), trip.currency)} per person · {trip.budget ? `${Math.round((spent / trip.budget) * 100)}% of budget` : "no budget set"}</p>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full">
              {byCat.map(([k, v]) => <span key={k} style={{ width: `${(v / spent) * 100}%`, background: CATEGORY_COLOR[k as ExpenseCategory] }} title={CATEGORY_LABEL[k as ExpenseCategory]} />)}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
              {byCat.map(([k, v]) => <li key={k} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: CATEGORY_COLOR[k as ExpenseCategory] }} />{CATEGORY_LABEL[k as ExpenseCategory]} <span className="num ml-auto font-medium">{money(v, trip.currency)}</span></li>)}
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-card p-5" data-testid="replay-participation">
            <h3 className="font-semibold">The crew</h3>
            <ul className="mt-3 grid gap-3">
              {participation.map(({ m, photos, paid, activities }) => (
                <li key={m.id} className="flex items-center gap-3">
                  <Avatar person={m} size={32} ring={false} />
                  <span className="flex-1 text-sm font-medium">{m.name.split(" ")[0]}</span>
                  <span className="num text-xs text-ink-muted">{photos} 📸 · {activities} plans · {money(paid, trip.currency)} paid</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              {topPhotographer && topPhotographer.photos > 0 && <div className="rounded-xl bg-coral-soft p-3"><p className="font-semibold text-[#8A3B22]">📸 Chief photographer</p><p className="text-ink">{topPhotographer.m.name}</p></div>}
              {topPayer && topPayer.paid > 0 && <div className="rounded-xl bg-sage p-3"><p className="font-semibold text-forest">💳 Big spender</p><p className="text-ink">{topPayer.m.name}</p></div>}
            </div>
          </div>
        </section>
      </div>

      {(trip.highlights.length > 0 || access.canAdmin) && (
        <section className="mt-10 rounded-3xl bg-sage/70 p-6 sm:p-10" data-testid="replay-highlights">
          <h2 className="text-xl font-semibold tracking-tight">Memorable highlights</h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-3">
            {trip.highlights.map((h, i) => (
              <li key={h} className="rounded-2xl bg-card p-5 text-[15px] leading-snug shadow-sm"><span className="flex items-start justify-between gap-2"><span className="num text-3xl font-semibold text-coral">0{i + 1}</span>{access.canAdmin && <Button variant="ghost" size="icon-xs" aria-label={`Remove highlight ${i + 1}`} onClick={() => { actions.patchTrip(trip.id, { highlights: trip.highlights.filter((_, j) => j !== i) }); saved("Highlight removed"); }} data-testid={`replay-highlight-remove-${i}`}><X /></Button>}</span><p className="mt-2">{h}</p></li>
            ))}
          </ul>
          {access.canAdmin && trip.highlights.length < 10 && (
            <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); const h = highlight.trim(); if (!h) return; actions.patchTrip(trip.id, { highlights: [...trip.highlights, h] }); saved("Highlight added"); setHighlight(""); }}>
              <Input value={highlight} onChange={(e) => setHighlight(e.target.value)} maxLength={200} placeholder="The moment everyone still talks about…" className="h-10 flex-1 rounded-xl bg-card" aria-label="New highlight" data-testid="replay-highlight-input" />
              <Button type="submit" className="h-10 rounded-xl" data-testid="replay-highlight-add-button">Add</Button>
            </form>
          )}
        </section>
      )}
      <p className="mt-10 text-center text-sm text-ink-muted">Plan together. Travel together. <b className="text-forest">Remember together.</b></p>
    </div>
  );
}
