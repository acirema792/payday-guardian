import { beforeEach, describe, expect, it } from "vitest";
import { collectPlatformFee, conversionSubject, executeEmployerPlan, feeSubject, releaseSubject, repayReturnedTransfer, type ExecuteInput } from "../src/executor/execute.ts";
import { Store } from "../src/executor/store.ts";
import { AGENT_ID, approve } from "../src/policy/approval.ts";
import { toMinor } from "../src/policy/money.ts";
import { planEmployerPayroll } from "../src/policy/planner.ts";
import type { EmployerPlan } from "../src/policy/types.ts";
import { CORRIDORS, type CorridorKey } from "../src/scenario/corridors.ts";
import type { ContractorProfile } from "../src/scenario/seed.ts";
import { FakeAirwallex } from "./fake-airwallex.ts";
import { MORNING, PAYDAY, config } from "./fixtures.ts";

const employer = { employerId: "emp_a", name: "Northwind Labs", accountId: "acct_A", fundingCurrency: "USD" };

function profile(first: string, key: CorridorKey, amount: string, extra: Partial<ContractorProfile> = {}): ContractorProfile {
  const corridor = CORRIDORS[key];
  return {
    id: first.toLowerCase(),
    employerId: employer.employerId,
    name: `${first} Test`,
    firstName: first,
    lastName: "Test",
    country: corridor.country,
    currency: corridor.currency,
    amountMinor: toMinor(amount, corridor.currency),
    priority: "standard",
    corridor,
    ...extra,
  };
}

const testConfig = {
  ...config,
  swiftFeeMinor: { ...config.swiftFeeMinor, USD: toMinor("15", "USD") },
  rails: {
    ...config.rails,
    DE: { localCurrency: "EUR", localAvailable: true, localCutoffUtc: "13:00", swiftCutoffUtc: "14:00" },
    MX: { localCurrency: "MXN", localAvailable: true, localCutoffUtc: "23:00", swiftCutoffUtc: "20:00" },
  },
};

let fake: FakeAirwallex;
let store: Store;

beforeEach(() => {
  fake = new FakeAirwallex();
  store = new Store();
});

function setup(profiles: ContractorProfile[], usd: string, overrides: Partial<ExecuteInput> = {}) {
  const plan = planEmployerPayroll({
    employer,
    contractors: profiles,
    balances: { accountId: employer.accountId, available: { USD: toMinor(usd, "USD") } },
    rates: { EUR: "1.10", GBP: "1.30", MXN: "0.055" },
    payday: PAYDAY,
    now: MORNING,
    config: testConfig,
  });
  const input: ExecuteInput = { runId: "run_1", plan, profiles: new Map(profiles.map((p) => [p.id, p])), api: fake, store, limits: testConfig, ...overrides };
  return { plan, input };
}

const LIMIT = toMinor("100", "USD"); // the agent may charge a platform fee up to this on its own

const team = () => [profile("Ana", "US_USD", "1000"), profile("Lena", "DE_EUR", "1000"), profile("Diego", "MX_USD", "500")];

