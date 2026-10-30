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
      "goal", "plan", "new_info", "decision", "new_info", "decision", "action", "approval", "new_info", "decision", "new_info", "decision", "approval", "result",
    ]);
    expect(summary).toMatchObject({
      contractors: 36,
      paidOnPayday: 34,
      heldForFraud: 1,
      releasedAfterApproval: 1, // Maria, to her account on file, after a person approved
      escalatedCutoff: 2,
      instantAdvances: 1, // Andrea Cruz opted in; Paolo Mendoza did not
      returnsRepaid: 1,
      feesCollected: 3, // Northwind, Fabrikam, and Contoso only after its top-up
      feesDeferred: 1,
    });
    // Every employer ends non-negative in every currency: nobody was paid with someone else's money.
    for (const balances of Object.values(summary.finalBalances)) {
      for (const amount of Object.values(balances)) expect(Number(amount)).toBeGreaterThanOrEqual(0);
    }
    expect(summary.apiCalls).toBeGreaterThan(100);
    // No payout is left in flight: each one landed, was held, or was escalated to a person.
    const finalStatuses = events.at(-1)!.snapshot!.employers.flatMap((e) => e.contractors.map((c) => c.status));
    expect(new Set(finalStatuses)).toEqual(new Set(["paid", "repaid", "escalated", "advanced"]));
    expect(finalStatuses.filter((s) => s === "paid" || s === "repaid")).toHaveLength(summary.paidOnPayday);
    // Every transfer the bank received reached a terminal status.
    expect(env.webhooks!.received.filter((r) => r.transfer?.status === "PROCESSING")).toHaveLength(0);
    env.store.close();
  });

  it("confirms the bank return from a verified webhook and ignores its redelivery", async () => {
    const env = await offlineEnvironment();
    const events: DemoEvent[] = [];
    await runDemo(env, (e) => events.push(e));
    const bankReturn = events.find((e) => e.title.startsWith("#3"))!;
    expect(bankReturn.lines.join("\n")).toMatch(/payout\.transfer\.failed for Valeria Flores: CANCELLED, BENEFICIARY_BANK_RETURNED, on \w+ \w+'s account/);
    const processed = env.webhooks!.received.filter((r) => r.outcome === "processed").length;
    expect(env.webhooks!.received.filter((r) => r.outcome === "duplicate")).toHaveLength(processed);
    env.store.close();
  });

  it("releases the held payout only to the account on file, under an approval bound to it", async () => {
    const env = await offlineEnvironment();
    const events: DemoEvent[] = [];
    await runDemo(env, (e) => events.push(e));
    const approval = events.find((e) => e.phase === "approval" && e.title.includes("release"))!.lines.join("\n");
    expect(approval).toMatch(/account in the email \(ending 7891\): rejected/);
    expect(approval).toMatch(/larger amount: rejected/);
    expect(approval).toMatch(/Maria Garcia paid to the account ending 7771 on file/);
    // The release batch charged no second platform fee.
    expect(env.store.auditLog().filter((c) => c.path === "/charges/create")).toHaveLength(3);
    env.store.close();
  });

  it("pays an instant advance on Metal only to the opted-in contractor, within the mandate, once", async () => {
    const env = await offlineEnvironment();
    const events: DemoEvent[] = [];
    await runDemo(env, (e) => events.push(e));
    const step = events.find((e) => e.title.startsWith("Approval: instant advance"))!;
    const text = step.lines.join("\n");
    expect(step.title).toContain("Andrea Cruz");
    expect(text).toMatch(/not on the mandate\. Metal refused, nothing sent: mandate_payee_not_listed/);
    expect(text).toMatch(/over the cap\. Metal refused, nothing sent: mandate_cap_exceeded/);
    expect(text).toMatch(/Paid 50\.00 USDZ to Andrea Cruz/);
    expect(text).toMatch(/same payment id: already paid, nothing sent/);
    expect(text).toMatch(/new payment id\. Metal refused, nothing sent: mandate_budget_spent/);
    expect(text).toMatch(/remaining PHP 257,142\.86 goes in the next Philippine LOCAL window/);
    const andrea = step.snapshot!.employers.flatMap((e) => e.contractors).find((c) => c.name === "Andrea Cruz")!;
    expect(andrea.status).toBe("advanced");
    expect((await env.instantRails!.emp_b.status()).spentMinor).toBe(5000n);
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
