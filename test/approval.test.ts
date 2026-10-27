import { describe, expect, it } from "vitest";
import { approve, isApproved, type ApprovalSubject } from "../src/policy/approval.ts";

const subject: ApprovalSubject = {
  action: "conversion",
  employerAccountId: "acct_A",
  amountMinor: 551414n,
  currency: "USD",
  counterparty: "EUR",
  evidence: ["quote_123", "payroll_run_2026-11-06"],
};

describe("approval binding", () => {
  it("accepts execution of exactly what was approved", () => {
    expect(isApproved(approve(subject, "oscar"), subject)).toBe(true);
  });

  it("ignores evidence order", () => {
    const approval = approve(subject, "oscar");
    expect(isApproved(approval, { ...subject, evidence: [...subject.evidence].reverse() })).toBe(true);
  });

  it.each([
    ["amount", { amountMinor: 551415n }],
    ["currency", { currency: "EUR" }],
    ["counterparty", { counterparty: "GBP" }],
    ["employer account", { employerAccountId: "acct_B" }],
    ["evidence", { evidence: ["quote_456", "payroll_run_2026-11-06"] }],
    ["action", { action: "payout" as const }],
  ])("is invalidated when the %s changes", (_, change) => {
    expect(isApproved(approve(subject, "oscar"), { ...subject, ...change })).toBe(false);
  });

  it("rejects execution without an approval", () => {
    expect(isApproved(undefined, subject)).toBe(false);
  });
});
