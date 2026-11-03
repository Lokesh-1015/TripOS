import { useState } from "react";
import { Link } from "react-router-dom";
import { Globe, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TravellerRow } from "@/components/social";
import { ApiError, apiErrorMessage } from "@/lib/api";
import { isTripFull, joinedCount } from "@/lib/format";
import { useJoinActions, useJoinRequests, type JoinRequestRow } from "@/lib/publicTrips";
import type { Trip } from "@/lib/types";

/** Where a host decides who joins. Being public only makes a trip findable: nobody gets in without this. */
export default function JoinRequestsPanel({ trip }: { trip: Trip }) {
  const { data } = useJoinRequests(trip.id, true);
  const join = useJoinActions();
  const [busy, setBusy] = useState<string>();
  const [showAnswered, setShowAnswered] = useState(false);
  const full = isTripFull(trip);
  const run = (id: string, work: Promise<unknown>, done: string) => {
    setBusy(id);
    void work.then(() => toast.success(done), (err) => {
      const isFull = err instanceof ApiError && (err.body as { code?: string } | null)?.code === "TRIP_FULL";
      toast.error(isFull ? "The trip is now full. Raise the limit to accept this person." : apiErrorMessage(err));
    }).finally(() => setBusy(undefined));
  };
  const answered: (JoinRequestRow & { status: string })[] = [...(data?.accepted ?? []).map((r) => ({ ...r, status: "Accepted" })), ...(data?.rejected ?? []).map((r) => ({ ...r, status: "Not accepted" }))];
  return (
    <section className="rounded-2xl border border-line bg-card" data-testid="join-requests-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><UserPlus className="size-4 text-forest" /> Requests to join {data?.pending.length ? <span className="num rounded-full bg-coral px-2 text-xs font-bold text-white" data-testid="join-requests-count">{data.pending.length}</span> : null}</h2>
        {trip.visibility === "public" && <Link to={`/app/explore/${trip.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-forest hover:underline" data-testid="join-requests-public-link"><Globe className="size-3.5" /> See the public page</Link>}
      </div>
      {full && <p className="mx-4 mb-3 rounded-xl bg-coral-soft px-3 py-2 text-sm text-[#8A3B22]" data-testid="join-requests-full">This trip is full ({joinedCount(trip)} of {trip.maxParticipants}). Raise the limit in Edit trip to accept anyone else.</p>}
      {!data?.pending.length && <p className="px-4 pb-4 text-sm text-ink-muted" data-testid="join-requests-empty">No requests waiting.</p>}
      {data?.pending.length ? (
        <div className="divide-y border-t" data-testid="join-requests-pending">
          {data.pending.map((r) => (
            <div key={r.id} data-testid={`join-request-${r.person.username}`}>
              <TravellerRow person={r.person} actions={<>
                <Button className="rounded-xl" disabled={busy === r.id || full} onClick={() => run(r.id, join.accept(trip.id, r.id), `${r.person.name.split(" ")[0]} has joined`)} data-testid={`join-request-accept-${r.person.username}`}>Accept</Button>
                <Button variant="outline" className="rounded-xl" disabled={busy === r.id} onClick={() => run(r.id, join.reject(trip.id, r.id), "Request declined")} data-testid={`join-request-reject-${r.person.username}`}>Decline</Button>
              </>} />
              {r.message && <p className="mx-4 mb-4 whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm" data-testid={`join-request-message-${r.person.username}`}>{r.message}</p>}
            </div>
          ))}
        </div>
      ) : null}
      {answered.length > 0 && (
        <div className="border-t p-3">
          <Button variant="ghost" size="sm" onClick={() => setShowAnswered(!showAnswered)} aria-expanded={showAnswered} data-testid="join-requests-answered-toggle">{showAnswered ? "Hide" : "Show"} past requests ({answered.length})</Button>
          {showAnswered && <ul className="mt-2 grid gap-1 px-2 text-sm" data-testid="join-requests-answered">{answered.map((r) => <li key={r.id} className="flex justify-between gap-3"><Link to={`/app/u/${r.person.username}`} className="truncate hover:underline">{r.person.name}</Link> <span className="shrink-0 text-ink-muted">{r.status}</span></li>)}</ul>}
        </div>
      )}
    </section>
  );
}
