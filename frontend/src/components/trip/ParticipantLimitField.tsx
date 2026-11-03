import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/**
 * `minimum` is how many people have already joined, as the limit can't go below that.
 * The value is kept as typed, so a half-typed number doesn't jump around.
 */
export function ParticipantLimitField({ enabled, value, minimum, error, onChange }: { enabled: boolean; value: string; minimum: number; error?: string; onChange: (next: { enabled: boolean; value: string }) => void }) {
  const total = Number(value);
  return (
    <div className="grid gap-3 rounded-xl border border-line p-4" data-testid="participant-limit">
      <label className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">Set a maximum number of participants for this trip.</span>
        <Switch checked={enabled} onCheckedChange={(on) => onChange({ enabled: on, value: on && !value ? String(Math.max(minimum, 2)) : value })} data-testid="participant-limit-switch" />
      </label>
      {enabled && (
        <div className="grid gap-1.5">
          <Input inputMode="numeric" value={value} onChange={(e) => onChange({ enabled, value: e.target.value.replace(/\D/g, "") })} className="h-10 w-28 rounded-xl" aria-label="Maximum participants" aria-invalid={!!error} data-testid="participant-limit-input" />
          <p className="text-xs text-ink-muted" data-testid="participant-limit-hint">
            This includes you as the host{total >= 1 ? `: you plus ${total - 1} more ${total - 1 === 1 ? "person" : "people"}` : ""}.
            {minimum > 1 && ` ${minimum} people have already joined, so it can't be lower than ${minimum}. Nobody is ever removed by changing this.`}
          </p>
          {error && <p className="text-sm font-medium text-destructive" role="alert" data-testid="participant-limit-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** The problem with a typed limit, if there is one. */
export function participantLimitError(enabled: boolean, value: string, minimum: number) {
  if (!enabled) return undefined;
  const total = Number(value);
  if (!Number.isInteger(total) || total < 1) return "Enter how many people can join";
  if (total > 1000) return "That's more than TripOS can handle on one trip";
  if (total < minimum) return `${minimum} people have already joined, so the limit can't be lower than that`;
  return undefined;
}
