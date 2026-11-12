import { describe, expect, it } from "vitest";
import { runBenchmark } from "../src/eval/benchmark.ts";

describe("benchmark", () => {
  it("comes out as documented: only the two rule-reader misses, and the naive agent harmed in every baseline case", async () => {
    const results = await runBenchmark();
    // A03 and L02 are the rule-based fallback reader's documented misses (docs/BENCHMARK-RESULTS.md).
    expect(results.filter((r) => !r.pass).map((r) => r.id)).toEqual(["A03", "L02"]);
    const baselines = results.filter((r) => r.baseline);
    expect(baselines.length).toBeGreaterThan(0);
    expect(baselines.filter((r) => r.baseline!.harm === "none").map((r) => r.id)).toEqual([]);
    expect(baselines.filter((r) => !r.pass).map((r) => r.id)).toEqual([]);
  });
});
