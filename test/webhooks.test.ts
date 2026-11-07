import { describe, expect, it } from "vitest";
import { Store } from "../src/executor/store.ts";
import type { AddressInfo } from "node:net";
import { signWebhook, verifySignature, WebhookReceiver } from "../src/webhooks/airwallex.ts";
import { startWebhookServer, WEBHOOK_PATH } from "../src/webhooks/server.ts";

const SECRET = "whsec_test";
const NOW = 1_793_000_000_000;

function delivery(event: object, opts: { secret?: string; timestamp?: number } = {}) {
  const rawBody = JSON.stringify(event);
  const timestamp = String(opts.timestamp ?? NOW);
  return { headers: { timestamp, signature: signWebhook(opts.secret ?? SECRET, timestamp, rawBody) }, rawBody };
}

const failed = {
  id: "evt_1",
  name: "payout.transfer.failed",
  account_id: "acct_contoso",
  data: { id: "tr_1", request_id: "req_1", status: "CANCELLED", failure_type: "BENEFICIARY_BANK_RETURNED" },
  created_at: "2026-11-06T05:30:00+0000",
};

const receiver = () => new WebhookReceiver({ secret: SECRET, store: new Store(), employerByAccount: new Map([["acct_contoso", "emp_b"]]), now: () => NOW });

describe("webhook signature", () => {
  it("accepts a delivery signed by any of the subscriptions' secrets, and no other", () => {
    const r = new WebhookReceiver({ secret: ["whsec_platform", SECRET], store: new Store(), employerByAccount: new Map([["acct_contoso", "emp_b"]]), now: () => NOW });
    const d = delivery(failed);
    expect(r.receive(d.headers, d.rawBody).outcome).toBe("processed");
    const other = delivery({ ...failed, id: "evt_2" }, { secret: "whsec_other" });
    expect(r.receive(other.headers, other.rawBody).outcome).toBe("bad_signature");
  });

  it("accepts the documented HMAC-SHA256 of x-timestamp + raw body", () => {
    const d = delivery(failed);
    expect(verifySignature(SECRET, d.headers, d.rawBody, NOW)).toBe("ok");
  });

  it("rejects a body changed after signing, even by whitespace", () => {
    const d = delivery(failed);
    expect(verifySignature(SECRET, d.headers, JSON.stringify(failed, null, 1), NOW)).toBe("bad_signature");
  });

  it("rejects the wrong secret, a missing signature and a replay outside five minutes", () => {
    const d = delivery(failed, { secret: "other" });
    expect(verifySignature(SECRET, d.headers, d.rawBody, NOW)).toBe("bad_signature");
    expect(verifySignature(SECRET, { timestamp: String(NOW) }, d.rawBody, NOW)).toBe("bad_signature");
    const old = delivery(failed, { timestamp: NOW - 6 * 60_000 });
    expect(verifySignature(SECRET, old.headers, old.rawBody, NOW)).toBe("stale");
  });

  it("refuses a signed timestamp that is not a number, and reads one in seconds as seconds", () => {
    const body = JSON.stringify(failed);
    expect(verifySignature(SECRET, { timestamp: "soon", signature: signWebhook(SECRET, "soon", body) }, body, NOW)).toBe("stale");
    const seconds = String(Math.floor(NOW / 1000));
    expect(verifySignature(SECRET, { timestamp: seconds, signature: signWebhook(SECRET, seconds, body) }, body, NOW)).toBe("ok");
  });
});

describe("webhook receiver", () => {
  it("turns a verified transfer failure into a typed event for the right employer", () => {
    const d = delivery(failed);
    expect(receiver().receive(d.headers, d.rawBody)).toEqual({
      http: 200,
      outcome: "processed",
      eventId: "evt_1",
      name: "payout.transfer.failed",
      transfer: {
        eventId: "evt_1",
        name: "payout.transfer.failed",
        accountId: "acct_contoso",
        employerId: "emp_b",
        transferId: "tr_1",
        requestId: "req_1",
        status: "CANCELLED",
        failureType: "BENEFICIARY_BANK_RETURNED",
      },
    });
  });

  it("acts on a redelivered event only once", () => {
    const r = receiver();
    const d = delivery(failed);
    expect(r.receive(d.headers, d.rawBody).outcome).toBe("processed");
    const again = r.receive(d.headers, d.rawBody);
    expect(again).toMatchObject({ http: 200, outcome: "duplicate" });
    expect(again.transfer).toBeUndefined();
  });

  it("answers 400 to a forged event and never parses it", () => {
    const d = delivery(failed);
    expect(receiver().receive({ ...d.headers, signature: "00".repeat(32) }, d.rawBody)).toEqual({ http: 400, outcome: "bad_signature" });
    expect(receiver().receive(d.headers, "{not json")).toEqual({ http: 400, outcome: "bad_signature" });
  });

  it("acknowledges but does not act on events for accounts that are not our employers", () => {
    const d = delivery({ ...failed, id: "evt_2", account_id: "acct_someone_else" });
    const res = receiver().receive(d.headers, d.rawBody);
    expect(res).toMatchObject({ http: 200, outcome: "unknown_account" });
    expect(res.transfer).toBeUndefined();
  });

  it("reads transfers wrapped in data.object and ignores other event types", () => {
    const r = receiver();
    const wrapped = delivery({ ...failed, id: "evt_3", data: { object: failed.data } });
    expect(r.receive(wrapped.headers, wrapped.rawBody).transfer?.transferId).toBe("tr_1");
    const other = delivery({ ...failed, id: "evt_4", name: "deposit.settled" });
    expect(r.receive(other.headers, other.rawBody).outcome).toBe("ignored");
  });
});

describe("webhook HTTP endpoint", () => {
  it("verifies the raw body as delivered and answers 200, or 400 for a bad signature", async () => {
    const r = new WebhookReceiver({ secret: SECRET, store: new Store(), employerByAccount: new Map([["acct_contoso", "emp_b"]]), now: Date.now });
    const server = await startWebhookServer(r, 0);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${WEBHOOK_PATH}`;
    const post = (event: object, secret = SECRET) => {
      const body = JSON.stringify(event);
      const timestamp = String(Date.now());
      return fetch(url, { method: "POST", body, headers: { "x-timestamp": timestamp, "x-signature": signWebhook(secret, timestamp, body) } });
    };
    expect((await post(failed)).status).toBe(200);
    expect((await post({ ...failed, id: "evt_9" }, "whsec_wrong")).status).toBe(400);
    expect(r.received.map((x) => x.outcome)).toEqual(["processed", "bad_signature"]);
    server.close();
  });
});
