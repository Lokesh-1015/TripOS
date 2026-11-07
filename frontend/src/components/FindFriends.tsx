import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/common";
import { FriendButton } from "@/components/social";
import { ListSkeleton } from "@/components/PageLoading";
import { usePeopleSearch, type TravellerCard } from "@/lib/social";
import { useSuggestedTravellers } from "@/lib/publicTrips";

function Row({ person }: { person: TravellerCard }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5" data-testid={`find-friends-person-${person.id}`}>
      <Avatar person={person} size={36} ring={false} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{person.name}</p>
        <p className="truncate text-xs text-ink-muted">@{person.username}</p>
      </div>
      <FriendButton person={person} />
    </div>
  );
}

/** Search by name or username, with travellers who share your interests until you type. Never by email. */
export function FindFriends() {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim().replace(/^@/, "")), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const searching = q.length >= 2;
  const search = usePeopleSearch(q);
  const suggested = useSuggestedTravellers();
  const people = searching ? search.data : suggested.data;
  const loading = searching ? search.isPending : suggested.isPending;
  return (
    <div className="grid gap-3" data-testid="find-friends">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by name or username" aria-label="Search travellers by name or username" autoComplete="off" className="h-11 rounded-xl pl-9" data-testid="find-friends-search" />
      </div>
      <div className="max-h-80 overflow-y-auto rounded-xl border border-line bg-card">
        {loading ? <div className="p-2"><ListSkeleton rows={3} testId="find-friends-loading" /></div>
          : people?.length ? (
            <>
              {!searching && <p className="px-3 pt-2.5 pb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Travellers like you</p>}
              {people.map((p) => <Row key={p.id} person={p} />)}
            </>
          ) : <p className="px-3 py-4 text-sm text-ink-muted" data-testid="find-friends-empty">{searching ? `No travellers match “${q}”.` : "Search for friends who already use TripOS."}</p>}
      </div>
    </div>
  );
}
