import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { MapPin, Navigation, Plus, Search, Trash2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog, Field } from "@/components/common";
import { useTripAccess } from "@/lib/access";
import { apiGet } from "@/lib/api";
import { useLiveLocations, type LiveLocation } from "@/lib/liveLocation";
import { actions, saved } from "@/lib/store";
import { uid } from "@/lib/format";
import type { Place, PlaceType, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";
import LiveLocationPanel, { isStale, seenLabel } from "./LiveLocationPanel";
import { PLACE_META } from "./placeMeta";
import type { LivePin } from "./TripMap";

const TripMap = lazy(() => import("./TripMap"));

interface PlaceResult { name: string; address: string; lat: number; lng: number }

const searchPlaces = (q: string, near?: { lat: number; lng: number }) =>
  apiGet<PlaceResult[]>(`/places/search?q=${encodeURIComponent(q)}${near ? `&lat=${near.lat}&lng=${near.lng}` : ""}`);

export function MapFallback({ className }: { className?: string }) {
  return <div className={cn("rounded-2xl border border-line bg-muted", className)} data-testid="trip-map-loading" />;
}

/** Search as you type. Pauses until typing stops, so the shared search service isn't asked for every letter. */
function PlaceSearch({ near, onPick }: { near?: { lat: number; lng: number }; onPick: (result: PlaceResult) => void }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 400);
    return () => clearTimeout(t);
  }, [text]);
  const { data, isError, isFetching } = useQuery({
    queryKey: ["place-search", query, near?.lat, near?.lng],
    queryFn: () => searchPlaces(query, near),
    enabled: query.length >= 3,
    staleTime: Infinity,
    retry: false,
  });
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search for a place or address" className="pl-9" aria-label="Search for a place" data-testid="place-search-input" />
      {query.length >= 3 && text.trim() === query && !isFetching && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-card shadow-lg" data-testid="place-search-results">
          {isError ? <p className="px-3 py-3 text-sm text-ink-muted" data-testid="place-search-error">Search isn't available right now. You can still click the map.</p>
            : !data?.length ? <p className="px-3 py-3 text-sm text-ink-muted">No places found.</p>
            : data.map((r) => (
              <button key={`${r.lat},${r.lng}`} type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted" onClick={() => { onPick(r); setText(""); setQuery(""); }} data-testid="place-search-result">
                <MapPin className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.name}</span><span className="block truncate text-xs text-ink-muted">{r.address}</span></span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export default function MapTab({ trip }: { trip: Trip }) {
  const { canContribute } = useTripAccess(trip);
  const [filter, setFilter] = useState<"all" | PlaceType>("all");
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  // Pins from before maps were real have no coordinates, so they're placed by search or by clicking the map.
  const [relocating, setRelocating] = useState<Place>();
  const [draft, setDraft] = useState<Place>();
  const [err, setErr] = useState<string>();
  const [deleting, setDeleting] = useState<Place>();
  const places = trip.places.filter((p) => filter === "all" || p.type === filter);
  const sel = trip.places.find((p) => p.id === selected);
  const locating = adding || !!relocating;

  const { data: destination } = useQuery({
    queryKey: ["place-search", trip.destination],
    queryFn: () => searchPlaces(trip.destination),
    enabled: trip.destination.trim().length >= 3,
    staleTime: Infinity,
    retry: false,
  });
  const center = destination?.[0] ? { lat: destination[0].lat, lng: destination[0].lng } : undefined;

  const locations = useLiveLocations(trip.id);
  const live = useMemo<LivePin[]>(() => locations.flatMap((x) => {
    const person = trip.members.find((m) => m.id === x.userId);
    return person ? [{ person, lat: x.lat, lng: x.lng, stale: isStale(x), label: `${person.name}: ${seenLabel(x)}` }] : [];
  }), [locations, trip.members]);

  const placeAt = (at: { lat: number; lng: number; name?: string; address?: string }) => {
    setErr(undefined);
    setDraft(relocating
      ? { ...relocating, lat: at.lat, lng: at.lng, address: at.address ?? relocating.address }
      : { id: uid("pl"), name: at.name ?? "", type: "activity", lat: at.lat, lng: at.lng, address: at.address ?? "", note: "" });
  };

  const save = () => {
    if (!draft) return;
    if (draft.name.trim().length < 2) return setErr("Name the place");
    actions.upsert(trip.id, "places", { ...draft, name: draft.name.trim() }, { text: `saved “${draft.name.trim()}” to the map`, kind: "map" });
    saved("Place saved");
    setSelected(draft.id);
    setDraft(undefined);
    setAdding(false);
    setRelocating(undefined);
  };

  // Stays on this map: opening another maps site would hand someone's position to a third party.
  const [focus, setFocus] = useState<{ lat: number; lng: number; at: number }>();
  const showPerson = (x: LiveLocation) => setFocus({ lat: x.lat, lng: x.lng, at: Date.now() });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", ...Object.keys(PLACE_META)] as ("all" | PlaceType)[]).map((k) => (
            <button key={k} onClick={() => setFilter(k)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", filter === k ? "border-forest bg-forest text-white" : "border-line bg-card text-ink-muted hover:text-ink")} data-testid={`map-filter-${k}`}>
              {k === "all" ? `All places · ${trip.places.length}` : PLACE_META[k].label}
            </button>
          ))}
          {canContribute && <Button size="sm" variant={locating ? "secondary" : "default"} className="ml-auto rounded-lg" onClick={() => { setAdding(!locating); setRelocating(undefined); }} data-testid="map-add-place-button">
            {locating ? <><X className="size-3.5" /> Cancel</> : <><Plus className="size-3.5" /> Add place</>}
          </Button>}
        </div>
        {locating && (
          <div className="grid gap-2">
            <PlaceSearch near={center} onPick={placeAt} />
            <p className="rounded-xl bg-coral-soft px-3 py-2 text-sm text-[#8A3B22]" data-testid="map-add-hint">{relocating ? `Search, or click the map to place “${relocating.name}”.` : "Search above, or click anywhere on the map to drop a pin."}</p>
          </div>
        )}
        <Suspense fallback={<MapFallback className="aspect-[4/3] w-full lg:aspect-[16/11]" />}>
          <TripMap
            places={places}
            selected={selected}
            onSelect={setSelected}
            onMapClick={locating ? (lat, lng) => placeAt({ lat, lng }) : undefined}
            center={center}
            live={live}
            focus={focus}
            className="aspect-[4/3] w-full lg:aspect-[16/11]"
          />
        </Suspense>
      </div>

      <aside className="grid content-start gap-3">
        <LiveLocationPanel trip={trip} locations={locations} onShow={showPerson} />
        {sel && (
          <div className="rounded-2xl border border-forest/30 bg-sage/50 p-4 animate-rise" data-testid="map-selected-place">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: PLACE_META[sel.type].color }}>{PLACE_META[sel.type].label}</p>
            <h3 className="mt-1 font-semibold">{sel.name}</h3>
            <p className="text-sm text-ink-muted">{sel.address}</p>
            {sel.note && <p className="mt-2 text-sm">{sel.note}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sel.lat != null && sel.lng != null ? `${sel.lat},${sel.lng}` : `${sel.name} ${sel.address}`)}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-forest px-3 text-xs font-medium text-white" data-testid="map-open-directions">
                <Navigation className="size-3.5" /> Open in Maps
              </a>
              {canContribute && sel.lat == null && <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => { setRelocating(sel); setAdding(false); }} data-testid="map-set-location"><MapPin className="size-3.5" /> Set location</Button>}
              {canContribute && <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => setDeleting(sel)} data-testid="map-delete-place"><Trash2 className="size-3.5" /> Remove</Button>}
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-line bg-card">
          <h3 className="border-b px-4 py-3 text-sm font-semibold">Saved places</h3>
          {places.length === 0 ? <p className="px-4 py-8 text-center text-sm text-ink-muted">No places in this category yet.</p> : (
            <ul className="max-h-[460px] divide-y overflow-y-auto" data-testid="map-places-list">
              {places.map((p) => {
                const M = PLACE_META[p.type];
                return (
                  <li key={p.id}>
                    <button onClick={() => setSelected(p.id)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60", selected === p.id && "bg-muted")} data-testid={`map-place-${p.id}`}>
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg text-white" style={{ background: M.color }}><M.icon className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-ink-muted">{p.lat == null ? "Not on the map yet" : p.note || p.address}</span></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(undefined)}>
        <DialogContent data-testid="place-dialog">
          <DialogHeader><DialogTitle>Save a place</DialogTitle></DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <Field label="Name" htmlFor="pl-name" error={err}><Input id="pl-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="place-name-input" /></Field>
              <Field label="Type">
                <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v as PlaceType })}>
                  <SelectTrigger className="w-full" data-testid="place-type-select"><SelectValue>{(v) => PLACE_META[v as PlaceType].label}</SelectValue></SelectTrigger>
                  <SelectContent>{Object.entries(PLACE_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Address" htmlFor="pl-addr"><Input id="pl-addr" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} data-testid="place-address-input" /></Field>
              <Field label="Note" htmlFor="pl-note"><Input id="pl-note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} data-testid="place-note-input" /></Field>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setDraft(undefined)}>Cancel</Button><Button onClick={save} data-testid="place-save-button">Save place</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)} title={`Remove “${deleting?.name}”?`} body="It will be removed from the trip map." confirmLabel="Remove place" onConfirm={() => { if (deleting) { actions.remove(trip.id, "places", deleting.id); setSelected(undefined); saved("Place removed"); } }} />
    </div>
  );
}
