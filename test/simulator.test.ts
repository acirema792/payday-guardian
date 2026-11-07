import { describe, expect, it } from "vitest";
import type { Api } from "../src/airwallex/api.ts";
import { confirmedTransition } from "../src/sandbox/simulator.ts";

// A sandbox that acknowledges the first `ignored` transitions without applying them.
function sandbox(ignored: number, failing = 0) {
  let status = "SENT";
  let posts = 0;
  const api: Api = {
    get: async <T>() => ({ status }) as T,
    post: async <T>(_path: string, body: unknown) => {
      posts += 1;
      if (posts <= failing) throw new Error("Airwallex 500 operation_failed");
      if (posts > ignored) status = (body as { next_status: string }).next_status === "FAILED" ? "CANCELLED" : (body as { next_status: string }).next_status;
      return {} as T;
    },
  };
  return { api, posts: () => posts };
}

describe("sandbox transfer transitions", () => {
  it("retries a transition the sandbox acknowledged but did not apply", async () => {
    const s = sandbox(1);
    await confirmedTransition(s.api, "t1", "PAID", undefined, { waitMs: 0 });
    expect(s.posts()).toBe(2);
  });

  it("retries a transition the sandbox answered with a server error", async () => {
    const s = sandbox(0, 1);
    await confirmedTransition(s.api, "t1", "PAID", undefined, { waitMs: 0 });
    expect(s.posts()).toBe(2);
  });

  it("reads a FAILED transition back as CANCELLED", async () => {
    const s = sandbox(0);
    await confirmedTransition(s.api, "t1", "FAILED", "BENEFICIARY_BANK_RETURNED", { waitMs: 0 });
    expect(s.posts()).toBe(1);
  });

  it("gives up loudly rather than reporting a payout as landed", async () => {
    await expect(confirmedTransition(sandbox(99).api, "t1", "PAID", undefined, { attempts: 3, waitMs: 0 })).rejects.toThrow(/did not reach PAID/);
  });
});
