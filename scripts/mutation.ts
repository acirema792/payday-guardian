// Breaks each protection in turn, in a scratch copy of the repo, and records whether the benchmark
// and the unit tests catch it. A protection nothing catches is a claim we cannot back. Writes
// docs/evidence/mutation.json. Run: npm run mutation (a few minutes; no credentials)
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
// One protection each: the file, the line as it is, and the line with the protection removed.
const mutations: { id: string; protection: string; file: string; from: string; to: string }[] = [
  { id: "M01", protection: "Approval bound to a hash of what executes", file: "src/policy/approval.ts", from: "if (approval === undefined || approval.subjectHash !== subjectHash(executing)) return false;", to: "if (approval === undefined) return false;" },
  { id: "M02", protection: "The agent cannot approve its own actions", file: "src/policy/approval.ts", from: "if (!approval.approvedBy.trim() || approval.approvedBy === AGENT_ID) return false;", to: "if (!approval.approvedBy.trim()) return false;" },
  { id: "M03", protection: "Approvals expire after 12 hours", file: "src/policy/approval.ts", from: "if (age < 0 || age > (checks.maxAgeMs ?? APPROVAL_TTL_MS)) return false;", to: "if (age < 0) return false;" },
  { id: "M04", protection: "A release approval names the payee's full bank details", file: "src/executor/execute.ts", from: "counterparty: `${profile.id}:${payeeFingerprint(profile.corridor.bankDetails as Record<string, unknown>)}`,", to: "counterparty: profile.id,", },
  { id: "M05", protection: "Payouts and the fee are once per pay period, across batches", file: "src/executor/execute.ts", from: 'return runId.split(":")[0];', to: "return runId;" },
  { id: "M06", protection: "The planner refuses another account's balance", file: "src/policy/planner.ts", from: "if (balances.accountId !== employer.accountId) {", to: "if (false) {" },
  { id: "M07", protection: "The executor refuses a plan on another employer's account", file: "src/executor/execute.ts", from: "if (input.api.accountId !== plan.accountId) {", to: "if (false) {" },
  { id: "M08", protection: "The platform fee reserves fraud- and cut-off-held wages", file: "src/policy/planner.ts", from: "const reserved: Candidate[] = [...decisions.values()]", to: "const reserved: Candidate[] = [...new Map<string, PayoutDecision>().values()]" },
  { id: "M09", protection: "A note with a number not in the facts is discarded", file: "src/agent/explainer.ts", from: "export function noteIsGrounded(note: string, facts: ExceptionFacts): boolean {", to: "export function noteIsGrounded(note: string, facts: ExceptionFacts): boolean {\n  return true;" },
  { id: "M10", protection: "Fraud holds on emailed or recent bank-detail changes", file: "src/policy/planner.ts", from: "if (holds.length > 0 || !routed.ok) {", to: "if (!routed.ok) {" },
  { id: "M11", protection: "A lost response is recovered by request_id, not retried blindly", file: "src/executor/execute.ts", from: "const existing = await findTransferByRequestId(api, requestId).catch(() => undefined);", to: "const existing = undefined as Transfer | undefined;" },
  { id: "M12", protection: "SWIFT fees are priced before converting", file: "src/policy/routing.ts", from: "const fee = config.swiftFeeMinor[contractor.currency];", to: "const fee = 0n;" },
  { id: "M13", protection: "A payout past its cut-off is escalated, not sent late", file: "src/policy/routing.ts", from: "if (beforeCutoff(now, rails.swiftCutoffUtc)) {", to: "if (true) {" },
  { id: "M14", protection: "Advances only to an opt-in through the verified portal", file: "src/policy/advance.ts", from: 'if (optIn.channel !== "verified_portal")', to: "if (false)" },
  { id: "M15", protection: "No advance on a payout the employer has not funded", file: "src/policy/advance.ts", from: "if (input.employerAvailableUsdMinor < payoutUsd)", to: "if (false)" },
  { id: "M16", protection: "Reconciliation counts only PAID as landed", file: "src/policy/reconcile.ts", from: "if (!LANDED.has(t.status)) {", to: "if (false) {" },
];

// The cases that miss without any mutation (the documented rule-reader misses).
const baselineMisses = new Set(["A03", "L02"]);

function scratchCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "pg-mutation-"));
  for (const part of ["src", "test", "scripts", "package.json", "tsconfig.json"]) cpSync(join(repo, part), join(dir, part), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
  return dir;
}

function benchmarkMisses(dir: string): string[] {
  const script = `const { runBenchmark } = await import(${JSON.stringify(join(dir, "src/eval/benchmark.ts"))}); console.log(JSON.stringify((await runBenchmark()).filter((r) => !r.pass).map((r) => r.id)));`;
  const out = execFileSync("node", ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" }).trim().split("\n").pop()!;
  return JSON.parse(out);
}

function failingTests(dir: string): number {
  try {
    execFileSync("npx", ["vitest", "run", "--reporter=json", "--outputFile=vitest.json"], { cwd: dir, stdio: "ignore" });
  } catch {
    // vitest exits non-zero when a test fails; the report says how many
  }
  try {
    return JSON.parse(readFileSync(join(dir, "vitest.json"), "utf8")).numFailedTests as number;
  } catch {
    return -1; // the copy did not even load: counts as caught
  }
}

const results = [];
for (const m of mutations) {
  const dir = scratchCopy();
  try {
    const file = join(dir, m.file);
    const text = readFileSync(file, "utf8");
    const matches = text.split(m.from).length - 1;
    if (matches !== 1) throw new Error(`${m.id}: expected one match in ${m.file}, found ${matches}`);
    writeFileSync(file, text.replace(m.from, m.to));
    const caughtBy = benchmarkMisses(dir).filter((id) => !baselineMisses.has(id));
    const tests = failingTests(dir);
    const result = { id: m.id, protection: m.protection, file: m.file, benchmarkCasesThatCatchIt: caughtBy, failingUnitTests: tests, caught: caughtBy.length > 0 || tests !== 0 };
    results.push(result);
    console.log(`${result.caught ? "caught  " : "SURVIVED"} ${m.id} ${m.protection}: benchmark ${caughtBy.join(", ") || "-"}, unit tests failing ${tests}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const summary = { mutations: results.length, caught: results.filter((r) => r.caught).length, caughtByBenchmark: results.filter((r) => r.benchmarkCasesThatCatchIt.length).length, caughtByUnitTests: results.filter((r) => r.failingUnitTests !== 0).length };
writeFileSync(join(repo, "docs/evidence/mutation.json"), JSON.stringify({ ranAt: new Date().toISOString(), summary, results }, null, 2) + "\n");
console.log(JSON.stringify(summary));
