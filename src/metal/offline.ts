import { createHash } from "node:crypto";
import type { InstantRailOptIn } from "../policy/advance.ts";
import { toMajor } from "../policy/money.ts";
import type { InstantRail, MandateState, MandateVerification, PullResult } from "./rail.ts";

// Deterministic in-memory Metal account under one mandate, mirroring what metal-agent reports on
// testnet: refusals are checked before sending (same reason strings), and a payment id pays once.

export interface OfflineMetalOptions {
  employerId: string;
  account: string;
  balanceMinor: bigint;
  payees: string[];
  capMinor: bigint;
  budgetMinor: bigint;
  optIns: Record<string, InstantRailOptIn>;
}

const REFUSAL = {
  payee: "mandate_payee_not_listed (the payee is not one the mandate allows)",
  cap: "mandate_cap_exceeded (the amount is above the mandate's per-payment cap)",
  budget: "mandate_budget_spent (the amount would take the mandate past its budget)",
  balance: "insufficient_balance (the account holds less than the amount)",
};

export class OfflineMetal implements InstantRail {
  readonly label = "Metal testnet (offline rehearsal)";
  readonly employerId: string;
  readonly account: string;
  readonly optIns: Record<string, InstantRailOptIn>;
  private balance: bigint;
  private spent = 0n;
  private readonly payees: string[];
  private readonly cap: bigint;
  private readonly budget: bigint;
  private readonly paid = new Map<string, { to: string; amount: bigint; transaction: string }>();

  constructor(options: OfflineMetalOptions) {
    this.employerId = options.employerId;
    this.account = options.account;
    this.optIns = options.optIns;
    this.balance = options.balanceMinor;
    this.payees = options.payees.map((p) => p.toLowerCase());
    this.cap = options.capMinor;
    this.budget = options.budgetMinor;
  }

  async status(): Promise<MandateState> {
    return {
      reference: `0x${createHash("sha256").update(`mandate:${this.account}`).digest("hex")}`,
      principal: this.account,
      payees: this.payees,
      capMinor: this.cap,
      budgetMinor: this.budget,
      spentMinor: this.spent,
      payments: this.paid.size,
      bound: true,
      revoked: false,
    };
  }

  async pull(to: string, amountMinor: bigint, paymentId: string): Promise<PullResult> {
    const done = this.paid.get(paymentId);
    if (done) {
      if (done.to !== to.toLowerCase() || done.amount !== amountMinor) throw new Error(`payment id ${paymentId} is another payment`);
      return { outcome: "paid", transaction: done.transaction, spentMinor: this.spent, again: true };
    }
    if (!this.payees.includes(to.toLowerCase())) return { outcome: "refused", reason: REFUSAL.payee, sent: false };
    if (amountMinor > this.cap) return { outcome: "refused", reason: REFUSAL.cap, sent: false };
    if (this.spent + amountMinor > this.budget) return { outcome: "refused", reason: REFUSAL.budget, sent: false };
    if (amountMinor > this.balance) return { outcome: "refused", reason: REFUSAL.balance, sent: false };
    const transaction = `0x${createHash("sha256").update(`pull:${this.account}:${paymentId}`).digest("hex")}`;
    this.balance -= amountMinor;
    this.spent += amountMinor;
    this.paid.set(paymentId, { to: to.toLowerCase(), amount: amountMinor, transaction });
    return { outcome: "paid", transaction, spentMinor: this.spent, again: false };
  }

  async verify(): Promise<MandateVerification> {
    return {
      verified: true,
      payments: [...this.paid.values()].map((p) => `payment ${p.transaction}: ${toMajor(p.amount, "USD")} *USDZ to ${p.to}`),
    };
  }
}
