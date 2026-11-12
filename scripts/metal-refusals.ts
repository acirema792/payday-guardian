// Records on Metal testnet the three refusals of the committed live run's mandate.
//
// In the live run the three out-of-mandate pulls were refused by metal-agent before sending, so
// they are in our evidence but not on chain. This sends the same three pulls again under the same
// mandate with --record-refusal: the mandate refuses each one on chain, in a transaction that
// moves nothing, and `mandate verify` then lists the payment and the refusals from the chain.
//
// Safety: it runs only against the committed run's mandate, and only while that mandate's budget
// is fully spent, so no pull here can pay anyone. The gas is paid by a separate recorder key
// (faucet USDZ) that has no authority over the account; the mandate key signs, the owner key is
// not used. Needs METAL_RPC_URL and data/metal from npm run metal:setup.
// Usage: npm run metal:refusals   Writes docs/evidence/metal-refusals.json and .md
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadMetalSetup, MetalCliRail, parseLines } from "../src/metal/cli.ts";
import type { PullResult } from "../src/metal/rail.ts";
import { toMajor, toMinor } from "../src/policy/money.ts";

const RECORDER = "data/metal/recorder-key.json";
const PROBE_ADDRESS = "0x000000000000000000000000000000000000dEaD"; // the same address the live run probed
const rpc = process.env.METAL_RPC_URL;
const setup = loadMetalSetup();
if (!rpc || !setup) {
  console.error("Needs METAL_RPC_URL in .env and data/metal/metal.json (npm run metal:setup).");
  process.exit(1);
}
const redact = (text: string) => text.split(rpc).join("<METAL_RPC_URL>");

// The committed live run's Metal section: mandate, payee, amount and payment id.
const live = JSON.parse(readFileSync("docs/evidence/live-run.json", "utf8"));
const findMetal = (o: unknown): { mandate: string; account: string; payee: string; amount: string; paymentId: string } | undefined => {
  if (!o || typeof o !== "object") return undefined;
  if ("mandate" in o && "probes" in o) return o as never;
  for (const v of Object.values(o)) {
    const found = findMetal(v);
    if (found) return found;
  }
  return undefined;
};
const committed = findMetal(live);
if (!committed) throw new Error("No Metal section in docs/evidence/live-run.json");

const rail = new MetalCliRail(setup, rpc);
const before = await rail.status();
if (before.reference.toLowerCase() !== committed.mandate.toLowerCase()) {
  throw new Error(`data/metal/metal.json holds mandate ${before.reference}, not the committed run's ${committed.mandate}; nothing sent`);
}
if (!before.bound || before.budgetMinor <= 0n || before.spentMinor < before.budgetMinor) {
  throw new Error(`The mandate must be bound with its budget spent so no probe can pay (bound ${before.bound}, spent ${before.spentMinor} of ${before.budgetMinor} minor); nothing sent`);
}

function cli(args: string[], show = true): Promise<ReturnType<typeof parseLines>> {
  return new Promise((resolve, reject) => {
    execFile("node_modules/.bin/metal-agent", args, { env: { ...process.env, METAL_RPC_URL: rpc }, timeout: 300_000 }, (error, stdout, stderr) => {
      if (show) console.log(redact(`${stdout}${stderr ? `\n${stderr}` : ""}`).trim().replace(/^/gm, "  "));
      if (error) reject(new Error(redact(`metal-agent ${args.slice(0, 2).join(" ")} failed: ${stderr || error.message}`)));
      else resolve(parseLines(stdout));
    });
  });
}

// The recorder: a key that only submits refused pulls and pays their gas. Its file is never printed.
if (!existsSync(RECORDER)) await cli(["key", "create", "--out", RECORDER], false);
const recorder = JSON.parse(readFileSync(RECORDER, "utf8")).address as string;
console.log(`Recorder (pays gas only): ${recorder}`);
try {
  await cli(["fund", recorder, "--network", "testnet"]);
} catch (error) {
  console.warn(`Faucet: ${(error as Error).message}. Carrying on if the recorder already holds USDZ for gas.`);
}