describe("executor", () => {
  it("converts only the gap, creates each beneficiary once, and pays with explicit rails", async () => {
    const { input } = setup(team(), "5000");
    const report = await executeEmployerPlan(input);

    expect(report.conversions).toMatchObject([{ buyCurrency: "EUR", status: "converted" }]);
    expect(fake.creates("/fx/conversions/create")[0].body).toMatchObject({ buy_currency: "EUR", sell_currency: "USD", buy_amount: "1000.00" });
    expect(fake.creates("/beneficiaries/create")).toHaveLength(3);

    const bodies = fake.creates("/transfers/create").map((c) => c.body);
    expect(bodies.map((b) => [b.transfer_currency, b.transfer_method, b.transfer_amount])).toEqual([
      ["USD", "LOCAL", "1000.00"],
      ["EUR", "LOCAL", "1000.00"],
      ["USD", "SWIFT", "500.00"],
    ]);
    expect(bodies.every((b) => b.source_currency === b.transfer_currency && b.reason === "wages_salary")).toBe(true);
    expect(report.payouts.every((p) => p.status === "sent")).toBe(true);
  });

  it("re-running the same payroll run moves no money twice", async () => {
    const { input } = setup(team(), "5000");
    await executeEmployerPlan(input);
    const before = fake.calls.filter((c) => c.method === "POST").length;
    const again = await executeEmployerPlan(input);
    expect(fake.calls.filter((c) => c.method === "POST").length).toBe(before); // not even a new quote
    expect(fake.creates("/transfers/create")).toHaveLength(3);
    expect(fake.creates("/fx/conversions/create")).toHaveLength(1);
    expect(again.payouts.every((p) => p.status === "sent")).toBe(true);
  });

  it("a later batch in the same pay period never pays anyone twice", async () => {
    const { input } = setup(team(), "5000", { runId: "payday-2026-11-06:b1" });
    await executeEmployerPlan(input);
    const later = await executeEmployerPlan({ ...input, runId: "payday-2026-11-06:b2" });
    expect(fake.creates("/transfers/create")).toHaveLength(3);
    expect(later.payouts.every((p) => p.status === "sent")).toBe(true);
    // The next pay period is a new payroll
    await executeEmployerPlan({ ...input, runId: "payday-2026-11-13:b1" });
    expect(fake.creates("/transfers/create")).toHaveLength(6);
  });

  it("refuses to execute one employer's plan on another employer's account", async () => {
    const { input } = setup(team(), "5000");
    Object.assign(fake, { accountId: "acct_B" });
    await expect(executeEmployerPlan(input)).rejects.toThrow(/cannot execute on acct_B/);
    expect(fake.calls).toHaveLength(0);
  });

  it("pays in a later batch a payout the bank rejected outright, with a new request_id", async () => {
    const { input } = setup([profile("Ana", "US_USD", "1000")], "5000", { runId: "payday-2026-11-06:b1" });
    fake.rejectNextTransfer = "balance_insufficient";
    expect((await executeEmployerPlan(input)).payouts[0]).toMatchObject({ status: "blocked", detail: expect.stringMatching(/rejected/) });
    const later = await executeEmployerPlan({ ...input, runId: "payday-2026-11-06:b2" });
    expect(later.payouts[0].status).toBe("sent");
    expect(fake.creates("/transfers/create")).toHaveLength(2); // the rejected attempt and the payment
  });

  it("never reports a different amount as sent: a changed amount in the same pay period goes to a person", async () => {
    const { input } = setup([profile("Ana", "US_USD", "1000")], "5000", { runId: "payday-2026-11-06:b1" });
    await executeEmployerPlan(input);
    const raised = setup([profile("Ana", "US_USD", "1200")], "5000", { runId: "payday-2026-11-06:b2" }).input;
    expect((await executeEmployerPlan(raised)).payouts[0]).toMatchObject({ status: "blocked", detail: expect.stringMatching(/Already sent USD 1000.00/) });
    expect(fake.creates("/transfers/create")).toHaveLength(1);
  });

  it("pays the new account after a verified bank-detail change, not the beneficiary cached from the old one", async () => {
    const ana = profile("Ana", "US_USD", "1000");
    await executeEmployerPlan(setup([ana], "5000", { runId: "payday-2026-10-06:b1" }).input);
    const moved = { ...ana, corridor: { ...ana.corridor, bankDetails: { ...ana.corridor.bankDetails, account_number: "999999999" } }, bankDetailsChangedAt: new Date("2026-10-01T00:00:00Z"), bankDetailsChangeChannel: "verified_portal" as const };
    const report = await executeEmployerPlan(setup([moved], "5000", { runId: "payday-2026-11-06:b1" }).input);
    expect(report.payouts[0].status).toBe("sent");
    const created = fake.creates("/beneficiaries/create").map((c) => c.body.beneficiary.bank_details.account_number);
    expect(created).toHaveLength(2);
    expect(created.at(-1)).toBe("999999999");
    const paidTo = fake.creates("/transfers/create").at(-1)!.body.beneficiary_id;
    expect(paidTo).not.toBe(fake.creates("/transfers/create")[0].body.beneficiary_id);
  });

  it("recovers a transfer whose response was lost instead of paying again", async () => {
    const { input } = setup([profile("Ana", "US_USD", "1000")], "5000");
    fake.loseNextTransferResponse = true;
    const report = await executeEmployerPlan(input);
    expect(fake.transfers).toHaveLength(1);
    expect(report.payouts[0]).toMatchObject({ status: "sent", transferId: fake.transfers[0].id });
    expect(fake.calls.some((c) => c.method === "GET" && c.path === "/transfers")).toBe(true);
  });

  it("makes no API calls for held payouts", async () => {
    const maria = profile("Maria", "MX_MXN", "20000", { bankDetailsChangedAt: new Date("2026-11-05T20:00:00Z"), bankDetailsChangeChannel: "email" });
    const { input } = setup([maria, profile("Ana", "US_USD", "1000")], "5000");
    const report = await executeEmployerPlan(input);
    expect(report.payouts[0]).toMatchObject({ contractorId: "maria", status: "held" });
    expect(fake.calls.some((c) => c.body?.beneficiary?.first_name === "Maria")).toBe(false);
    expect(fake.creates("/fx/conversions/create")).toHaveLength(0); // MXN never needed
    expect(fake.creates("/transfers/create")).toHaveLength(1);
  });

  describe("approval-bound conversions", () => {
    const big = () => [profile("Lena", "DE_EUR", "20000")]; // 22,000 USD > 15,000 auto-approve

    it("waits for a person before converting above the limit", async () => {
      const { input } = setup(big(), "30000");
      const report = await executeEmployerPlan(input);
      expect(report.conversions[0].status).toBe("awaiting_approval");
      expect(report.payouts[0].status).toBe("awaiting_approval");
      expect(fake.creates("/fx/quotes/create")).toHaveLength(0);
    });

    it("applies the conversion limit itself, even if the plan says no approval is needed", async () => {
      const { plan, input } = setup(big(), "30000");
      const unflagged = { ...plan, conversions: plan.conversions.map((c) => ({ ...c, needsApproval: false })) };
      const report = await executeEmployerPlan({ ...input, plan: unflagged, limits: testConfig });
      expect(report.conversions[0].status).toBe("awaiting_approval");
      expect(fake.creates("/fx/quotes/create")).toHaveLength(0);
    });

    it("converts and pays once the exact conversion is approved", async () => {
      const { plan, input } = setup(big(), "30000");
      const approval = approve(conversionSubject(plan, plan.conversions[0], "run_1"), "oscar");
      const report = await executeEmployerPlan({ ...input, approvals: [approval] });
      expect(report.conversions[0].status).toBe("converted");
      expect(report.payouts[0].status).toBe("sent");
    });

    it("ignores an approval for a different amount", async () => {
      const { plan, input } = setup(big(), "30000");
      const stale = approve({ ...conversionSubject(plan, plan.conversions[0], "run_1"), amountMinor: 1n }, "oscar");
      const report = await executeEmployerPlan({ ...input, approvals: [stale] });
      expect(report.conversions[0].status).toBe("awaiting_approval");
    });
  });

  it("refuses a quote that costs more than the planned slippage and re-plans instead", async () => {
    fake.quoteRates.EUR = 1.2; // planned at 1.10
    const { input } = setup([profile("Lena", "DE_EUR", "1000")], "5000");
    const report = await executeEmployerPlan(input);
    expect(report.conversions[0]).toMatchObject({ status: "blocked" });
    expect(report.payouts[0].status).toBe("blocked");
    expect(fake.creates("/fx/conversions/create")).toHaveLength(0);
    expect(fake.creates("/transfers/create")).toHaveLength(0);
  });

  describe("payout-linked FX (restricted currencies)", () => {
    const linkedConfig = { payoutLinkedFx: ["PHP"] };
    function setupLinked(rate = "0.0175") {
      const people = [profile("Jose", "PH_PHP", "10000"), profile("Bea", "PH_PHP", "8000")];
      const plan = planEmployerPayroll({
        employer,
        contractors: people,
        balances: { accountId: employer.accountId, available: { USD: toMinor("5000", "USD"), PHP: toMinor("999999", "PHP") } },
        rates: { PHP: rate },
        payday: PAYDAY,
        now: new Date("2026-11-06T05:00:00Z"),
        config: { ...testConfig, ...linkedConfig },
      });
      return { plan, input: { runId: "run_1", plan, profiles: new Map(people.map((p) => [p.id, p])), api: fake, store, limits: testConfig } as ExecuteInput };
    }

    it("funds each payout from USD at its own locked quote, with no wallet conversion", async () => {
      const { plan, input } = setupLinked();
      expect(plan.conversions).toMatchObject([{ mode: "payout_linked", buyCurrency: "PHP", buyMinor: toMinor("18000", "PHP") }]);
      const report = await executeEmployerPlan(input);
      expect(report.conversions[0].status).toBe("payout_linked");
      expect(fake.creates("/fx/conversions/create")).toHaveLength(0);
      const bodies = fake.creates("/transfers/create").map((c) => c.body);
      expect(bodies).toHaveLength(2);
      expect(bodies.every((b) => b.source_currency === "USD" && b.transfer_currency === "PHP" && b.quote_id)).toBe(true);
      expect(report.payouts.every((p) => p.status === "sent")).toBe(true);
    });

    it("blocks the payout when its quote is worse than planned", async () => {
      const { input } = setupLinked("0.0150"); // planned far cheaper than the 0.0175 quote
      const report = await executeEmployerPlan(input);
      expect(report.payouts.every((p) => p.status === "blocked")).toBe(true);
      expect(fake.creates("/transfers/create")).toHaveLength(0);
    });
  });

  it("blocks a payout whose bank details fail validation", async () => {
    fake.invalidBeneficiaryNames.add("Ana");
    const { input } = setup([profile("Ana", "US_USD", "1000")], "5000");
    const report = await executeEmployerPlan(input);
    expect(report.payouts[0]).toMatchObject({ status: "blocked" });
    expect(fake.creates("/transfers/create")).toHaveLength(0);
  });
});

