import { useEffect, useState } from "react";
import { addMonths, format } from "date-fns";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, Compass, MapPin, Plus, Search, SlidersHorizontal, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, EmptyState, Field, PageHeader } from "@/components/common";
import { TravellerRow } from "@/components/social";
import { fmtRange } from "@/lib/format";
import { TRAVEL_STYLES, TRIP_CATEGORIES, usePublicTrips, useSuggestedTravellers, type PublicTrip, type TripFilters } from "@/lib/publicTrips";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const ANY = "any";
const MONTHS = Array.from({ length: 24 }, (_, i) => {
  const month = addMonths(new Date(), i);
  return [format(month, "yyyy-MM"), format(month, "MMMM yyyy")];
});
const DURATIONS: [string, string, string, string][] = [[ANY, "Any length", "", ""], ["short", "Up to 3 days", "", "3"], ["week", "4 to 7 days", "4", "7"], ["long", "More than a week", "8", ""]];

export function capacityLabel(t: Pick<PublicTrip, "full" | "participantCount" | "maxParticipants" | "placesLeft">) {
  if (t.full) return "Trip Full";
  if (t.maxParticipants == null) return `${t.participantCount} joined`;
  return `${t.participantCount} of ${t.maxParticipants} joined · ${t.placesLeft} ${t.placesLeft === 1 ? "place" : "places"} left`;
}

