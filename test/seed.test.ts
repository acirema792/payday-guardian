import { describe, expect, it } from "vitest";
import { toMinor } from "../src/policy/money.ts";
import { planEmployerPayroll } from "../src/policy/planner.ts";
import { contractors, contractorsOf, employers, indicativeUsdRates, policyConfig } from "../src/scenario/seed.ts";

const PAYDAY = new Date("2026-11-06T00:00:00Z");
const EARLY = new Date("2026-11-06T05:00:00Z"); // before every cut-off

function plan(employerId: string, usd: string) {
  const employer = { ...employers.find((e) => e.employerId === employerId)!, accountId: `acct_${employerId}` };
  return planEmployerPayroll({
    employer,
    contractors: contractorsOf(employerId),
    balances: { accountId: employer.accountId, available: { USD: toMinor(usd, "USD") } },
    rates: indicativeUsdRates,
    payday: PAYDAY,
    now: EARLY,
    config: policyConfig,
  });
}

describe("seed scenario", () => {
  it("has 3 employers x 12 contractors across six countries", () => {
    expect(employers).toHaveLength(3);
    for (const e of employers) expect(contractorsOf(e.employerId)).toHaveLength(12);
    expect(new Set(contractors.map((c) => c.country))).toEqual(new Set(["US", "GB", "DE", "MX", "PH", "IN"]));
    expect(new Set(contractors.map((c) => c.id)).size).toBe(36);
  });

  it("employer A's initial funding pays everyone and the platform fee", () => {
    const a = plan("emp_a", employers[0].initialFundingMajor);
    expect(a.payouts.every((p) => p.status === "pay")).toBe(true);
    expect(a.platformFee.status).toBe("collect");
    expect(a.fundingRequestMinor).toBe(0n);
  });

  it("employer B's partial funding pays statutory wages first and requests the rest", () => {
    const b = plan("emp_b", employers[1].initialFundingMajor);
    const statutory = b.payouts.filter((p) => p.contractor.priority === "statutory");
    expect(statutory.every((p) => p.status === "pay")).toBe(true);
    expect(b.payouts.some((p) => p.status === "hold")).toBe(true);
    expect(b.fundingRequestMinor).toBeGreaterThan(0n);
  });

  it("employer C pays nobody until its own deposit lands", () => {
    const before = plan("emp_c", "0");
    expect(before.payouts.every((p) => p.status === "hold")).toBe(true);
    const after = plan("emp_c", employers[2].midRunDepositMajor!);
    expect(after.payouts.every((p) => p.status === "pay")).toBe(true);
  });

  it("routes the USD account in Mexico over SWIFT and everything else locally", () => {
    const a = plan("emp_a", "40000");
    const swift = a.payouts.filter((p) => p.method === "SWIFT").map((p) => p.contractor.name);
    expect(swift).toEqual(["Diego Ramirez"]);
  });
});