describe("released fraud holds", () => {
  const changed = { bankDetailsChangedAt: new Date("2026-11-05T18:00:00Z"), bankDetailsChangeChannel: "email" as const };
  const maria = () => profile("Maria", "MX_MXN", "4500", { ...changed, releasedHold: { evidence: ["email_1", "call_1"] } });
  const at = new Date("2026-11-06T04:50:00Z");
  const run = (approvals: ReturnType<typeof approve>[]) => {
    const { input } = setup([maria()], "5000", { runId: "payday-2026-11-06:r1", approvals, now: at });
    return executeEmployerPlan(input);
  };
  const subject = (p = maria(), evidence = ["payday-2026-11-06", "email_1", "call_1"]) => releaseSubject("acct_A", p, p.amountMinor, "MXN", evidence);

  it("pays a released payout only under an approval for exactly that payout, account and payday", async () => {
    expect((await run([])).payouts[0].status).toBe("awaiting_approval");
    const emailAccount = { ...maria(), corridor: { ...maria().corridor, bankDetails: { ...maria().corridor.bankDetails, account_number: "012180001234567891" } } };
    expect((await run([approve(subject(emailAccount), "ops", at)])).payouts[0].status).toBe("awaiting_approval");
    expect((await run([approve(subject(maria(), ["payday-2026-10-30", "email_1", "call_1"]), "ops", at)])).payouts[0].status).toBe("awaiting_approval");
    expect((await run([approve(subject(), AGENT_ID, at)])).payouts[0].status).toBe("awaiting_approval");
    expect((await run([approve(subject(), "ops", new Date("2026-11-05T16:00:00Z"))])).payouts[0].status).toBe("awaiting_approval");
    expect(fake.creates("/transfers/create")).toHaveLength(0);

    expect((await run([approve(subject(), "ops", at)])).payouts[0].status).toBe("sent");
    expect(fake.creates("/transfers/create")).toHaveLength(1);
  });

  it("pays nothing if the account on file changes after the approval", async () => {
    const approval = approve(subject(), "ops", at);
    const swapped = { ...maria(), corridor: { ...maria().corridor, bankDetails: { ...maria().corridor.bankDetails, account_number: "012180001234567891" } } };
    const { input } = setup([swapped], "5000", { runId: "payday-2026-11-06:r1", approvals: [approval], now: at });
    expect((await executeEmployerPlan(input)).payouts[0].status).toBe("awaiting_approval");
    expect(fake.creates("/transfers/create")).toHaveLength(0);
  });
});

