// Ported from the earlier project (ADR-0006). Pure so the rules can be tested without a database.
export type TripRole = "owner" | "admin" | "member" | "viewer";
export type MemberStatus = "invited" | "active" | "removed";

const ROLE_RANK: Record<TripRole, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

export interface TripActor {
  readonly userId: string;
  readonly tripId: string;
  readonly role: TripRole;
  readonly status: MemberStatus;
}

export const hasAtLeastRole = (actual: TripRole, required: TripRole) => ROLE_RANK[actual] >= ROLE_RANK[required];
export const outranks = (actor: TripRole, target: TripRole) => ROLE_RANK[actor] > ROLE_RANK[target];
