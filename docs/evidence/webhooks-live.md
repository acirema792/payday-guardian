# Live Airwallex webhooks

On 2026-11-12 `npm run webhooks:live` subscribed Fabrikam Studio's connected account (`acct_yNJZekd_O4mKHna4-rp6ig`) to `payout.transfer.*` events by API (`POST /webhooks/create` with `x-on-behalf-of`), pointed at an anonymous public request inbox (webhook.site), since this machine had no public URL. Each delivery was read back from the inbox with its exact raw body and headers and handed to our receiver code; the subscription's signing secret never left this machine. It then sent one USD 10.00 LOCAL sandbox payout from that account and asked the sandbox simulator for SENT and then FAILED (failure type `BENEFICIARY_BANK_RETURNED`). The events below are exactly what the sandbox sent; the transfer reads back CANCELLED.

Each delivery was checked by the receiver before anything else: HMAC-SHA256 over `x-timestamp` + raw body with the subscription's secret, a 5-minute window, dedupe on event id, and routing by `account_id` to the employer ([`src/webhooks/airwallex.ts`](../../src/webhooks/airwallex.ts)).

| Read from the inbox (UTC) | Event | Receiver outcome | Transfer status | Failure type |
|---|---|---|---|---|
| 20:48:33 | `payout.transfer.processing` | processed | PROCESSING |  |
| 20:48:33 | `payout.transfer.sent` | processed | SENT |  |
| 20:48:33 | `payout.transfer.paid` | processed | PAID |  |
| 20:48:33 | `payout.transfer.failed` | processed | FAILED | INCORRECT_ROUTING |
| 20:48:33 | `payout.transfer.cancelled` | processed | CANCELLED | INCORRECT_ROUTING |

5 events verified and processed for transfer `412d7a30-9479-4808-aff6-4effb1ed0ccc`; 0 redeliveries recognised as duplicates. The same receiver refused a real delivery with one byte of its body changed (HTTP 400, `bad_signature`). What this does not show: our own server receiving the push in real time; the receiver checked each delivery seconds after it reached the inbox.