const amount = toMinor(committed.amount, "USD");
const usdz = (minor: bigint) => `${toMajor(minor, "USD")} USDZ`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const probes = [
  { probe: `${usdz(amount)} to ${short(PROBE_ADDRESS)}, an address not on the mandate`, to: PROBE_ADDRESS, amountMinor: amount, id: "payee" },
  { probe: `${usdz(amount + 1n)} to Andrea Cruz, one cent over the cap`, to: committed.payee, amountMinor: amount + 1n, id: "cap" },
  { probe: `another ${usdz(amount)} to Andrea Cruz under a new payment id`, to: committed.payee, amountMinor: amount, id: "budget" },
];

const results: { probe: string; result: PullResult }[] = [];
for (const p of probes) {
  console.log(`\nProbe: ${p.probe}`);
  const result = await rail.pull(p.to, p.amountMinor, `${committed.paymentId}:onchain-${p.id}`, RECORDER);
  console.log(`  -> ${JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  results.push({ probe: p.probe, result });
}
const after = await rail.status();
const verification = await rail.verify();

const recorded = results.filter((r) => r.result.outcome === "refused" && r.result.sent && r.result.transaction);
const ok = recorded.length === probes.length && after.spentMinor === before.spentMinor && after.payments === before.payments && verification.verified;
const report = {
  ranAt: new Date().toISOString(),
  network: "testnet",
  mandate: committed.mandate,
  account: committed.account,
  recorder,
  spentBefore: usdz(before.spentMinor),
  spentAfter: usdz(after.spentMinor),
  paymentsBefore: before.payments,
  paymentsAfter: after.payments,
  probes: results,
  verification,
  allRecordedAndNothingMoved: ok,
};
writeFileSync("docs/evidence/metal-refusals.json", JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");

const row = (r: (typeof results)[number]) =>
  r.result.outcome === "refused"
    ? `| ${r.probe} | ${r.result.reason} | ${r.result.sent && r.result.explorer ? `[${short(r.result.transaction ?? "")}](${r.result.explorer})` : "not recorded"} |`
    : `| ${r.probe} | **${r.result.outcome}** | ${"transaction" in r.result ? r.result.transaction ?? "" : ""} |`;
writeFileSync(
  "docs/evidence/metal-refusals.md",
  `# Metal refusals recorded on chain

The committed live run paid Andrea Cruz's USD 50 advance under mandate \`${committed.mandate}\` (Contoso Health's Metal account \`${committed.account}\`, signed by its owner). In that run, the three pulls outside the mandate were refused by \`metal-agent\` before sending, so they were not on chain.

On ${report.ranAt.slice(0, 10)} we sent the same three pulls under the same mandate with \`metal-agent mandate pull --record-refusal\` (\`npm run metal:refusals\`). The mandate refused each one on chain, in a transaction that moves nothing. The gas came from a separate key (\`${recorder}\`, faucet USDZ) with no authority over the account; the agent's mandate key signed, and the owner's key was not used.

| Pull | Refused by the mandate on chain | Transaction |
|---|---|---|
${results.map(row).join("\n")}

Spent under the mandate: ${report.spentBefore} before, ${report.spentAfter} after; payments ${report.paymentsBefore} before, ${report.paymentsAfter} after.

\`metal-agent mandate verify\` (checks the chain against the owner's signed mandate): verified ${verification.verified ? "yes" : "no"}.

\`\`\`
${verification.payments.join("\n")}
\`\`\`
`,
);
console.log(`\n${ok ? "OK" : "CHECK"}: ${recorded.length}/${probes.length} refusals recorded on chain; spent ${report.spentBefore} -> ${report.spentAfter}; verified ${verification.verified}`);
if (!ok) process.exit(1);
