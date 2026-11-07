import { describe, expect, it } from "vitest";
import { toMinor } from "../src/policy/money.ts";
import { type BankTransfer, type LedgerPayout, reconcile } from "../src/policy/reconcile.ts";

const payout = (id: string, amount = "100"): LedgerPayout => ({ contractorId: id, transferId: `t_${id}`, amountMinor: toMinor(amount, "USD"), currency: "USD" });
const landed = (id: string, amount = "100", status = "PAID"): [string, BankTransfer] => [`t_${id}`, { transferId: `t_${id}`, status, amountMinor: toMinor(amount, "USD"), currency: "USD" }];

describe("closing reconciliation", () => {
  it("matches every payout the bank reports landed, for the same amount and currency", () => {
    const r = reconcile([payout("a"), payout("b")], new Map([landed("a"), landed("b")]));
    expect(r).toEqual({ matched: 2, issues: [] });
  });

  it("flags a payout the bank does not have, a different amount, and one that has not landed", () => {
    const r = reconcile([payout("a"), payout("b"), payout("c")], new Map([landed("b", "101"), landed("c", "100", "CANCELLED")]));
    expect(r.matched).toBe(0);
    expect(r.issues.map((i) => i.code)).toEqual(["missing_at_bank", "amount_mismatch", "not_landed"]);
  });

  it("does not count a transfer as matched when the bank omits its amount, or it is only SENT", () => {
    const r = reconcile([payout("a"), payout("b")], new Map<string, BankTransfer>([["t_a", { transferId: "t_a", status: "PAID" }], landed("b", "100", "SENT")]));
    expect(r.matched).toBe(0);
    expect(r.issues.map((i) => i.code)).toEqual(["amount_unreported", "not_landed"]);
  });
});
