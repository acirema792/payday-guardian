import type { InstantRailOptIn } from "../policy/advance.ts";

// The instant rail behind one interface: one Metal account per employer, paid from only under a
// mandate whose limits (payees, per-payment cap, budget) Metal enforces on chain. The agent holds
// the mandate key, never the owner's key.

export interface MandateState {
  reference: string;
  principal: string; // the employer's Metal account
  payees: string[];
  capMinor: bigint; // USDZ, to the cent
  budgetMinor: bigint;
  spentMinor: bigint;
  payments: number;
  bound: boolean;
  revoked: boolean;
}

export type PullResult =
  | { outcome: "paid"; transaction: string; explorer?: string; spentMinor?: bigint; again: boolean }
  // sent: the refused pull went on chain (metal-agent --record-refusal), in a transaction that moves nothing.
  | { outcome: "refused"; reason: string; sent: boolean; transaction?: string; explorer?: string }
  | { outcome: "held" | "pending"; transaction?: string; reason?: string };

export interface MandateVerification {
  verified: boolean;
  payments: string[]; // one line per payment the chain holds under the mandate
}

export interface InstantRail {
  label: string; // e.g. "Metal testnet"
  employerId: string;
  account: string;
  optIns: Record<string, InstantRailOptIn>; // by contractor id
  status(): Promise<MandateState>;
  // Pays `to` under the mandate. The same paymentId pays at most once.
  pull(to: string, amountMinor: bigint, paymentId: string): Promise<PullResult>;
  verify(): Promise<MandateVerification>;
}
