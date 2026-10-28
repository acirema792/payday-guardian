// Live Kit 6 smoke test: money movement on behalf of a provisioned connected account (employer A),
// including the platform fee via charges/create, and proof that other tenants are untouched.
// Needs `npm run provision` first. Run: npm run smoke:connected
import { createQuote, platformApi, readBalances } from "../src/airwallex/api.ts";
import { AirwallexClient } from "../src/airwallex/client.ts";
import { collectPlatformFee, executeEmployerPlan } from "../src/executor/execute.ts";
import { Store } from "../src/executor/store.ts";
import { toMajor, toMinor } from "../src/policy/money.ts";
import { planEmployerPayroll } from "../src/policy/planner.ts";
import { CORRIDORS } from "../src/scenario/corridors.ts";
import { type ContractorProfile, employers, policyConfig } from "../src/scenario/seed.ts";
import { loadTenants } from "../src/scenario/tenants.ts";
import { sandboxSimulator } from "../src/sandbox/simulator.ts";
import { TenantRegistry } from "../src/tenant/adapter.ts";

const tenants = loadTenants();
if (!tenants.emp_a?.globalAccountId) throw new Error("Run npm run provision first");

const platform = AirwallexClient.fromEnv();
const store = new Store("data/smoke-connected.db");
platform.onCall((e) => store.audit(e));
const registry = new TenantRegistry(
  platform,
  employers.map((e) => ({ employerId: e.employerId, name: e.name, accountId: tenants[e.employerId].accountId, mode: tenants[e.employerId].mode })),
);
const a = registry.for("emp_a");
const show = (b: Record<string, bigint>) => Object.entries(b).filter(([, v]) => v !== 0n).map(([c, v]) => `${c} ${toMajor(v, c)}`).join(", ") || "empty";

const before = { b: await readBalances(registry.for("emp_b")), c: await readBalances(registry.for("emp_c")) };

await sandboxSimulator.deposit(a, tenants.emp_a.globalAccountId, "500", "Northwind smoke funding");
console.log("Northwind after deposit:", show(await readBalances(a)));

const person = (id: string, first: string, last: string, key: "US_USD" | "DE_EUR", amount: string): ContractorProfile => {
  const corridor = CORRIDORS[key];
  return { id, employerId: "emp_a", name: `${first} ${last}`, firstName: first, lastName: last, country: corridor.country, currency: corridor.currency, amountMinor: toMinor(amount, corridor.currency), priority: "standard", corridor };
};
const team = [person("kit6_ana", "Ana", "Lopez", "US_USD", "25"), person("kit6_lena", "Lena", "Schmidt", "DE_EUR", "20")];

const eurQuote = await createQuote(a, "EUR", "USD", "20.00");
const plan = planEmployerPayroll({
  employer: { ...employers[0], accountId: tenants.emp_a.accountId },
  contractors: team,
  balances: { accountId: tenants.emp_a.accountId, available: await readBalances(a) },
  rates: { EUR: (Number(toMajor(eurQuote.sellMinor, "USD")) / 20).toFixed(8) },
  payday: new Date(),
  now: new Date(),
  config: { ...policyConfig, platformFeeMinor: toMinor("5", "USD"), rails: Object.fromEntries(Object.entries(policyConfig.rails).map(([k, v]) => [k, { ...v, localCutoffUtc: "23:59", swiftCutoffUtc: "23:59" }])) },
});
const runId = `kit6-${Date.now()}`;
const report = await executeEmployerPlan({ runId, plan, profiles: new Map(team.map((p) => [p.id, p])), api: a, store });
console.log("Conversions:", JSON.stringify(report.conversions));
for (const p of report.payouts) console.log("Payout:", JSON.stringify(p));
console.log("Northwind after payroll (the EUR conversion must have landed here, not on the platform):", show(await readBalances(a)));

for (const p of report.payouts) {
  if (p.status !== "sent") continue;
  await sandboxSimulator.transitionTransfer(a, p.transferId, "SENT");
  await sandboxSimulator.transitionTransfer(a, p.transferId, "PAID");
}

const fee = await collectPlatformFee(platformApi(platform), plan, store, runId, "connected");
console.log("Platform fee:", JSON.stringify(fee));
if (fee.status === "charged") {
  for (let i = 0; i < 10; i++) {
    const charge = await platform.get<{ status: string }>(`/charges/${fee.chargeId}`).catch((e) => ({ status: `lookup failed: ${(e as Error).message}` }));
    console.log(`  charge status: ${charge.status}`);
    if (charge.status === "SETTLED" || charge.status.startsWith("lookup")) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
console.log("Northwind final:", show(await readBalances(a)));

const after = { b: await readBalances(registry.for("emp_b")), c: await readBalances(registry.for("emp_c")) };
console.log("Contoso untouched:", show(before.b) === show(after.b), `(${show(after.b)})`);
console.log("Fabrikam untouched:", show(before.c) === show(after.c), `(${show(after.c)})`);
const errors = store.auditLog().filter((e) => e.status >= 400 || e.status === 0);
console.log(`Audit: ${store.auditLog().length} calls, ${errors.length} errors`);
for (const e of errors) console.log("  error:", e.method, e.path, e.status, e.error_code);
store.close();
