// Unstructured input the agent reads. The model (or the rule-based fallback) only turns text into a
// typed Interpretation; code decides what, if anything, changes. Instructions inside a message are
// data: a new account number in an email is never used to pay anyone.

export interface InboundMessage {
  id: string;
  channel: "email" | "chat" | "bank_notice";
  from: string;
  subject: string;
  body: string;
  receivedAt: Date;
}

export type Interpretation =
  | { kind: "bank_detail_change_request"; personName: string; urgent: boolean; includesNewAccountDetails: boolean }
  | { kind: "funding_notice"; employerName: string; amountMajor?: string; currency?: string }
  | { kind: "transfer_returned"; personName?: string; failureType?: string }
  | { kind: "other"; summary: string };

export interface Interpreter {
  name: string;
  interpret(message: InboundMessage): Promise<Interpretation>;
}

const URGENCY = /\b(urgent|asap|today|immediately|right away)\b/i;
const ACCOUNT_CHANGE = /\b(new|change|update|different)\b.{0,40}\b(account|bank|iban|clabe|routing)\b|\b(account|bank)\b.{0,40}\b(changed|closed|new)\b/i;
const ACCOUNT_NUMBER = /\b\d{8,}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{10,}\b/;

// Deterministic fallback used when no model is configured, and as the baseline in tests.
export const ruleInterpreter: Interpreter = {
  name: "rules",
  async interpret(message) {
    const text = `${message.subject}\n${message.body}`;

    if (message.channel === "bank_notice" && /\breturn(ed)?\b/i.test(text)) {
      const failureType = /\b([A-Z]+(?:_[A-Z]+)+)\b/.exec(text)?.[1];
      const personName = /\bto ([A-Z][a-z]+ [A-Z][a-z]+)/.exec(text)?.[1];
      return { kind: "transfer_returned", personName, failureType };
    }

    if (ACCOUNT_CHANGE.test(text)) {
      const signed = /(?:^|\n)\s*(?:thanks|thank you|regards|best)?[,!.\s]*\n?\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s*$/i.exec(message.body.trim());
      const intro = /\b(?:it's|this is|i am|i'm)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)/.exec(text);
      return {
        kind: "bank_detail_change_request",
        personName: (intro?.[1] ?? signed?.[1] ?? message.from).trim(),
        urgent: URGENCY.test(text),
        includesNewAccountDetails: ACCOUNT_NUMBER.test(message.body),
      };
    }

    const funding = /\b(sent|wired|transferred|deposited|funded)\b.{0,60}?\b(USD|EUR|GBP)?\s?([\d,]+(?:\.\d+)?)/i.exec(text);
    if (funding) {
      const employerName = /\b([A-Z][a-z]+ (?:Health|Labs|Studio|Inc|Ltd|LLC))\b/.exec(text)?.[1] ?? message.from;
      return { kind: "funding_notice", employerName, amountMajor: funding[3]?.replace(/,/g, ""), currency: funding[2]?.toUpperCase() };
    }

    return { kind: "other", summary: message.subject };
  },
};

// Names from messages are matched by code against the contractor list; ambiguity escalates.
export function matchByName<T extends { id: string; name: string }>(name: string, people: T[]): T | "ambiguous" | undefined {
  const wanted = name.trim().toLowerCase();
  const exact = people.filter((p) => p.name.toLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return "ambiguous";
  const first = people.filter((p) => p.name.toLowerCase().split(" ")[0] === wanted.split(" ")[0]);
  if (first.length === 1) return first[0];
  return first.length > 1 ? "ambiguous" : undefined;
}
