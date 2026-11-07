// Publishes the proof of a live run to docs/evidence: the console timeline, the full audit log of
// Airwallex calls, and a summary that checks tenant isolation from the log itself. Nothing secret is
// in either file: sandbox account and object ids, paths, statuses and synthetic names only.
// Run: npm run evidence                (latest data/live-*.db and data/demo-run-live.json)
//      npm run evidence -- data/live-20261028T010823.db
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { AirwallexClient } from "../src/airwallex/client.ts";
import { employers } from "../src/scenario/seed.ts";
import { loadTenants } from "../src/scenario/tenants.ts";

const dbPath = process.argv[2] ?? `data/${readdirSync("data").filter((f) => /^live-.*\.db$/.test(f)).sort().at(-1)}`;
const db = new DatabaseSync(dbPath);
const rows = db.prepare("SELECT at, method, path, account, request_id, status, error_code, ms FROM audit ORDER BY id").all() as {
  at: string;
  method: string;
  path: string;
  account: string | null;
  request_id: string | null;
  status: number;
  error_code: string | null;
  ms: number;
}[];
const run = JSON.parse(readFileSync("data/demo-run-live.json", "utf8"));
const tenants = loadTenants();
const nameOf = new Map(employers.map((e) => [tenants[e.employerId]?.accountId, e.name]));

mkdirSync("docs/evidence", { recursive: true });
copyFileSync("data/demo-run-live.json", "docs/evidence/live-run.json");
const csv = (v: unknown) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync(
  "docs/evidence/live-audit.csv",
  ["at,method,path,account,request_id,status,error_code,ms", ...rows.map((r) => [r.at, r.method, r.path, r.account, r.request_id, r.status, r.error_code, r.ms].map(csv).join(","))].join("\n") + "\n",
);

const endpoint = (path: string) => path.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "/{id}").replace(/\/charges\/ch_[\w-]+/, "/charges/{id}");
const count = <K>(keys: K[]) => [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<K, number>())].sort((a, b) => b[1] - a[1]);
const errors = rows.filter((r) => r.status >= 400); // an error response from Airwallex
const noResponse = rows.filter((r) => r.status === 0); // network timeout: no response, read retried by the client
type ReconciledPayout = { contractor: string; employer: string; transferId: string; ledger: string; bank: string; status: string };
const strangers = rows.filter((r) => r.account && !nameOf.has(r.account));
const summary = run.summary;

// The closing reconciliation: each payout as the ledger has it and as Airwallex reported it back.
const reconciled = (summary.reconciled?.payouts ?? []) as ReconciledPayout[];
const reconciliationTable = reconciled.length
  ? `\n## Closing reconciliation (read back from Airwallex on each employer's own account)\n\n| Contractor | Employer | Transfer | Ledger | Airwallex | Status |\n|---|---|---|---|---|---|\n${reconciled
      .map((r) => `| ${r.contractor} | ${r.employer} | \`${r.transferId.slice(0, 8)}…\` | ${r.ledger} | ${r.bank} | ${r.status} |`)
      .join("\n")}\n`
  : "";

// With credentials, read each platform fee charge back from Airwallex (read-only).
const fees = db.prepare("SELECT key, result FROM operations WHERE key LIKE '%:fee' AND result IS NOT NULL ORDER BY key").all() as { key: string; result: string }[];
let feeTable = "";
if (process.env.AWX_CLIENT_ID && fees.length) {
  const client = AirwallexClient.fromEnv();
  const lines: string[] = [];
  for (const f of fees) {
    const { chargeId } = JSON.parse(f.result);
    const c = await client.get<{ status: string; amount: number; currency: string; source: string }>(`/charges/${chargeId}`);
    lines.push(`| \`${f.key}\` | \`${chargeId}\` | ${nameOf.get(c.source) ?? c.source} | ${c.currency} ${c.amount} | ${c.status} |`);
  }
  feeTable = `\n## Platform fee charges, read back on ${new Date().toISOString().slice(0, 10)}\n\n| Operation | Charge | Charged to | Amount | Status |\n|---|---|---|---|---|\n${lines.join("\n")}\n`;
}

// The Metal testnet advance, when the run had the instant rail: every pull, with explorer links.
type Pull = { outcome: string; transaction?: string; explorer?: string; reason?: string; sent?: boolean; again?: boolean };
const metalEvents = run.events.filter((e: { data?: { metal?: unknown } }) => e.data?.metal) as { at: string; data: { metal: {
  rail: string; account: string; mandate: string; payee: string; amount: string; paymentId: string;
  paid?: Pull; again?: Pull; probes: { probe: string; result: Pull }[]; verification?: { verified: boolean; payments: string[] };
} } }[];
const explorer = (m: { rail: string }, kind: "tx" | "address", id: string) => (m.rail === "Metal testnet" ? `[\`${id.slice(0, 10)}…\`](https://testnet.metalntwx.com/${kind}/${id})` : `\`${id.slice(0, 10)}…\``);
const pullRow = (m: { rail: string }, what: string, r: Pull | undefined) =>
  `| ${what} | ${!r ? "not run" : r.outcome === "refused" ? `refused${r.sent ? " (recorded on chain)" : ", nothing sent"}: ${r.reason}` : r.again ? "already paid, nothing sent" : r.outcome} | ${r?.transaction ? explorer(m, "tx", r.transaction) : ""} |`;
