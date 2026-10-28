import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirwallexClient } from "../src/airwallex/client.ts";

// Scripted responses for non-login calls; login always succeeds.
let script: number[];
let apiCalls: number;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  apiCalls = 0;
  vi.stubGlobal("fetch", async (url: string | URL) => {
    if (String(url).endsWith("/authentication/login")) return new Response(JSON.stringify({ token: "t" }), { status: 201 });
    apiCalls += 1;
    const status = script.shift() ?? 200;
    return new Response(JSON.stringify(status === 200 ? { ok: true } : { code: `e${status}` }), { status });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const client = () => new AirwallexClient("cid", "key", "https://api.example.test");
async function run<T>(p: Promise<T>): Promise<T> {
  const settled = p.then((v) => ({ v }), (e) => ({ e }));
  await vi.runAllTimersAsync();
  const r = (await settled) as { v?: T; e?: unknown };
  if ("e" in r) throw r.e;
  return r.v as T;
}

describe("client retries", () => {
  it("retries a read after a server error", async () => {
    script = [503, 200];
    await expect(run(client().get("/balances/current"))).resolves.toEqual({ ok: true });
    expect(apiCalls).toBe(2);
  });

  it("retries a POST rejected with 429, which was not processed", async () => {
    script = [429, 200];
    await expect(run(client().post("/transfers/create", { request_id: "r" }))).resolves.toEqual({ ok: true });
    expect(apiCalls).toBe(2);
  });

  it("never blindly retries a POST that failed with a server error", async () => {
    script = [502, 200];
    await expect(run(client().post("/transfers/create", { request_id: "r" }))).rejects.toMatchObject({ status: 502 });
    expect(apiCalls).toBe(1);
  });

  it("does not retry client errors", async () => {
    script = [400];
    await expect(run(client().get("/balances/current"))).rejects.toMatchObject({ status: 400 });
    expect(apiCalls).toBe(1);
  });

  it("gives up after four attempts", async () => {
    script = [503, 503, 503, 503, 200];
    await expect(run(client().get("/balances/current"))).rejects.toMatchObject({ status: 503 });
    expect(apiCalls).toBe(4);
  });
});
