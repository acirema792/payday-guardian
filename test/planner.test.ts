import { describe, expect, it } from "vitest";
import { toMinor } from "../src/policy/money.ts";
import { TenantIsolationError, planEmployerPayroll, type PlanInput } from "../src/policy/planner.ts";
import type { Contractor, Employer, WalletBalances } from "../src/policy/types.ts";
import { MORNING, PAYDAY, config, contractor, employerA, employerB, employerC } from "./fixtures.ts";

const usd = (v: string) => toMinor(v, "USD");
const eur = (v: string) => toMinor(v, "EUR");

function input(employer: Employer, contractors: Contractor[], available: Record<string, bigint>, overrides: Partial<PlanInput> = {}): PlanInput {
  const balances: WalletBalances = { accountId: employer.accountId, available };
  return { employer, contractors, balances, rates: { EUR: "1.10" }, payday: PAYDAY, now: MORNING, config, ...overrides };
}

const statusOf = (plan: ReturnType<typeof planEmployerPayroll>) =>
  Object.fromEntries(plan.payouts.map((p) => [p.contractor.id, p.status]));

describe("tenant isolation", () => {
  it("refuses to plan an employer's payroll from another employer's wallet", () => {
    const cBalances: WalletBalances = { accountId: employerC.accountId, available: { USD: usd("1000000") } };
    const run = () => planEmployerPayroll({ ...input(employerB, [], {}), balances: cBalances });
    expect(run).toThrow(TenantIsolationError);
  });

  it("refuses contractors that belong to another employer", () => {
    const stray = contractor({ id: "a1", employerId: employerA.employerId });
    expect(() => planEmployerPayroll(input(employerB, [stray], { USD: usd("5000") }))).toThrow(TenantIsolationError);
  });

  it("a deposit landing in employer C does not fund employer B (the cross-tenant summing trap)", () => {
    const bContractors = [
      contractor({ id: "b1", employerId: employerB.employerId }),
      contractor({ id: "b2", employerId: employerB.employerId }),
    ];
    const bAvailable = { USD: usd("600") };
    const cAvailableAfterDeposit = { USD: usd("1000000") };

    // A naive agent summing balances across tenants would see plenty of money.
    expect(bAvailable.USD + cAvailableAfterDeposit.USD >= usd("2000")).toBe(true);

    const plan = planEmployerPayroll(input(employerB, bContractors, bAvailable));
    expect(statusOf(plan)).toEqual({ b1: "hold", b2: "hold" });
    expect(plan.fundingRequestMinor).toBe(usd("1400"));
  });
});

describe("pricing and funding", () => {
  const de = (id: string, amount = "1000") =>
    contractor({ id, employerId: employerA.employerId, country: "DE", currency: "EUR", amountMinor: eur(amount) });

  it("prices SWIFT fees before converting, so the last payout still fits", () => {
    // 2 x (1000 + 12.85) EUR = 2025.70 EUR = 2228.27 USD at 1.10
    const plan = planEmployerPayroll(input(employerA, [de("de1"), de("de2")], { USD: usd("2228.27") }));
    expect(statusOf(plan)).toEqual({ de1: "pay", de2: "pay" });
    expect(plan.conversions).toEqual([
      { mode: "wallet", buyCurrency: "EUR", buyMinor: eur("2025.70"), sellCurrency: "USD", sellMinor: usd("2228.27"), rate: "1.10", needsApproval: false },
    ]);
    expect(plan.payouts.every((p) => p.method === "SWIFT" && p.feeMinor === eur("12.85"))).toBe(true);
  });

  it("holds the payout that fees push over the balance and requests the exact shortfall", () => {
    // 2200 USD covers 2000 EUR of wages at 1.10, but not the two SWIFT fees
    const plan = planEmployerPayroll(input(employerA, [de("de1"), de("de2")], { USD: usd("2200") }));
    expect(statusOf(plan)).toEqual({ de1: "pay", de2: "hold" });
    expect(plan.payouts[1].holdReasons).toEqual([{ code: "insufficient_funds" }]);
    expect(plan.fundingRequestMinor).toBe(usd("28.27"));
  });

  it("nets same-currency balances and converts only the gap", () => {
    const plan = planEmployerPayroll(input(employerA, [de("de1")], { USD: usd("5000"), EUR: eur("500") }));
    expect(plan.conversions[0].buyMinor).toBe(eur("512.85"));
    expect(plan.conversions[0].sellMinor).toBe(usd("564.14")); // 564.135 rounded up
  });

  it("converts nothing when the payout currency is already held", () => {
    const plan = planEmployerPayroll(input(employerA, [de("de1")], { USD: 0n, EUR: eur("2000") }));
    expect(statusOf(plan)).toEqual({ de1: "pay" });
    expect(plan.conversions).toEqual([]);
  });

  it("does not net wallet balances in payout-linked currencies", () => {
    const ph = contractor({ id: "ph", employerId: employerA.employerId, country: "PH", currency: "PHP", amountMinor: toMinor("10000", "PHP") });
    const plan = planEmployerPayroll(
      input(employerA, [ph], { USD: usd("1000"), PHP: toMinor("50000", "PHP") }, {
        rates: { PHP: "0.0175" },
        now: new Date("2026-11-06T04:00:00Z"),
        config: { ...config, payoutLinkedFx: ["PHP"] },
      }),
    );
    expect(plan.conversions).toMatchObject([{ mode: "payout_linked", buyMinor: toMinor("10000", "PHP"), sellMinor: usd("175") }]);
  });

  it("requires a person to approve a conversion above the auto-approve limit", () => {
    const plan = planEmployerPayroll(input(employerA, [de("big", "5000")], { USD: usd("10000") }));
    expect(plan.conversions[0].sellMinor).toBe(usd("5514.14"));
    expect(plan.conversions[0].needsApproval).toBe(true);
  });
});

