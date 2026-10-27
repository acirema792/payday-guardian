import type { Contractor, HoldReason } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

// Payroll-diversion defence. Holds only this contractor's payout; the rest of payroll proceeds.
export function fraudHolds(contractor: Contractor, payday: Date, windowDays: number): HoldReason[] {
  const reasons: HoldReason[] = [];
  const changedAt = contractor.bankDetailsChangedAt;
  if (changedAt) {
    const days = (payday.getTime() - changedAt.getTime()) / DAY_MS;
    if (days < windowDays) reasons.push({ code: "bank_details_changed_recently", changedAt, days: Math.max(0, days) });
    const channel = contractor.bankDetailsChangeChannel;
    if (channel && channel !== "verified_portal") reasons.push({ code: "unverified_instruction_channel", channel });
  }
  return reasons;
}
