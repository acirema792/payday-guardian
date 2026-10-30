import { mkdirSync } from "node:fs";
import { createQuote, platformApi, readBalances } from "../airwallex/api.ts";
import { AirwallexClient } from "../airwallex/client.ts";
import type { Explainer } from "../agent/explainer.ts";
import { type Interpreter, ruleInterpreter } from "../agent/messages.ts";
import { Store } from "../executor/store.ts";
import { MetalCliRail } from "../metal/cli.ts";
import { WebhookReceiver } from "../webhooks/airwallex.ts";
import { startWebhookServer } from "../webhooks/server.ts";
import { pointSubscriptions } from "../webhooks/subscriptions.ts";
import { toMajor, toMinor } from "../policy/money.ts";
import { sandboxSimulator } from "../sandbox/simulator.ts";
import { employers as seedEmployers } from "../scenario/seed.ts";
import { loadTenants } from "../scenario/tenants.ts";
import { TenantRegistry } from "../tenant/adapter.ts";
import type { DemoEnvironment } from "./environment.ts";

// The demo on the real Airwallex sandbox: each employer is its provisioned Kit 6 connected account
// (data/tenants.json), money moves on its behalf, and every call lands in a fresh audit store.

// Quote sizes near the demo's real conversions, so planned and executed rates agree.
const RATE_PROBES: Record<string, string> = { GBP: "6000", EUR: "7000", MXN: "45000", PHP: "90000", INR: "250000" };

export interface LiveOptions {
  interpreter?: Interpreter;
  explainer?: Explainer;
  readingNotes?: (messageId: string) => string[];
  log?: (line: string) => void;
  // Public HTTPS URL of a tunnel to localhost:4322: subscribes this run to live payout.transfer webhooks.
  webhookUrl?: string;
  // Allow Contoso/Fabrikam to start with money left over from an earlier run (the story's numbers then differ).
  allowDirtyBaseline?: boolean;
}

export async function liveEnvironment(options: LiveOptions = {}): Promise<DemoEnvironment> {
  const log = options.log ?? (() => {});
  const tenants = loadTenants();
  const missing = seedEmployers.filter((e) => !tenants[e.employerId]?.globalAccountId);
  if (missing.length) throw new Error(`Not provisioned: ${missing.map((e) => e.name).join(", ")}. Run npm run provision.`);

  mkdirSync("data", { recursive: true });
  const store = new Store(`data/live-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}.db`);
  const platform = AirwallexClient.fromEnv();
  platform.onCall((e) => store.audit(e));

  const registry = new TenantRegistry(
    platform,
    seedEmployers.map((e) => ({ employerId: e.employerId, name: e.name, accountId: tenants[e.employerId].accountId, mode: tenants[e.employerId].mode })),
  );
  const employers = seedEmployers.map((e) => ({ ...e, accountId: tenants[e.employerId].accountId, globalAccountId: tenants[e.employerId].globalAccountId }));

  // Baseline: the story needs Contoso at its initial funding and Fabrikam empty until its deposit lands.
  for (const e of employers) {
    const balances = await readBalances(registry.for(e.employerId));
    const usd = balances.USD ?? 0n;
    const target = toMinor(e.initialFundingMajor, "USD");
    const others = Object.entries(balances).filter(([c, v]) => c !== "USD" && v !== 0n);
    log(`${e.name}: wallet USD ${toMajor(usd, "USD")}${others.length ? `, ${others.map(([c, v]) => `${c} ${toMajor(v, c)}`).join(", ")}` : ""}`);
    if (usd > target && e.employerId !== "emp_a" && !options.allowDirtyBaseline) {
      throw new Error(`${e.name} already holds USD ${toMajor(usd, "USD")} (story expects ${e.initialFundingMajor}). Re-provision fresh employers or pass allowDirtyBaseline.`);
    }
    if (usd < target) {
      const topUp = toMajor(target - usd, "USD");
      await sandboxSimulator.deposit(registry.for(e.employerId), e.globalAccountId, topUp, `${e.name} payroll funding`);
      const started = Date.now();
      while (((await readBalances(registry.for(e.employerId))).USD ?? 0n) < target) {
        if (Date.now() - started > 90_000) throw new Error(`${e.name}: deposit did not clear within 90s`);
        await new Promise((r) => setTimeout(r, 2000));
      }
      log(`${e.name}: deposited USD ${topUp} to reach the story's starting balance (cleared in ${((Date.now() - started) / 1000).toFixed(0)}s)`);
    }
  }

  // Live rates from Airwallex quotes (USD per unit), taken on the employer that converts the most.
  const rates: Record<string, string> = {};
  for (const [currency, amount] of Object.entries(RATE_PROBES)) {
    const quote = await createQuote(registry.for("emp_a"), currency, "USD", amount);
    rates[currency] = (Number(toMajor(quote.sellMinor, "USD")) / Number(amount)).toFixed(10);
  }
  log(`Live USD rates: ${Object.entries(rates).map(([c, r]) => `${c} ${Number(r).toPrecision(5)}`).join(", ")}`);

  // Live webhooks: re-point the subscriptions to this run's tunnel and verify every delivery.
  let webhooks: WebhookReceiver | undefined;
  if (options.webhookUrl) {
    const employerByAccount = new Map(employers.map((e) => [e.accountId, e.employerId]));
    const subscriptions = await pointSubscriptions(platform, ["platform", ...employerByAccount.keys()], options.webhookUrl, log);
    if (!subscriptions.length) throw new Error("No webhook subscription could be created; run without --webhook-url.");
    webhooks = new WebhookReceiver({ secret: subscriptions.map((s) => s.secret), store, employerByAccount });
    await startWebhookServer(webhooks, Number(process.env.WEBHOOK_PORT ?? 4322));
    log(`Webhooks: ${subscriptions.length} subscriptions (${subscriptions.map((s) => s.scope).join(", ")}) deliver to this run`);
  }

  // Metal testnet, when npm run metal:setup has run and METAL_RPC_URL is set.
  const metal = MetalCliRail.fromEnv();
  if (metal) {
    const mandate = await metal.status();
    if (!mandate.bound || mandate.revoked) throw new Error("The Metal mandate is not bound. Run npm run metal:setup.");
    log(`Metal testnet: ${employers.find((e) => e.employerId === metal.employerId)?.name} account ${metal.account}, mandate spent ${toMajor(mandate.spentMinor, "USD")} of ${toMajor(mandate.budgetMinor, "USD")} USDZ`);
  } else {
    log("Metal testnet: not set up on this run (npm run metal:setup and METAL_RPC_URL); a missed cut-off is escalated only.");
  }

  return {
    label: "Airwallex sandbox (live, Kit 6 connected accounts)",
    employers,
    apiFor: (employerId) => registry.for(employerId),
    platform: platformApi(platform),
    simulator: sandboxSimulator,
    tenantMode: "connected",
    rates,
    store,
    interpreter: options.interpreter ?? ruleInterpreter,
    readingNotes: options.readingNotes,
    explainer: options.explainer,
    fundsSettleTimeoutMs: 90_000,
    instantRails: metal ? { [metal.employerId]: metal } : undefined,
    webhooks,
    webhookWaitMs: webhooks ? 90_000 : undefined,
  };
}
