import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common";
import { apiDelete, apiErrorMessage, apiGet, apiPost } from "@/lib/api";
import { actions, saved } from "@/lib/store";
import type { Member, Trip } from "@/lib/types";
import { ListSkeleton } from "@/components/PageLoading";

interface LeaveOptions {
  mode: "request" | "direct" | "choose_successor" | "only_person";
  role: string;
  request: { id: string; at: string } | null;
  nextOwner: { id: string; name: string } | null;
  candidates: { id: string; name: string; role: string }[];
}

const STAYS = "Everything you've added, such as expenses, messages and memories, stays with the group. You'll lose access to the trip.";

/** Leaving a trip, explained for whoever's asking: members ask an admin, and the last admin hands over first. */
export function LeaveTripDialog({ trip, open, onClose, onDeleteTrip }: { trip: Trip; open: boolean; onClose: () => void; onDeleteTrip: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data, isPending, isError } = useQuery({ queryKey: ["leave", trip.id], queryFn: () => apiGet<LeaveOptions>(`/trips/${trip.id}/leave`), enabled: open });
  const [successor, setSuccessor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    try {
      await work();
      await client.invalidateQueries({ queryKey: ["leave", trip.id] });
      after();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const leave = () => run(() => apiPost(`/trips/${trip.id}/leave`, { successorId: successor }), () => {
    onClose();
    saved(`You've left ${trip.name}`);
    void actions.reload();
    navigate("/app/trips", { replace: true });
  });
  const ask = () => run(() => apiPost(`/trips/${trip.id}/leave`, {}), () => { saved("Request sent", { description: "An admin will decide, and we'll let you know." }); void actions.refreshTrip(trip.id); });
  const cancel = () => run(() => apiDelete(`/trips/${trip.id}/leave`), () => { saved("Request cancelled"); void actions.refreshTrip(trip.id); });

  let body: React.ReactNode = <ListSkeleton rows={1} />;
  let footer: React.ReactNode = null;
  if (isError) body = <p className="text-sm text-destructive" role="alert">This couldn't be loaded. Please try again.</p>;
  else if (!isPending && data) {
    if (data.mode === "request" && data.request) {
      body = <p className="rounded-xl bg-muted p-3 text-sm" data-testid="leave-pending">You've asked to leave. An admin will approve or decline it, and we'll let you know.</p>;
      footer = <Button variant="outline" disabled={busy} onClick={() => void cancel()} data-testid="leave-cancel-request">Cancel request</Button>;
    } else if (data.mode === "request") {
      body = <p className="text-sm">An admin needs to approve this before you leave. {STAYS}</p>;
      footer = <Button disabled={busy} onClick={() => void ask()} data-testid="leave-ask">Ask to leave</Button>;
    } else if (data.mode === "direct") {
      body = <p className="text-sm">{data.nextOwner ? `${data.nextOwner.name} will become the trip's owner. ` : ""}{STAYS}</p>;
      footer = <Button variant="destructive" disabled={busy} onClick={() => void leave()} data-testid="leave-confirm">Leave trip</Button>;
    } else if (data.mode === "choose_successor") {
      body = (
        <div className="grid gap-3">
          <p className="text-sm">You're the only admin, so choose someone to take over. They become {data.role === "owner" ? "the owner" : "an admin"} at the moment you leave. {STAYS}</p>
          <Field label="Hand the trip over to">
            <Select value={successor ?? ""} onValueChange={(v) => setSuccessor(v as string)}>
              <SelectTrigger className="w-full rounded-xl" data-testid="leave-successor"><SelectValue>{(v) => data.candidates.find((c) => c.id === v)?.name ?? "Choose someone"}</SelectValue></SelectTrigger>
              <SelectContent>{data.candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
      );
      footer = <Button variant="destructive" disabled={busy || !successor} onClick={() => void leave()} data-testid="leave-handover">Hand over and leave</Button>;
    } else {
      body = (
        <div className="grid gap-2 text-sm" data-testid="leave-only-person">
          <p>You're the only person on this trip, so there's nobody to hand it over to.</p>
          <p>You can delete the trip instead, or invite someone, make them an admin, and then leave.</p>
        </div>
      );
      footer = data.role === "owner" ? <Button variant="destructive" onClick={() => { onClose(); onDeleteTrip(); }} data-testid="leave-delete-instead">Delete trip</Button> : null;
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="leave-dialog">
        <DialogHeader>
          <DialogTitle>Leave {trip.name}?</DialogTitle>
          <DialogDescription>You can come back later if someone invites you or shares the link.</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** For admins, next to someone who has asked to leave. */
export function LeaveRequestActions({ trip, member }: { trip: Trip; member: Member }) {
  const request = trip.leaveRequests?.find((r) => r.userId === member.id);
  const [busy, setBusy] = useState(false);
  if (!request) return null;
  const answer = (approve: boolean) => {
    setBusy(true);
    void apiPost(`/trips/${trip.id}/leave-requests/${request.id}/${approve ? "approve" : "reject"}`)
      .then(() => { saved(approve ? `${member.name.split(" ")[0]} has left the trip` : "Request declined"); return actions.refreshTrip(trip.id); }, (err) => toast.error(apiErrorMessage(err)))
      .finally(() => setBusy(false));
  };
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid={`leave-request-${member.id}`}>
      <span className="inline-flex items-center gap-1 rounded-full bg-coral-soft px-2 py-0.5 text-xs font-medium text-[#8A3B22]"><LogOut className="size-3" /> Asked to leave</span>
      <Button size="sm" variant="outline" className="h-7 rounded-lg" disabled={busy} onClick={() => answer(true)} data-testid={`leave-approve-${member.id}`}>Approve</Button>
      <Button size="sm" variant="ghost" className="h-7 rounded-lg" disabled={busy} onClick={() => answer(false)} data-testid={`leave-reject-${member.id}`}>Decline</Button>
    </span>
  );
}
