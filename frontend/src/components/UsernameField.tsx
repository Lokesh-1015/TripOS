import { format, parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common";
import { useUsernameCheck } from "@/lib/social";

export type UsernameState = "unchanged" | "locked" | "checking" | "available" | "unavailable";

/** The username as it will be saved: no "@", lowercase. */
export const cleanUsername = (value: string) => value.trim().replace(/^@/, "").toLowerCase();

/**
 * Checks a username while someone types: whether it's free, and whether this person can change it yet.
 * `setup` is for the first choice while creating an account, which doesn't start the 30-day wait.
 */
export function useUsernameStatus(value: string, current: string, nextChangeAt: string | null, setup = false) {
  const locked = !setup && !!nextChangeAt;
  const typed = cleanUsername(value);
  const changed = typed !== current;
  const { data, isFetching } = useUsernameCheck(value, changed && !locked && typed.length > 0);
  const state: UsernameState = locked ? "locked"
    : !changed ? "unchanged"
    : !typed ? "unavailable"
    : isFetching || !data || data.username !== typed ? "checking"
    : data.available ? "available" : "unavailable";
  const reason = !typed ? "Choose a username" : data?.reason ?? null;
  return { state, typed, reason, locked };
}

export function UsernameField({ id, value, current, nextChangeAt, setup = false, onChange, testId = "profile-username-input", inputClassName = "" }: {
  id: string;
  value: string;
  current: string;
  nextChangeAt: string | null;
  setup?: boolean;
  onChange: (value: string) => void;
  testId?: string;
  inputClassName?: string;
}) {
  const { state, typed, reason, locked } = useUsernameStatus(value, current, nextChangeAt, setup);
  const after = setup ? "You can change it later, once every 30 days." : "After changing it, you can't change it again for 30 days.";
  const hint = state === "locked"
    ? <span data-testid="username-locked">You can change it again on {format(parseISO(nextChangeAt as string), "d MMMM yyyy")}.</span>
    : state === "unchanged"
      ? <span>{setup ? `@${current} is yours. Keep it or choose another. ${after}` : "Letters, numbers, underscores and periods. You can change it once every 30 days."}</span>
      : state === "checking"
        ? <span>Checking…</span>
        : state === "available"
          ? <span className="text-forest" data-testid="username-available">@{typed} is available. {after}</span>
          : <span className="text-destructive" data-testid="username-unavailable">{reason}</span>;
  return (
    <Field label="Username" htmlFor={id} hint={hint}>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-muted">@</span>
        <Input id={id} value={value} maxLength={31} disabled={locked || !current} placeholder={current ? undefined : "Loading…"} autoComplete="off" autoCapitalize="none" spellCheck={false} className={`pl-7 ${inputClassName}`} onChange={(e) => onChange(e.target.value.replace(/^@/, ""))} data-testid={testId} />
      </div>
    </Field>
  );
}
