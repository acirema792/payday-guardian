// Live webhook check on the Airwallex sandbox, for one employer's connected account (Kit 6).
// It subscribes that account to payout.transfer.* events at your public URL (a tunnel to port
// 4322), makes one small sandbox payout, moves it to SENT and then FAILED with the simulator, and
// records every event Airwallex delivers: signature verified (HMAC-SHA256 over x-timestamp + raw
// body), deduped on event id, routed to the employer by account_id. It also sends the receiver one
// forged event to show a bad signature is refused. Sandbox only; the payout is 10 USD of the
// employer's own sandbox balance (topped up by a simulated deposit if needed).
// Usage: npm run webhooks:live -- --url https://<your tunnel>
//    or: npm run webhooks:live -- --inbox   (no tunnel: Airwallex delivers to an anonymous webhook.site
//        inbox, and each delivery is read back with its exact body and headers and handed to the same
//        receiver code; the signing secret never leaves this machine)
// Writes docs/evidence/webhooks-live.{json,md}. Secrets stay in data/ and are never printed.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createBeneficiary, createTransfer, readBalances, validateBeneficiary } from "../src/airwallex/api.ts";
import { AirwallexClient } from "../src/airwallex/client.ts";
import { Store } from "../src/executor/store.ts";
import { toMinor } from "../src/policy/money.ts";
import { beneficiaryPayload, CORRIDORS } from "../src/scenario/corridors.ts";
import { employers } from "../src/scenario/seed.ts";
import { loadTenants } from "../src/scenario/tenants.ts";
import { sandboxSimulator } from "../src/sandbox/simulator.ts";
import { TenantRegistry } from "../src/tenant/adapter.ts";
import { type WebhookResult, WebhookReceiver } from "../src/webhooks/airwallex.ts";
import { startWebhookServer, WEBHOOK_PATH } from "../src/webhooks/server.ts";
import { pointSubscriptions } from "../src/webhooks/subscriptions.ts";

const PORT = 4322;
const EMPLOYER = "emp_c";
const urlFlag = process.argv.indexOf("--url");
const inboxMode = process.argv.includes("--inbox");
let publicUrl = urlFlag > 0 ? process.argv[urlFlag + 1] : undefined;
let inboxToken: string | undefined;
if (inboxMode) {
  const res = await fetch("https://webhook.site/token", { method: "POST", headers: { accept: "application/json" } });
  inboxToken = ((await res.json()) as { uuid: string }).uuid;
  publicUrl = `https://webhook.site/${inboxToken}`;
}
if (!publicUrl || !/^https:\/\//.test(publicUrl)) {
  console.error("Pass the tunnel's https URL (--url https://<your tunnel>) or use --inbox");
  process.exit(1);
}
const mode = inboxMode ? "inbox" : "tunnel";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tenants = loadTenants();
const platform = AirwallexClient.fromEnv();
const registry = new TenantRegistry(
  platform,
  employers.map((e) => ({ employerId: e.employerId, name: e.name, accountId: tenants[e.employerId].accountId, mode: tenants[e.employerId].mode })),
);
const employer = employers.find((e) => e.employerId === EMPLOYER)!;
const accountId = tenants[EMPLOYER].accountId;
const api = registry.for(EMPLOYER);

// 1. The receiver, then the subscription pointing at it (created by API on the employer's account).
mkdirSync("data", { recursive: true });
const subscriptions = await pointSubscriptions(platform, [accountId], publicUrl, (line) => console.log(line.replace(publicUrl, "<tunnel>")), "data/webhook-subscriptions-live.json");
const secret = subscriptions.find((s) => s.scope === accountId)?.secret;
if (!secret) throw new Error(`No webhook subscription on ${accountId}; nothing sent`);
const deliveries: (WebhookResult & { at: string })[] = [];
const receiver = new WebhookReceiver({ secret, store: new Store(`data/webhooks-live-${Date.now()}.db`), employerByAccount: new Map([[accountId, EMPLOYER]]) });
const record = (r: WebhookResult) => {
  deliveries.push({ ...r, at: new Date().toISOString() });
  console.log(`  webhook: ${r.outcome} ${r.name ?? ""} ${r.transfer ? `${r.transfer.transferId} ${r.transfer.status}${r.transfer.failureType ? ` ${r.transfer.failureType}` : ""}` : ""}`);
};
const server = inboxMode ? undefined : await startWebhookServer(receiver, PORT, record);
if (server) console.log(`Receiver on http://localhost:${PORT}${WEBHOOK_PATH}`);

