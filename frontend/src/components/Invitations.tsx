import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api";
import { actions, useApp } from "@/lib/store";
import { ago } from "@/lib/format";

/**
 * Every trip someone has been invited to and hasn't answered, each with Accept and Decline. Shown on My Trips
 * and the dashboard, so an invitation doesn't only live in the notification bell.
 */
export function Invitations({ testId, prefix }: { testId: string; prefix: string }) {
  const navigate = useNavigate();
  const invites = useApp((s) => s.notifications).filter((n) => n.kind === "invite");
  const [busy, setBusy] = useState<string>();
  if (!invites.length) return null;
  const accept = (id: string) => {
    setBusy(id);
    void actions.acceptInvite(id).then(
      (tripId) => { toast.success("You joined the trip"); navigate(`/app/trips/${tripId}`); },
      (err) => { toast.error(apiErrorMessage(err)); setBusy(undefined); },
    );
  };
  return (
    <section className="mb-6 grid gap-2 rounded-2xl border border-coral/30 bg-coral-soft/60 p-3 sm:p-4" aria-label="Trip invitations" data-testid={testId}>
      <h2 className="px-1 text-sm font-semibold">{invites.length === 1 ? "You're invited" : `${invites.length} trip invitations`}</h2>
      {invites.map((n) => (
        <div key={n.id} className="flex flex-col gap-3 rounded-xl bg-card/80 p-3 sm:flex-row sm:items-center" data-testid={`invitation-${n.id}`}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-coral text-white"><UserPlus className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{n.title}</p>
            <p className="text-xs text-ink-muted">{n.body} · {ago(n.at)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-xl bg-card" disabled={busy === n.id} onClick={() => { actions.dismissNotification(n.id); toast("Invitation declined"); }} data-testid={`${prefix}-invite-decline`}>Decline</Button>
            <Button className="rounded-xl" disabled={busy === n.id} onClick={() => accept(n.id)} data-testid={`${prefix}-invite-accept`}>{busy === n.id ? "Joining…" : "Accept invite"}</Button>
          </div>
        </div>
      ))}
    </section>
  );
}
