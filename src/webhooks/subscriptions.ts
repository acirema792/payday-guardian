import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AirwallexClient } from "../airwallex/client.ts";
import { WEBHOOK_PATH } from "./server.ts";

// Webhook subscriptions created by API: one on the platform and one on each employer's connected
// account (x-on-behalf-of), each with its own secret. Kept in data/ (not committed), never printed.
// A new public URL (a tunnel to this machine) re-points them: Airwallex allows updating only the URL.

export const SUBSCRIPTIONS_FILE = "data/webhook-subscriptions.json";
export const TRANSFER_EVENTS = ["payout.transfer.processing", "payout.transfer.sent", "payout.transfer.paid", "payout.transfer.failed", "payout.transfer.cancelled"];
const VERSION = "2025-04-25";

export interface Subscription {
  scope: string; // "platform" or the employer's connected account id
  id: string;
  secret: string;
  url: string;
}

export function loadSubscriptions(path = SUBSCRIPTIONS_FILE): Subscription[] {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

export async function pointSubscriptions(
  client: AirwallexClient,
  scopes: string[],
  baseUrl: string,
  log: (line: string) => void = () => {},
  path = SUBSCRIPTIONS_FILE,
): Promise<Subscription[]> {
  const url = `${baseUrl.replace(/\/$/, "")}${WEBHOOK_PATH}`;
  const known = new Map(loadSubscriptions(path).map((s) => [s.scope, s]));
  const result: Subscription[] = [];
  for (const scope of scopes) {
    const onBehalfOf = scope === "platform" ? undefined : scope;
    const existing = known.get(scope);
    try {
      if (existing) {
        if (existing.url !== url) await client.post(`/webhooks/${existing.id}/update`, { url }, { onBehalfOf });
        result.push({ ...existing, url });
        log(`${scope}: webhook ${existing.id} -> ${url}`);
      } else {
        const created = await client.post<{ id: string; secret: string }>(
          "/webhooks/create",
          { url, version: VERSION, events: TRANSFER_EVENTS, request_id: randomUUID() },
          { onBehalfOf },
        );
        result.push({ scope, id: created.id, secret: created.secret, url });
        log(`${scope}: webhook ${created.id} created -> ${url}`);
      }
    } catch (error) {
      log(`${scope}: no subscription (${(error as Error).message})`);
      if (existing) result.push(existing);
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
  return result;
}
