import {
  type Api,
  createBeneficiary,
  createCharge,
  createConversion,
  createQuote,
  createTransfer,
  findTransferByRequestId,
  getTransfer,
  isAmbiguous,
  isDuplicateRequest,
  type Transfer,
  validateBeneficiary,
} from "../airwallex/api.ts";
import { type Approval, type ApprovalSubject, isApproved } from "../policy/approval.ts";
import { type Currency, sellAmountFor, toMajor } from "../policy/money.ts";
import type { ConversionDecision, EmployerPlan, HoldReason, TransferMethod } from "../policy/types.ts";
import { beneficiaryPayload } from "../scenario/corridors.ts";
import type { ContractorProfile } from "../scenario/seed.ts";
import type { Store } from "./store.ts";

export type ConversionOutcome =
  | { buyCurrency: Currency; status: "converted"; conversionId: string; quoteId: string; sellMinor: string }
  | { buyCurrency: Currency; status: "payout_linked" } // each payout locks its own quote
  | { buyCurrency: Currency; status: "awaiting_approval"; subject: ApprovalSubject }
  | { buyCurrency: Currency; status: "blocked"; detail: string };

export type PayoutOutcome =
  | { contractorId: string; status: "sent"; transferId: string; transferStatus: string; method: TransferMethod; requestId: string }
  | { contractorId: string; status: "held"; reasons: HoldReason[] }
  | { contractorId: string; status: "awaiting_approval" | "blocked"; detail: string };

export interface ExecutionReport {
  employerId: string;
  conversions: ConversionOutcome[];
  payouts: PayoutOutcome[];
}

export interface ExecuteInput {
  runId: string;
  plan: EmployerPlan;
  profiles: Map<string, ContractorProfile>;
  api: Api; // scoped to this employer
  store: Store;
  approvals?: Approval[];
  // A locked quote may cost at most this much more than the planned conversion (fraction).
  maxRateSlippage?: number;
}

export function conversionSubject(plan: EmployerPlan, conversion: ConversionDecision, runId: string): ApprovalSubject {
  return {
    action: "conversion",
    employerAccountId: plan.accountId,
    amountMinor: conversion.sellMinor,
    currency: conversion.sellCurrency,
    counterparty: conversion.buyCurrency,
    evidence: [runId],
  };
}

function slippageCeiling(input: ExecuteInput, plannedMinor: bigint): bigint {
  const slippage = input.maxRateSlippage ?? 0.005;
  return plannedMinor + (plannedMinor * BigInt(Math.round(slippage * 10_000))) / 10_000n;
}

type Funding = { sourceCurrency?: Currency; quoteId?: string } | { detail: string };

// How a payout is funded: from the wallet balance in its own currency, or, for payout-linked FX,
// from the funding currency at a quote locked now and checked against the plan's rate.
async function fundPayout(input: ExecuteInput, currency: Currency, amountMinor: bigint): Promise<Funding> {
  const linked = input.plan.conversions.find((c) => c.buyCurrency === currency && c.mode === "payout_linked");
  if (!linked) return {};
  const planned = sellAmountFor(amountMinor, currency, linked.sellCurrency, linked.rate);
  const quote = await createQuote(input.api, currency, linked.sellCurrency, toMajor(amountMinor, currency));
  if (quote.sellMinor > slippageCeiling(input, planned)) {
    return { detail: `Rate moved: quote sells ${toMajor(quote.sellMinor, linked.sellCurrency)} vs planned ${toMajor(planned, linked.sellCurrency)}; re-plan` };
  }
  return { sourceCurrency: linked.sellCurrency, quoteId: quote.quoteId };
}

async function convert(input: ExecuteInput, conversion: ConversionDecision): Promise<ConversionOutcome> {
  const { plan, runId, store, api } = input;
  const key = `${runId}:${plan.employerId}:fx:${conversion.buyCurrency}`;
  const done = store.result<ConversionOutcome>(key);
  if (done?.status === "converted") return done;

  const subject = conversionSubject(plan, conversion, runId);
  if (conversion.needsApproval && !input.approvals?.some((a) => isApproved(a, subject))) {
    return { buyCurrency: conversion.buyCurrency, status: "awaiting_approval", subject };
  }
  if (conversion.mode === "payout_linked") return { buyCurrency: conversion.buyCurrency, status: "payout_linked" };

  const buyMajor = toMajor(conversion.buyMinor, conversion.buyCurrency);
  const quote = await createQuote(api, conversion.buyCurrency, conversion.sellCurrency, buyMajor);
  if (quote.sellMinor > slippageCeiling(input, conversion.sellMinor)) {
    return {
      buyCurrency: conversion.buyCurrency,
      status: "blocked",
      detail: `Rate moved: quote sells ${toMajor(quote.sellMinor, conversion.sellCurrency)} vs planned ${toMajor(conversion.sellMinor, conversion.sellCurrency)}; re-plan`,
    };
  }

  try {
    const result = await createConversion(api, store.requestIdFor(key), quote.quoteId, conversion.buyCurrency, conversion.sellCurrency, buyMajor);
    const outcome: ConversionOutcome = {
      buyCurrency: conversion.buyCurrency,
      status: "converted",
      conversionId: result.conversionId,
      quoteId: quote.quoteId,
      sellMinor: result.sellMinor.toString(),
    };
    store.saveResult(key, outcome);
    return outcome;
  } catch (err) {
    if (isDuplicateRequest(err)) {
      // An earlier attempt with this request_id already booked the conversion.
      const outcome: ConversionOutcome = { buyCurrency: conversion.buyCurrency, status: "converted", conversionId: "(earlier attempt)", quoteId: quote.quoteId, sellMinor: "" };
      store.saveResult(key, outcome);
      return outcome;
    }
    return { buyCurrency: conversion.buyCurrency, status: "blocked", detail: `Conversion failed: ${(err as Error).message}` };
  }
}

