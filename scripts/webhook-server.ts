// Receives Airwallex webhooks for the provisioned employers (data/tenants.json) on
// http://localhost:4322/webhooks/airwallex. Verifies the signature over the raw body, answers at
// once, dedupes on event id in data/webhooks.db and prints each payout.transfer event per employer.
// Airwallex needs a public HTTPS URL: expose this port with a tunnel, then create the subscription in
// the sandbox web app (Developer > Webhooks) and put its secret in AWX_WEBHOOK_SECRET.
// Run: npm run webhooks
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { Store } from "../src/executor/store.ts";
import { employers } from "../src/scenario/seed.ts";
import { loadTenants } from "../src/scenario/tenants.ts";
import { WebhookReceiver } from "../src/webhooks/airwallex.ts";

const PORT = Number(process.env.WEBHOOK_PORT ?? 4322);
const secret = process.env.AWX_WEBHOOK_SECRET;
if (!secret) {
  console.error("Set AWX_WEBHOOK_SECRET in .env (the subscription's secret from the sandbox web app).");
  process.exit(1);
}

const tenants = loadTenants();
const employerByAccount = new Map(employers.filter((e) => tenants[e.employerId]?.accountId).map((e) => [tenants[e.employerId].accountId, e.employerId]));
mkdirSync("data", { recursive: true });
const receiver = new WebhookReceiver({ secret, store: new Store("data/webhooks.db"), employerByAccount });

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhooks/airwallex") {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const header = (name: string) => (Array.isArray(req.headers[name]) ? req.headers[name][0] : req.headers[name]);
    const result = receiver.receive({ timestamp: header("x-timestamp"), signature: header("x-signature") }, Buffer.concat(chunks).toString("utf8"));
    res.writeHead(result.http).end();
    const t = result.transfer;
    console.log(
      `${new Date().toISOString()} ${result.outcome} ${result.name ?? ""}${t ? ` ${t.employerId} transfer ${t.transferId} ${t.status}${t.failureType ? ` ${t.failureType}` : ""}` : ""}`,
    );
  });
}).listen(PORT, "127.0.0.1", () => console.log(`Webhook receiver on http://localhost:${PORT}/webhooks/airwallex for ${employerByAccount.size} employers`));
