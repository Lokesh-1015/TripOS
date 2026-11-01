// What the signed-in person may do on a trip, used to hide actions they can't take.
// Mirrors server/src/authz/trip-policies.ts. The server still enforces every rule; this is only for the UI.
import { useApp } from "./store";
import type { Member, Role, Trip } from "./types";

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

export function useTripAccess(trip: Pick<Trip, "members">) {
  const me = useApp((s) => s.user.id);
  const role = trip.members.find((m) => m.id === me)?.role ?? "viewer";
  const rank = RANK[role];
  return {
    me,
    role,
    canContribute: rank >= RANK.member,
    canAdmin: rank >= RANK.admin,
    isOwner: role === "owner",
    /** Authors manage their own expenses, polls, photos and documents; admins can moderate anyone's. */
    canModerate: (authorId: string | undefined) => rank >= RANK.member && (authorId === me || rank >= RANK.admin),
    /** Admins and the owner manage only people below them, and never themselves. */
    canManageMember: (target: Pick<Member, "id" | "role">) => rank >= RANK.admin && target.id !== me && rank > RANK[target.role],
    grantableRoles: (["admin", "member", "viewer"] as Role[]).filter((r) => rank > RANK[r]),
  };
}
