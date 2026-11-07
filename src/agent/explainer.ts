import Anthropic from "@anthropic-ai/sdk";

// Claude explains an exception to the person who has to act on it. Code has already decided: the
// facts, reasons and options below come from policy. The model only turns them into a short note,
// and a note that states a number the facts do not contain is discarded for the template.

export interface ExceptionFacts {
  kind: "fraud_hold" | "cutoff_escalation";
  person: string;
  employer: string;
  amount: string; // e.g. "MXN 45,000.00"
  reasons: string[];
  evidence: string[];
  options: string[]; // what a person may do, decided by policy
}

export interface Explainer {
  name: string;
  explain(facts: ExceptionFacts): Promise<string>;
}

export const templateExplainer: Explainer = {
  name: "template",
  async explain(f) {
    const why = f.reasons.join("; ");
    return f.kind === "fraud_hold"
      ? `${f.person}'s ${f.amount} payout from ${f.employer} is on hold: ${why}. The rest of payroll is going out. Next steps: ${f.options.join("; ")}.`
      : `${f.person}'s ${f.amount} payout from ${f.employer} cannot land today: ${why}. A person decides: ${f.options.join(", or ")}.`;
  },
};

const SYSTEM = `You write short notes for the payroll operations lead at a contractor platform.
An automated payroll agent has stopped one payout. Its policy code already decided what happens; you explain it.

Write two or three plain sentences: what happened, why the agent stopped, and what the person can do.
Use only the facts given. Do not add amounts, dates, account numbers or options that are not in the facts.
Do not change or second-guess the decision. Refer to people by name, never by gendered pronouns. No greeting, no sign-off, no markdown.`;

const numbers = (text: string) => (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
const currencies = (text: string) => text.match(/\b(?:USDZ|USD|EUR|GBP|MXN|PHP|INR|CAD|AUD|NZD|JPY|CNY|HKD|SGD|CHF|SEK|NOK|DKK|BRL|COP|ARS|CLP|PEN|ZAR|AED)\b/g) ?? [];
// Words and symbols that carry an amount or a currency without a digit or an ISO code.
const SPELLED = /\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|lakh|crore|dollar|euro|peso|pound|rupee)s?\b|[$€£₱₹¥]/gi;

// Every number and currency code in the note must appear in the facts, so the model cannot
// introduce a figure or move an amount to another currency. Look-alike digits (full-width, other
// scripts) are normalised or refused, and amounts spelled out in words are refused.
export function noteIsGrounded(note: string, facts: ExceptionFacts): boolean {
  const text = note.normalize("NFKC");
  if (/[^\P{Nd}0-9]/u.test(text)) return false;
  const factsText = JSON.stringify(facts);
  const known = new Set(numbers(factsText));
  const knownCurrencies = new Set(currencies(factsText));
  const spelled = new Set((factsText.match(SPELLED) ?? []).map((w) => w.toLowerCase()));
  return (
    numbers(text).every((n) => known.has(n)) &&
    currencies(text).every((c) => knownCurrencies.has(c)) &&
    (text.match(SPELLED) ?? []).every((w) => spelled.has(w.toLowerCase()))
  );
}

export function claudeExplainer(options: { client?: Pick<Anthropic, "messages">; model?: string } = {}): Explainer {
  const client = options.client ?? new Anthropic();
  const model = options.model ?? "claude-opus-5-5";
  return {
    name: `claude (${model})`,
    async explain(facts) {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: 1000,
          system: SYSTEM,
          output_config: { effort: "low" },
          messages: [{ role: "user", content: `<facts>\n${JSON.stringify(facts, null, 2)}\n</facts>` }],
        });
        const note = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
        if (response.stop_reason === "refusal" || !note || !noteIsGrounded(note, facts)) return templateExplainer.explain(facts);
        return note;
      } catch {
        return templateExplainer.explain(facts);
      }
    },
  };
}