const metalSection = metalEvents
  .map(({ data: { metal: m } }) => `
## Instant advance on ${m.rail}

The ops lead approved an advance of ${m.amount} USDZ to the address the contractor opted in with. The agent
paid it under the mandate on Contoso Health's Metal account ${explorer(m, "address", m.account)}, whose limits Metal enforces on chain.

| Pull | Outcome | Transaction |
|---|---|---|
${m.probes.filter((p) => !p.probe.includes("new payment id")).map((p) => pullRow(m, `Probe: ${p.probe}`, p.result)).join("\n")}
${pullRow(m, `The approved advance, payment id \`${m.paymentId}\``, m.paid)}
${pullRow(m, "The same pull again", m.again)}
${m.probes.filter((p) => p.probe.includes("new payment id")).map((p) => pullRow(m, `Probe: ${p.probe}`, p.result)).join("\n")}

\`mandate verify\`, from the chain alone: ${m.verification ? `${m.verification.verified ? "verified" : "NOT verified"}; ${m.verification.payments.length} on chain` : "not run"}.
`)
  .join("");

writeFileSync(
  "docs/evidence/README.md",
  `# Live run evidence

The full demo, run on the Airwallex sandbox against three Kit 6 connected accounts, with Claude
reading the inbound messages. Generated by \`npm run evidence\` from the run's own audit store.

- Timeline shown in the console: [live-run.json](live-run.json) (\`npm run console\`, then open http://localhost:4321/?run=live)
- Every Airwallex call, in order: [live-audit.csv](live-audit.csv)

## Result

| | |
|---|---|
| Environment | ${run.environment} |
| Reader | ${run.reader} |
| Contractors paid on payday | ${summary.paidOnPayday} of ${summary.contractors} |
| Suspected diversions stopped / released to the account on file after a person approved | ${summary.heldForFraud} / ${summary.releasedAfterApproval ?? 0} |
| Escalated after the cut-off / given an instant advance on Metal | ${summary.escalatedCutoff} / ${summary.instantAdvances ?? 0} |
| Bank returns re-paid (once) | ${summary.returnsRepaid} |
| Wallet conversions / payout-linked FX | ${summary.walletConversions} / ${summary.payoutLinkedFx} |
| Platform fees charged / deferred | ${summary.feesCollected} / ${summary.feesDeferred} |
${summary.reconciled ? `| Payouts read back from Airwallex and matching the ledger (amount, currency, PAID) | ${summary.reconciled.matched} of ${summary.paidOnPayday}, ${summary.reconciled.issues} issues |\n` : ""}${reconciliationTable}
## Audit log checks

- **${rows.length} Airwallex API calls** between ${rows[0].at} and ${rows.at(-1)!.at}, **${errors.length} error responses**${errors.length ? ` (${errors.map((r) => `${r.status} ${r.error_code ?? ""} on \`${r.method} ${endpoint(r.path)}\``).join(", ")}; each retried and read back)` : ""}${noResponse.length ? ` (and ${noResponse.length} ${noResponse.length === 1 ? "read" : "reads"} with no response, a network timeout, retried at once: \`${noResponse.map((r) => `${r.method} ${endpoint(r.path)}`).join("`, `")}\`)` : ""}. (The payday report counts ${summary.apiCalls}: its own final snapshot reads each employer's balance afterwards.)
- The payday itself is a scenario clock (${run.events[0].at.slice(0, 10)}, 04:00 to 07:00 UTC); the calls above ran at the real times shown.
- Employer-scoped calls touched **only the ${nameOf.size} employer accounts**${strangers.length ? `, plus ${strangers.length} calls on other accounts (CHECK)` : ""}; ${rows.filter((r) => !r.account).length} platform-level calls (creating the platform fee charges, which name the employer as \`source\`, and reading them back until SETTLED).

| Account | Employer | Calls |
|---|---|---|
${count(rows.map((r) => r.account ?? "platform")).map(([a, n]) => `| \`${a}\` | ${nameOf.get(a) ?? "platform"} | ${n} |`).join("\n")}

| Endpoint | Calls |
|---|---|
${count(rows.map((r) => `${r.method} ${endpoint(r.path)}`)).map(([e, n]) => `| \`${e}\` | ${n} |`).join("\n")}
${feeTable}${metalSection}`,
);
console.log(`Wrote docs/evidence from ${dbPath}: ${rows.length} calls, ${errors.length} errors, ${strangers.length} on unknown accounts`);
