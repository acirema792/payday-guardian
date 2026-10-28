import { createHmac, timingSafeEqual } from "node:crypto";
import type { Store } from "../executor/store.ts";

// Airwallex webhooks: verify the HMAC-SHA256 of x-timestamp + raw body before parsing anything,
// reject stale timestamps, dedupe on event id (delivery is at-least-once), and act only on events
// for an account we know as an employer. Answer fast; the money decisions stay in the executor,
// which re-reads the transfer from the API before it repays.

export interface WebhookEvent {
  id: string;
  name: string;
  account_id?: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface TransferEvent {
  eventId: string;
  name: string;
  accountId: string;
  employerId: string;
  transferId: string;
  requestId?: string;
  status: string;
  failureType?: string;
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "unknown_account" | "bad_signature" | "stale" | "malformed";

export interface WebhookResult {
  http: 200 | 400;
  outcome: WebhookOutcome;
  eventId?: string;
  name?: string;
  transfer?: TransferEvent;
}

export interface WebhookHeaders {
  timestamp?: string;
  signature?: string;
}

const FIVE_MINUTES = 5 * 60_000;

export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}${rawBody}`).digest("hex");
}

export function verifySignature(secret: string, headers: WebhookHeaders, rawBody: string, nowMs: number, toleranceMs = FIVE_MINUTES): "ok" | "bad_signature" | "stale" {
  if (!headers.timestamp || !headers.signature) return "bad_signature";
  const expected = Buffer.from(signWebhook(secret, headers.timestamp, rawBody), "hex");
  const given = Buffer.from(headers.signature, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "bad_signature";
  // x-timestamp is Unix milliseconds.
  if (Math.abs(nowMs - Number(headers.timestamp)) > toleranceMs) return "stale";
  return "ok";
}

export class WebhookReceiver {
  private readonly secret: string;
  private readonly store: Store;
  private readonly employerByAccount: Map<string, string>;
  private readonly now: () => number;
  readonly received: WebhookResult[] = [];

  constructor(options: { secret: string; store: Store; employerByAccount: Map<string, string>; now?: () => number }) {
    if (!options.secret) throw new Error("Webhook secret is required");
    this.secret = options.secret;
    this.store = options.store;
    this.employerByAccount = options.employerByAccount;
    this.now = options.now ?? Date.now;
  }

  receive(headers: WebhookHeaders, rawBody: string): WebhookResult {
    const result = this.handle(headers, rawBody);
    this.received.push(result);
    return result;
  }

  private handle(headers: WebhookHeaders, rawBody: string): WebhookResult {
    const check = verifySignature(this.secret, headers, rawBody, this.now());
    if (check !== "ok") return { http: 400, outcome: check };

    let event: WebhookEvent;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return { http: 400, outcome: "malformed" };
    }
    if (typeof event?.id !== "string" || typeof event.name !== "string") return { http: 400, outcome: "malformed" };

    const base = { http: 200 as const, eventId: event.id, name: event.name };
    const employerId = event.account_id ? this.employerByAccount.get(event.account_id) : undefined;
    // For transfer events, data is the transfer itself (newer API versions) or wraps it in data.object.
    const t = ((event.data?.object as Record<string, unknown> | undefined) ?? event.data ?? {}) as Record<string, unknown>;
    const transfer: TransferEvent | undefined =
      employerId && event.name.startsWith("payout.transfer.") && typeof t.id === "string" && typeof t.status === "string"
        ? {
            eventId: event.id,
            name: event.name,
            accountId: event.account_id!,
            employerId,
            transferId: t.id,
            requestId: typeof t.request_id === "string" ? t.request_id : undefined,
            status: t.status,
            failureType: typeof t.failure_type === "string" ? t.failure_type : undefined,
          }
        : undefined;
    const outcome: WebhookOutcome = !employerId ? "unknown_account" : transfer ? "processed" : "ignored";
    if (!this.store.recordWebhookEvent(event.id, event.name, event.account_id ?? null, outcome)) return { ...base, outcome: "duplicate" };
    return transfer ? { ...base, outcome, transfer } : { ...base, outcome };
  }
}
