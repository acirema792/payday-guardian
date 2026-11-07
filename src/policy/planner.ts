import { type Currency, sellAmountFor } from "./money.ts";
import { fraudHolds } from "./fraud.ts";
import { cutoffMinutes, route } from "./routing.ts";
import type {
  ConversionDecision,
  Contractor,
  Employer,
  EmployerPlan,
  PayoutDecision,
  PolicyConfig,
  TransferMethod,
  WalletBalances,
} from "./types.ts";

export class TenantIsolationError extends Error {}

export interface PlanInput {
  employer: Employer;
  contractors: Contractor[];
  balances: WalletBalances;
  // Units of the employer's funding currency per 1 unit of each payout currency, from a locked quote.
  rates: Record<Currency, string>;
  payday: Date;
  now: Date;
  config: PolicyConfig;
}

interface Candidate {
  contractor: Contractor;
  method: TransferMethod;
  feeMinor: bigint;
  cutoffMinutes: number; // the chosen rail's cut-off today, minutes after 00:00 UTC
  approvalRequired?: PayoutDecision["approvalRequired"];
}

const FRAUD_HOLDS = new Set(["bank_details_changed_recently", "unverified_instruction_channel"]);

interface Need {
  obligations: Map<Currency, bigint>; // per currency, before netting
  gaps: Map<Currency, bigint>; // per non-funding currency, after netting against that currency's balance
  sellMinor: Map<Currency, bigint>; // funding currency spent to cover each gap
  fundingNeedMinor: bigint; // funding-currency obligations + conversion cost
}

function available(balances: WalletBalances, currency: Currency): bigint {
  return balances.available[currency] ?? 0n;
}

// Same-currency balances net first; only the remaining gap is converted from the funding currency.
function computeNeed(selected: Candidate[], includeFee: boolean, input: PlanInput): Need {
  const funding = input.employer.fundingCurrency;
  const obligations = new Map<Currency, bigint>();
  const add = (currency: Currency, amount: bigint) => obligations.set(currency, (obligations.get(currency) ?? 0n) + amount);
  for (const c of selected) add(c.contractor.currency, c.contractor.amountMinor + c.feeMinor);
  if (includeFee) add(funding, input.config.platformFeeMinor);

  const gaps = new Map<Currency, bigint>();
  const sellMinor = new Map<Currency, bigint>();
  let fundingNeedMinor = obligations.get(funding) ?? 0n;
  for (const [currency, owed] of obligations) {
    if (currency === funding) continue;
    const linked = input.config.payoutLinkedFx.includes(currency);
    const gap = owed - (linked ? 0n : available(input.balances, currency));
    if (gap <= 0n) continue;
    const rate = input.rates[currency];
    if (!rate) throw new Error(`No ${funding}/${currency} rate supplied`);
    const cost = sellAmountFor(gap, currency, funding, rate);
    gaps.set(currency, gap);
    sellMinor.set(currency, cost);
    fundingNeedMinor += cost;
  }
  return { obligations, gaps, sellMinor, fundingNeedMinor };
}

function fundable(need: Need, input: PlanInput): boolean {
  return need.fundingNeedMinor <= available(input.balances, input.employer.fundingCurrency);
}

// What a candidate costs in the employer's funding currency, fee included, for ordering only.
function fundingCost(c: Candidate, input: PlanInput): bigint {
  const funding = input.employer.fundingCurrency;
  const owed = c.contractor.amountMinor + c.feeMinor;
  if (c.contractor.currency === funding) return owed;
  const rate = input.rates[c.contractor.currency];
  if (!rate) throw new Error(`No ${funding}/${c.contractor.currency} rate supplied`);
  return sellAmountFor(owed, c.contractor.currency, funding, rate);
}

// When cash is short: statutory wages first, then the earliest cut-off (a payout with a later
// window can still land if funds arrive later), then the cheapest in funding currency (pays the
// most people), then id so the plan is deterministic.
function byPriority(input: PlanInput) {
  return (a: Candidate, b: Candidate): number => {
    if (a.contractor.priority !== b.contractor.priority) return a.contractor.priority === "statutory" ? -1 : 1;
    if (a.cutoffMinutes !== b.cutoffMinutes) return a.cutoffMinutes - b.cutoffMinutes;
    const costA = fundingCost(a, input);
    const costB = fundingCost(b, input);
    if (costA !== costB) return costA < costB ? -1 : 1;
    return a.contractor.id.localeCompare(b.contractor.id);
  };
}

