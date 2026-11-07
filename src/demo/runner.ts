import { readBalances, readTransferBack } from "../airwallex/api.ts";
import { type ExceptionFacts, templateExplainer } from "../agent/explainer.ts";
import { type InboundMessage, matchByName } from "../agent/messages.ts";
import { collectPlatformFee, executeEmployerPlan, type ExecuteInput, payPeriodOf, type PayoutOutcome, releaseSubject, repayReturnedTransfer } from "../executor/execute.ts";
import { type AdvanceDecision, planInstantAdvance } from "../policy/advance.ts";
import { AGENT_ID, approve, type Approval, type ApprovalSubject, isApproved, subjectHash } from "../policy/approval.ts";
import { sellAmountFor, sum, toMajor, toMinor } from "../policy/money.ts";
import { planEmployerPayroll } from "../policy/planner.ts";
import { type BankTransfer, type LedgerPayout, reconcile } from "../policy/reconcile.ts";
import type { EmployerPlan, HoldReason } from "../policy/types.ts";
import { type ContractorProfile, contractorsOf, instantAdvanceConfig, PAYDAY, policyConfig } from "../scenario/seed.ts";
import type { DemoEnvironment } from "./environment.ts";

// The 5-minute demo as code: Goal -> Plan -> New information -> Revised decision -> Result.
// Every number shown comes from the policy engine and the bank; the narration is templated here
// (a model can rephrase it, but never changes it).

export type Phase = "goal" | "plan" | "new_info" | "decision" | "approval" | "action" | "result";

export type ContractorStatus = "pending" | "planned" | "short" | "held_fraud" | "sent" | "paid" | "returned" | "repaid" | "escalated" | "advanced" | "blocked";

// State of every wallet and payout after a step, for the console.
export interface Snapshot {
  employers: {
    employerId: string;
    name: string;
    balances: Record<string, string>;
    contractors: { id: string; name: string; country: string; currency: string; amount: string; status: ContractorStatus; note?: string }[];
  }[];
}

export interface DemoEvent {
  at: string;
  phase: Phase;
  title: string;
  lines: string[];
  data?: unknown;
  snapshot?: Snapshot;
}

export interface DemoSummary {
  contractors: number;
  paidOnPayday: number;
  heldForFraud: number;
  releasedAfterApproval: number;
  escalatedCutoff: number;
  instantAdvances: number;
  returnsRepaid: number;
  walletConversions: number;
  payoutLinkedFx: number;
  feesCollected: number;
  feesDeferred: number;
  apiCalls: number;
  reconciled: { matched: number; issues: number; payouts: { contractor: string; employer: string; transferId: string; ledger: string; bank: string; status: string }[] };
  finalBalances: Record<string, Record<string, string>>;
}

