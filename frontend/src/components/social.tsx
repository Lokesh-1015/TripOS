import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/common";
import { apiErrorMessage } from "@/lib/api";
import { useSocialActions, type TravellerCard } from "@/lib/social";

/** Add Friend, Request Sent, Accept Request or Friends, for wherever a traveller appears. */
export function FriendButton({ person }: { person: Pick<TravellerCard, "username" | "relationship" | "requestId" | "canSendRequest"> }) {
  const social = useSocialActions();
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    void work().then(() => { if (done) toast.success(done); }, (err) => toast.error(apiErrorMessage(err))).finally(() => setBusy(false));
  };
  if (person.relationship === "self") return null;
  if (person.relationship === "friends") return <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-sage px-3 text-sm font-medium text-forest" data-testid="friend-state-friends"><Check className="size-4" /> Friends</span>;
  if (person.relationship === "request_sent") {
    return <Button variant="outline" className="rounded-xl" disabled={busy} onClick={() => run(() => social.cancel(person.requestId as string), "Request cancelled")} data-testid="friend-state-sent"><Clock className="size-4" /> Request Sent</Button>;
  }
  if (person.relationship === "request_received") {
    return (
      <Button className="rounded-xl" disabled={busy} onClick={() => run(() => social.accept(person.requestId as string), "You're now friends")} data-testid="friend-state-accept"><Check className="size-4" /> Accept Request</Button>
    );
  }
  if (!person.canSendRequest) return null;
  return <Button className="rounded-xl" disabled={busy} onClick={() => run(() => social.sendRequest(person.username), "Friend request sent")} data-testid="friend-state-add"><UserPlus className="size-4" /> Add Friend</Button>;
}

/** What two travellers have in common is what matters here, rather than how many friends someone has. */
export function TravellerRow({ person, actions }: { person: TravellerCard; actions?: React.ReactNode }) {
  const common = [
    person.sharedStyles.length ? `You both like ${person.sharedStyles.slice(0, 3).join(", ")}` : "",
    person.mutualFriends ? `${person.mutualFriends} mutual ${person.mutualFriends === 1 ? "friend" : "friends"}` : "",
    person.location,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-3 p-4" data-testid={`traveller-${person.username}`}>
      <Link to={`/app/u/${person.username}`} className="flex min-w-0 flex-1 items-center gap-3" data-testid={`traveller-link-${person.username}`}>
        <Avatar person={person} size={44} ring={false} />
        <span className="min-w-0">
          <span className="block truncate font-medium">{person.name}</span>
          <span className="block truncate text-xs text-ink-muted">@{person.username}{person.limited ? " · Private profile" : ""}</span>
          {common.length > 0 && <span className="mt-0.5 block truncate text-xs text-ink-muted">{common.join(" · ")}</span>}
        </span>
      </Link>
      <div className="flex flex-wrap items-center gap-2">{actions ?? <FriendButton person={person} />}</div>
    </div>
  );
}
