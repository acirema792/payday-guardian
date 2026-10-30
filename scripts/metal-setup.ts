// The owner's step for the optional instant rail on Metal testnet, run before a live demo:
//   1. Contoso Health's Metal account (a smart account its owner key controls), created once
//   2. faucet funding for that account (free testnet USDZ)
//   3. Andrea Cruz's opted-in payout address (a synthetic wallet), created once
//   4. a fresh mandate for this payday: pays only Andrea, at most the advance per payment and in
//      total, bound on chain (renewing the previous one, so each run starts with nothing spent)
// The runner gets the mandate credential and its key, never the owner key.
// Needs METAL_RPC_URL (an endpoint you create in the Metal console). Writes data/metal/metal.json.
// Usage: npm run metal:setup
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadMetalSetup, METAL_FILE, type MetalSetup, parseLines } from "../src/metal/cli.ts";
import { toMajor } from "../src/policy/money.ts";
import { instantAdvanceConfig, instantRailOptIns } from "../src/scenario/seed.ts";

const DIR = "data/metal";
const OWNER = `${DIR}/owner-key.json`;
const ANDREA = `${DIR}/contractor-andrea-cruz.json`;
const rpc = process.env.METAL_RPC_URL;
if (!rpc) {
  console.error("METAL_RPC_URL is not set. Sign in at https://console-testnet.metalntwx.com, create an endpoint, and add METAL_RPC_URL=<endpoint> to .env.");
  process.exit(1);
}
const redact = (text: string) => text.split(rpc).join("<METAL_RPC_URL>");

function cli(args: string[], chain = true): Promise<ReturnType<typeof parseLines>> {
  const full = chain ? [...args, "--network", "testnet"] : args;
  console.log(`$ metal-agent ${full.join(" ")}`);
  return new Promise((resolve, reject) => {
    execFile("node_modules/.bin/metal-agent", full, { env: { ...process.env, METAL_RPC_URL: rpc }, timeout: 300_000 }, (error, stdout, stderr) => {
      const text = redact(`${stdout}${stderr ? `\n${stderr}` : ""}`).trim();
      if (text) console.log(text.replace(/^/gm, "  "));
      if (error) reject(new Error(redact(`metal-agent ${args.slice(0, 2).join(" ")} failed: ${stderr || error.message}`)));
      else resolve(parseLines(stdout));
    });
  });
}

mkdirSync(DIR, { recursive: true });
const previous = loadMetalSetup();

// 1. The employer's Metal account (continues where an earlier attempt stopped).
const account = await cli(["account", "create", ...(existsSync(OWNER) ? ["--key", OWNER] : ["--out", OWNER])]);
const principal = account.get("account")!;
const owner = account.get("owner")!;

// 2. Free testnet USDZ for the advances. The faucet sets the amount and may ask to wait.
try {
  await cli(["fund", principal]);
} catch (error) {
  console.warn(`Faucet: ${(error as Error).message}. If the account already holds enough USDZ, carry on; otherwise use the console's Faucet page.`);
}

// 3. Andrea Cruz's payout address: a synthetic contractor wallet, created once.
if (!existsSync(ANDREA)) await cli(["key", "create", "--out", ANDREA], false);
const andrea = JSON.parse(readFileSync(ANDREA, "utf8")).address as string;

// 4. A fresh mandate for this payday, bound on chain.
const cap = toMajor(instantAdvanceConfig.maxAdvanceMinor, "USD");
const credential = `${DIR}/mandate-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}.json`;
const created = await cli([
  "mandate", "credential", "create",
  "--principal", principal,
  "--payee", `${andrea},Andrea Cruz`,
  "--cap", cap,
  "--budget", cap,
  "--description", "Contoso Health: instant payday advances for opted-in contractors",
  "--key", OWNER,
  "--out", credential,
]);
if (previous?.credential && existsSync(previous.credential) && previous.account === principal) {
  await cli(["mandate", "renew", "--credential", credential, "--replaces", previous.credential, "--key", OWNER]);
} else {
  await cli(["mandate", "bind", "--credential", credential, "--key", OWNER]);
}
await cli(["mandate", "status", "--credential", credential]);

const setup: MetalSetup = {
  network: "testnet",
  employerId: "emp_b",
  account: principal,
  owner,
  credential,
  issuerPublic: created.get("issuer-public-file")!,
  explorerUrl: "https://testnet.metalntwx.com",
  optIns: {
    emp_b_andrea_cruz: { address: andrea, optedInAt: instantRailOptIns.emp_b_andrea_cruz.optedInAt.toISOString(), channel: instantRailOptIns.emp_b_andrea_cruz.channel },
  },
};
writeFileSync(METAL_FILE, JSON.stringify(setup, null, 2) + "\n");
console.log(`\nWrote ${METAL_FILE}: Contoso Health's Metal account ${principal}, mandate ${credential} (cap and budget ${cap} USDZ, payee Andrea Cruz ${andrea}).`);
console.log(`Account on the explorer: https://testnet.metalntwx.com/address/${principal}`);