export function planEmployerPayroll(input: PlanInput): EmployerPlan {
  const { employer, contractors, balances, config } = input;

  // Tenant isolation: only this employer's wallet may fund this employer's contractors.
  if (balances.accountId !== employer.accountId) {
    throw new TenantIsolationError(
      `Balances from ${balances.accountId} cannot fund employer ${employer.employerId} (${employer.accountId})`,
    );
  }
  for (const c of contractors) {
    if (c.employerId !== employer.employerId) {
      throw new TenantIsolationError(`Contractor ${c.id} belongs to ${c.employerId}, not ${employer.employerId}`);
    }
  }

  const decisions = new Map<string, PayoutDecision>();
  const candidates: Candidate[] = [];
  for (const contractor of contractors) {
    const fraud = fraudHolds(contractor, input.payday, config.fraudWindowDays);
    // A released fraud hold is planned, but still needs its approval at execution.
    const released = contractor.releasedHold !== undefined && fraud.length > 0 && fraud.every((h) => FRAUD_HOLDS.has(h.code));
    const holds = released ? [] : fraud;
    const routed = route(contractor, input.now, config);
    if (!routed.ok) holds.push(routed.reason);
    if (holds.length > 0 || !routed.ok) {
      decisions.set(contractor.id, { contractor, status: "hold", feeMinor: 0n, holdReasons: holds });
      continue;
    }
    candidates.push({
      contractor,
      method: routed.method,
      feeMinor: routed.feeMinor,
      cutoffMinutes: cutoffMinutes(contractor, routed.method, config),
      ...(released ? { approvalRequired: { action: "release_hold" as const, evidence: contractor.releasedHold!.evidence } } : {}),
    });
  }

  candidates.sort(byPriority(input));
  const selected: Candidate[] = [];
  for (const candidate of candidates) {
    if (fundable(computeNeed([...selected, candidate], false, input), input)) {
      selected.push(candidate);
      decisions.set(candidate.contractor.id, {
        contractor: candidate.contractor,
        status: "pay",
        method: candidate.method,
        feeMinor: candidate.feeMinor,
        holdReasons: [],
        ...(candidate.approvalRequired ? { approvalRequired: candidate.approvalRequired } : {}),
      });
    } else {
      decisions.set(candidate.contractor.id, {
        contractor: candidate.contractor,
        status: "hold",
        method: candidate.method,
        feeMinor: candidate.feeMinor,
        holdReasons: [{ code: "insufficient_funds" }],
      });
    }
  }

  // The platform fee never displaces wages: collect it only when nobody is waiting for funds and it
  // still fits after payroll AND after the wages held for other reasons (a fraud hold may be
  // released today; a missed cut-off is still owed in the next window), which stay reserved.
  const anyoneShort = selected.length < candidates.length;
  const reserved: Candidate[] = [...decisions.values()]
    .filter((d) => d.status === "hold" && d.holdReasons.some((r) => r.code !== "insufficient_funds"))
    .map((d) => ({ contractor: d.contractor, method: "LOCAL", feeMinor: 0n, cutoffMinutes: 0 }));
  const collectFee = config.platformFeeMinor > 0n && !anyoneShort && fundable(computeNeed([...selected, ...reserved], true, input), input);
  const finalNeed = computeNeed(selected, collectFee, input);

  const conversions: ConversionDecision[] = [...finalNeed.gaps].map(([currency, gap]) => {
    const sellMinor = finalNeed.sellMinor.get(currency) ?? 0n;
    return {
      mode: config.payoutLinkedFx.includes(currency) ? "payout_linked" : "wallet",
      buyCurrency: currency,
      buyMinor: gap,
      sellCurrency: employer.fundingCurrency,
      sellMinor,
      rate: input.rates[currency],
      needsApproval: sellMinor > config.autoApproveConversionMinor,
    };
  });

  const fullNeed = computeNeed(candidates, config.platformFeeMinor > 0n, input);
  const shortfall = fullNeed.fundingNeedMinor - available(balances, employer.fundingCurrency);

  return {
    employerId: employer.employerId,
    accountId: employer.accountId,
    payouts: contractors.map((c) => decisions.get(c.id)!),
    conversions,
    platformFee: {
      status: collectFee ? "collect" : "defer",
      amountMinor: config.platformFeeMinor,
      currency: employer.fundingCurrency,
      needsApproval: config.platformFeeMinor > config.autoChargeMaxMinor,
    },
    fundingRequestMinor: shortfall > 0n ? shortfall : 0n,
  };
}
