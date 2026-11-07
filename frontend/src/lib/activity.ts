import type { TripEvent } from "./types";

const JOINED = /^joined (the trip|via invite link)$/;

/**
 * Makes the activity feed read in order. "You invited Dhruv" followed later by "Dhruv joined the trip"
 * becomes one line, "Dhruv accepted your invitation", instead of the join showing above its invitation.
 * Events arrive newest first; anything that can't be matched is shown as it is.
 */
export function tidyEvents<E extends TripEvent>(events: E[], nameOf: (id: string) => string | undefined, me: string): E[] {
  const used = new Set<string>();
  const out: E[] = [];
  events.forEach((e, i) => {
    if (used.has(e.id)) return;
    const joiner = JOINED.test(e.text) ? nameOf(e.actorId) : undefined;
    const invite = joiner ? events.slice(i + 1).find((o) => !used.has(o.id) && o.text === `invited ${joiner}`) : undefined;
    if (!invite) return void out.push(e);
    used.add(invite.id);
    const inviter = invite.actorId === me ? "your" : `${nameOf(invite.actorId)?.split(" ")[0] ?? "an"}'s`;
    out.push({ ...e, text: `accepted ${inviter} invitation` });
  });
  return out;
}
