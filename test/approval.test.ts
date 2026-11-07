import { describe, expect, it } from "vitest";
import { AGENT_ID, approve, isApproved, payeeFingerprint, type ApprovalSubject } from "../src/policy/approval.ts";

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

  it("rejects an approval the agent signed itself, or one with no approver", () => {
    expect(isApproved(approve(subject, AGENT_ID), subject)).toBe(false);
    expect(isApproved(approve(subject, "  "), subject)).toBe(false);
  });

  it("rejects an approval older than 12 hours, or dated in the future", () => {
    const at = new Date("2026-11-06T04:50:00Z");
    const approval = approve(subject, "oscar", at);
    expect(isApproved(approval, subject, { now: new Date("2026-11-06T16:50:00Z") })).toBe(true);
    expect(isApproved(approval, subject, { now: new Date("2026-11-06T16:50:00.001Z") })).toBe(false);
    expect(isApproved(approval, subject, { now: new Date("2026-11-06T04:49:59Z") })).toBe(false);
  });

  it("fingerprints a payee by all of its bank details, in any key order", () => {
    expect(payeeFingerprint({ a: "1", b: "2" })).toBe(payeeFingerprint({ b: "2", a: "1" }));
    expect(payeeFingerprint({ account_number: "012180000000007771" })).not.toBe(payeeFingerprint({ account_number: "012180001234567891" }));
  });
});
