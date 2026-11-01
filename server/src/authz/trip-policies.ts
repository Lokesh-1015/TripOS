import { hasAtLeastRole, outranks, type TripActor, type TripRole } from "./trip-roles.js";

/** Not a bare boolean: the reason becomes the message the UI shows. */
export type PolicyResult = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

const ALLOW: PolicyResult = { allowed: true };
const deny = (reason: string): PolicyResult => ({ allowed: false, reason });

function requireRole(actor: TripActor, required: TripRole, action: string): PolicyResult {
  // An invited or removed member has no access at all, whatever their role says.
  if (actor.status !== "active") return deny("You are not an active member of this trip");
  return hasAtLeastRole(actor.role, required) ? ALLOW : deny(`Only ${required}s or above can ${action}`);
}

export const canViewTrip = (actor: TripActor) => requireRole(actor, "viewer", "view this trip");
export const canEditTrip = (actor: TripActor) => requireRole(actor, "admin", "edit trip details");
export const canDeleteTrip = (actor: TripActor) => requireRole(actor, "owner", "delete a trip");
export const canInviteMembers = (actor: TripActor) => requireRole(actor, "admin", "invite members");
export const canContribute = (actor: TripActor) => requireRole(actor, "member", "add or edit trip content");

export function canRemoveMember(actor: TripActor, target: TripActor): PolicyResult {
  const permitted = requireRole(actor, "admin", "remove members");
  if (!permitted.allowed) return permitted;
  if (target.userId === actor.userId) return deny("You can't remove yourself from a trip");
  if (target.role === "owner") return deny("The trip owner can't be removed");
  return outranks(actor.role, target.role) ? ALLOW : deny("You can't remove a member with the same or higher role");
}

export function canChangeMemberRole(actor: TripActor, target: TripActor, newRole: TripRole): PolicyResult {
  const permitted = requireRole(actor, "admin", "change member roles");
  if (!permitted.allowed) return permitted;
  if (newRole === "owner") return deny("Ownership can't be assigned as a role");
  if (target.role === "owner") return deny("The owner's role can't be changed");
  if (target.userId === actor.userId) return deny("You can't change your own role");
  if (!outranks(actor.role, target.role)) return deny("You can't change the role of a member at or above your own");
  // Strictly outranks: an admin appointing admins would create peers only the owner could remove.
  return outranks(actor.role, newRole) ? ALLOW : deny("You can't grant a role at or above your own");
}

/** Authors manage their own content; admins can moderate anyone's. */
export function canManageOwnContent(actor: TripActor, authorId: string, noun: string): PolicyResult {
  const permitted = requireRole(actor, "member", `change ${noun}`);
  if (!permitted.allowed) return permitted;
  return authorId === actor.userId || hasAtLeastRole(actor.role, "admin") ? ALLOW : deny(`Only the person who added this ${noun} or an admin can change it`);
}
