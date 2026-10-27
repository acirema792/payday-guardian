import type { Currency } from "./money.ts";

export type TransferMethod = "LOCAL" | "SWIFT";
export type Priority = "statutory" | "standard";
export type InstructionChannel = "verified_portal" | "email" | "chat" | "phone";

export interface Contractor {
  id: string;
  employerId: string;
  name: string;
  country: string; // ISO 3166-1 alpha-2 of the beneficiary bank
  currency: Currency;
  amountMinor: bigint;
  priority: Priority;
  beneficiaryId?: string;
  // Last change to bank details, and how the change was requested.
  bankDetailsChangedAt?: Date;
  bankDetailsChangeChannel?: InstructionChannel;
}

export interface Employer {
  employerId: string;
  name: string;
  accountId: string;
  fundingCurrency: Currency;
}

// Balances read from ONE employer's wallet. accountId ties them to that wallet.
export interface WalletBalances {
  accountId: string;
  available: Record<Currency, bigint>;
}

export interface CountryRails {
  localCurrency: Currency;
  localAvailable: boolean;
  // Latest UTC time on payday at which a LOCAL / SWIFT payout still lands that day ("HH:MM").
  localCutoffUtc?: string;
  swiftCutoffUtc?: string;
}

export interface PolicyConfig {
  // Per-payout fee in the payout currency, by method. LOCAL is free on Airwallex.
  swiftFeeMinor: Record<Currency, bigint>;
  platformFeeMinor: bigint; // charged in the employer's funding currency
  fraudWindowDays: number; // bank-detail changes this close to payday are held
  autoApproveConversionMinor: bigint; // in funding currency; above this a person approves
  rails: Record<string, CountryRails>;
  // Restricted currencies (e.g. PHP, INR) cannot be converted inside the wallet; each payout is
  // funded from the funding currency at a locked quote instead. Wallet balances in them are not netted.
  payoutLinkedFx: Currency[];
}

export type HoldReason =
  | { code: "bank_details_changed_recently"; changedAt: Date; days: number }
  | { code: "unverified_instruction_channel"; channel: InstructionChannel }
  | { code: "cutoff_missed"; detail: string }
  | { code: "insufficient_funds" };

export interface PayoutDecision {
  contractor: Contractor;
  status: "pay" | "hold";
  method?: TransferMethod;
  feeMinor: bigint;
  holdReasons: HoldReason[];
}

export interface ConversionDecision {
  mode: "wallet" | "payout_linked";
  buyCurrency: Currency;
  buyMinor: bigint;
  sellCurrency: Currency;
  sellMinor: bigint;
  rate: string;
  needsApproval: boolean;
}

export interface EmployerPlan {
  employerId: string;
  accountId: string;
  payouts: PayoutDecision[];
  conversions: ConversionDecision[];
  platformFee: { status: "collect" | "defer"; amountMinor: bigint; currency: Currency };
  // Exact amount the employer must add (funding currency) to pay everyone not held for other reasons.
  fundingRequestMinor: bigint;
}
