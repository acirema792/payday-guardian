import { describe, expect, it } from "vitest";
import { matchByName, ruleInterpreter } from "../src/agent/messages.ts";
import { offlineEnvironment } from "../src/demo/environment.ts";
import { type DemoEvent, inbox, runDemo } from "../src/demo/runner.ts";

describe("demo runner (offline bank)", () => {
  it("tells the four-moment story with the expected outcomes", async () => {
    const env = await offlineEnvironment();
    const events: DemoEvent[] = [];
    const summary = await runDemo(env, (e) => events.push(e));

    expect(events.map((e) => e.phase)).toEqual([
      "goal", "plan", "new_info", "decision", "new_info", "decision", "action", "new_info", "decision", "new_info", "decision", "result",
    ]);
    expect(summary).toMatchObject({
      contractors: 36,
      paidOnPayday: 33,
      heldForFraud: 1,
      escalatedCutoff: 2,
      returnsRepaid: 1,
      feesCollected: 3, // Northwind, Fabrikam, and Contoso only after its top-up
      feesDeferred: 1,
    });
    // Every employer ends non-negative in every currency: nobody was paid with someone else's money.
    for (const balances of Object.values(summary.finalBalances)) {
      for (const amount of Object.values(balances)) expect(Number(amount)).toBeGreaterThanOrEqual(0);
    }
    expect(summary.apiCalls).toBeGreaterThan(100);
    env.store.close();
  });

  it("is deterministic", async () => {
    const run = async () => {
      const env = await offlineEnvironment();
      const s = await runDemo(env, () => {});
      env.store.close();
      return { ...s, apiCalls: 0 };
    };
    expect(await run()).toEqual(await run());
  });
});

describe("rule interpreter", () => {
  it("reads the diversion email as a bank-detail change request, with urgency and new details", async () => {
    expect(await ruleInterpreter.interpret(inbox.diversion)).toEqual({
      kind: "bank_detail_change_request",
      personName: "Maria",
      urgent: true,
      includesNewAccountDetails: true,
    });
  });

  it("reads a bank return notice", async () => {
    expect(await ruleInterpreter.interpret(inbox.bankReturn)).toEqual({
      kind: "transfer_returned",
      personName: "Valeria Flores",
      failureType: "BENEFICIARY_BANK_RETURNED",
    });
  });

  it("reads a funding notice", async () => {
    expect(await ruleInterpreter.interpret(inbox.topUp)).toMatchObject({ kind: "funding_notice", employerName: "Contoso Health", amountMajor: "21000" });
  });
});

describe("name matching", () => {
  const people = [
    { id: "1", name: "Maria Garcia" },
    { id: "2", name: "Liza Garcia" },
    { id: "3", name: "Ana Lopez" },
    { id: "4", name: "Ana Torres" },
  ];

  it("matches a full name or a unique first name", () => {
    expect(matchByName("maria garcia", people)).toEqual(people[0]);
    expect(matchByName("Maria", people)).toEqual(people[0]);
  });

  it("refuses to guess between two people", () => {
    expect(matchByName("Ana", people)).toBe("ambiguous");
    expect(matchByName("Garcia", people)).toBeUndefined();
  });
});