// Inbox mode: read each new delivery back (exact raw body and headers) and hand it to the receiver.
type InboxRequest = { uuid: string; content: string; headers: Record<string, string[] | undefined>; method: string };
const seen = new Set<string>();
const inboxRaw: InboxRequest[] = [];
async function pollInbox(): Promise<void> {
  if (!inboxToken) return;
  const res = await fetch(`https://webhook.site/token/${inboxToken}/requests?sorting=oldest&per_page=100`, { headers: { accept: "application/json" } });
  const { data } = (await res.json()) as { data: InboxRequest[] };
  for (const req of data) {
    if (seen.has(req.uuid) || req.method !== "POST") continue;
    seen.add(req.uuid);
    inboxRaw.push(req);
    record(receiver.receive({ timestamp: req.headers["x-timestamp"]?.[0], signature: req.headers["x-signature"]?.[0] }, req.content));
  }
}

// 2. A forged event must be refused: through the tunnel to our server, or (inbox mode) handed to the
// receiver directly once a real delivery has arrived, as that delivery with one byte of its body changed.
let forged = { status: 0 };
if (!inboxMode) {
  forged = await fetch(`${publicUrl.replace(/\/$/, "")}${WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-timestamp": String(Date.now()), "x-signature": "00".repeat(32) },
    body: JSON.stringify({ id: `forged-${randomUUID()}`, name: "payout.transfer.paid", account_id: accountId, data: { id: "forged", status: "PAID" }, created_at: new Date().toISOString() }),
  });
  console.log(`Forged event through the tunnel: HTTP ${forged.status}`);
}

// 3. Funds for a 10 USD payout from the employer's own wallet.
const amountMinor = toMinor("10", "USD");
let usd = (await readBalances(api)).USD ?? 0n;
if (usd < amountMinor) {
  await sandboxSimulator.deposit(api, tenants[EMPLOYER].globalAccountId, "20", `${employer.name} webhook check funding`);
  for (let i = 0; i < 30 && usd < amountMinor; i++) {
    await sleep(2000);
    usd = (await readBalances(api)).USD ?? 0n;
  }
  if (usd < amountMinor) throw new Error("The test deposit has not settled; nothing sent");
}

// 4. One payout, then SENT and FAILED through the simulator.
const corridor = CORRIDORS.US_USD;
const payload = beneficiaryPayload(corridor, "Webhook", "Check");
await validateBeneficiary(api, payload, "LOCAL");
const beneficiaryId = await createBeneficiary(api, randomUUID(), payload, "LOCAL", "Webhook Check");
const transfer = await createTransfer(api, { requestId: randomUUID(), beneficiaryId, currency: "USD", amountMajor: "10.00", method: "LOCAL", reference: "Webhook check" });
console.log(`Transfer ${transfer.id} ${transfer.status}`);
await sleep(5000);
await sandboxSimulator.transitionTransfer(api, transfer.id, "SENT");
await sleep(5000);
await sandboxSimulator.transitionTransfer(api, transfer.id, "FAILED", "BENEFICIARY_BANK_RETURNED");

// 5. Wait for the failed event (Airwallex delivers at least once; give it up to 3 minutes).
const forTransfer = () => deliveries.filter((d) => d.transfer?.transferId === transfer.id);
for (let i = 0; i < 90 && !forTransfer().some((d) => d.transfer?.status === "CANCELLED" || d.name === "payout.transfer.failed" || d.name === "payout.transfer.cancelled"); i++) {
  await pollInbox();
  await sleep(2000);
}
await sleep(10_000); // collect any redeliveries
await pollInbox();
server?.close();
if (inboxMode) {
  // The tamper check: a real delivery with one byte of its body changed, same headers.
  const real = inboxRaw.find((r) => r.content.includes(transfer.id));
  if (real) {
    const tampered = real.content.replace(/"status":"(\w)/, (_m, c: string) => `"status":"${c === "X" ? "Y" : "X"}`);
    const r = receiver.receive({ timestamp: real.headers["x-timestamp"]?.[0], signature: real.headers["x-signature"]?.[0] }, tampered);
    record(r);
    forged = { status: r.http };
    console.log(`Tampered copy of a real delivery: HTTP ${r.http} ${r.outcome}`);
  }
  await fetch(`https://webhook.site/token/${inboxToken}`, { method: "DELETE" }).catch(() => undefined);
}

