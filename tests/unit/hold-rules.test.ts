import { describe, expect, it } from "vitest";
import { holdState, type HoldInputs } from "@/lib/hold-rules";

const DAY = 86_400_000;
const now = new Date("2026-11-20T12:00:00Z");
const held = { status: "AUTHORIZED", intent: "AUTHORIZE", authorizedAt: new Date(now.getTime() - 2 * DAY), authorizationExpiresAt: new Date(now.getTime() + 27 * DAY) };

function inputs(over: Partial<HoldInputs> = {}): HoldInputs {
  return { payment: held, deliveries: [], buyerActions: [], openObjectionCount: 0, notMetCount: 0, deadlineUtc: new Date(now.getTime() + 3 * DAY), reviewWindowDays: 5, now, ...over };
}

describe("hold rules", () => {
  it("nothing is allowed when no payment is held (captured at checkout, voided or never paid)", () => {
    for (const payment of [null, { ...held, status: "COMPLETED" }, { ...held, status: "VOIDED" }, { ...held, intent: "CAPTURE", status: "COMPLETED" }]) {
      const h = holdState(inputs({ payment }));
      expect(h.held).toBe(false);
      expect([h.sellerCapture.allowed, h.sellerVoid.allowed, h.buyerVoid.allowed]).toEqual([false, false, false]);
    }
  });

  it("honor period is 3 days after the authorization; expiry comes from PayPal", () => {
    const h = holdState(inputs());
    expect(h.honorEndsAt!.toISOString()).toBe(new Date(held.authorizedAt.getTime() + 3 * DAY).toISOString());
    expect(h.expiresAt).toEqual(held.authorizationExpiresAt);
    expect(h.expired).toBe(false);
  });

  it("seller capture: needs a delivery, then buyer acceptance or a passed review window with nothing flagged", () => {
    expect(holdState(inputs()).sellerCapture.allowed).toBe(false);
    const d = [{ number: 1, submittedAt: new Date(now.getTime() - 2 * DAY) }];
    expect(holdState(inputs({ deliveries: d })).sellerCapture.reason).toMatch(/until/);
    const accepted = holdState(inputs({ deliveries: d, buyerActions: [{ type: "ACCEPT", createdAt: new Date(now.getTime() - DAY) }] }));
    expect(accepted.buyerAccepted).toBe(true);
    expect(accepted.sellerCapture.allowed).toBe(true);
    const old = [{ number: 1, submittedAt: new Date(now.getTime() - 6 * DAY) }];
    expect(holdState(inputs({ deliveries: old })).sellerCapture.allowed).toBe(true);
    expect(holdState(inputs({ deliveries: old, notMetCount: 1 })).sellerCapture.allowed).toBe(false);
    expect(holdState(inputs({ deliveries: old, openObjectionCount: 2 })).sellerCapture.reason).toMatch(/2 open objections/);
  });

  it("an acceptance of an earlier delivery does not count for a newer one", () => {
    const d = [{ number: 1, submittedAt: new Date(now.getTime() - 3 * DAY) }, { number: 2, submittedAt: new Date(now.getTime() - DAY) }];
    const h = holdState(inputs({ deliveries: d, buyerActions: [{ type: "ACCEPT", createdAt: new Date(now.getTime() - 2 * DAY) }] }));
    expect(h.buyerAccepted).toBe(false);
    expect(h.sellerCapture.allowed).toBe(false);
  });

  it("an expired hold cannot be captured", () => {
    const h = holdState(inputs({ payment: { ...held, authorizationExpiresAt: new Date(now.getTime() - 1) }, deliveries: [{ number: 1, submittedAt: new Date(now.getTime() - 10 * DAY) }] }));
    expect(h.expired).toBe(true);
    expect(h.sellerCapture).toMatchObject({ allowed: false });
  });

  it("buyer release: only after the agreed deadline, only with nothing delivered, and only if a deadline was agreed", () => {
    expect(holdState(inputs()).buyerVoid.allowed).toBe(false);
    const past = new Date(now.getTime() - DAY);
    expect(holdState(inputs({ deadlineUtc: past })).buyerVoid.allowed).toBe(true);
    expect(holdState(inputs({ deadlineUtc: past, deliveries: [{ number: 1, submittedAt: past }] })).buyerVoid.allowed).toBe(false);
    expect(holdState(inputs({ deadlineUtc: null })).buyerVoid.reason).toMatch(/No deadline/);
    expect(holdState(inputs()).sellerVoid.allowed).toBe(true);
  });
});
