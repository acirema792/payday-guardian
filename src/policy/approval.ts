import { createHash } from "node:crypto";
import type { Currency } from "./money.ts";

// What a person actually saw when approving. Any change to these fields invalidates the approval.
export interface ApprovalSubject {
  action: "conversion" | "payout" | "release_hold" | "platform_fee" | "instant_advance";
  employerAccountId: string;
  amountMinor: bigint;
  currency: Currency;
  counterparty: string; // beneficiary id, the currency bought for a conversion, or a payout address
  evidence: string[]; // ids or hashes of the documents shown
}

export interface Approval {
  subjectHash: string;
  approvedBy: string;
  approvedAt: Date;
}

// The agent never approves its own actions, and an approval goes stale.
export const AGENT_ID = "payday-guardian-agent";
export const APPROVAL_TTL_MS = 12 * 60 * 60 * 1000;

export interface ApprovalChecks {
  now?: Date; // when given, the approval must be no older than maxAgeMs and not from the future
  maxAgeMs?: number;
}

// Identifies a payee by its full bank details, so an approval for one account never pays another.
export function payeeFingerprint(bankDetails: Record<string, unknown>): string {
  const canonical = JSON.stringify(Object.keys(bankDetails).sort().map((k) => [k, bankDetails[k]]));
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function subjectHash(subject: ApprovalSubject): string {
  const canonical = JSON.stringify([
    subject.action,
    subject.employerAccountId,
    subject.amountMinor.toString(),
    subject.currency,
    subject.counterparty,
    [...subject.evidence].sort(),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function approve(subject: ApprovalSubject, approvedBy: string, approvedAt = new Date()): Approval {
  return { subjectHash: subjectHash(subject), approvedBy, approvedAt };
}

// Execution checks the approval against what is about to happen, not against what was proposed.
export function isApproved(approval: Approval | undefined, executing: ApprovalSubject, checks: ApprovalChecks = {}): boolean {
  if (approval === undefined || approval.subjectHash !== subjectHash(executing)) return false;
  if (!approval.approvedBy.trim() || approval.approvedBy === AGENT_ID) return false;
  if (checks.now) {
    const age = checks.now.getTime() - approval.approvedAt.getTime();
    if (age < 0 || age > (checks.maxAgeMs ?? APPROVAL_TTL_MS)) return false;
  }
  return true;
}
