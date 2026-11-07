import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Compass, MapPin, Search, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar } from "@/components/common";
import { apiGet } from "@/lib/api";
import { useApp } from "@/lib/store";
import { fmtRange } from "@/lib/format";
import { usePeopleSearch } from "@/lib/social";
import type { PublicTrip } from "@/lib/publicTrips";
import { cn } from "@/lib/utils";

interface Result {
  key: string;
  group: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  to: string;
  /** People show their photo rather than an icon. */
  person?: { name: string; avatar: string };
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Waits a moment after typing stops, so every keystroke doesn't search the server. */
function useSettled(value: string, ms = 200) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * One search for everything: your trips and their places straight away, then people (by name or username,
 * never email) and public trips from Explore. Ctrl/⌘K jumps here from anywhere.
 */
export function GlobalSearch({ autoFocus = false, onDone, className }: { autoFocus?: boolean; onDone?: () => void; className?: string }) {
  const navigate = useNavigate();
  const trips = useApp((s) => s.trips);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();
  const remote = useSettled(needle.replace(/^@/, ""));
  const people = usePeopleSearch(remote);
  const explore = useQuery({
    queryKey: ["public", "search", remote],
    queryFn: () => apiGet<{ trips: PublicTrip[] }>(`/public/trips?destination=${encodeURIComponent(remote)}&offset=0`),
    enabled: remote.length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const results = useMemo<Result[]>(() => {
    if (!needle) return [];
    const mine = trips
      .filter((t) => `${t.name} ${t.destination}`.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((t) => ({ key: `trip-${t.id}`, group: "Your trips", icon: MapPin, title: t.name, detail: `${t.destination} · ${fmtRange(t.startDate, t.endDate)}`, to: `/app/trips/${t.id}` }));
    const places = trips
      .flatMap((t) => t.places.filter((p) => p.name.toLowerCase().includes(needle)).map((p) => ({ key: `place-${t.id}-${p.id}`, group: "Places in your trips", icon: MapPin, title: p.name, detail: t.name, to: `/app/trips/${t.id}/map` })))
      .slice(0, 4);
    const found = (remote.length >= 2 ? people.data ?? [] : [])
      .slice(0, 5)
      .map((p) => ({ key: `person-${p.id}`, group: "People", icon: UserRound, title: p.name, detail: `@${p.username}`, to: `/app/u/${p.username}`, person: { name: p.name, avatar: p.avatar } }));
    const mineIds = new Set(trips.map((t) => t.id));
    const discover = (remote.length >= 2 ? explore.data?.trips ?? [] : [])
      .filter((t) => !mineIds.has(t.id))
      .slice(0, 4)
      .map((t) => ({ key: `public-${t.id}`, group: "Explore", icon: Compass, title: t.title, detail: `${t.destination} · ${fmtRange(t.startDate, t.endDate)}`, to: `/app/explore/${t.id}` }));
    return [...mine, ...places, ...found, ...discover];
  }, [needle, remote, trips, people.data, explore.data]);

  useEffect(() => setActive(0), [needle]);
  const go = (to: string) => {
    setOpen(false);
    setQ("");
    input.current?.blur();
    onDone?.();
    navigate(to);
  };
  const submit = () => {
    if (results[active]) return go(results[active].to);
    if (needle) go(`/app/trips?q=${encodeURIComponent(q.trim())}`);
  };
  const searching = remote.length >= 2 && (people.isFetching || explore.isFetching);
  let lastGroup = "";

  return (
    <div ref={box} className={cn("relative w-full", className)}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} role="search">
        <label className="relative block">
          <span className="sr-only">Search trips, places, people and Explore</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
          <input
            ref={input}
            value={q}
            autoFocus={autoFocus}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0))); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
              if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
            }}
            placeholder="Search trips, places, people…"
            aria-label="Search trips, places, people and Explore"
            role="combobox"
            aria-expanded={open && !!needle}
            aria-controls="global-search-results"
            aria-activedescendant={results[active] ? `search-${results[active].key}` : undefined}
            autoComplete="off"
            className="h-10 w-full rounded-xl border border-line bg-card pr-14 pl-9 text-sm outline-none transition-[border-color,box-shadow] focus:border-forest focus:ring-3 focus:ring-forest/10"
            data-testid="header-search-input"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-md border border-line bg-muted px-1.5 py-0.5 font-sans text-[10px] text-ink-muted sm:block">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </label>
      </form>
      {open && needle && (
        <div id="global-search-results" role="listbox" className="absolute inset-x-0 top-full z-40 mt-2 max-h-[min(70dvh,440px)] overflow-y-auto rounded-2xl border border-line bg-popover p-1.5 shadow-xl" data-testid="search-results">
          {results.map((r, i) => {
            const heading = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <div key={r.key}>
                {heading && <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">{heading}</p>}
                <button
                  id={`search-${r.key}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r.to)}
                  className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left", i === active ? "bg-sage" : "hover:bg-muted")}
                  data-testid={`search-result-${r.key}`}
                >
                  {r.person ? <Avatar person={r.person} size={32} ring={false} /> : <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card text-forest ring-1 ring-line"><r.icon className="size-4" /></span>}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.title}</span>
                    <span className="block truncate text-xs text-ink-muted">{r.detail}</span>
                  </span>
                </button>
              </div>
            );
          })}
          {!results.length && (
            <div className="grid gap-1 px-3 py-3" data-testid="search-no-results">
              <p className="text-sm text-ink-muted">{searching || remote !== needle.replace(/^@/, "") ? "Searching…" : `Nothing matches “${q.trim()}” in your trips or people.`}</p>
            </div>
          )}
          {/* Never a dead end: Explore can always be searched for the place. */}
          {needle.length >= 2 && !needle.includes("@") && (
            <button onClick={() => go(`/app/explore?destination=${encodeURIComponent(q.trim())}`)} className="mt-1 flex w-full items-center gap-3 rounded-xl border-t border-line px-2.5 py-2.5 text-left text-sm font-medium text-forest hover:bg-muted" data-testid="search-explore-link">
              <Compass className="size-4" /> Search Explore for “{q.trim()}”
            </button>
          )}
          {!!results.length && searching && <p className="px-3 py-2 text-xs text-ink-muted">Looking for more…</p>}
        </div>
      )}
    </div>
  );
}
