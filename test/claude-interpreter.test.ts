import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { claudeInterpreter, type Reading, toInterpretation } from "../src/agent/claude-interpreter.ts";
import { inbox } from "../src/demo/runner.ts";

const reading = (r: Partial<Reading>): Reading => ({
  kind: "other",
  person_name: null,
  employer_name: null,
  urgent: false,
  includes_new_account_details: false,
  amount: null,
  currency: null,
  failure_type: null,
  red_flags: [],
  summary: "s",
  ...r,
});

function fakeClient(respond: (params: any) => unknown) {
  const calls: any[] = [];
  const client = {
    messages: {
      parse: async (params: any) => {
        calls.push(params);
        return respond(params);
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  return { client, calls };
}

describe("claude interpreter", () => {
  it("maps Claude's reading onto the typed interpretation", async () => {
    const { client, calls } = fakeClient(() => ({
      stop_reason: "end_turn",
      parsed_output: reading({ kind: "bank_detail_change_request", person_name: "Maria", urgent: true, includes_new_account_details: true, red_flags: ["urgency"] }),
    }));
    const notes: string[] = [];
    const interpreter = claudeInterpreter({ client, onReading: (_, __, note) => notes.push(note) });
    expect(await interpreter.interpret(inbox.diversion)).toEqual({
      kind: "bank_detail_change_request",
      personName: "Maria",
      urgent: true,
      includesNewAccountDetails: true,
    });
    expect(notes).toEqual(["ok"]);
    // The message goes in as delimited data, with the schema-constrained output format.
    expect(calls[0].messages[0].content).toContain("<body>");
    expect(calls[0].output_config.effort).toBe("low");
    expect(calls[0].output_config.format).toBeDefined();
    expect(calls[0].tools).toBeUndefined(); // the reader has no tools at all
  });

  it("falls back to the rule reader on a refusal", async () => {
    const { client } = fakeClient(() => ({ stop_reason: "refusal", parsed_output: null }));
    expect((await claudeInterpreter({ client }).interpret(inbox.bankReturn)).kind).toBe("transfer_returned");
  });

  it("falls back to the rule reader when the API fails", async () => {
    const { client } = fakeClient(() => {
      throw new Error("network down");
    });
    const result = await claudeInterpreter({ client }).interpret(inbox.topUp);
    expect(result).toMatchObject({ kind: "funding_notice", employerName: "Contoso Health" });
  });

  it("normalises amounts and currencies", () => {
    expect(toInterpretation(reading({ kind: "funding_notice", employer_name: "Contoso Health", amount: "21,000", currency: "usd" }))).toEqual({
      kind: "funding_notice",
      employerName: "Contoso Health",
      amountMajor: "21000",
      currency: "USD",
    });
  });
});