const at = (hhmm: string) => new Date(`${PAYDAY}T${hhmm}:00Z`);
const usd = (minor: bigint) => `USD ${Number(toMajor(minor, "USD")).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

export const inbox = {
  diversion: {
    id: "msg_diversion",
    channel: "email",
    from: "maria.garcia.payments@gmail.com",
    subject: "Urgent - new bank account for my pay",
    body: "Hi, it's Maria. My bank account was closed, please send my pay to this new account today, it's urgent. CLABE 012180001234567891. Thanks, Maria Garcia",
    receivedAt: at("04:20"),
  },
  bankReturn: {
    id: "msg_return",
    channel: "bank_notice",
    from: "Airwallex",
    subject: "Transfer returned",
    body: "Your transfer to Valeria Flores was returned by the beneficiary bank: BENEFICIARY_BANK_RETURNED.",
    receivedAt: at("05:30"),
  },
  topUp: {
    id: "msg_topup",
    channel: "email",
    from: "finance@contoso-health.example",
    subject: "Remaining payroll funds",
    body: "Hi team, Contoso Health here. We have just sent USD 32,000 to cover the rest of this week's payroll. Apologies for the delay.",
    receivedAt: at("06:40"),
  },
} satisfies Record<string, InboundMessage>;

// Out-of-band verification a person records before approving a release: evidence, not an instruction.
export const callLog = {
  id: "call_maria_0445",
  by: "Ops lead",
  note: "Called Maria Garcia at 04:45 on the phone number on file. Maria did not send the email, and the bank account on file is unchanged.",
};
// An address on no mandate, for probing the chain's own limits.
const PROBE_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const COUNTRY_ADJECTIVE: Record<string, string> = { PH: "Philippine" };
// Scripted stand-in for the person who approves in this demo.
const DEMO_APPROVER = "ops-lead@platform.example (scripted approver)";

function holdText(reason: HoldReason): string {
  switch (reason.code) {
    case "insufficient_funds":
      return "not enough of this employer's own money";
    case "bank_details_changed_recently":
      return reason.days < 1 ? "bank-detail change requested on payday" : `bank-detail change requested ${Math.floor(reason.days)} days before payday`;
    case "unverified_instruction_channel":
      return `request came by ${reason.channel}, not the verified portal`;
    case "cutoff_missed":
      return reason.detail;
  }
}

function describePlan(name: string, plan: EmployerPlan): string[] {
  const pay = plan.payouts.filter((p) => p.status === "pay");
  const hold = plan.payouts.filter((p) => p.status === "hold");
  const lines = [`${name}: pay ${pay.length}, hold ${hold.length}`];
  for (const c of plan.conversions) {
    lines.push(`  ${c.mode === "wallet" ? "convert" : "fund at payout"} ${toMajor(c.buyMinor, c.buyCurrency)} ${c.buyCurrency} for ${usd(c.sellMinor)}${c.needsApproval ? " (needs approval)" : ""}`);
  }
  for (const h of hold) lines.push(`  hold ${h.contractor.name}: ${h.holdReasons.map(holdText).join("; ")}`);
  if (plan.fundingRequestMinor > 0n) lines.push(`  funding request to employer: ${usd(plan.fundingRequestMinor)}`);
  lines.push(`  platform fee: ${plan.platformFee.status}`);
  return lines;
}

export async function runDemo(env: DemoEnvironment, emit: (e: DemoEvent) => void): Promise<DemoSummary> {
  const changeRequests = new Map<string, { at: Date; channel: "email" | "chat" }>();
  const releasedHolds = new Map<string, string[]>(); // contractor -> evidence a person released the hold on
  let heldForRelease: ContractorProfile | undefined;
  const sent = new Map<string, { runId: string; outcome: Extract<PayoutOutcome, { status: "sent" }> }>();
  const escalations: string[] = [];
  const escalationReasons = new Map<string, HoldReason[]>();
  let heldForFraud = 0;
  let returnsRepaid = 0;
  const repaidTransfer = new Map<string, string>();
  const advancesPaid = new Map<string, bigint>(); // contractor -> USD advanced this payday
  let walletConversions = 0;
  let payoutLinkedFx = 0;
  let feesCollected = 0;
  let feesDeferred = 0;
  const feeIssues: string[] = [];
  const profiles = new Map<string, ContractorProfile>();
  for (const e of env.employers) for (const c of contractorsOf(e.employerId)) profiles.set(c.id, c);

  const status = new Map<string, { status: ContractorStatus; note?: string }>();
  const setStatus = (id: string, value: ContractorStatus, note?: string) => status.set(id, { status: value, note });
  const holdStatus = (reasons: HoldReason[]): ContractorStatus =>
    reasons.some((r) => r.code === "unverified_instruction_channel" || r.code === "bank_details_changed_recently")
      ? "held_fraud"
      : reasons.some((r) => r.code === "cutoff_missed")
        ? "escalated"
        : "short";
  const applyPlan = (p: EmployerPlan) => {
    for (const d of p.payouts) {
      if (d.status === "pay") setStatus(d.contractor.id, "planned");
      else setStatus(d.contractor.id, holdStatus(d.holdReasons), d.holdReasons.map(holdText).join("; "));
    }
  };

  async function snapshot(): Promise<Snapshot> {
    const out: Snapshot = { employers: [] };
    for (const e of env.employers) {
      const balances = await readBalances(env.apiFor(e.employerId));
      out.employers.push({
        employerId: e.employerId,
        name: e.name,
        balances: Object.fromEntries(Object.entries(balances).filter(([, v]) => v !== 0n).map(([c, v]) => [c, toMajor(v, c)])),
        contractors: contractorsOf(e.employerId).map((c) => ({
          id: c.id,
          name: c.name,
          country: c.country,
          currency: c.currency,
          amount: toMajor(c.amountMinor, c.currency),
          status: status.get(c.id)?.status ?? "pending",
          note: status.get(c.id)?.note,
        })),
      });
    }
    return out;
  }

  const say = async (time: string, phase: Phase, title: string, lines: string[], data?: unknown) =>
    emit({ at: at(time).toISOString(), phase, title, lines, data, snapshot: await snapshot() });
  const employer = (id: string) => env.employers.find((e) => e.employerId === id)!;

  // Contractors still to be paid, with any change requests the agent has recorded.
  const pending = (employerId: string) =>
    contractorsOf(employerId)
      .filter((c) => !sent.has(c.id))
      .map((c) => {
        const req = changeRequests.get(c.id);
        const evidence = releasedHolds.get(c.id);
        return req ? { ...c, bankDetailsChangedAt: req.at, bankDetailsChangeChannel: req.channel, ...(evidence ? { releasedHold: { evidence } } : {}) } : c;
      });


  // Deposit, then trust only the wallet: poll until the funds are available or the window closes.
  async function depositAndWait(employerId: string, globalAccountId: string, amountMajor: string, payer: string): Promise<number | null> {
    const api = env.apiFor(employerId);
    const before = (await readBalances(api)).USD ?? 0n;
    await env.simulator.deposit(api, globalAccountId, amountMajor, payer);
    const target = before + toMinor(amountMajor, "USD");
    const started = Date.now();
    for (;;) {
      if (((await readBalances(api)).USD ?? 0n) >= target) return (Date.now() - started) / 1000;
      if (Date.now() - started >= (env.fundsSettleTimeoutMs ?? 0)) return null;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const cleared = (seconds: number | null) =>
    seconds === null ? "Not yet available in the wallet when the window closed; planning with what is there." : seconds < 1 ? "Available in the wallet immediately." : `Cleared into the wallet after ${seconds.toFixed(0)}s.`;

  async function plan(employerId: string, time: string): Promise<EmployerPlan> {
    const e = employer(employerId);
    const available = await readBalances(env.apiFor(employerId));
    return planEmployerPayroll({
      employer: e,
      contractors: pending(employerId),
      balances: { accountId: e.accountId, available },
      rates: env.rates,
      payday: at("00:00"),
      now: at(time),
      config: policyConfig,
    });
  }

  async function execute(employerId: string, time: string, runId: string, options: { only?: string; fee?: boolean; approvals?: Approval[] } = {}): Promise<string[]> {
    const full = await plan(employerId, time);
    // A release batch pays only the released payout; the employer's fee was already settled.
    const p = options.only ? { ...full, payouts: full.payouts.filter((d) => d.contractor.id === options.only) } : full;
    const input: ExecuteInput = { runId, plan: p, profiles, api: env.apiFor(employerId), store: env.store, approvals: options.approvals, now: at(time), limits: policyConfig };
    const report = await executeEmployerPlan(input);
    const fee =
      options.fee === false
        ? ({ status: "deferred", detail: "fee already handled for this employer" } as const)
        : await collectPlatformFee(env.platform, p, env.store, runId, env.tenantMode, { chargeLimitMinor: policyConfig.autoChargeMaxMinor, now: at(time) });
    if (fee.status === "charged" || fee.status === "accrued") feesCollected += 1;
    if (fee.status === "pending" || fee.status === "failed" || fee.status === "awaiting_approval") feeIssues.push(`${env.employers.find((e) => e.employerId === employerId)!.name}: ${fee.detail}`);
    if (fee.status === "deferred" && options.fee !== false) feesDeferred += 1;
    walletConversions += report.conversions.filter((c) => c.status === "converted").length;

    for (const o of report.payouts) {
      if (o.status === "sent") setStatus(o.contractorId, "sent", `${o.method} transfer ${o.transferId.slice(0, 8)}`);
      else if (o.status === "held") setStatus(o.contractorId, holdStatus(o.reasons), o.reasons.map(holdText).join("; "));
      else setStatus(o.contractorId, "blocked", o.detail);
      if (o.status === "sent") {
        sent.set(o.contractorId, { runId, outcome: o });
        if (profiles.get(o.contractorId)!.currency !== "USD" && policyConfig.payoutLinkedFx.includes(profiles.get(o.contractorId)!.currency)) payoutLinkedFx += 1;
      }
      if (o.status === "held" && o.reasons.some((r) => r.code === "unverified_instruction_channel")) heldForFraud += 1;
      if (o.status === "held" && o.reasons.some((r) => r.code === "cutoff_missed")) {
        escalations.push(o.contractorId);
        escalationReasons.set(o.contractorId, o.reasons);
      }
    }
    const count = (s: string) => report.payouts.filter((o) => o.status === s).length;
    const methods = report.payouts.flatMap((o) => (o.status === "sent" ? [o.method] : []));
    return [
      `${employer(employerId).name}: ${count("sent")} sent (${methods.filter((m) => m === "LOCAL").length} LOCAL, ${methods.filter((m) => m === "SWIFT").length} SWIFT), ${count("held")} held, ${count("blocked") + count("awaiting_approval")} blocked`,
      ...(options.fee === false ? [] : [`  platform fee: ${fee.status}`]),
    ];
  }

  const explainer = env.explainer ?? templateExplainer;
  const money = (minor: bigint, currency: string) => `${currency} ${Number(toMajor(minor, currency)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const accountOnFile = (c: ContractorProfile) => `${c.corridor.bankDetails.account_number ? `account ending ${String(c.corridor.bankDetails.account_number).slice(-4)}` : "account"} on file`;
  let releasedAfterApproval = 0;

  // Goal
  await say("04:00", "goal", "Pay 36 contractors for 3 employers in 6 countries today", [
    "Each payout from its own employer's money, before the local cut-off, and never to a fraudster.",
    "Policy code decides amounts, priorities, rails and holds; the agent reads messages and explains.",
  ]);

  // Plan
  const initial: string[] = [];
  for (const e of env.employers) {
    const p = await plan(e.employerId, "04:00");
    applyPlan(p);
    initial.push(...describePlan(e.name, p));
  }
  await say("04:00", "plan", "Initial plan from live balances", initial);

  // New information #1: a deposit lands in the wrong tenant
  const fabrikam = env.employers.find((e) => e.midRunDepositMajor)!;
  const fabrikamCleared = await depositAndWait(fabrikam.employerId, fabrikam.globalAccountId, fabrikam.midRunDepositMajor!, `${fabrikam.name} payroll funding`);
  const contoso = env.employers.find((e) => e.employerId === "emp_b")!;
  const contosoPlan = await plan(contoso.employerId, "04:10");
  const fabrikamPlan = await plan(fabrikam.employerId, "04:10");
  const pooled = sum(await Promise.all(env.employers.map(async (e) => (await readBalances(env.apiFor(e.employerId))).USD ?? 0n)));
  await say("04:10", "new_info", "#1 Fabrikam's funding lands; Contoso is still short", [
    `${fabrikam.name} deposit received: USD ${fabrikam.midRunDepositMajor}. ${cleared(fabrikamCleared)}`,
    `A pooled ledger would now see ${usd(pooled)} and pay Contoso in full, partly with other employers' money.`,
  ]);
  applyPlan(fabrikamPlan);
  applyPlan(contosoPlan);
  await say("04:10", "decision", "Revised: Fabrikam pays everyone; Contoso stays limited to its own wallet", [
    ...describePlan(fabrikam.name, fabrikamPlan),
    ...describePlan(contoso.name, contosoPlan),
  ]);

  // New information #2: payroll-diversion email
  await say("04:20", "new_info", "#2 Email: \"please send my pay to this new account today, urgent\"", [`From ${inbox.diversion.from}: ${inbox.diversion.body}`]);
  const reading = await env.interpreter.interpret(inbox.diversion);
  const decisionLines: string[] = [`Read by ${env.interpreter.name}: ${JSON.stringify(reading)}`, ...(env.readingNotes?.(inbox.diversion.id) ?? [])];
  if (reading.kind === "bank_detail_change_request") {
    const all = env.employers.flatMap((e) => contractorsOf(e.employerId));
    const match = matchByName(reading.personName, all);
    if (match && match !== "ambiguous") {
      changeRequests.set(match.id, { at: inbox.diversion.receivedAt, channel: "email" });
      const revised = await plan(match.employerId, "04:20");
      const held = revised.payouts.find((p) => p.contractor.id === match.id)!;
      applyPlan(revised);
      decisionLines.push(
        `Matched to ${match.name} (${employer(match.employerId).name}). The account number in the email is not used.`,
        `Hold ${match.name}: ${held.holdReasons.map(holdText).join("; ")}.`,
        `Everyone else at ${employer(match.employerId).name} is still paid (${revised.payouts.filter((p) => p.status === "pay").length} payouts).`,
        `Verification request goes to the contact on file, not to ${inbox.diversion.from}.`,
      );
      const facts: ExceptionFacts = {
        kind: "fraud_hold",
        person: match.name,
        employer: employer(match.employerId).name,
        amount: money(match.amountMinor, match.currency),
        reasons: held.holdReasons.map(holdText),
        evidence: [`email from ${inbox.diversion.from} at 04:20 asking to pay a new account today`],
        options: [
          `call ${match.name} on the phone number on file`,
          `if the account is unchanged, approve paying the ${accountOnFile(match)}`,
          "never pay the account in the email",
        ],
      };
      decisionLines.push(`Note for the ops lead, by ${explainer.name}: ${await explainer.explain(facts)}`);
      heldForRelease = match;
    } else {
      decisionLines.push(`No unique contractor matches "${reading.personName}": escalate to a person.`);
    }
  }
  await say("04:20", "decision", "Revised: hold one payout, not the payroll", decisionLines);

  // Execute the batch
  const batch1 = `payday-${PAYDAY}:b1`;
  const executed: string[] = [];
  for (const e of env.employers) executed.push(...(await execute(e.employerId, "04:30", batch1)));
  await say("04:30", "action", "Payroll batch executed on Airwallex", executed);

  // A person verifies out of band and approves the release. The approval is bound to what executes.
  if (heldForRelease) {
    const c = heldForRelease;
    const e = employer(c.employerId);
    const evidence = [inbox.diversion.id, callLog.id];
    const period = payPeriodOf(`payday-${PAYDAY}:r1`);
    // The subject is built the way the executor builds it from what it is about to send.
    const requested = releaseSubject(e.accountId, c, c.amountMinor, c.currency, [period, ...evidence]);
    const approval = approve(requested, DEMO_APPROVER, at("04:50"));
    const emailAccount = /CLABE\s+(\d+)/.exec(inbox.diversion.body)?.[1] ?? "unknown";
    const toEmailAccount = { ...c, corridor: { ...c.corridor, bankDetails: { ...c.corridor.bankDetails, account_number: emailAccount } } };
    const verdict = (ok: boolean, no: string) => (ok ? "ACCEPTED (CHECK)" : no);
    const lines = [
      `${callLog.by}: ${callLog.note}`,
      `Approval requested: release ${money(c.amountMinor, c.currency)} from ${e.name} to ${c.name}'s ${accountOnFile(c)}, this payday only. Evidence: the email and the call log. Bound to SHA-256 ${subjectHash(requested).slice(0, 12)}…`,
      `Approved by ${DEMO_APPROVER}.`,
      `The same approval checked against the account in the email (ending ${emailAccount.slice(-4)}): ${verdict(isApproved(approval, releaseSubject(e.accountId, toEmailAccount, c.amountMinor, c.currency, [period, ...evidence])), "rejected, the hash does not match")}.`,
      `The same approval checked against a larger amount: ${verdict(isApproved(approval, { ...requested, amountMinor: requested.amountMinor + 1n }), "rejected")}.`,
      `The same approval on next week's payday, or 12 hours later: ${verdict(isApproved(approval, releaseSubject(e.accountId, c, c.amountMinor, c.currency, ["payday-next", ...evidence])) || isApproved(approval, requested, { now: new Date(at("04:50").getTime() + 12 * 3600_000 + 1) }), "rejected")}. An approval the agent signs itself: ${verdict(isApproved(approve(requested, AGENT_ID, at("04:50")), requested, { now: at("04:50") }), "rejected")}.`,
    ];
    // The executor pays the released payout only if an approval matches exactly what it is about to send.
    releasedHolds.set(c.id, evidence);
    lines.push(...(await execute(c.employerId, "04:50", `payday-${PAYDAY}:r1`, { only: c.id, fee: false, approvals: [approval] })));
    const s = sent.get(c.id);
    if (s) {
      await env.simulator.transitionTransfer(env.apiFor(c.employerId), s.outcome.transferId, "SENT");
      await env.simulator.transitionTransfer(env.apiFor(c.employerId), s.outcome.transferId, "PAID");
      setStatus(c.id, "paid", `released after call-back; paid to the ${accountOnFile(c)}`);
      releasedAfterApproval += 1;
      lines.push(`${c.name} paid to the ${accountOnFile(c)}. The account in the email never received anything.`);
    }
    await say("04:50", "approval", `Approval: release ${c.name}'s pay to the account on file`, lines);
  }

  // New information #3: a returned MXN transfer
  const returnedName = "Valeria Flores";
  const returned = [...sent.entries()].find(([id]) => profiles.get(id)!.name === returnedName);
  const hooksBefore = env.webhooks?.received.length ?? 0;
  // The bank's side of each transfer: sandbox transfers stay PROCESSING until simulated to a terminal status.
  const land = async (contractorId: string, transferId: string) => {
    const api = env.apiFor(profiles.get(contractorId)!.employerId);
    await env.simulator.transitionTransfer(api, transferId, "SENT");
    await env.simulator.transitionTransfer(api, transferId, "PAID");
  };
  for (const [id, s] of sent) {
    if (s.runId !== batch1) continue;
    const api = env.apiFor(profiles.get(id)!.employerId);
    if (id !== returned?.[0]) {
      await land(id, s.outcome.transferId);
      setStatus(id, "paid");
      continue;
    }
    await env.simulator.transitionTransfer(api, s.outcome.transferId, "SENT");
    {
      await env.simulator.transitionTransfer(api, s.outcome.transferId, "FAILED", "BENEFICIARY_BANK_RETURNED");
      setStatus(id, "returned", "BENEFICIARY_BANK_RETURNED");
    }
  }
  const isReturnEvent = (h: { transfer?: { name: string; transferId: string } }) =>
    h.transfer?.name === "payout.transfer.failed" && h.transfer.transferId === returned?.[1].outcome.transferId;
  // Live deliveries arrive asynchronously; wait a bounded time for the return's own event.
  if (env.webhooks && env.webhookWaitMs) {
    const started = Date.now();
    while (!env.webhooks.received.slice(hooksBefore).some(isReturnEvent) && Date.now() - started < env.webhookWaitMs) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const hooks = env.webhooks?.received.slice(hooksBefore) ?? [];
  const failedHook = hooks.find(isReturnEvent);
  const returnLines = [`${inbox.bankReturn.from}: ${inbox.bankReturn.body}`];
  if (env.webhooks) {
    returnLines.push(
      `Webhooks: ${hooks.filter((h) => h.outcome === "processed").length} payout.transfer events verified (HMAC-SHA256 over x-timestamp + raw body); ${hooks.filter((h) => h.outcome === "duplicate").length} redeliveries ignored by event id.`,
    );
    if (failedHook?.transfer) {
      const t = failedHook.transfer;
      returnLines.push(`payout.transfer.failed for ${returnedName}: ${t.status}, ${t.failureType}, on ${env.employers.find((e) => e.employerId === t.employerId)!.name}'s account.`);
    }
  } else {
    returnLines.push("No webhook subscription on this run: the return is confirmed from GET /transfers/{id} before anything is re-paid.");
  }
  await say("05:30", "new_info", `#3 Bank return on ${returnedName}'s MXN payout`, returnLines);
  const notice = await env.interpreter.interpret(inbox.bankReturn);
  const repayLines = [`Read by ${env.interpreter.name}: ${JSON.stringify(notice)}`, ...(env.readingNotes?.(inbox.bankReturn.id) ?? [])];
  if (notice.kind === "transfer_returned" && returned) {
    const [id, s] = returned;
    const e = profiles.get(id)!.employerId;
    const p = await plan(e, "05:30");
    const input: ExecuteInput = {
      runId: s.runId,
      plan: { ...p, payouts: [{ contractor: profiles.get(id)!, status: "pay", method: s.outcome.method, feeMinor: 0n, holdReasons: [] }] },
      profiles,
      api: env.apiFor(e),
      store: env.store,
      limits: policyConfig,
    };
    const first = await repayReturnedTransfer(input, id);
    const again = await repayReturnedTransfer(input, id);
    if (first.status === "repaid") {
      returnsRepaid += 1;
      repaidTransfer.set(id, first.transferId);
      await land(id, first.transferId);
      setStatus(id, "repaid", `re-paid once, transfer ${first.transferId.slice(0, 8)}`);
    }
    repayLines.push(
      `Re-verified ${returnedName}'s bank details and re-paid: ${first.status} (new transfer ${first.status === "repaid" ? first.transferId.slice(0, 8) : "-"}).`,
      `Running the repay again returns the same transfer: ${again.status === "repaid" && first.status === "repaid" && again.transferId === first.transferId ? "no duplicate" : "CHECK"}.`,
    );
  }
  await say("05:30", "decision", "Revised: re-verify and re-pay once", repayLines);

  // New information #4: Contoso's top-up lands after the PH cut-offs
  const topUp = await env.interpreter.interpret(inbox.topUp);
  const contosoCleared = await depositAndWait(contoso.employerId, contoso.globalAccountId, "32000", `${contoso.name} top-up`);
  const balanceNow = (await readBalances(env.apiFor(contoso.employerId))).USD ?? 0n;
  const late = await plan(contoso.employerId, "06:40");
  await say("06:40", "new_info", "#4 Contoso's top-up arrives at 06:40 UTC", [
    `From ${inbox.topUp.from}: ${inbox.topUp.body}`,
    `Read by ${env.interpreter.name}: ${JSON.stringify(topUp)}`,
    ...(env.readingNotes?.(inbox.topUp.id) ?? []),
    `Checked against the wallet, not the email: ${cleared(contosoCleared)} Contoso now holds ${usd(balanceNow)}.`,
  ]);
  const lateLines = describePlan(contoso.name, late);
  const batch2 = `payday-${PAYDAY}:b2`;
  lateLines.push(...(await execute(contoso.employerId, "06:40", batch2)));
  const lateSent = [...sent].filter(([, s]) => s.runId === batch2);
  for (const [id, s] of lateSent) {
    await land(id, s.outcome.transferId);
    setStatus(id, "paid");
  }
  if (lateSent.length) lateLines.push(`${lateSent.length} late transfers reached PAID before their local cut-offs.`);
  const advances = new Map<string, Extract<AdvanceDecision, { status: "offer" }>>();
  // Each offer is checked against what the employer holds after the payouts already offered.
  const committedUsd = new Map<string, bigint>();
  for (const id of escalations) {
    const c = profiles.get(id)!;
    const rail = env.instantRails?.[c.employerId];
    const optIn = rail?.optIns[id];
    const advance = planInstantAdvance({
      contractor: c,
      holdReasons: escalationReasons.get(id) ?? [],
      optIn,
      usdRates: env.rates,
      payday: at("00:00"),
      fraudWindowDays: policyConfig.fraudWindowDays,
      config: instantAdvanceConfig,
      employerAvailableUsdMinor: ((await readBalances(env.apiFor(c.employerId))).USD ?? 0n) - (committedUsd.get(c.employerId) ?? 0n),
      alreadyAdvancedMinor: advancesPaid.get(id) ?? 0n,
    });
    const window = `the next ${COUNTRY_ADJECTIVE[c.country] ?? c.country} window`;
    if (advance.status === "offer") {
      advances.set(id, advance);
      const payoutUsd = c.currency === "USD" ? c.amountMinor : sellAmountFor(c.amountMinor, c.currency, "USD", env.rates[c.currency]);
      committedUsd.set(c.employerId, (committedUsd.get(c.employerId) ?? 0n) + payoutUsd);
    }
    const note = await explainer.explain({
      kind: "cutoff_escalation",
      person: c.name,
      employer: employer(c.employerId).name,
      amount: money(c.amountMinor, c.currency),
      reasons: [
        contosoCleared === null ? "the employer's top-up had not reached its wallet when the cut-offs passed" : "the employer's funds cleared at 06:40 UTC",
        "the Philippine cut-offs passed (LOCAL 06:30 UTC, SWIFT 06:00 UTC)",
      ],
      evidence: ["top-up email at 06:40 UTC", "wallet balance read at 06:40 UTC"],
      options:
        advance.status === "offer" && rail && optIn
          ? [
              `approve an instant ${money(advance.advanceMinor, "USD")} advance on ${rail.label} to the address ${c.name} gave when opting in through the verified portal on ${optIn.optedInAt.toISOString().slice(0, 10)}, and pay the remaining ${money(advance.remainderMinor, c.currency)} in ${window}`,
              `pay all of it in ${window} and tell ${c.name} now`,
            ]
          : [`pay in ${window} and tell the contractor now`, "use an instant rail if the contractor has opted in"],
    });
    lateLines.push(`Escalate ${c.name}. Note for the ops lead, by ${explainer.name}: ${note}`);
    if (advance.status === "none" && rail) lateLines.push(`  No instant advance for ${c.name}: ${advance.reason}.`);
  }
  await say("06:40", "decision", "Revised: pay what can still land today, escalate what cannot", lateLines);

  // A person approves an instant advance; the agent pays it under the employer's Metal mandate.
  let instantAdvances = 0;
  let advancedMinor = 0n;
  const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
  const usdz = (minor: bigint) => `${toMajor(minor, "USD")} USDZ`;
  const refusal = (r: Awaited<ReturnType<NonNullable<DemoEnvironment["instantRails"]>[string]["pull"]>>) =>
    r.outcome === "refused" ? `Metal refused, ${r.sent ? "refusal recorded on chain" : "nothing sent"}: ${r.reason}` : `NOT REFUSED (${r.outcome}), CHECK`;
  for (const [id, advance] of advances) {
    const c = profiles.get(id)!;
    const e = employer(c.employerId);
    const rail = env.instantRails![c.employerId];
    const optIn = rail.optIns[id];
    const evidence = [payPeriodOf(`payday-${PAYDAY}:advance`), inbox.topUp.id, `optin:${id}:${optIn.optedInAt.toISOString()}`];
    const subject = (counterparty: string, amountMinor = advance.advanceMinor): ApprovalSubject => ({
      action: "instant_advance", employerAccountId: rail.account, amountMinor, currency: instantAdvanceConfig.token, counterparty, evidence,
    });
    const requested = subject(`${id}:${advance.address}`);
    const approval = approve(requested, DEMO_APPROVER, at("06:45"));
    const mandate = await rail.status();
    const paymentId = `payday-${PAYDAY}:advance:${id}`;
    const lines = [
      `${c.name} opted in to instant advances on ${optIn.optedInAt.toISOString().slice(0, 10)} through the verified portal, to ${short(advance.address)}. ${e.name} caps an advance at ${money(instantAdvanceConfig.maxAdvanceMinor, "USD")}.`,
      `Approval requested: advance ${usdz(advance.advanceMinor)} from ${e.name}'s Metal account ${short(rail.account)} to ${c.name}. Bound to SHA-256 ${subjectHash(requested).slice(0, 12)}…`,
      `Approved by ${DEMO_APPROVER}.`,
      `Mandate on ${e.name}'s Metal account, enforced on chain: pays only ${c.name}, at most ${usdz(mandate.capMinor)} per payment and ${usdz(mandate.budgetMinor)} in total (spent ${usdz(mandate.spentMinor)}).`,
    ];
    const probes: { probe: string; result: unknown }[] = [];
    const probe = async (label: string, to: string, amountMinor: bigint, suffix: string) => {
      const r = await rail.pull(to, amountMinor, `${paymentId}:probe-${suffix}`);
      probes.push({ probe: label, result: r });
      lines.push(`Probe, bypassing our policy code: ${label}. ${refusal(r)}`);
    };
    await probe(`${usdz(advance.advanceMinor)} to ${short(PROBE_ADDRESS)}, an address not on the mandate`, PROBE_ADDRESS, advance.advanceMinor, "payee");
    await probe(`${usdz(advance.advanceMinor + 1n)} to ${c.name}, one cent over the cap`, advance.address, advance.advanceMinor + 1n, "cap");
    let paid: Awaited<ReturnType<typeof rail.pull>> | undefined;
    let again: Awaited<ReturnType<typeof rail.pull>> | undefined;
    let verification: Awaited<ReturnType<typeof rail.verify>> | undefined;
    if (isApproved(approval, subject(`${id}:${advance.address}`), { now: at("06:45") })) {
      paid = await rail.pull(advance.address, advance.advanceMinor, paymentId);
      if (paid.outcome === "paid") {
        instantAdvances += 1;
        advancedMinor += advance.advanceMinor;
        advancesPaid.set(id, (advancesPaid.get(id) ?? 0n) + advance.advanceMinor);
        lines.push(`Paid ${usdz(advance.advanceMinor)} to ${c.name} on ${rail.label}: transaction ${short(paid.transaction)}${paid.explorer ? ` ${paid.explorer}` : ""}`);
        again = await rail.pull(advance.address, advance.advanceMinor, paymentId);
        lines.push(`Same pull again, same payment id: ${again.outcome === "paid" && again.again && again.transaction === paid.transaction ? "already paid, nothing sent" : "CHECK"}.`);
        await probe(`another ${usdz(advance.advanceMinor)} to ${c.name} under a new payment id`, advance.address, advance.advanceMinor, "budget");
        verification = await rail.verify();
        lines.push(`Verified from the chain alone (mandate verify): ${verification.verified ? "yes" : "NO"}, ${verification.payments.filter((p) => p.startsWith("payment")).length} payment under this mandate.`);
        lines.push(`The remaining ${money(advance.remainderMinor, c.currency)} goes in the next ${COUNTRY_ADJECTIVE[c.country] ?? c.country} LOCAL window; ${c.name} is told now.`);
        setStatus(id, "advanced", `${usdz(advance.advanceMinor)} advance paid on ${rail.label} (${short(paid.transaction)}); ${money(advance.remainderMinor, c.currency)} in the next window`);
      } else {
        lines.push(`Advance not paid: ${paid.outcome}${"reason" in paid && paid.reason ? `, ${paid.reason}` : ""}. ${c.name} stays escalated.`);
      }
    }
    await say("06:45", "approval", `Approval: instant advance for ${c.name} on ${rail.label}`, lines, {
      metal: { rail: rail.label, account: rail.account, mandate: mandate.reference, payee: advance.address, amount: toMajor(advance.advanceMinor, "USD"), paymentId, paid, again, probes, verification },
    });
  }

  // Close the day: read every payout we call paid back from Airwallex, on its own employer's
  // account, and check it against the ledger before reporting it.
  const ledger: LedgerPayout[] = [...status].flatMap(([id, v]) => {
    if (v.status !== "paid" && v.status !== "repaid") return [];
    const c = profiles.get(id)!;
    const transferId = repaidTransfer.get(id) ?? sent.get(id)?.outcome.transferId;
    return transferId ? [{ contractorId: id, transferId, amountMinor: c.amountMinor, currency: c.currency }] : [];
  });
  const bank = new Map<string, BankTransfer>();
  for (const p of ledger) {
    const t = await readTransferBack(env.apiFor(profiles.get(p.contractorId)!.employerId), p.transferId);
    bank.set(p.transferId, { transferId: t.id, status: t.status, amountMinor: t.amountMinor, currency: t.currency });
  }
  const closing = reconcile(ledger, bank);
  // What was compared, so the evidence shows the bank's own amounts, not just the verdict.
  const reconciliation = ledger.map((p) => {
    const t = bank.get(p.transferId);
    return {
      contractor: profiles.get(p.contractorId)!.name,
      employer: employer(profiles.get(p.contractorId)!.employerId).name,
      transferId: p.transferId,
      ledger: `${p.currency} ${toMajor(p.amountMinor, p.currency)}`,
      bank: t?.amountMinor !== undefined && t.currency ? `${t.currency} ${toMajor(t.amountMinor, t.currency)}` : "not reported",
      status: t?.status ?? "missing",
    };
  });

  // Result
  const finalBalances: DemoSummary["finalBalances"] = {};
  for (const e of env.employers) {
    const balances = await readBalances(env.apiFor(e.employerId));
    finalBalances[e.name] = Object.fromEntries(Object.entries(balances).filter(([, v]) => v !== 0n).map(([c, v]) => [c, toMajor(v, c)]));
  }
  const total = env.employers.reduce((n, e) => n + contractorsOf(e.employerId).length, 0);
  const summary: DemoSummary = {
    contractors: total,
    paidOnPayday: [...status.values()].filter((v) => v.status === "paid" || v.status === "repaid").length,
    heldForFraud,
    releasedAfterApproval,
    escalatedCutoff: escalations.length,
    instantAdvances,
    returnsRepaid,
    walletConversions,
    payoutLinkedFx,
    feesCollected,
    feesDeferred,
    apiCalls: env.store.auditLog().length,
    reconciled: { matched: closing.matched, issues: closing.issues.length, payouts: reconciliation },
    finalBalances,
  };
  await say("07:00", "result", "Payday report", [
    `${summary.paidOnPayday}/${total} contractors paid on payday (${((summary.paidOnPayday / total) * 100).toFixed(1)}%), every one from their own employer's wallet.`,
    `${heldForFraud} suspected diversion stopped${releasedAfterApproval ? `, then released to the account on file after a person approved` : ""}; ${escalations.length} escalated because their cut-off had passed${instantAdvances ? ` (${instantAdvances} given an instant ${usd(advancedMinor)} advance on Metal testnet, the rest in the next window)` : ""}; ${returnsRepaid} bank return re-paid once.`,
    `${walletConversions} wallet conversions (net gap only) and ${payoutLinkedFx} payout-linked FX payouts at locked quotes.`,
    `Platform fees: ${feesCollected} collected (charges read back SETTLED), ${feesDeferred} deferred until that employer's wages were covered.`,
    ...feeIssues.map((f) => `Fee not confirmed, ${f}`),
    `Reconciled with Airwallex: ${closing.matched} of ${ledger.length} payouts read back on their own employer's account, landed, for exactly the amount and currency in the ledger; ${closing.issues.length} mismatches.`,
    ...closing.issues.map((i) => `Reconciliation issue for ${profiles.get(i.contractorId)!.name}: ${JSON.stringify(i)}`),
    `Audit log: ${summary.apiCalls} API calls recorded.`,
    ...Object.entries(finalBalances).map(([name, b]) => `${name} final balances: ${Object.entries(b).map(([c, v]) => `${c} ${v}`).join(", ") || "0"}`),
  ], summary);

  return summary;
}
