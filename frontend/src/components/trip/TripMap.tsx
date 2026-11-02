// The real map, loaded on demand because the map library is large. Tiles come from OpenFreeMap, which needs no key.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Avatar } from "@/components/common";
import type { Person, Place } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PLACE_META } from "./placeMeta";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const ROUTE = "trip-route";

export interface LivePin {
  person: Person;
  lat: number;
  lng: number;
  /** Hasn't updated for a while, so it's shown faded. */
  stale: boolean;
  label: string;
}

const hasCoordinates = (p: Place): p is Place & { lat: number; lng: number } => typeof p.lat === "number" && typeof p.lng === "number";

/** A React element placed on the map at a position. */
function Marker({ map, lat, lng, anchor, children }: { map: maplibregl.Map; lat: number; lng: number; anchor: "bottom" | "center"; children: ReactNode }) {
  const [element] = useState(() => document.createElement("div"));
  const marker = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    marker.current = new maplibregl.Marker({ element, anchor }).setLngLat([lng, lat]).addTo(map);
    return () => {
      marker.current?.remove();
      marker.current = null;
    };
    // Moving is handled below, so a new position doesn't rebuild the marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, element, anchor]);
  useEffect(() => {
    marker.current?.setLngLat([lng, lat]);
  }, [lat, lng]);
  return createPortal(children, element);
}

export default function TripMap({ places, selected, onSelect, onMapClick, route = false, center, live = [], focus, className }: {
  places: Place[];
  selected?: string;
  onSelect?: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  /** Numbers the places and draws a line between them in order. */
  route?: boolean;
  /** Where to look when there's nothing to show yet. */
  center?: { lat: number; lng: number };
  live?: LivePin[];
  /** Moves the view here when it changes, such as to someone sharing their location. */
  focus?: { lat: number; lng: number; at: number };
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const clickHandler = useRef(onMapClick);
  clickHandler.current = onMapClick;
  const pinned = places.filter(hasCoordinates);

  useEffect(() => {
    if (!container.current) return;
    let instance: maplibregl.Map;
    try {
      instance = new maplibregl.Map({ container: container.current, style: STYLE_URL, center: [78, 22], zoom: 2, attributionControl: { compact: true } });
    } catch {
      // Some older phones and locked-down browsers have no WebGL. The list of places still works.
      setUnsupported(true);
      return;
    }
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    instance.on("click", (e) => {
      if ((e.originalEvent.target as Element | null)?.closest(".maplibregl-marker")) return;
      clickHandler.current?.(Number(e.lngLat.lat.toFixed(6)), Number(e.lngLat.lng.toFixed(6)));
    });
    instance.on("load", () => setStyleReady(true));
    setMap(instance);
    return () => {
      setMap(null);
      setStyleReady(false);
      instance.remove();
    };
  }, []);

  // Show everything saved. Only a change to the places moves the view, so someone's live position can't pull it away.
  const pinKey = pinned.map((p) => `${p.id}:${p.lat},${p.lng}`).join("|");
  const fitted = useRef(false);
  useEffect(() => {
    if (!map) return;
    if (!pinned.length) {
      const only = center ?? (live[0] ? { lat: live[0].lat, lng: live[0].lng } : undefined);
      if (only && !fitted.current) map.jumpTo({ center: [only.lng, only.lat], zoom: 10 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    pinned.forEach((p) => bounds.extend([p.lng, p.lat]));
    map.fitBounds(bounds, { padding: 70, maxZoom: 13, duration: fitted.current ? 500 : 0 });
    fitted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pinKey, center?.lat, center?.lng, live.length > 0]);

  useEffect(() => {
    const place = pinned.find((p) => p.id === selected);
    if (map && place) map.easeTo({ center: [place.lng, place.lat], duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selected]);

  useEffect(() => {
    if (map && focus) map.easeTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 14), duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focus?.at]);

  useEffect(() => {
    if (!map || !styleReady || !route) return;
    const line: GeoJSON.Feature<GeoJSON.LineString> = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pinned.map((p) => [p.lng, p.lat]) } };
    const source = map.getSource(ROUTE) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(line);
    else {
      map.addSource(ROUTE, { type: "geojson", data: line });
      map.addLayer({ id: ROUTE, type: "line", source: ROUTE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#F28B68", "line-width": 3, "line-dasharray": [2, 1.5] } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, styleReady, route, pinKey]);

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-line bg-muted", onMapClick && "[&_canvas]:!cursor-crosshair", className)} data-testid="trip-map" data-map-ready={styleReady}>
      {/* Inline, because the map library's stylesheet sets its own position on this element. */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {unsupported && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-ink-muted" data-testid="trip-map-unsupported">This browser can't show the map. Your saved places are still listed here.</p>}
      {map && pinned.map((p) => {
        const M = PLACE_META[p.type];
        const on = selected === p.id;
        return (
          <Marker key={p.id} map={map} lat={p.lat} lng={p.lng} anchor="bottom">
            <button type="button" onClick={() => onSelect?.(p.id)} className={cn("relative block transition-transform duration-200", on ? "z-10 scale-110" : "hover:scale-105")} aria-label={p.name} data-testid={`map-pin-${p.id}`}>
              <span className={cn("grid size-8 place-items-center rounded-full rounded-bl-none -rotate-45 border-2 border-white text-white shadow-md", on && "animate-pulse-pin")} style={{ background: M.color }}>
                <span className="rotate-45">{route ? <span className="num text-[11px] font-bold">{places.indexOf(p) + 1}</span> : <M.icon className="size-3.5" />}</span>
              </span>
              {(on || route) && <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-card px-2 py-0.5 text-[11px] font-semibold text-ink shadow">{p.name}</span>}
            </button>
          </Marker>
        );
      })}
      {map && live.map((pin) => (
        <Marker key={pin.person.id} map={map} lat={pin.lat} lng={pin.lng} anchor="center">
          <span className={cn("relative block rounded-full ring-2 ring-coral", pin.stale && "opacity-60 grayscale")} title={pin.label} data-testid={`live-pin-${pin.person.id}`}>
            <Avatar person={pin.person} size={34} ring={false} />
          </span>
        </Marker>
      ))}
    </div>
  );
}
