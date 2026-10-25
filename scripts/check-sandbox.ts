// Read-only sandbox readiness check. Prints no secrets and creates nothing.
// Run: npm run check
import { AirwallexClient, AirwallexError } from "../src/airwallex/client.ts";

type Result = { step: string; ok: boolean; detail: string };
const results: Result[] = [];

async function step(name: string, fn: () => Promise<string>) {
  try {
    results.push({ step: name, ok: true, detail: await fn() });
  } catch (err) {
    const detail =
      err instanceof AirwallexError ? `${err.status} ${err.code ?? ""}`.trim() : (err as Error).message;
    results.push({ step: name, ok: false, detail });
  }
}

const client = AirwallexClient.fromEnv();

await step("Login (API key)", async () => {
  await client.get("/balances/current");
  return "token issued";
});

await step("Global accounts", async () => {
  const r = await client.get<{
    items?: { country_code?: string; required_features?: { currency: string; transfer_method: string }[] }[];
  }>("/global_accounts");
  const items = r.items ?? [];
  const label = (a: (typeof items)[number]) =>
    `${a.country_code}/${(a.required_features ?? []).map((f) => `${f.currency} ${f.transfer_method}`).join("+")}`;
  return `${items.length} found${items.length ? ": " + items.map(label).join(", ") : ""}`;
});

await step("Wallet balances", async () => {
  const r = await client.get<{ currency: string; available_amount: number }[]>("/balances/current");
  const nonZero = r.filter((b) => b.available_amount > 0);
  return nonZero.length ? nonZero.map((b) => `${b.currency} ${b.available_amount}`).join(", ") : "all zero";
});

// List endpoints answer even before Airwallex enables platform access, so an empty list
// proves nothing. Only an existing connected account (or a successful create) does.
let connectedAccounts = 0;
await step("Connected accounts (list)", async () => {
  const r = await client.get<{ items?: { id: string; status?: string }[] }>("/accounts", { query: { page_size: 10 } });
  const items = r.items ?? [];
  connectedAccounts = items.length;
  return `${items.length} connected account(s)${items.length ? ": " + items.map((a) => a.status).join(", ") : ""}`;
});

await step("Platform payments (list)", async () => {
  const q = { page_num: 0, page_size: 10 };
  const charges = await client.get<{ items?: unknown[] }>("/charges", { query: q });
  const transfers = await client.get<{ items?: unknown[] }>("/connected_account_transfers", { query: q });
  return `${charges.items?.length ?? 0} charge(s), ${transfers.items?.length ?? 0} connected-account transfer(s)`;
});

for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"}  ${r.step}: ${r.detail}`);

if (connectedAccounts === 0) {
  console.log(
    "\nKit 6 platform access is unconfirmed: lists respond before it is enabled. It is confirmed once\n" +
      "Airwallex (devhelp@airwallex.com) replies, or the first POST /accounts/create succeeds.",
  );
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