describe("returned transfers", () => {
  async function sentThenReturned(failureType: string) {
    const { input } = setup([profile("Maria", "MX_MXN", "20000")], "5000");
    await executeEmployerPlan(input);
    fake.transfers[0].status = "CANCELLED";
    fake.transfers[0].failure_type = failureType;
    return input;
  }

  it("re-verifies and re-pays a bank return exactly once", async () => {
    const input = await sentThenReturned("BENEFICIARY_BANK_RETURNED");
    const first = await repayReturnedTransfer(input, "maria");
    const second = await repayReturnedTransfer(input, "maria");
    expect(first.status).toBe("repaid");
    expect(second).toEqual(first);
    expect(fake.transfers).toHaveLength(2);
    expect(fake.transfers[1].request_id).not.toBe(fake.transfers[0].request_id);
  });

  it("escalates instead of re-paying when the account itself is wrong", async () => {
    const input = await sentThenReturned("INVALID_ACCOUNT_NAME_OR_NUMBER");
    expect((await repayReturnedTransfer(input, "maria")).status).toBe("escalated");
    expect(fake.transfers).toHaveLength(1);
  });

  it("escalates a repay when the bank details changed after the payout, and sends nothing", async () => {
    const input = await sentThenReturned("BENEFICIARY_BANK_RETURNED");
    const maria = input.profiles.get("maria")!;
    const moved = { ...maria, corridor: { ...maria.corridor, bankDetails: { ...maria.corridor.bankDetails, account_number: "012180001234567891" } } };
    const outcome = await repayReturnedTransfer({ ...input, profiles: new Map([["maria", moved]]) }, "maria");
    expect(outcome).toMatchObject({ status: "escalated", detail: expect.stringMatching(/Bank details changed/) });
    expect(fake.transfers).toHaveLength(1);
    expect(fake.creates("/beneficiaries/create")).toHaveLength(1);
  });

  it("re-pays on a new rail to the same bank details with a beneficiary for that rail", async () => {
    const input = await sentThenReturned("BENEFICIARY_BANK_RETURNED");
    const original = input.plan.payouts[0].method!;
    const other = original === "LOCAL" ? "SWIFT" : "LOCAL";
    const plan = { ...input.plan, payouts: input.plan.payouts.map((p) => ({ ...p, method: other as typeof original })) };
    const outcome = await repayReturnedTransfer({ ...input, plan }, "maria");
    expect(outcome.status).toBe("repaid");
    const bens = fake.creates("/beneficiaries/create");
    expect(bens).toHaveLength(2);
    expect(bens[1].body.beneficiary.bank_details.account_number).toBe(bens[0].body.beneficiary.bank_details.account_number);
    const [first, repay] = fake.creates("/transfers/create").map((c) => c.body);
    expect(repay).toMatchObject({ transfer_method: other });
    expect(repay.beneficiary_id).not.toBe(first.beneficiary_id);
    expect(fake.transfers).toHaveLength(2);
  });

  it("does nothing for a transfer that did not fail", async () => {
    const { input } = setup([profile("Ana", "US_USD", "1000")], "5000");
    await executeEmployerPlan(input);
    expect(await repayReturnedTransfer(input, "ana")).toEqual({ status: "not_failed", transferStatus: "PROCESSING" });
  });
});

