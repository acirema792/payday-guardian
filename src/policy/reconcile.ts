import type { Currency } from "./money.ts";

// Closing reconciliation: what our ledger says was paid against what the bank reports. Pure: the
// runner reads each transfer back on its own employer's account and hands both sides here.

export interface LedgerPayout {
  contractorId: string;
  employerAccountId: string;
  transferId: string;
  amountMinor: bigint;
  currency: Currency;
}

export interface BankTransfer {
  transferId: string;
  status: string;
  amountMinor?: bigint;
  currency?: Currency;
}

export type ReconcileIssue =
  | { contractorId: string; code: "missing_at_bank"; transferId: string }
  | { contractorId: string; code: "amount_mismatch"; expected: string; actual: string }
  | { contractorId: string; code: "not_landed"; status: string };

export interface Reconciliation {
  matched: number;
  issues: ReconcileIssue[];
}

const LANDED = new Set(["PAID", "SENT"]);

export function reconcile(ledger: LedgerPayout[], bank: Map<string, BankTransfer | undefined>): Reconciliation {
  const issues: ReconcileIssue[] = [];
  let matched = 0;
  for (const p of ledger) {
    const t = bank.get(p.transferId);
    if (!t) {
      issues.push({ contractorId: p.contractorId, code: "missing_at_bank", transferId: p.transferId });
      continue;
    }
    // The bank may omit the amount on a read; when it reports one, it must be exactly ours.
    if ((t.amountMinor !== undefined && t.amountMinor !== p.amountMinor) || (t.currency !== undefined && t.currency !== p.currency)) {
      issues.push({ contractorId: p.contractorId, code: "amount_mismatch", expected: `${p.currency} ${p.amountMinor}`, actual: `${t.currency ?? "?"} ${t.amountMinor ?? "?"}` });
      continue;
    }
    if (!LANDED.has(t.status)) {
      issues.push({ contractorId: p.contractorId, code: "not_landed", status: t.status });
      continue;
    }
    matched += 1;
  }
  return { matched, issues };
}
