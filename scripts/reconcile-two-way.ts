// Two-way reconciliation of the committed live run, read-only. The closing reconciliation in the
// run read back every payout in our ledger. This checks the other direction: it lists every
// transfer Airwallex holds on each employer's connected account and requires each one to be a
// transfer our store recorded sending (a payout or a repay). It also checks that every transfer we
// recorded is listed on its own employer's account. Only GET calls, no money moves.
// Each live run used freshly provisioned accounts, so the listing covers each account's whole life.
// Usage: npm run reconcile:two-way [-- --db data/live-<run>.db]   Writes docs/evidence/two-way-reconciliation.{json,md}
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { listTransfers } from "../src/airwallex/api.ts";
import { AirwallexClient } from "../src/airwallex/client.ts";
import { findUnrecorded } from "../src/policy/reconcile.ts";
import { employers } from "../src/scenario/seed.ts";
import { loadTenants } from "../src/scenario/tenants.ts";
import { TenantRegistry } from "../src/tenant/adapter.ts";

const flag = process.argv.indexOf("--db");
const dbPath = flag > 0 ? process.argv[flag + 1] : "data/live-20261107T024753.db";
const db = new DatabaseSync(dbPath, { readOnly: true });

// What our store recorded sending: payout and repay operations, each with the transfer it created.
const rows = db.prepare("SELECT key, result FROM operations WHERE (key LIKE '%:payout:%' OR key LIKE '%:repay:%') AND result IS NOT NULL").all() as { key: string; result: string }[];
const recorded = new Map<string, { employerId: string; transferIds: Set<string> }>();
for (const r of rows) {
  const employerId = r.key.split(":")[1];
  const id = (JSON.parse(r.result) as { id?: string }).id;
  if (!id) continue;
  if (!recorded.has(employerId)) recorded.set(employerId, { employerId, transferIds: new Set() });
  recorded.get(employerId)!.transferIds.add(id);
}

// The run's accounts and when it first touched each one.
const used = db.prepare("SELECT account, MIN(at) AS first FROM audit WHERE account IS NOT NULL GROUP BY account").all() as { account: string; first: string }[];
const firstUse = new Map(used.map((u) => [u.account, u.first]));

const tenants = loadTenants();
const platform = AirwallexClient.fromEnv();
const registry = new TenantRegistry(
  platform,
  employers.map((e) => ({ employerId: e.employerId, name: e.name, accountId: tenants[e.employerId].accountId, mode: tenants[e.employerId].mode })),
);

const now = new Date().toISOString();
const perEmployer: {
  employer: string;
  accountId: string;
  window: { from: string; to: string };
  listedAtAirwallex: number;
  recordedByUs: number;
  unrecorded: ReturnType<typeof findUnrecorded>;
  recordedButNotListed: string[];
  statuses: Record<string, number>;
}[] = [];
for (const e of employers) {
  const accountId = tenants[e.employerId].accountId;
  const first = firstUse.get(accountId);
  if (!first) throw new Error(`${e.name}'s account ${accountId} in data/tenants.json was not used by ${dbPath}; nothing compared`);
  // From six hours before the run's first call on the account (it was created minutes before) to now.
  const from = new Date(new Date(first).getTime() - 6 * 3600_000).toISOString();
  const listed = await listTransfers(registry.for(e.employerId), from, now);
  const ours = recorded.get(e.employerId)?.transferIds ?? new Set<string>();
  const unrecorded = findUnrecorded(ours, listed.map((t) => ({ transferId: t.id, status: t.status, amountMinor: t.amountMinor, currency: t.currency })));
  const listedIds = new Set(listed.map((t) => t.id));
  const notListed = [...ours].filter((id) => !listedIds.has(id));
  const statuses: Record<string, number> = {};
  for (const t of listed) statuses[t.status] = (statuses[t.status] ?? 0) + 1;
  perEmployer.push({ employer: e.name, accountId, window: { from, to: now }, listedAtAirwallex: listed.length, recordedByUs: ours.size, unrecorded, recordedButNotListed: notListed, statuses });
  console.log(`${e.name} (${accountId}): Airwallex lists ${listed.length}, our store recorded ${ours.size}; unrecorded ${unrecorded.length}, recorded but not listed ${notListed.length}; ${JSON.stringify(statuses)}`);
}

const clean = perEmployer.every((p) => p.unrecorded.length === 0 && p.recordedButNotListed.length === 0);
const report = { ranAt: now, run: dbPath.replace(/^data\//, ""), readOnly: true, clean, perEmployer };
writeFileSync("docs/evidence/two-way-reconciliation.json", JSON.stringify(report, null, 2) + "\n");
const sum = (k: "listedAtAirwallex" | "recordedByUs") => perEmployer.reduce((n, p) => n + p[k], 0);
writeFileSync(
  "docs/evidence/two-way-reconciliation.md",
  `# Two-way reconciliation of the live run

The closing reconciliation in the live run read back every payout in our ledger from Airwallex. This checks the other direction, so a transfer we have no record of cannot hide: on ${now.slice(0, 10)} we listed every transfer Airwallex holds on each employer's connected account (\`GET /api/v1/transfers\` with \`x-on-behalf-of\`, read-only) and compared it with every transfer our store recorded sending in the run (\`${report.run}\`: payouts and repays). Each live run used freshly provisioned accounts, so each listing covers the account's whole life. Reproduce with \`npm run reconcile:two-way\` (needs our sandbox credentials).

| Employer | Connected account | Listed by Airwallex | Recorded by us | Listed but not recorded | Recorded but not listed | Statuses at Airwallex |
|---|---|---|---|---|---|---|
${perEmployer.map((p) => `| ${p.employer} | \`${p.accountId}\` | ${p.listedAtAirwallex} | ${p.recordedByUs} | ${p.unrecorded.length} | ${p.recordedButNotListed.length} | ${Object.entries(p.statuses).map(([s, n]) => `${s} ${n}`).join(", ")} |`).join("\n")}
| **All three** | | **${sum("listedAtAirwallex")}** | **${sum("recordedByUs")}** | **${perEmployer.reduce((n, p) => n + p.unrecorded.length, 0)}** | **${perEmployer.reduce((n, p) => n + p.recordedButNotListed.length, 0)}** | |

${clean ? "Every transfer on the three accounts is one we recorded sending, and every transfer we recorded is on its own employer's account." : "**Not clean:** see docs/evidence/two-way-reconciliation.json for each transfer."}
`,
);
console.log(clean ? "CLEAN" : "NOT CLEAN");
if (!clean) process.exit(1);
