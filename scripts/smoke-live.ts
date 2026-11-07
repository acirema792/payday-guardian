// Live sandbox smoke test of the money-movement layer, using your own sandbox account as a single
// employer (org-entity mode). Small amounts, sandbox only. Run: npm run smoke
import { createQuote, getTransfer, readBalances } from "../src/airwallex/api.ts";
import { AirwallexClient } from "../src/airwallex/client.ts";
import { executeEmployerPlan, repayReturnedTransfer } from "../src/executor/execute.ts";
import { Store } from "../src/executor/store.ts";
import { toMajor, toMinor } from "../src/policy/money.ts";
import { planEmployerPayroll } from "../src/policy/planner.ts";
import { CORRIDORS, type CorridorKey } from "../src/scenario/corridors.ts";
import type { ContractorProfile } from "../src/scenario/seed.ts";
import { policyConfig } from "../src/scenario/seed.ts";
import { sandboxSimulator } from "../src/sandbox/simulator.ts";
import { TenantClient } from "../src/tenant/adapter.ts";

const platform = AirwallexClient.fromEnv();
const store = new Store(`data/smoke.db`);
platform.onCall((e) => store.audit(e));

const { id: accountId } = await platform.get<{ id: string }>("/account");
const tenant = new TenantClient(platform, { employerId: "emp_live", name: "Sandbox Business", accountId, mode: "org-entity" });
const employer = { employerId: "emp_live", name: "Sandbox Business", accountId, fundingCurrency: "USD" };

const person = (first: string, last: string, key: CorridorKey, amount: string): ContractorProfile => {
  const corridor = CORRIDORS[key];
  return {
    id: `live_${first.toLowerCase()}`,
    employerId: employer.employerId,
    name: `${first} ${last}`,
    firstName: first,
    lastName: last,
    country: corridor.country,
    currency: corridor.currency,
    amountMinor: toMinor(amount, corridor.currency),
    priority: "standard",
    corridor,
  };
};
const team = [
  person("Ana", "Lopez", "US_USD", "25"),
  person("Lena", "Schmidt", "DE_EUR", "20"),
  person("Jose", "Santos", "PH_PHP", "1500"),
  person("Diego", "Ramirez", "MX_USD", "30"),
];

// Plan with a rate from a live quote, so the executor's slippage guard compares like with like.
const phpQuote = await createQuote(tenant, "PHP", "USD", "1500.00");
const phpRate = (Number(toMajor(phpQuote.sellMinor, "USD")) / 1500).toFixed(8);
const available = await readBalances(tenant);
const config = {
  ...policyConfig,
  rails: Object.fromEntries(Object.entries(policyConfig.rails).map(([k, v]) => [k, { ...v, localCutoffUtc: "23:59", swiftCutoffUtc: "23:59" }])),
};
const runId = `smoke-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
const plan = planEmployerPayroll({
  employer,
  contractors: team,
  balances: { accountId, available },
  rates: { PHP: phpRate },
  payday: new Date(),
  now: new Date(),
  config,
});
const input = { runId, plan, profiles: new Map(team.map((p) => [p.id, p])), api: tenant, store, limits: policyConfig };

console.log(`Run ${runId} on ${accountId}`);
console.log("Plan:", plan.payouts.map((p) => `${p.contractor.name} ${p.status} ${p.method ?? ""}`).join(" | "));
const report = await executeEmployerPlan(input);
console.log("Conversions:", JSON.stringify(report.conversions));
for (const p of report.payouts) console.log("Payout:", JSON.stringify(p));

// Drive each transfer through the sandbox lifecycle; Jose's comes back from the bank.
for (const p of report.payouts) {
  if (p.status !== "sent") continue;
  await sandboxSimulator.transitionTransfer(tenant, p.transferId, "SENT");
  if (p.contractorId === "live_jose") await sandboxSimulator.transitionTransfer(tenant, p.transferId, "FAILED", "BENEFICIARY_BANK_RETURNED");
  else await sandboxSimulator.transitionTransfer(tenant, p.transferId, "PAID");
}
for (const p of report.payouts) if (p.status === "sent") console.log("Status:", p.contractorId, (await getTransfer(tenant, p.transferId)).status);

const repay = await repayReturnedTransfer(input, "live_jose");
console.log("Repay:", JSON.stringify(repay));
console.log("Repay again (must be identical):", JSON.stringify(await repayReturnedTransfer(input, "live_jose")));

const diego = report.payouts.find((p) => p.contractorId === "live_diego");
if (diego?.status === "sent") {
  const raw = await tenant.get<Record<string, unknown>>(`/transfers/${diego.transferId}`);
  console.log("SWIFT USD fee fields:", JSON.stringify({ amount_payer_pays: raw.amount_payer_pays, fee_amount: raw.fee_amount, fee_currency: raw.fee_currency, fees: raw.fees }));
}

const audit = store.auditLog().filter((a) => a.at >= new Date(Date.now() - 10 * 60_000).toISOString());
console.log(`Audit: ${audit.length} calls, ${audit.filter((a) => a.status >= 400 || a.status === 0).length} errors`);
for (const a of audit.filter((a) => a.status >= 400)) console.log("  error:", a.method, a.path, a.status, a.error_code);
store.close();