describe("platform fee", () => {
  const plan = (status: "collect" | "defer", needsApproval = false): EmployerPlan => ({
    employerId: "emp_a",
    accountId: "acct_A",
    payouts: [],
    conversions: [],
    platformFee: { status, amountMinor: toMinor("49", "USD"), currency: "USD", needsApproval },
    fundingRequestMinor: 0n,
  });

  it("charges a fee above the agent's limit only with an approval bound to that exact fee", async () => {
    const waiting = await collectPlatformFee(fake, plan("collect", true), store, "run_1", "connected", { chargeLimitMinor: LIMIT });
    expect(waiting.status).toBe("awaiting_approval");
    expect(fake.calls).toHaveLength(0);

    const bigger = { ...feeSubject(plan("collect", true), "run_1"), amountMinor: toMinor("490", "USD") };
    expect((await collectPlatformFee(fake, plan("collect", true), store, "run_1", "connected", { chargeLimitMinor: LIMIT, approvals: [approve(bigger, "ops")] })).status).toBe("awaiting_approval");
    expect(fake.calls).toHaveLength(0);

    const ok = approve(feeSubject(plan("collect", true), "run_1"), "ops");
    expect(await collectPlatformFee(fake, plan("collect", true), store, "run_1", "connected", { chargeLimitMinor: LIMIT, approvals: [ok] })).toMatchObject({ status: "charged" });
    expect(fake.creates("/charges/create")).toHaveLength(1);
  });

  it("applies the charge limit itself, even if the plan says no approval is needed", async () => {
    const big = { ...plan("collect"), platformFee: { status: "collect" as const, amountMinor: toMinor("900", "USD"), currency: "USD", needsApproval: false } };
    expect((await collectPlatformFee(fake, big, store, "run_1", "connected", { chargeLimitMinor: LIMIT })).status).toBe("awaiting_approval");
    expect(fake.calls).toHaveLength(0);
  });

  it("calls the fee collected only once the charge reads back SETTLED", async () => {
    fake.chargeStatus = "PENDING";
    const pending = await collectPlatformFee(fake, plan("collect"), store, "run_1", "connected", { chargeLimitMinor: LIMIT, settle: { attempts: 2, waitMs: 0 } });
    expect(pending.status).toBe("pending");
    fake.chargeStatus = "SETTLED";
    const settled = await collectPlatformFee(fake, plan("collect"), store, "run_1", "connected", { chargeLimitMinor: LIMIT, settle: { attempts: 2, waitMs: 0 } });
    expect(settled).toMatchObject({ status: "charged" });
    expect(fake.creates("/charges/create")).toHaveLength(1);
  });

  it("reports a charge that ends in another status as failed", async () => {
    fake.chargeStatus = "FAILED";
    expect((await collectPlatformFee(fake, plan("collect"), store, "run_1", "connected", { chargeLimitMinor: LIMIT, settle: { attempts: 2, waitMs: 0 } })).status).toBe("failed");
  });

  it("charges a connected account once, even if collection runs twice", async () => {
    const first = await collectPlatformFee(fake, plan("collect"), store, "run_1", "connected", { chargeLimitMinor: LIMIT });
    const second = await collectPlatformFee(fake, plan("collect"), store, "run_1", "connected", { chargeLimitMinor: LIMIT });
    expect(first).toEqual(second);
    expect(fake.creates("/charges/create")).toHaveLength(1);
    expect(fake.creates("/charges/create")[0].body).toMatchObject({ source: "acct_A", amount: "49.00", reason: "professional_business_services" });
  });

  it("charges the fee once per pay period, whichever batch collects it", async () => {
    await collectPlatformFee(fake, plan("collect"), store, "payday-2026-11-06:b1", "connected", { chargeLimitMinor: LIMIT });
    await collectPlatformFee(fake, plan("collect"), store, "payday-2026-11-06:b2", "connected", { chargeLimitMinor: LIMIT });
    expect(fake.creates("/charges/create")).toHaveLength(1);
  });

  it("accrues the fee in the ledger in org-entity mode", async () => {
    expect((await collectPlatformFee(fake, plan("collect"), store, "run_1", "org-entity", { chargeLimitMinor: LIMIT })).status).toBe("accrued");
    expect(fake.calls).toHaveLength(0);
  });

  it("does not charge a deferred fee", async () => {
    expect((await collectPlatformFee(fake, plan("defer"), store, "run_1", "connected", { chargeLimitMinor: LIMIT })).status).toBe("deferred");
    expect(fake.calls).toHaveLength(0);
  });
});
