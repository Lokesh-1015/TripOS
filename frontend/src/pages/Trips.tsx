import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LayoutGrid, List, Map as MapIcon, Plus, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvatarStack, EmptyState, PageHeader, StatusBadge } from "@/components/common";
import { TripCard } from "@/components/TripCard";
import { Invitations } from "@/components/Invitations";
import { useApp } from "@/lib/store";
import { fmtRange, money, totalSpent, tripStatus } from "@/lib/format";
import type { TripStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const FILTERS: ("all" | TripStatus)[] = ["all", "upcoming", "ongoing", "completed", "archived"];
const FILTER_LABEL: Record<(typeof FILTERS)[number], string> = { all: "All", upcoming: "Upcoming", ongoing: "Ongoing", completed: "Past", archived: "Archived" };
const SORTS: Record<string, string> = { soonest: "Start date (soonest)", latest: "Start date (latest)", name: "Name (A-Z)" };

export default function Trips() {
  const trips = useApp((s) => s.trips);
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const filter = (params.get("status") ?? "all") as (typeof FILTERS)[number];
  const sort = params.get("sort") ?? "soonest";
  const view = params.get("view") === "list" ? "list" : "grid";
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== "all") next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const list = useMemo(() => {
    const needle = q.toLowerCase();
    return trips
      .filter((t) => (filter === "all" ? tripStatus(t) !== "archived" : tripStatus(t) === filter))
      .filter((t) => !needle || `${t.name} ${t.destination} ${t.members.map((m) => m.name).join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "latest" ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate)));
  }, [trips, q, filter, sort]);

  const count = (f: (typeof FILTERS)[number]) => trips.filter((t) => (f === "all" ? tripStatus(t) !== "archived" : tripStatus(t) === f)).length;

  return (
    <div>
      <PageHeader
        title="My Trips"
        subtitle="Every trip you're planning, on, or reminiscing about."
        actions={<Link to="/app/trips/new" className={cn(buttonVariants(), "h-10 rounded-xl bg-coral text-white hover:bg-[#e97a56] lg:hidden")} data-testid="trips-create-button"><Plus className="size-4" /> Create trip</Link>}
      />
      <Invitations testId="trips-invitations" prefix="trips" />
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-1.5" data-testid="trips-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setParam("status", f)}
              className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium capitalize transition-colors duration-150", filter === f ? "border-forest bg-forest text-white" : "border-line bg-card text-ink-muted hover:text-ink")}
              data-testid={`trips-filter-${f}`}
            >
              {FILTER_LABEL[f]} <span className="num ml-1 opacity-70">{count(f)}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 lg:ml-auto">
          <div className="inline-flex shrink-0 rounded-xl border border-line bg-card p-1" role="group" aria-label="View">
            {([["grid", LayoutGrid, "Grid view"], ["list", List, "List view"]] as const).map(([k, I, label]) => (
              <button key={k} onClick={() => setParam("view", k === "grid" ? "" : k)} className={cn("grid size-8 place-items-center rounded-lg transition-colors", view === k ? "bg-forest text-white" : "text-ink-muted hover:text-ink")} aria-label={label} aria-pressed={view === k} data-testid={`trips-view-${k}`}><I className="size-4" /></button>
            ))}
          </div>
          <label className="relative min-w-0 flex-1 lg:w-64">
            <span className="sr-only">Search trips</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input value={q} onChange={(e) => setParam("q", e.target.value)} placeholder="Filter my trips by name, place or person" aria-label="Filter my trips" className="h-10 rounded-xl pl-9" data-testid="trips-search-input" />
          </label>
          <Select value={sort} onValueChange={(v) => setParam("sort", v)}>
            <SelectTrigger className="h-10 w-36 shrink-0 rounded-xl sm:w-44" aria-label="Sort trips" data-testid="trips-sort-select"><SelectValue>{(v) => SORTS[v as string]}</SelectValue></SelectTrigger>
            <SelectContent>{Object.entries(SORTS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon={MapIcon}
          title={q ? `No trips match “${q}”` : "No trips here yet"}
          body={q ? "Try a different search or clear the filters." : "Create a trip and invite your crew to start planning."}
          action={<Link to="/app/trips/new" className={cn(buttonVariants(), "rounded-xl bg-coral text-white hover:bg-[#e97a56]")} data-testid="trips-empty-create">Create trip</Link>}
          testId="trips-empty-state"
        />
      ) : view === "list" ? (
        <ul className="divide-y rounded-2xl border border-line bg-card" data-testid="trips-list">
          {list.map((t) => (
            <li key={t.id}>
              <Link to={`/app/trips/${t.id}`} className="flex items-center gap-4 p-3 transition-colors hover:bg-muted/50 sm:px-4" data-testid={`trips-list-row-${t.id}`}>
                <img src={t.cover} alt="" className="size-14 shrink-0 rounded-xl object-cover" loading="lazy" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className="block truncate text-xs text-ink-muted">{t.destination} · {fmtRange(t.startDate, t.endDate)}</span>
                </span>
                <span className="num hidden text-sm text-ink-muted md:block">{money(totalSpent(t), t.currency)}{t.budget ? ` of ${money(t.budget, t.currency)}` : ""}</span>
                <span className="hidden sm:block"><AvatarStack people={t.members} size={26} max={3} /></span>
                <StatusBadge status={tripStatus(t)} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="trips-grid">
          {list.map((t) => <TripCard key={t.id} trip={t} />)}
        </div>
      )}
    </div>
  );
}
