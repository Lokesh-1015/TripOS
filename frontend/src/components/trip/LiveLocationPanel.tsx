import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Link } from "react-router-dom";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar } from "@/components/common";
import { apiErrorMessage } from "@/lib/api";
import { startSharing, stopSharing, STALE_AFTER_MS, type LiveLocation } from "@/lib/liveLocation";
import { useApp } from "@/lib/store";
import type { Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

const DURATIONS = [[1, "1 hour"], [4, "4 hours"], [8, "8 hours"]] as const;

export const isStale = (x: LiveLocation) => Date.now() - new Date(x.updatedAt).getTime() > STALE_AFTER_MS;
export const seenLabel = (x: LiveLocation) => (isStale(x) ? `Last seen ${formatDistanceToNowStrict(new Date(x.updatedAt))} ago` : "Live now");

export default function LiveLocationPanel({ trip, locations, onShow }: { trip: Trip; locations: LiveLocation[]; onShow: (x: LiveLocation) => void }) {
  const me = useApp((s) => s.user.id);
  const allowed = useApp((s) => s.settings.privacy.shareLocation);
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState<1 | 4 | 8>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const mine = locations.some((x) => x.userId === me);
  const people = Object.fromEntries(trip.members.map((m) => [m.id, m]));

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setErr(undefined);
    try {
      await action();
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error && !("status" in e) && e.message !== "Failed to fetch" ? e.message : apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-card" data-testid="live-location-panel">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Radio className="size-4 text-coral" /> Live location</h3>
        {mine
          ? <Button size="sm" variant="outline" className="h-8 rounded-lg" disabled={busy} onClick={() => void act(() => stopSharing(trip.id))} data-testid="live-location-stop">Stop sharing</Button>
          : allowed && <Button size="sm" className="h-8 rounded-lg" onClick={() => { setErr(undefined); setOpen(true); }} data-testid="live-location-start">Share</Button>}
      </div>
      {!allowed && <p className="px-4 pt-3 text-xs text-ink-muted" data-testid="live-location-off">Location sharing is off in your <Link to="/app/settings" className="underline">privacy settings</Link>.</p>}
      {locations.length === 0
        ? <p className="px-4 py-4 text-sm text-ink-muted" data-testid="live-location-empty">Nobody is sharing right now. It's off unless someone turns it on.</p>
        : (
          <ul className="divide-y" data-testid="live-location-list">
            {locations.map((x) => {
              const person = people[x.userId];
              if (!person) return null;
              return (
                <li key={x.userId}>
                  <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/60" onClick={() => onShow(x)} data-testid={`live-location-person-${x.userId}`}>
                    <Avatar person={person} size={28} ring={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{x.userId === me ? "You" : person.name}</span>
                      <span className={cn("block text-xs", isStale(x) ? "text-ink-muted" : "text-[#1E7B58]")}>{seenLabel(x)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      {err && !open && <p className="px-4 pb-3 text-xs font-medium text-destructive" role="alert">{err}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="live-location-dialog">
          <DialogHeader>
            <DialogTitle>Share your live location?</DialogTitle>
            <DialogDescription>Only the people on {trip.name} can see it.</DialogDescription>
          </DialogHeader>
          <ul className="grid list-disc gap-1 pl-5 text-sm text-ink-muted">
            <li>It stops by itself at the end of the time you choose, or whenever you press Stop.</li>
            <li>Only your latest position is kept, and it's deleted when sharing ends. There's no history.</li>
            <li>It only updates while TripOS is open on this device. Otherwise people see when you were last seen.</li>
          </ul>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How long to share">
            {DURATIONS.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={hours === value} onClick={() => setHours(value)} className={cn("rounded-xl border p-3 text-sm font-medium transition-colors", hours === value ? "border-forest bg-sage text-forest" : "border-line text-ink-muted hover:text-ink")} data-testid={`live-location-hours-${value}`}>{label}</button>
            ))}
          </div>
          {err && <p className="text-xs font-medium text-destructive" role="alert" data-testid="live-location-error">{err}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void act(() => startSharing(trip.id, hours))} data-testid="live-location-confirm">{busy ? "Finding you..." : "Start sharing"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
