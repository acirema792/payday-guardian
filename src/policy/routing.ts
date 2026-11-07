import type { Contractor, CountryRails, HoldReason, PolicyConfig, TransferMethod } from "./types.ts";

export type RouteDecision =
  | { ok: true; method: TransferMethod; feeMinor: bigint }
  | { ok: false; reason: HoldReason };

function minutesUtc(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Invalid cut-off "${hhmm}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

// The cut-off of the rail a payout goes on; no cut-off configured counts as end of day.
export function cutoffMinutes(contractor: Contractor, method: TransferMethod, config: PolicyConfig): number {
  const rails = config.rails[contractor.country];
  const cutoff = method === "LOCAL" ? rails?.localCutoffUtc : rails?.swiftCutoffUtc;
  return cutoff ? minutesUtc(cutoff) : 24 * 60;
}

function beforeCutoff(now: Date, cutoff: string | undefined): boolean {
  if (!cutoff) return true;
  return now.getUTCHours() * 60 + now.getUTCMinutes() <= minutesUtc(cutoff);
}

// Picks the rail explicitly (never inferred from a missing fee): LOCAL when it exists for the
// currency and its cut-off has not passed, else SWIFT if that still lands today, else escalate.
export function route(contractor: Contractor, now: Date, config: PolicyConfig): RouteDecision {
  const rails: CountryRails | undefined = config.rails[contractor.country];
  if (!rails) return { ok: false, reason: { code: "cutoff_missed", detail: `No rails configured for ${contractor.country}` } };

  const localPossible = rails.localAvailable && rails.localCurrency === contractor.currency;
  if (localPossible && beforeCutoff(now, rails.localCutoffUtc)) return { ok: true, method: "LOCAL", feeMinor: 0n };

  if (beforeCutoff(now, rails.swiftCutoffUtc)) {
    const fee = config.swiftFeeMinor[contractor.currency];
    if (fee === undefined) throw new Error(`No SWIFT fee configured for ${contractor.currency}`);
    return { ok: true, method: "SWIFT", feeMinor: fee };
  }

  const missed = localPossible ? `LOCAL ${rails.localCutoffUtc} and SWIFT ${rails.swiftCutoffUtc}` : `SWIFT ${rails.swiftCutoffUtc}`;
  return { ok: false, reason: { code: "cutoff_missed", detail: `${contractor.country} cut-off passed (${missed} UTC)` } };
}
