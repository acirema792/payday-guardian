import { type Api, withAudit } from "../airwallex/api.ts";
import type { Explainer } from "../agent/explainer.ts";
import { type Interpreter, ruleInterpreter } from "../agent/messages.ts";
import { Store } from "../executor/store.ts";
import { OfflineMetal } from "../metal/offline.ts";
import type { InstantRail } from "../metal/rail.ts";
import type { Employer } from "../policy/types.ts";
import { toMinor } from "../policy/money.ts";
import { OfflineBank } from "../sandbox/offline-bank.ts";
import type { Simulator } from "../sandbox/simulator.ts";
import { instantAdvanceConfig, instantRailOptIns, employers as seedEmployers, indicativeUsdRates, policyConfig } from "../scenario/seed.ts";
import { WebhookReceiver } from "../webhooks/airwallex.ts";

// Everything the demo runner needs from the outside world. The offline environment below runs
// against the in-memory bank; a live environment provides the same shape over the sandbox.
export interface DemoEnvironment {
  label: string;
  employers: (Employer & { globalAccountId: string; initialFundingMajor: string; midRunDepositMajor?: string })[];
  apiFor(employerId: string): Api;
  platform: Api;
  simulator: Simulator;
  tenantMode: "connected" | "org-entity";
  rates: Record<string, string>;
  store: Store;
  interpreter: Interpreter;
  // Extra lines the reader produced for a message (e.g. Claude's red flags and summary).
  readingNotes?: (messageId: string) => string[];
  // How long to wait for a deposit to clear into the wallet. On the sandbox, deposits into connected
  // accounts become available a few seconds after the simulation call returns.
  fundsSettleTimeoutMs?: number;
  // Writes the note a person reads for each exception (default: template).
  explainer?: Explainer;
  // Verified Airwallex webhooks, when a subscription delivers to this run (offline: always).
  webhooks?: WebhookReceiver;
  // Live deliveries arrive asynchronously: how long to wait for an expected event (offline: 0).
  webhookWaitMs?: number;
  // Optional instant rail (Metal testnet), one account per employer, keyed by employer id.
  instantRails?: Record<string, InstantRail>;
}

// Offline stand-ins for Contoso's Metal account and Andrea Cruz's opted-in address (synthetic).
export const OFFLINE_METAL = { account: "0xc0000000000000000000000000000000000000b2", andrea: "0xa0000000000000000000000000000000000000c2" };

export async function offlineEnvironment(
  options: { interpreter?: Interpreter; explainer?: Explainer; readingNotes?: (messageId: string) => string[]; storePath?: string } = {},
): Promise<DemoEnvironment> {
  const store = new Store(options.storePath);
  const employerByAccount = new Map(seedEmployers.map((e) => [`acct_${e.employerId}`, e.employerId]));
  const webhooks = new WebhookReceiver({ secret: "offline-demo-webhook-secret", store, employerByAccount });
  const bank = new OfflineBank({
    usdRates: indicativeUsdRates,
    swiftFeeMinor: policyConfig.swiftFeeMinor,
    restrictedWalletFx: policyConfig.payoutLinkedFx,
    webhooks: { secret: "offline-demo-webhook-secret", deliver: (headers, rawBody) => webhooks.receive(headers, rawBody), redeliver: true },
  });
  const audit = (e: Parameters<Store["audit"]>[0]) => store.audit(e);

  bank.openAccount("acct_platform");
  const employers = seedEmployers.map((e) => {
    const accountId = `acct_${e.employerId}`;
    const globalAccountId = bank.openAccount(accountId, e.fundingCurrency);
    return { ...e, accountId, globalAccountId };
  });
  const simulator = bank.simulator();
  for (const e of employers) {
    if (Number(e.initialFundingMajor) > 0) await simulator.deposit(bank.api(e.accountId), e.globalAccountId, e.initialFundingMajor, `${e.name} payroll funding`);
  }

  const rail = new OfflineMetal({
    employerId: "emp_b",
    account: OFFLINE_METAL.account,
    balanceMinor: toMinor("100", "USD"),
    payees: [OFFLINE_METAL.andrea],
    capMinor: instantAdvanceConfig.maxAdvanceMinor,
    budgetMinor: instantAdvanceConfig.maxAdvanceMinor,
    optIns: { emp_b_andrea_cruz: { ...instantRailOptIns.emp_b_andrea_cruz, address: OFFLINE_METAL.andrea } },
  });

  const apis = new Map(employers.map((e) => [e.employerId, withAudit(bank.api(e.accountId), e.accountId, audit)]));
  return {
    label: "offline bank (deterministic rehearsal)",
    employers,
    apiFor: (employerId) => {
      const api = apis.get(employerId);
      if (!api) throw new Error(`Unknown employer ${employerId}`);
      return api;
    },
    platform: withAudit(bank.platformApi("acct_platform"), "platform", audit),
    simulator,
    tenantMode: "connected",
    rates: indicativeUsdRates,
    store,
    interpreter: options.interpreter ?? ruleInterpreter,
    readingNotes: options.readingNotes,
    explainer: options.explainer,
    webhooks,
    instantRails: { emp_b: rail },
  };
}