function TripCard({ trip }: { trip: PublicTrip }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition-shadow hover:shadow-lg" data-testid={`public-trip-${trip.id}`}>
      <div className="relative h-44 overflow-hidden">
        <img src={trip.cover} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        {trip.category && <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-0.5 text-xs font-medium text-forest">{trip.category}</span>}
        {trip.full && <span className="absolute right-3 top-3 rounded-full bg-forest px-2.5 py-0.5 text-xs font-semibold text-white" data-testid={`public-trip-full-${trip.id}`}>Trip Full</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-lg font-semibold leading-snug"><Link to={`/app/explore/${trip.id}`} className="after:absolute after:inset-0" data-testid={`public-trip-link-${trip.id}`}>{trip.title}</Link></h3>
        <p className="flex items-center gap-1.5 text-sm text-ink-muted"><MapPin className="size-4 shrink-0" /> <span className="truncate">{trip.destination}</span></p>
        <p className="flex items-center gap-1.5 text-sm text-ink-muted"><CalendarDays className="size-4 shrink-0" /> {fmtRange(trip.startDate, trip.endDate)}{trip.flexibleDates ? " · flexible" : ""}</p>
        {trip.description && <p className="line-clamp-2 text-sm">{trip.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-3 pt-2 text-sm">
          {trip.host.username ? (
            <Link to={`/app/u/${trip.host.username}`} className="relative z-10 flex min-w-0 items-center gap-2 hover:underline" data-testid={`public-trip-host-${trip.id}`}><Avatar person={trip.host} size={26} ring={false} /> <span className="truncate">{trip.host.name}</span></Link>
          ) : (
            <span className="flex min-w-0 items-center gap-2"><Avatar person={trip.host} size={26} ring={false} /> <span className="truncate">{trip.host.name}</span></span>
          )}
          <span className={cn("flex shrink-0 items-center gap-1 text-xs", trip.full ? "font-semibold text-forest" : "text-ink-muted")} data-testid={`public-trip-capacity-${trip.id}`}><Users className="size-3.5" /> {capacityLabel(trip)}</span>
        </div>
      </div>
    </article>
  );
}

function DiscoverTrips() {
  const currency = useApp((s) => s.settings.currency);
  const [f, setF] = useState<TripFilters>({});
  const [typed, setTyped] = useState("");
  const [more, setMore] = useState(false);
  const [duration, setDuration] = useState(ANY);
  const set = (patch: TripFilters) => setF((x) => ({ ...x, ...patch }));
  useEffect(() => {
    const timer = setTimeout(() => set({ destination: typed.trim() }), 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const { data, isPending, isError, hasNextPage, fetchNextPage, isFetchingNextPage } = usePublicTrips({ ...f, currency: f.budgetMax ? currency : undefined });
  const trips = data?.pages.flatMap((p) => p.trips) ?? [];
  const filtering = Object.values(f).some(Boolean);
  const pick = (value: string | null, label: string) => <SelectValue>{() => (value === ANY || !value ? `Any ${label}` : value)}</SelectValue>;
  return (
    <div className="grid gap-5">
      <section className="grid gap-3 rounded-2xl border border-line bg-card p-4" data-testid="explore-filters">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Where do you want to go?" className="h-10 rounded-xl pl-9" aria-label="Destination" data-testid="explore-destination" />
          </div>
          <Select value={f.month || ANY} onValueChange={(v) => set({ month: v === ANY ? "" : (v as string) })}>
            <SelectTrigger className="h-10 w-full rounded-xl" aria-label="Travel month" data-testid="explore-month"><SelectValue>{(v) => (v === ANY ? "Any month" : MONTHS.find(([k]) => k === v)?.[1])}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value={ANY}>Any month</SelectItem>{MONTHS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={f.category || ANY} onValueChange={(v) => set({ category: v === ANY ? "" : (v as string) })}>
            <SelectTrigger className="h-10 w-full rounded-xl" aria-label="Trip category" data-testid="explore-category">{pick(f.category ?? null, "category")}</SelectTrigger>
            <SelectContent><SelectItem value={ANY}>Any category</SelectItem>{TRIP_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={f.style || ANY} onValueChange={(v) => set({ style: v === ANY ? "" : (v as string) })}>
            <SelectTrigger className="h-10 w-full rounded-xl" aria-label="Travel style" data-testid="explore-style">{pick(f.style ?? null, "style")}</SelectTrigger>
            <SelectContent><SelectItem value={ANY}>Any style</SelectItem>{TRAVEL_STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.available === "true"} onCheckedChange={(on) => set({ available: on ? "true" : "" })} data-testid="explore-available" /> Only trips with places left</label>
          <Button variant="ghost" size="sm" aria-expanded={more} onClick={() => setMore(!more)} data-testid="explore-more-filters"><SlidersHorizontal className="size-4" /> More filters</Button>
        </div>
        {more && (
          <div className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Leaving from" htmlFor="ex-from"><Input id="ex-from" type="date" value={f.from ?? ""} onChange={(e) => set({ from: e.target.value })} className="rounded-xl" data-testid="explore-from" /></Field>
            <Field label="Back by" htmlFor="ex-to"><Input id="ex-to" type="date" value={f.to ?? ""} onChange={(e) => set({ to: e.target.value })} className="rounded-xl" data-testid="explore-to" /></Field>
            <Field label="Length">
              <Select value={duration} onValueChange={(v) => { const d = DURATIONS.find(([k]) => k === v) ?? DURATIONS[0]; setDuration(d[0]); set({ minDays: d[2], maxDays: d[3] }); }}>
                <SelectTrigger className="w-full rounded-xl" data-testid="explore-duration"><SelectValue>{(v) => DURATIONS.find(([k]) => k === v)?.[1]}</SelectValue></SelectTrigger>
                <SelectContent>{DURATIONS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={`Budget per person, up to (${currency})`} htmlFor="ex-budget"><Input id="ex-budget" inputMode="numeric" value={f.budgetMax ?? ""} onChange={(e) => set({ budgetMax: e.target.value.replace(/\D/g, "") })} className="rounded-xl" data-testid="explore-budget" /></Field>
            <Field label="People already going, at most" htmlFor="ex-people"><Input id="ex-people" inputMode="numeric" value={f.maxPeople ?? ""} onChange={(e) => set({ maxPeople: e.target.value.replace(/\D/g, "") })} className="rounded-xl" data-testid="explore-people" /></Field>
          </div>
        )}
      </section>

      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="explore-loading">{[0, 1, 2].map((i) => <div key={i} className="h-80 animate-pulse rounded-2xl border border-line bg-card" />)}</div>
      ) : isError ? (
        <EmptyState icon={Compass} title="Trips couldn't be loaded" body="Please check your connection and try again." testId="explore-error" />
      ) : trips.length === 0 ? (
        <EmptyState
          icon={Compass}
          title={filtering ? "No trips match that" : "No public trips yet"}
          body={filtering ? "Try removing a filter or two." : "Be the first. Host a trip and invite other travellers to join you."}
          action={!filtering && <Link to="/app/trips/new?public=1" className={buttonVariants()} data-testid="explore-empty-host">Host a Trip</Link>}
          testId="explore-empty"
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="explore-trips">{trips.map((t) => <TripCard key={t.id} trip={t} />)}</div>
          {hasNextPage && <Button variant="outline" className="justify-self-center rounded-xl" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()} data-testid="explore-load-more">{isFetchingNextPage ? "Loading…" : "Show more trips"}</Button>}
        </>
      )}
    </div>
  );
}

function Travellers() {
  const { data, isPending, isError } = useSuggestedTravellers();
  if (isPending) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (isError) return <EmptyState icon={Users} title="Travellers couldn't be loaded" body="Please check your connection and try again." testId="travellers-error" />;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-muted">People with public profiles who share your travel styles, interests or destinations, or who know your friends. Add yours to your <Link to="/app/people" className="font-medium text-forest underline">profile</Link> to find better matches.</p>
      {data.length ? (
        <section className="divide-y rounded-2xl border border-line bg-card" data-testid="travellers-list">{data.map((p) => <TravellerRow key={p.id} person={p} />)}</section>
      ) : (
        <EmptyState icon={Users} title="No suggestions yet" body="As more travellers make their profiles public, the ones you have things in common with will appear here." action={<Link to="/app/people" className={buttonVariants({ variant: "outline" })}>Search for someone</Link>} testId="travellers-empty" />
      )}
    </div>
  );
}

/** Where journeys and travel companions are found. Trips come first, as hosting and joining them is the point. */
export default function Explore() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "trips";
  return (
    <div>
      <PageHeader
        title="Explore"
        subtitle="Find a trip to join, or host one and find people to travel with."
        actions={<Link to="/app/trips/new?public=1" className={cn(buttonVariants(), "h-10 rounded-xl")} data-testid="explore-host-button"><Plus className="size-4" /> Host a Trip</Link>}
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v as string })}>
        <TabsList className="mb-5">
          <TabsTrigger value="trips" data-testid="explore-tab-trips">Discover Trips</TabsTrigger>
          <TabsTrigger value="travellers" data-testid="explore-tab-travellers">Travellers</TabsTrigger>
        </TabsList>
        <TabsContent value="trips"><DiscoverTrips /></TabsContent>
        <TabsContent value="travellers"><Travellers /></TabsContent>
      </Tabs>
    </div>
  );
}

