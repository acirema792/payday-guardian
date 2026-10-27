import { describe, expect, it } from "vitest";
import { fraudHolds } from "../src/policy/fraud.ts";
import { toMinor } from "../src/policy/money.ts";
import { route } from "../src/policy/routing.ts";
import { MORNING, PAYDAY, config, contractor } from "./fixtures.ts";

describe("fraud holds", () => {
  it("holds a bank-detail change requested by email the day before payday", () => {
    const maria = contractor({
      id: "maria",
      employerId: "emp_a",
      bankDetailsChangedAt: new Date("2026-11-05T10:00:00Z"),
      bankDetailsChangeChannel: "email",
    });
    const codes = fraudHolds(maria, PAYDAY, 5).map((r) => r.code);
    expect(codes).toEqual(["bank_details_changed_recently", "unverified_instruction_channel"]);
  });

  it("does not hold an old change made through the verified portal", () => {
    const old = contractor({
      id: "old",
      employerId: "emp_a",
      bankDetailsChangedAt: new Date("2026-09-01T00:00:00Z"),
      bankDetailsChangeChannel: "verified_portal",
    });
    expect(fraudHolds(old, PAYDAY, 5)).toEqual([]);
  });

  it("does not hold contractors whose details never changed", () => {
    expect(fraudHolds(contractor({ id: "x", employerId: "emp_a" }), PAYDAY, 5)).toEqual([]);
  });
});

describe("routing", () => {
  it("uses LOCAL (free) when the rail exists and its cut-off has not passed", () => {
    expect(route(contractor({ id: "us", employerId: "emp_a" }), MORNING, config)).toEqual({ ok: true, method: "LOCAL", feeMinor: 0n });
  });

  it("uses SWIFT with its fee where there is no LOCAL rail", () => {
    const de = contractor({ id: "de", employerId: "emp_a", country: "DE", currency: "EUR" });
    expect(route(de, MORNING, config)).toEqual({ ok: true, method: "SWIFT", feeMinor: toMinor("12.85", "EUR") });
  });

  it("falls back to SWIFT when the LOCAL cut-off passed but SWIFT still lands", () => {
    const gb = contractor({ id: "gb", employerId: "emp_a", country: "GB", currency: "GBP" });
    const swiftConfig = { ...config, swiftFeeMinor: { ...config.swiftFeeMinor, GBP: 1000n } };
    const gbLateRails = { ...swiftConfig, rails: { ...config.rails, GB: { ...config.rails.GB, swiftCutoffUtc: "16:00" } } };
    expect(route(gb, new Date("2026-11-06T15:30:00Z"), gbLateRails)).toEqual({ ok: true, method: "SWIFT", feeMinor: 1000n });
  });

  it("escalates when every cut-off has passed", () => {
    const ph = contractor({ id: "ph", employerId: "emp_a", country: "PH", currency: "PHP" });
    const decision = route(ph, MORNING, config);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason.code).toBe("cutoff_missed");
  });

  it("refuses to guess a SWIFT fee it was not given", () => {
    const gb = contractor({ id: "gb", employerId: "emp_a", country: "GB", currency: "GBP" });
    expect(() => route(gb, new Date("2026-11-06T15:30:00Z"), { ...config, rails: { ...config.rails, GB: { ...config.rails.GB, swiftCutoffUtc: "16:00" } } })).toThrow(/No SWIFT fee/);
  });
});
