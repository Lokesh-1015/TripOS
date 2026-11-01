import { useState, type MouseEvent } from "react";
import { BedDouble, Flag, MapPin, Mountain, Navigation, Plus, Trash2, Utensils, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog, Field } from "@/components/common";
import { useTripAccess } from "@/lib/access";
import { actions, saved } from "@/lib/store";
import { uid } from "@/lib/format";
import type { Place, PlaceType, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

export const PLACE_META: Record<PlaceType, { label: string; icon: typeof MapPin; color: string }> = {
  destination: { label: "Destinations", icon: Mountain, color: "#174C3C" },
  stay: { label: "Hotels & stays", icon: BedDouble, color: "#43546B" },
  food: { label: "Restaurants", icon: Utensils, color: "#F28B68" },
  activity: { label: "Activities", icon: Flag, color: "#B98A1E" },
  meetup: { label: "Meeting points", icon: Navigation, color: "#8C4FB0" },
};

export function IllustratedMap({ places, selected, onSelect, onMapClick, route = false, className }: { places: Place[]; selected?: string; onSelect?: (id: string) => void; onMapClick?: (x: number, y: number) => void; route?: boolean; className?: string }) {
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (!onMapClick) return;
    const r = e.currentTarget.getBoundingClientRect();
    onMapClick(Math.round(((e.clientX - r.left) / r.width) * 100), Math.round(((e.clientY - r.top) / r.height) * 100));
  };
  return (
    <div className={cn("map-grid relative overflow-hidden rounded-2xl border border-line", onMapClick && "cursor-crosshair", className)} onClick={click} data-testid="illustrated-map">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
        <path d="M-5 70 C 20 60, 30 80, 55 62 S 90 40, 105 48" stroke="#9CC2D6" strokeWidth="2.2" fill="none" opacity=".7" />
        <path d="M10 -5 C 18 30, 40 40, 48 60 S 60 95, 70 105" stroke="#fff" strokeWidth="1.6" fill="none" />
        <path d="M-5 30 C 30 35, 60 20, 105 28" stroke="#fff" strokeWidth="1.1" fill="none" />
        <path d="M70 -5 C 65 30, 80 60, 100 75" stroke="#fff" strokeWidth=".9" fill="none" />
        {route && places.length > 1 && (
          <polyline points={places.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#F28B68" strokeWidth=".8" strokeDasharray="2 1.4" strokeLinecap="round" />
        )}
      </svg>
      {places.map((p, i) => {
        const M = PLACE_META[p.type];
        const on = selected === p.id;
        return (
          <button
            key={p.id}
            onClick={(e) => { e.stopPropagation(); onSelect?.(p.id); }}
            className={cn("absolute -translate-x-1/2 -translate-y-full transition-transform duration-200", on ? "z-10 scale-110" : "hover:scale-105")}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            aria-label={p.name}
            data-testid={`map-pin-${p.id}`}
          >
            <span className={cn("grid size-8 place-items-center rounded-full rounded-bl-none -rotate-45 border-2 border-white text-white shadow-md", on && "animate-pulse-pin")} style={{ background: M.color }}>
              <span className="rotate-45">{route ? <span className="num text-[11px] font-bold">{i + 1}</span> : <M.icon className="size-3.5" />}</span>
            </span>
            {(on || route) && <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-card px-2 py-0.5 text-[11px] font-semibold text-ink shadow">{p.name}</span>}
          </button>
        );
      })}
      <span className="absolute bottom-2 right-2 rounded-md bg-card/90 px-2 py-1 text-[10px] font-medium text-ink-muted" data-testid="map-mock-label">Illustrative map · sample locations</span>
    </div>
  );
}

export default function MapTab({ trip }: { trip: Trip }) {
  const { canContribute } = useTripAccess(trip);
  const [filter, setFilter] = useState<"all" | PlaceType>("all");
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Place>();
  const [err, setErr] = useState<string>();
  const [deleting, setDeleting] = useState<Place>();
  const places = trip.places.filter((p) => filter === "all" || p.type === filter);
  const sel = trip.places.find((p) => p.id === selected);

  const save = () => {
    if (!draft) return;
    if (draft.name.trim().length < 2) return setErr("Name the place");
    actions.upsert(trip.id, "places", { ...draft, name: draft.name.trim() }, { text: `saved “${draft.name.trim()}” to the map`, kind: "map" });
    saved("Place saved");
    setSelected(draft.id);
    setDraft(undefined);
    setAdding(false);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", ...Object.keys(PLACE_META)] as ("all" | PlaceType)[]).map((k) => (
            <button key={k} onClick={() => setFilter(k)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", filter === k ? "border-forest bg-forest text-white" : "border-line bg-card text-ink-muted hover:text-ink")} data-testid={`map-filter-${k}`}>
              {k === "all" ? `All places · ${trip.places.length}` : PLACE_META[k].label}
            </button>
          ))}
          {canContribute && <Button size="sm" variant={adding ? "secondary" : "default"} className="ml-auto rounded-lg" onClick={() => setAdding(!adding)} data-testid="map-add-place-button">
            {adding ? <><X className="size-3.5" /> Cancel</> : <><Plus className="size-3.5" /> Add place</>}
          </Button>}
        </div>
        {adding && <p className="rounded-xl bg-coral-soft px-3 py-2 text-sm text-[#8A3B22]" data-testid="map-add-hint">Click anywhere on the map to drop a pin.</p>}
        <IllustratedMap
          places={places}
          selected={selected}
          onSelect={setSelected}
          onMapClick={adding ? (x, y) => { setErr(undefined); setDraft({ id: uid("pl"), name: "", type: "activity", x, y, address: "", note: "" }); } : undefined}
          className="aspect-[4/3] w-full lg:aspect-[16/11]"
        />
      </div>

      <aside className="grid content-start gap-3">
        {sel && (
          <div className="rounded-2xl border border-forest/30 bg-sage/50 p-4 animate-rise" data-testid="map-selected-place">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: PLACE_META[sel.type].color }}>{PLACE_META[sel.type].label}</p>
            <h3 className="mt-1 font-semibold">{sel.name}</h3>
            <p className="text-sm text-ink-muted">{sel.address}</p>
            {sel.note && <p className="mt-2 text-sm">{sel.note}</p>}
            <div className="mt-3 flex gap-2">
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${sel.name} ${sel.address}`)}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-forest px-3 text-xs font-medium text-white" data-testid="map-open-directions">
                <Navigation className="size-3.5" /> Open in Maps
              </a>
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
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-ink-muted">{p.note || p.address}</span></span>
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
