// Receives Airwallex webhooks for the provisioned employers (data/tenants.json) on
// http://localhost:4322/webhooks/airwallex. Verifies the signature over the raw body, answers at
// once, dedupes on event id in data/webhooks.db and prints each payout.transfer event per employer.
// Airwallex needs a public HTTPS URL: expose this port with a tunnel and pass it with --url, which
// creates (or re-points) the subscriptions by API, one on the platform and one per employer account.
// Run: npm run webhooks -- --url https://<your tunnel>
import { mkdirSync } from "node:fs";
import { AirwallexClient } from "../src/airwallex/client.ts";
import { Store } from "../src/executor/store.ts";
import { employers } from "../src/scenario/seed.ts";
import { loadTenants } from "../src/scenario/tenants.ts";
import { WebhookReceiver } from "../src/webhooks/airwallex.ts";
import { startWebhookServer, WEBHOOK_PATH } from "../src/webhooks/server.ts";
import { loadSubscriptions, pointSubscriptions } from "../src/webhooks/subscriptions.ts";

const PORT = Number(process.env.WEBHOOK_PORT ?? 4322);
const urlFlag = process.argv.indexOf("--url");
const publicUrl = urlFlag > 0 ? process.argv[urlFlag + 1] : undefined;

const tenants = loadTenants();
const employerByAccount = new Map(employers.filter((e) => tenants[e.employerId]?.accountId).map((e) => [tenants[e.employerId].accountId, e.employerId]));
const subscriptions = publicUrl
  ? await pointSubscriptions(AirwallexClient.fromEnv(), ["platform", ...employerByAccount.keys()], publicUrl, console.log)
  : loadSubscriptions();
const secrets = [...subscriptions.map((s) => s.secret), process.env.AWX_WEBHOOK_SECRET ?? ""].filter(Boolean);
if (!secrets.length) {
  console.error("No webhook subscription yet: open a tunnel to this port and run npm run webhooks -- --url https://<tunnel>.");
  process.exit(1);
}

mkdirSync("data", { recursive: true });
const receiver = new WebhookReceiver({ secret: secrets, store: new Store("data/webhooks.db"), employerByAccount });
await startWebhookServer(receiver, PORT, (result) => {
  const t = result.transfer;
  console.log(`${new Date().toISOString()} ${result.outcome} ${result.name ?? ""}${t ? ` ${t.employerId} transfer ${t.transferId} ${t.status}${t.failureType ? ` ${t.failureType}` : ""}` : ""}`);
});
console.log(`Webhook receiver on http://localhost:${PORT}${WEBHOOK_PATH} for ${employerByAccount.size} employers, ${secrets.length} subscription secrets`);