// Beneficiaries are per employer account and reused across runs.
async function ensureBeneficiary(input: ExecuteInput, profile: ContractorProfile, method: TransferMethod): Promise<string> {
  const key = `ben:${input.plan.accountId}:${profile.id}`;
  const saved = input.store.result<{ beneficiaryId: string }>(key);
  if (saved) return saved.beneficiaryId;
  const payload = beneficiaryPayload(profile.corridor, profile.firstName, profile.lastName);
  await validateBeneficiary(input.api, payload, method);
  const beneficiaryId = await createBeneficiary(input.api, input.store.requestIdFor(key), payload, method, profile.name);
  input.store.saveResult(key, { beneficiaryId });
  return beneficiaryId;
}

async function sendTransfer(
  input: ExecuteInput,
  key: string,
  args: { beneficiaryId: string; currency: Currency; amountMinor: bigint; method: TransferMethod; reference: string },
): Promise<{ transfer?: Transfer; requestId: string; detail?: string }> {
  const { api, store } = input;
  const saved = store.result<Transfer>(key);
  const requestId = store.requestIdFor(key);
  if (saved) return { transfer: saved, requestId };

  const funding = await fundPayout(input, args.currency, args.amountMinor);
  if ("detail" in funding) return { requestId, detail: funding.detail };

  try {
    const transfer = await createTransfer(api, { requestId, ...args, ...funding, amountMajor: toMajor(args.amountMinor, args.currency) });
    store.saveResult(key, transfer);
    return { transfer, requestId };
  } catch (err) {
    if (isAmbiguous(err) || isDuplicateRequest(err)) {
      // Never retry blindly: the first attempt may have gone through.
      const existing = await findTransferByRequestId(api, requestId).catch(() => undefined);
      if (existing) {
        store.saveResult(key, existing);
        return { transfer: existing, requestId };
      }
      return { requestId, detail: "Transfer outcome unconfirmed; will retry with the same request_id" };
    }
    return { requestId, detail: `Transfer rejected: ${(err as Error).message}` };
  }
}

export async function executeEmployerPlan(input: ExecuteInput): Promise<ExecutionReport> {
  const { plan, runId } = input;

  const conversions: ConversionOutcome[] = [];
  for (const conversion of plan.conversions) conversions.push(await convert(input, conversion));
  const blockedCurrency = new Map(
    conversions.flatMap((c) => (c.status === "awaiting_approval" || c.status === "blocked" ? [[c.buyCurrency, c] as const] : [])),
  );

  const payouts: PayoutOutcome[] = [];
  for (const decision of plan.payouts) {
    const contractorId = decision.contractor.id;
    if (decision.status === "hold") {
      payouts.push({ contractorId, status: "held", reasons: decision.holdReasons });
      continue;
    }
    const blocked = blockedCurrency.get(decision.contractor.currency);
    if (blocked) {
      payouts.push({
        contractorId,
        status: blocked.status === "awaiting_approval" ? "awaiting_approval" : "blocked",
        detail: blocked.status === "blocked" ? blocked.detail : `Waiting for approval of the ${blocked.buyCurrency} conversion`,
      });
      continue;
    }

    const profile = input.profiles.get(contractorId);
    if (!profile) throw new Error(`No profile for contractor ${contractorId}`);
    const method = decision.method!;

    let beneficiaryId: string;
    try {
      beneficiaryId = await ensureBeneficiary(input, profile, method);
    } catch (err) {
      payouts.push({ contractorId, status: "blocked", detail: `Beneficiary invalid: ${(err as Error).message}` });
      continue;
    }

    const sent = await sendTransfer(input, `${runId}:${plan.employerId}:payout:${contractorId}`, {
      beneficiaryId,
      currency: decision.contractor.currency,
      amountMinor: decision.contractor.amountMinor,
      method,
      reference: `Payroll ${runId}`,
    });
    payouts.push(
      sent.transfer
        ? { contractorId, status: "sent", transferId: sent.transfer.id, transferStatus: sent.transfer.status, method, requestId: sent.requestId }
        : { contractorId, status: "blocked", detail: sent.detail! },
    );
  }

  return { employerId: plan.employerId, conversions, payouts };
}