const events = forTransfer();
const finalStatus = (await api.get<{ status: string }>(`/transfers/${transfer.id}`)).status;
const processed = events.filter((d) => d.outcome === "processed");
const forgedRefused = forged.status === 400 && deliveries.some((d) => d.outcome === "bad_signature");
const failedSeen = processed.some((d) => d.name === "payout.transfer.failed" || d.name === "payout.transfer.cancelled");
// Earlier runs' test transfers stay listed, so the two-way reconciliation can still account for them.
const EVIDENCE_JSON = "docs/evidence/webhooks-live.json";
const previous = existsSync(EVIDENCE_JSON) ? (JSON.parse(readFileSync(EVIDENCE_JSON, "utf8")) as { transfer?: { id: string }; earlierTransfers?: string[] }) : undefined;
const earlierTransfers = [...(previous?.earlierTransfers ?? []), ...(previous?.transfer?.id && previous.transfer.id !== transfer.id ? [previous.transfer.id] : [])];
const report = {
  ranAt: new Date().toISOString(),
  employer: employer.name,
  accountId,
  subscription: { events: "payout.transfer.*", created: "by API, x-on-behalf-of the employer account" },
  transfer: { id: transfer.id, amount: "USD 10.00", method: "LOCAL", transitions: ["requested SENT", "requested FAILED (BENEFICIARY_BANK_RETURNED)"], readsBack: finalStatus },
  mode,
  forged: { how: inboxMode ? "a real delivery with one byte of its body changed, same headers" : "a forged event with a wrong signature, through the tunnel", http: forged.status, outcome: deliveries.find((d) => d.outcome === "bad_signature")?.outcome ?? "not received" },
  events: events.filter((d) => d.outcome !== "bad_signature").map((d) => ({ at: d.at, name: d.name, eventId: d.eventId, outcome: d.outcome, status: d.transfer?.status, failureType: d.transfer?.failureType })),
  verifiedAndProcessed: processed.length,
  duplicatesIgnored: events.filter((d) => d.outcome === "duplicate").length,
  ok: failedSeen && forgedRefused,
  note: "",
  ...(earlierTransfers.length ? { earlierTransfers } : {}),
};
// What the sandbox actually sent, which can differ from what was requested (2026-11-12: a PAID event
// before FAILED, and failure type INCORRECT_ROUTING).
const sentNames = report.events.map((e) => (e.name ?? "").replace("payout.transfer.", ""));
const listed = sentNames.length > 1 ? `${sentNames.slice(0, -1).join(", ")} and ${sentNames.at(-1)}` : sentNames.join("");
const failureTypes = [...new Set(report.events.map((e) => e.failureType).filter(Boolean))];
report.note = `The sandbox emitted ${listed} events${failureTypes.length ? ` and reported failure type ${failureTypes.join(", ")}` : ""}; the events are recorded as the sandbox sent them.`;
writeFileSync(EVIDENCE_JSON, JSON.stringify(report, null, 2) + "\n");
writeFileSync(
  "docs/evidence/webhooks-live.md",
  `# Live Airwallex webhooks

On ${report.ranAt.slice(0, 10)} \`npm run webhooks:live\` subscribed ${employer.name}'s connected account (\`${accountId}\`) to \`payout.transfer.*\` events by API (\`POST /webhooks/create\` with \`x-on-behalf-of\`), ${inboxMode ? "pointed at an anonymous public request inbox (webhook.site), since this machine had no public URL. Each delivery was read back from the inbox with its exact raw body and headers and handed to our receiver code; the subscription's signing secret never left this machine" : "pointed at our receiver through a temporary public tunnel"}. It then sent one USD 10.00 LOCAL sandbox payout from that account and asked the sandbox simulator for SENT and then FAILED (failure type \`BENEFICIARY_BANK_RETURNED\`). The events below are exactly what the sandbox sent; the transfer reads back ${finalStatus}.

Each delivery was checked by the receiver before anything else: HMAC-SHA256 over \`x-timestamp\` + raw body with the subscription's secret, a 5-minute window, dedupe on event id, and routing by \`account_id\` to the employer ([\`src/webhooks/airwallex.ts\`](../../src/webhooks/airwallex.ts)).

| ${inboxMode ? "Read from the inbox (UTC)" : "Received (UTC)"} | Event | Receiver outcome | Transfer status | Failure type |
|---|---|---|---|---|
${report.events.map((e) => `| ${e.at.slice(11, 19)} | \`${e.name}\` | ${e.outcome} | ${e.status ?? ""} | ${e.failureType ?? ""} |`).join("\n")}

${report.verifiedAndProcessed} events verified and processed for transfer \`${transfer.id}\`; ${report.duplicatesIgnored} redeliveries recognised as duplicates. ${inboxMode ? "The same receiver refused a real delivery with one byte of its body changed" : "A forged \\`payout.transfer.paid\\` sent through the same tunnel with a wrong signature was refused"} (HTTP ${forged.status}, \`${report.forged.outcome}\`).${inboxMode ? " What this does not show: our own server receiving the push in real time; the receiver checked each delivery seconds after it reached the inbox." : ""}
`,
);
console.log(`\n${report.ok ? "OK" : "CHECK"}: ${report.verifiedAndProcessed} verified events for ${transfer.id}, failed event ${failedSeen ? "received" : "NOT received"}, forged event ${forgedRefused ? "refused" : "NOT refused"}`);
process.exit(report.ok ? 0 : 1);