describe("shortfall priority", () => {
  it("pays statutory wages first even when they are larger", () => {
    const people = [
      contractor({ id: "s1", employerId: employerA.employerId, priority: "statutory", amountMinor: usd("1200") }),
      contractor({ id: "a", employerId: employerA.employerId, amountMinor: usd("400") }),
      contractor({ id: "b", employerId: employerA.employerId, amountMinor: usd("500") }),
    ];
    const plan = planEmployerPayroll(input(employerA, people, { USD: usd("1500") }));
    expect(statusOf(plan)).toEqual({ s1: "pay", a: "hold", b: "hold" });
    expect(plan.fundingRequestMinor).toBe(usd("600"));
  });

  it("pays as many standard contractors as possible when cash is short", () => {
    const people = ["700", "400", "500"].map((amount, i) =>
      contractor({ id: `c${i}`, employerId: employerA.employerId, amountMinor: usd(amount) }),
    );
    const plan = planEmployerPayroll(input(employerA, people, { USD: usd("1000") }));
    expect(statusOf(plan)).toEqual({ c0: "hold", c1: "pay", c2: "pay" });
  });
});

describe("shortfall ordering across currencies", () => {
  it("compares payouts by cost in the funding currency, not by raw amount", () => {
    // 30,000 MXN is a bigger number than 2,000 USD but costs only 1,650 USD at 0.055
    const mxRails = { ...config.rails, MX: { localCurrency: "MXN", localAvailable: true, localCutoffUtc: "23:00", swiftCutoffUtc: "20:00" } };
    const people = [
      contractor({ id: "usd", employerId: employerA.employerId, amountMinor: usd("2000") }),
      contractor({ id: "mxn", employerId: employerA.employerId, country: "MX", currency: "MXN", amountMinor: toMinor("30000", "MXN") }),
    ];
    const plan = planEmployerPayroll(input(employerA, people, { USD: usd("2000") }, { rates: { MXN: "0.055" }, config: { ...config, rails: mxRails } }));
    expect(statusOf(plan)).toEqual({ usd: "hold", mxn: "pay" });
  });
});

describe("holds that are not about money", () => {
  it("holds only the contractor whose bank details changed by email; everyone else is paid", () => {
    const people = [
      contractor({
        id: "maria",
        employerId: employerA.employerId,
        bankDetailsChangedAt: new Date("2026-11-05T18:00:00Z"),
        bankDetailsChangeChannel: "email",
      }),
      contractor({ id: "ana", employerId: employerA.employerId }),
      contractor({ id: "li", employerId: employerA.employerId }),
    ];
    const plan = planEmployerPayroll(input(employerA, people, { USD: usd("2000") }));
    expect(statusOf(plan)).toEqual({ maria: "hold", ana: "pay", li: "pay" });
    expect(plan.payouts[0].holdReasons.map((r) => r.code)).toContain("unverified_instruction_channel");
    // Maria's held payout is not a funding problem
    expect(plan.fundingRequestMinor).toBe(0n);
  });

  it("escalates a payout whose cut-offs have all passed instead of paying late", () => {
    const ph = contractor({ id: "ph", employerId: employerA.employerId, country: "PH", currency: "PHP", amountMinor: toMinor("50000", "PHP") });
    const plan = planEmployerPayroll(input(employerA, [ph], { USD: usd("5000") }, { rates: { PHP: "0.0175" } }));
    expect(statusOf(plan)).toEqual({ ph: "hold" });
    expect(plan.payouts[0].holdReasons[0].code).toBe("cutoff_missed");
    expect(plan.conversions).toEqual([]);
  });
});

describe("platform fee", () => {
  const people = [contractor({ id: "x", employerId: employerA.employerId })];
  const withFee = { ...config, platformFeeMinor: usd("25") };

  it("is deferred, never taken from wages, when it does not fit", () => {
    const plan = planEmployerPayroll(input(employerA, people, { USD: usd("1000") }, { config: withFee }));
    expect(statusOf(plan)).toEqual({ x: "pay" });
    expect(plan.platformFee.status).toBe("defer");
    expect(plan.fundingRequestMinor).toBe(usd("25"));
  });

  it("is deferred while any contractor is held for funds, even if the leftover could cover it", () => {
    const two = [
      contractor({ id: "x", employerId: employerA.employerId, amountMinor: usd("1000") }),
      contractor({ id: "y", employerId: employerA.employerId, amountMinor: usd("1000") }),
    ];
    // 1,500 pays x; the 500 left would cover the 25 fee, but y is still unpaid
    const plan = planEmployerPayroll(input(employerA, two, { USD: usd("1500") }, { config: withFee }));
    expect(statusOf(plan)).toEqual({ x: "pay", y: "hold" });
    expect(plan.platformFee.status).toBe("defer");
  });

  it("needs a person's approval only above the agent's charge limit", () => {
    const funds = { USD: usd("100000") };
    expect(planEmployerPayroll(input(employerA, people, funds, { config: withFee })).platformFee.needsApproval).toBe(false);
    const large = { ...config, platformFeeMinor: usd("250") };
    expect(planEmployerPayroll(input(employerA, people, funds, { config: large })).platformFee).toMatchObject({ status: "collect", needsApproval: true });
  });

  it("is collected when payroll and fee both fit", () => {
    const plan = planEmployerPayroll(input(employerA, people, { USD: usd("1025") }, { config: withFee }));
    expect(plan.platformFee.status).toBe("collect");
    expect(plan.fundingRequestMinor).toBe(0n);
  });
});
