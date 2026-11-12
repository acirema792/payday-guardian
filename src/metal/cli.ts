import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { InstantRailOptIn } from "../policy/advance.ts";
import { toMajor, toMinor } from "../policy/money.ts";
import type { InstantRail, MandateState, MandateVerification, PullResult } from "./rail.ts";

// The live instant rail: Metal testnet through Metal's own metal-agent CLI (pinned in package.json).
// It runs with the mandate credential and its key only; the owner's key is used by npm run
// metal:setup and never here. Every command and its parsed outcome is kept in `log` for evidence.

export const METAL_FILE = "data/metal/metal.json";
const CLI = "node_modules/.bin/metal-agent";

export interface MetalSetup {
  network: "testnet";
  employerId: string;
  account: string;
  owner: string;
  credential: string;
  issuerPublic: string;
  explorerUrl: string;
  optIns: Record<string, { address: string; optedInAt: string; channel: InstantRailOptIn["channel"] }>;
}

export function loadMetalSetup(path = METAL_FILE): MetalSetup | undefined {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

// "key value" lines, as metal-agent prints them. Repeated keys (payee, payment) collect in order.
export function parseLines(stdout: string): { get(key: string): string | undefined; all(key: string): string[]; lines: string[] } {
  const lines = stdout.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  const pairs = lines.map((l) => {
    const space = l.indexOf(" ");
    return space < 0 ? [l, ""] : [l.slice(0, space), l.slice(space + 1)];
  });
  return {
    get: (key) => pairs.find(([k]) => k === key)?.[1],
    all: (key) => pairs.filter(([k]) => k === key).map(([, v]) => v),
    lines,
  };
}

const usdzMinor = (text: string | undefined) => {
  const match = text ? /(\d+(?:\.\d+)?)/.exec(text) : null;
  return match ? toMinor(match[1], "USD") : 0n;
};

// Reads a pull's outcome from what metal-agent printed (exit codes: 0 paid, 1 refused, 3 pending, 4 held).
export function parsePull(stdout: string): PullResult {
  const out = parseLines(stdout);
  const again = out.lines.some((l) => l === "already paid, nothing sent");
  const outcome = again ? "paid" : out.get("outcome");
  const spent = out.get("spent");
  if (outcome === "paid") {
    return { outcome: "paid", transaction: out.get("transaction") ?? "", explorer: out.get("explorer"), spentMinor: spent ? usdzMinor(spent) : undefined, again };
  }
  if (outcome === "refused, not sent") return { outcome: "refused", reason: out.get("reason") ?? "refused", sent: false };
  if (outcome === "refused") return { outcome: "refused", reason: out.get("reason") ?? "refused", sent: true, transaction: out.get("transaction"), explorer: out.get("explorer") };
  if (outcome === "held" || outcome === "pending") return { outcome, transaction: out.get("transaction"), reason: out.get("reason") };
  const error = out.lines.find((l) => l.startsWith("error"));
  throw new Error(`metal-agent pull: ${error ?? "no outcome printed"}`);
}

export class MetalCliRail implements InstantRail {
  readonly label = "Metal testnet";
  readonly employerId: string;
  readonly account: string;
  readonly optIns: Record<string, InstantRailOptIn>;
  readonly log: { command: string; outcome: string; transaction?: string; explorer?: string }[] = [];

  private readonly setup: MetalSetup;
  private readonly rpcUrl: string;

  constructor(setup: MetalSetup, rpcUrl: string) {
    this.setup = setup;
    this.rpcUrl = rpcUrl;
    this.employerId = setup.employerId;
    this.account = setup.account;
    this.optIns = Object.fromEntries(
      Object.entries(setup.optIns).map(([id, o]) => [id, { address: o.address, optedInAt: new Date(o.optedInAt), channel: o.channel }]),
    );
  }

  static fromEnv(): MetalCliRail | undefined {
    const setup = loadMetalSetup();
    const rpc = process.env.METAL_RPC_URL;
    return setup && rpc ? new MetalCliRail(setup, rpc) : undefined;
  }

  // The RPC endpoint is the user's own and may carry a key: it never reaches output or logs.
  private redact(text: string): string {
    return text.split(this.rpcUrl).join("<METAL_RPC_URL>");
  }

  private run(args: string[]): Promise<{ stdout: string; code: number }> {
    return new Promise((resolve, reject) => {
      execFile(CLI, [...args, "--network", this.setup.network], { env: { ...process.env, METAL_RPC_URL: this.rpcUrl }, timeout: 180_000 }, (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : error ? -1 : 0;
        if (error && !stdout) reject(new Error(this.redact(`metal-agent ${args[0]} ${args[1] ?? ""}: ${stderr || error.message}`.trim())));
        else resolve({ stdout: this.redact(stdout + (stderr ? `\n${stderr}` : "")), code });
      });
    });
  }

  async status(): Promise<MandateState> {
    const { stdout } = await this.run(["mandate", "status", "--credential", this.setup.credential]);
    const out = parseLines(stdout);
    const [spent, budget] = (out.get("spent") ?? "").split(" of ");
    this.log.push({ command: "mandate status", outcome: `bound ${out.get("bound")}, spent ${out.get("spent")}` });
    return {
      reference: out.get("mandate") ?? "",
      principal: out.get("principal") ?? this.account,
      payees: out.all("payee").map((p) => p.split(" ")[0]),
      capMinor: usdzMinor(out.get("per-payment-cap")),
      budgetMinor: usdzMinor(budget ?? out.get("budget")),
      spentMinor: usdzMinor(spent),
      payments: Number(out.get("payments") ?? 0),
      bound: out.get("bound") === "yes",
      revoked: out.get("revoked") === "yes",
    };
  }

  // recordRefusalWith: a funded key that only submits the pull and pays its gas, so a refusal is
  // recorded on chain (metal-agent --record-refusal). It holds no authority over the account; the
  // mandate key still signs. Used only for probes the mandate must refuse.
  async pull(to: string, amountMinor: bigint, paymentId: string, recordRefusalWith?: string): Promise<PullResult> {
    const amount = toMajor(amountMinor, "USD");
    const record = recordRefusalWith ? ["--key", recordRefusalWith, "--record-refusal"] : [];
    const { stdout } = await this.run(["mandate", "pull", "--credential", this.setup.credential, "--to", to, "--amount", amount, "--payment-id", paymentId, ...record]);
    const result = parsePull(stdout);
    this.log.push({
      command: `mandate pull --to ${to} --amount ${amount} --payment-id ${paymentId}${recordRefusalWith ? " --record-refusal" : ""}`,
      outcome: result.outcome === "refused" ? `refused${result.sent ? "" : ", not sent"}: ${result.reason}` : result.outcome === "paid" && result.again ? "already paid, nothing sent" : result.outcome,
      transaction: "transaction" in result ? result.transaction : undefined,
      explorer: result.outcome === "paid" || result.outcome === "refused" ? result.explorer : undefined,
    });
    return result;
  }

  async verify(): Promise<MandateVerification> {
    const { stdout } = await this.run(["mandate", "verify", "--credential", this.setup.credential, "--issuer", this.setup.issuerPublic]);
    const out = parseLines(stdout);
    const result = { verified: out.get("verified") === "yes", payments: out.lines.filter((l) => /^(payment 0x|refusal \()/.test(l)) };
    this.log.push({ command: "mandate verify", outcome: `verified ${out.get("verified")}, ${result.payments.length} on chain` });
    return result;
  }
}
