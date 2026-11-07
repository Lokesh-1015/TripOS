import { useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/common";
import { useFriends, usePeopleSearch } from "@/lib/social";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ListSkeleton } from "@/components/PageLoading";

export interface PickedPerson {
  id: string;
  name: string;
  avatar: string;
  username?: string;
}

/** People this person has actually travelled with: active members of their trips, newest trips first. */
function usePastCoTravellers() {
  const me = useApp((s) => s.user.id);
  const trips = useApp((s) => s.trips);
  return useMemo(() => {
    const seen = new Map<string, PickedPerson>();
    for (const t of trips) for (const m of t.members) {
      if (m.id !== me && m.status !== "invited" && !seen.has(m.id)) seen.set(m.id, { id: m.id, name: m.name, avatar: m.avatar });
    }
    return [...seen.values()];
  }, [trips, me]);
}

function PersonRow({ person, state, label, onPick }: { person: PickedPerson; state: "pick" | "added" | "busy"; label: string; onPick: () => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2" data-testid={`invite-person-${person.id}`}>
      <Avatar person={person} size={32} ring={false} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{person.name}</p>
        {person.username && <p className="truncate text-xs text-ink-muted">@{person.username}</p>}
      </div>
      {state === "added"
        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-forest"><Check className="size-3.5" /> Added</span>
        : <Button size="sm" variant="outline" className="h-8 rounded-lg" disabled={state === "busy"} onClick={onPick} data-testid={`invite-pick-${person.id}`}>{label}</Button>}
    </div>
  );
}

function Section({ title, people, testId, render }: { title: string; people: PickedPerson[]; testId: string; render: (p: PickedPerson) => React.ReactNode }) {
  if (!people.length) return null;
  return (
    <div data-testid={testId}>
      <p className="px-3 pt-2.5 pb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">{title}</p>
      {people.map(render)}
    </div>
  );
}

/**
 * Picks travellers to invite: by searching names and usernames (never email addresses), from friends,
 * or from people on past trips. `added` holds everyone already invited or on the trip.
 */
export function InvitePeople({ added, busyId, label = "Invite", onPick }: { added: Set<string>; busyId?: string; label?: string; onPick: (person: PickedPerson) => void }) {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim().replace(/^@/, "")), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const searching = q.length >= 2;
  const search = usePeopleSearch(q);
  const friends = useFriends();
  const past = usePastCoTravellers();
  const friendList: PickedPerson[] = (friends.data ?? []).map((f) => ({ id: f.id, name: f.name, avatar: f.avatar, username: f.username }));
  const friendIds = new Set(friendList.map((f) => f.id));
  const pastList = past.filter((p) => !friendIds.has(p.id));
  const results: PickedPerson[] = (search.data ?? []).map((r) => ({ id: r.id, name: r.name, avatar: r.avatar, username: r.username }));
  const row = (p: PickedPerson) => <PersonRow key={p.id} person={p} label={label} state={added.has(p.id) ? "added" : busyId === p.id ? "busy" : "pick"} onPick={() => onPick(p)} />;

  return (
    <div className="grid gap-2" data-testid="invite-people">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by name or username" aria-label="Search travellers by name or username" autoComplete="off" className="h-10 rounded-xl pl-9" data-testid="invite-search-input" />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
        {searching ? (
          search.isPending ? <div className="p-2"><ListSkeleton rows={2} testId="invite-searching" /></div>
            : results.length ? <Section title="Travellers" people={results} testId="invite-section-search" render={row} />
            : <p className="px-3 py-3 text-sm text-ink-muted" data-testid="invite-no-results">No travellers match “{q}”.</p>
        ) : friendList.length || pastList.length ? (
          <>
            <Section title="Friends" people={friendList} testId="invite-section-friends" render={row} />
            <Section title="Past co-travellers" people={pastList} testId="invite-section-past" render={row} />
          </>
        ) : (
          <p className={cn("px-3 py-3 text-sm text-ink-muted")} data-testid="invite-empty">Search for someone by name or username. Your friends and people from your past trips will show here too.</p>
        )}
      </div>
    </div>
  );
}
