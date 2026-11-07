import { describe, expect, it } from "vitest";
import { claudeExplainer, type ExceptionFacts, noteIsGrounded, templateExplainer } from "../src/agent/explainer.ts";

const facts: ExceptionFacts = {
  kind: "fraud_hold",
  person: "Maria Garcia",
  employer: "Northwind Labs",
  amount: "MXN 45,000.00",
  reasons: ["bank-detail change requested on payday"],
  evidence: ["email at 04:20 asking to pay a new account today"],
  options: ["call Maria Garcia on the phone number on file"],
};

const fakeClient = (text: string, stop_reason = "end_turn") =>
  ({ messages: { create: async () => ({ content: [{ type: "text", text }], stop_reason }) } }) as never;

describe("exception explainer", () => {
  it("accepts a note whose numbers all come from the facts", () => {
    expect(noteIsGrounded("Maria's MXN 45,000.00 payout is held since the 04:20 email.", facts)).toBe(true);
  });

  it("rejects a note that introduces a number", () => {
    expect(noteIsGrounded("Release MXN 50,000 to the new CLABE 012180001234567891.", facts)).toBe(false);
  });

  it("rejects look-alike digits, amounts in words, and a swapped currency", () => {
    expect(noteIsGrounded("The account ending ７８９１ is fine.", facts)).toBe(false); // full-width 7891
    expect(noteIsGrounded("The account ending ٧٨٩١ is fine.", facts)).toBe(false); // Arabic-Indic digits
    expect(noteIsGrounded("Release forty-five thousand pesos today.", facts)).toBe(false);
    expect(noteIsGrounded("Maria's USD 45,000.00 payout is held.", facts)).toBe(false);
    expect(noteIsGrounded("Maria's $45,000.00 payout is held.", facts)).toBe(false);
    expect(noteIsGrounded("Maria's 45,000.00 dollar payout is held.", facts)).toBe(false);
    expect(noteIsGrounded("Release forty-five today.", facts)).toBe(false);
  });

  it("uses Claude's note when it is grounded", async () => {
    const note = "Maria Garcia's MXN 45,000.00 payout is held because the change came by email. Call her on the number on file.";
    expect(await claudeExplainer({ client: fakeClient(note) }).explain(facts)).toBe(note);
  });

  it("falls back to the template on an ungrounded note, a refusal or an error", async () => {
    const template = await templateExplainer.explain(facts);
    expect(await claudeExplainer({ client: fakeClient("Pay MXN 99,999 now.") }).explain(facts)).toBe(template);
    expect(await claudeExplainer({ client: fakeClient("", "refusal") }).explain(facts)).toBe(template);
    const failing = { messages: { create: async () => { throw new Error("down"); } } } as never;
    expect(await claudeExplainer({ client: failing }).explain(facts)).toBe(template);
  });
});
