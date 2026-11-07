import { buyAmountFor, type Currency, sellAmountFor } from "./money.ts";
import type { Contractor, HoldReason, InstructionChannel } from "./types.ts";

// Instant advance on an opt-in stablecoin rail (Metal testnet) for a payout that missed its local
// cut-off. Pure: decides whether one may be offered and how much. A person approves it, and the
// mandate on the employer's Metal account enforces the same limits on chain.

export interface InstantAdvanceConfig {
  token: "USDZ"; // Metal's dollar token: 1 USDZ = 1 USD, to the cent
  maxAdvanceMinor: bigint; // USD, per contractor per payday (the employer's setting)
}

// A contractor's consent to be paid on the instant rail, to an address they gave.
export interface InstantRailOptIn {
  address: string;
  optedInAt: Date;
  channel: InstructionChannel;
}

export type AdvanceDecision =
  | {
      status: "offer";
      address: string;
      advanceMinor: bigint; // USD, paid now as USDZ
      advanceLocalMinor: bigint; // the same advance in the payout currency, rounded down
      remainderMinor: bigint; // payout currency, paid in the next window of the fiat rail
    }
  | { status: "none"; reason: string };

export interface AdvanceInput {
  contractor: Contractor;
  holdReasons: HoldReason[];
  optIn?: InstantRailOptIn;
  usdRates: Record<Currency, string>; // USD per 1 unit of the payout currency
  payday: Date;
  fraudWindowDays: number;
  config: InstantAdvanceConfig;
  // The employer's own USD available now, after today's payouts: an advance is paid only on a
  // payout the employer has already funded, never around a shortfall.
  employerAvailableUsdMinor: bigint;
  // Already advanced to this contractor this payday; the cap covers the total.
  alreadyAdvancedMinor?: bigint;
}

const DAY_MS = 86_400_000;

export function planInstantAdvance(input: AdvanceInput): AdvanceDecision {
  const { contractor: c, holdReasons, optIn, config } = input;
  // Only a missed cut-off: a fraud hold or a funding shortfall is never paid around.
  if (!holdReasons.some((r) => r.code === "cutoff_missed")) return { status: "none", reason: "the payout did not miss a cut-off" };
  if (holdReasons.some((r) => r.code !== "cutoff_missed")) return { status: "none", reason: "the payout is also held for another reason" };
  if (!optIn) return { status: "none", reason: "the contractor has not opted in to the instant rail" };
  // A new payout address is a bank-detail change: same channel and recency rules.
  if (optIn.channel !== "verified_portal") return { status: "none", reason: `the opt-in came by ${optIn.channel}, not the verified portal` };
  if ((input.payday.getTime() - optIn.optedInAt.getTime()) / DAY_MS < input.fraudWindowDays) {
    return { status: "none", reason: `the opt-in is less than ${input.fraudWindowDays} days old` };
  }
  const capLeft = config.maxAdvanceMinor - (input.alreadyAdvancedMinor ?? 0n);
  if (config.maxAdvanceMinor <= 0n) return { status: "none", reason: "the employer allows no instant advance" };
  if (capLeft <= 0n) return { status: "none", reason: "the advance cap for this payday is already used" };

  const rate = c.currency === "USD" ? undefined : input.usdRates[c.currency];
  if (c.currency !== "USD" && !rate) return { status: "none", reason: `no USD rate for ${c.currency}` };
  const payoutUsd = rate ? sellAmountFor(c.amountMinor, c.currency, "USD", rate) : c.amountMinor;
  if (input.employerAvailableUsdMinor < payoutUsd) return { status: "none", reason: "the employer has not funded this payout yet" };
  const advanceMinor = payoutUsd < capLeft ? payoutUsd : capLeft;
  const advanceLocalMinor = rate ? buyAmountFor(advanceMinor, "USD", c.currency, rate) : advanceMinor;
  return {
    status: "offer",
    address: optIn.address,
    advanceMinor,
    advanceLocalMinor,
    remainderMinor: c.amountMinor - advanceLocalMinor > 0n ? c.amountMinor - advanceLocalMinor : 0n,
  };
}
