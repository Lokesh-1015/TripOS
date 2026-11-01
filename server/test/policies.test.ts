import { describe, expect, it } from "vitest";
import { canChangeMemberRole, canContribute, canDeleteTrip, canManageOwnContent, canRemoveMember, canViewTrip } from "../src/authz/trip-policies.js";
import type { MemberStatus, TripActor, TripRole } from "../src/authz/trip-roles.js";
import { expenseDeltas, settlementDeltas, sharesMatchTotal, toMinor } from "../src/common/money.js";

const actor = (role: TripRole, userId = "u1", status: MemberStatus = "active"): TripActor => ({ userId, tripId: "t", role, status });

describe("trip policies", () => {
  it("gives invited and removed members no access, whatever their role", () => {
    for (const status of ["invited", "removed"] as const) {
      expect(canViewTrip(actor("admin", "u1", status)).allowed).toBe(false);
      expect(canContribute(actor("owner", "u1", status)).allowed).toBe(false);
    }
  });

  it("makes viewers read-only", () => {
    expect(canViewTrip(actor("viewer")).allowed).toBe(true);
    expect(canContribute(actor("viewer")).allowed).toBe(false);
  });

  it("lets only the owner delete a trip", () => {
    expect(canDeleteTrip(actor("owner")).allowed).toBe(true);
    expect(canDeleteTrip(actor("admin")).allowed).toBe(false);
  });

  it("stops anyone removing the owner, themselves or a peer", () => {
    expect(canRemoveMember(actor("admin"), actor("owner", "u2")).allowed).toBe(false);
    expect(canRemoveMember(actor("owner"), actor("owner")).allowed).toBe(false);
    expect(canRemoveMember(actor("admin"), actor("admin", "u2")).allowed).toBe(false);
    expect(canRemoveMember(actor("admin"), actor("member", "u2")).allowed).toBe(true);
  });

  it("blocks privilege escalation", () => {
    expect(canChangeMemberRole(actor("admin"), actor("member", "u2"), "admin").allowed).toBe(false);
    expect(canChangeMemberRole(actor("member"), actor("member"), "admin").allowed).toBe(false);
    expect(canChangeMemberRole(actor("owner"), actor("member", "u2"), "owner").allowed).toBe(false);
    expect(canChangeMemberRole(actor("owner"), actor("member", "u2"), "admin").allowed).toBe(true);
    expect(canChangeMemberRole(actor("admin"), actor("member", "u2"), "viewer").allowed).toBe(true);
  });

  it("lets authors and admins manage content, and nobody else", () => {
    expect(canManageOwnContent(actor("member"), "u1", "expense").allowed).toBe(true);
    expect(canManageOwnContent(actor("member"), "u2", "expense").allowed).toBe(false);
    expect(canManageOwnContent(actor("admin"), "u2", "expense").allowed).toBe(true);
    expect(canManageOwnContent(actor("viewer"), "u1", "expense").allowed).toBe(false);
  });
});

describe("money", () => {
  it("converts amounts without floating point drift", () => {
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMinor(100.01)).toBe(10001);
    expect(toMinor(1.005 * 1000)).toBe(100500);
  });

  it("requires shares to equal the total exactly", () => {
    expect(sharesMatchTotal(10001, [5001, 5000])).toBe(true);
    expect(sharesMatchTotal(10001, [5000, 5000])).toBe(false);
  });

  it("always nets to zero across the group", () => {
    const shares = [{ memberId: "a", amountMinor: 3334 }, { memberId: "b", amountMinor: 3333 }, { memberId: "c", amountMinor: 3333 }];
    expect(expenseDeltas("a", 10000, shares).reduce((s, d) => s + d.amountMinor, 0)).toBe(0);
    expect(settlementDeltas("a", "b", 500).reduce((s, d) => s + d.amountMinor, 0)).toBe(0);
  });
});