export type RepayOutcome =
  | { status: "repaid"; transferId: string; requestId: string; originalTransferId: string }
  | { status: "not_failed"; transferStatus: string }
  | { status: "escalated" | "blocked"; detail: string };

// A returned payout (CANCELLED with a failure_type) is re-verified and paid once more.
// The repay has its own operation key, so running this twice never pays twice.
export async function repayReturnedTransfer(input: ExecuteInput, contractorId: string): Promise<RepayOutcome> {
  const { plan, runId, store, api } = input;
  const original = store.result<Transfer>(`${runId}:${plan.employerId}:payout:${contractorId}`);
  if (!original) return { status: "blocked", detail: "No original transfer recorded for this run" };

  const repayKey = `${runId}:${plan.employerId}:repay:${contractorId}:${original.id}`;
  const done = store.result<Transfer>(repayKey);
  if (done) return { status: "repaid", transferId: done.id, requestId: store.requestIdFor(repayKey), originalTransferId: original.id };

  const current = await getTransfer(api, original.id);
  if (current.status !== "CANCELLED" && current.status !== "FAILED") return { status: "not_failed", transferStatus: current.status };

  const decision = plan.payouts.find((p) => p.contractor.id === contractorId);
  const profile = input.profiles.get(contractorId);
  if (!decision?.method || !profile) return { status: "blocked", detail: "Contractor not in this plan" };

  // Bank details the beneficiary bank rejected cannot be fixed by retrying: ask the contractor.
  const badDetails = new Set(["ACCOUNT_CLOSED", "INVALID_ACCOUNT_NAME_OR_NUMBER", "INVALID_BANK_INFORMATION", "INVALID_BENEFICIARY_DETAILS", "BENEFICIARY_NAME_MISMATCH"]);
  if (current.failureType && badDetails.has(current.failureType)) {
    return { status: "escalated", detail: `Returned with ${current.failureType}; new bank details needed from the contractor` };
  }

  try {
    await validateBeneficiary(api, beneficiaryPayload(profile.corridor, profile.firstName, profile.lastName), decision.method);
  } catch (err) {
    return { status: "escalated", detail: `Beneficiary no longer validates: ${(err as Error).message}` };
  }

  const beneficiaryId = store.result<{ beneficiaryId: string }>(`ben:${plan.accountId}:${contractorId}`)?.beneficiaryId;
  if (!beneficiaryId) return { status: "blocked", detail: "Beneficiary id missing" };

  const sent = await sendTransfer(input, repayKey, {
    beneficiaryId,
    currency: decision.contractor.currency,
    amountMinor: decision.contractor.amountMinor,
    method: decision.method,
    reference: `Payroll ${runId} repay`,
  });
  return sent.transfer
    ? { status: "repaid", transferId: sent.transfer.id, requestId: sent.requestId, originalTransferId: original.id }
    : { status: "blocked", detail: sent.detail! };
}

export type FeeOutcome = { status: "charged"; chargeId: string } | { status: "accrued" | "deferred" | "failed"; detail: string };

// Platform fee, after payroll. Connected accounts: charges/create from the employer's wallet.
// Org-entity fallback: accrue it in our ledger (no platform charge API between sibling accounts).
export async function collectPlatformFee(
  platform: Api,
  plan: EmployerPlan,
  store: Store,
  runId: string,
  mode: "connected" | "org-entity",
): Promise<FeeOutcome> {
  if (plan.platformFee.status === "defer") return { status: "deferred", detail: "Fee does not fit after wages; deferred" };
  const amount = toMajor(plan.platformFee.amountMinor, plan.platformFee.currency);
  if (mode === "org-entity") return { status: "accrued", detail: `${amount} ${plan.platformFee.currency} accrued to the platform ledger` };

  const key = `${runId}:${plan.employerId}:fee`;
  const saved = store.result<{ chargeId: string }>(key);
  if (saved) return { status: "charged", chargeId: saved.chargeId };
  try {
    const charge = await createCharge(platform, store.requestIdFor(key), plan.accountId, plan.platformFee.currency, amount, `Platform fee ${runId}`);
    store.saveResult(key, { chargeId: charge.id });
    return { status: "charged", chargeId: charge.id };
  } catch (err) {
    return { status: "failed", detail: (err as Error).message };
  }
}
