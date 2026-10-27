import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirwallexClient } from "../src/airwallex/client.ts";
import { TenantClient, TenantRegistry, type Tenant } from "../src/tenant/adapter.ts";

type Call = { url: string; headers: Record<string, string> };
let calls: Call[];

beforeEach(() => {
  calls = [];
  let tokenCount = 0;
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), headers });
    if (String(url).endsWith("/authentication/login")) {
      tokenCount += 1;
      return new Response(JSON.stringify({ token: `tok_${headers["x-login-as"] ?? "platform"}_${tokenCount}` }), { status: 201 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

const platform = () => new AirwallexClient("cid", "key", "https://api.example.test");
const tenant = (employerId: string, accountId: string, mode: Tenant["mode"]): Tenant => ({ employerId, name: employerId, accountId, mode });
const apiCalls = () => calls.filter((c) => !c.url.endsWith("/authentication/login"));
const logins = () => calls.filter((c) => c.url.endsWith("/authentication/login"));

describe("tenant adapter", () => {
  it("connected mode sends x-on-behalf-of with the platform token", async () => {
    await new TenantClient(platform(), tenant("emp_b", "acct_B", "connected")).get("/balances/current");
    expect(apiCalls()[0].headers["x-on-behalf-of"]).toBe("acct_B");
    expect(logins()[0].headers["x-login-as"]).toBeUndefined();
  });

  it("org-entity mode logs in as the employer's own account and sends no x-on-behalf-of", async () => {
    await new TenantClient(platform(), tenant("emp_b", "acct_B", "org-entity")).get("/balances/current");
    expect(logins()[0].headers["x-login-as"]).toBe("acct_B");
    expect(apiCalls()[0].headers["x-on-behalf-of"]).toBeUndefined();
    expect(apiCalls()[0].headers.Authorization).toBe("Bearer tok_acct_B_1");
  });

  it("org-entity employers get separate tokens, each reused for that employer", async () => {
    const registry = new TenantRegistry(platform(), [
      tenant("emp_a", "acct_A", "org-entity"),
      tenant("emp_b", "acct_B", "org-entity"),
    ]);
    await registry.for("emp_a").get("/balances/current");
    await registry.for("emp_b").get("/balances/current");
    await registry.for("emp_a").get("/balances/current");
    expect(logins().map((c) => c.headers["x-login-as"])).toEqual(["acct_A", "acct_B"]);
    expect(apiCalls().map((c) => c.headers.Authorization)).toEqual(["Bearer tok_acct_A_1", "Bearer tok_acct_B_2", "Bearer tok_acct_A_1"]);
  });

  it("rejects two employers mapped to the same wallet", () => {
    expect(() => new TenantRegistry(platform(), [tenant("emp_a", "acct_X", "connected"), tenant("emp_b", "acct_X", "connected")])).toThrow(
      /two employers/,
    );
  });

  it("rejects unknown employers", () => {
    expect(() => new TenantRegistry(platform(), []).for("emp_z")).toThrow(/Unknown employer/);
  });
});
