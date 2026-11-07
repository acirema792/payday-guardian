# Engineering notes

Setup for your own sandbox, what we measured there, what the tests cover, and where the code lives. The [README](../README.md) has the overview.

## Run it live on your own sandbox

1. **Node 24+** and `npm ci`.
2. **Sandbox account:** sign up at https://www.sandbox.airwallex.com. Name the business `Sandbox Business` or `New Business Sandbox`; other names stay In review.
3. **API key:** in the sandbox web app, go to Developer > API keys > New scoped key. Then `cp .env.example .env` and fill in `AWX_CLIENT_ID` and `AWX_API_KEY`. Add `ANTHROPIC_API_KEY` for the Claude reader.
4. **Platform access:** Kit 6 needs Connected Accounts and Platform Payments, which are not self-serve. Email devhelp@airwallex.com with your sandbox email and Client ID.
5. **Check:** `npm run check` logs in and reports global accounts, balances and connected-account access. It changes nothing.
6. **Employers:** `npm run provision` creates, submits and activates one connected account per employer with synthetic data, and gives each a USD Global Account. The accounts are recorded in `data/tenants.json`. Wait about 5 minutes before the first FX call (`unconfigured_client_fee`).
7. **Prove money movement:** `npm run smoke:connected` pays one employer's contractors and charges the fee, and shows the other employers untouched.
8. **Run the demo live:** `npm run demo:live -- --reader claude`, then `npm run console` and open http://localhost:4321/?run=live. `npm run evidence` regenerates `docs/evidence` from that run. A second live run needs fresh employers first: `npm run provision -- --fresh`.
9. **Optional, Metal instant rail:** sign in at https://console-testnet.metalntwx.com, create an RPC endpoint and put its URL (`https://rpc-testnet.metalntwx.com/v1/<endpoint id>`, not its secret) in `METAL_RPC_URL`. `npm run metal:setup` creates Contoso's Metal account, funds it from the faucet, creates the contractor's synthetic wallet and binds a fresh mandate (keys stay in `data/metal/`). The next `npm run demo:live` pays the advance on testnet. Run `metal:setup` again before each live run.
10. **Optional, live webhooks:** expose port 4322 with your own tunnel and pass its https URL: `npm run demo:live -- --reader claude --webhook-url https://<tunnel>`. The run creates (or re-points) a `payout.transfer.*` subscription for the platform and each employer account by API, keeps the secrets in `data/webhook-subscriptions.json`, and waits for the returned transfer's signed `payout.transfer.failed` event. `npm run webhooks -- --url https://<tunnel>` serves the same subscriptions on their own.

## What we measured on the sandbox

Facts the build depends on, re-tested live (October 2026):

- Deposits into connected accounts can become available a few seconds after the simulation call returns (25 seconds in the committed run; one top-up stayed PENDING for more than 13 minutes on 2026-11-07). The agent polls the wallet until the funds have cleared and reports how long it took.
- Wallet conversions into PHP and INR fail with `unable_to_resolve_valid_value_date`; a USD-funded transfer with a locked `quote_id` works. MXN, GBP and EUR conversions work.
- A SWIFT USD payout costs a flat USD 15 (`amount_payer_pays` 45 for a 30 USD transfer).
- A transfer moved to FAILED reads back as CANCELLED with its `failure_type`.
- Corridor quirks:
  - MX MXN puts the CLABE in `account_number` with no routing type.
  - IN uses `account_routing_type1: "bank_code"` with the IFSC.
  - PH needs a `swift_code`.
  - DE validates for both LOCAL (SEPA) and SWIFT.
- Connected account submit also needs `identifications.primary` for the business person.
- Charges are created NEW or PENDING and settle shortly after.

## Tests

`npm test` runs the vitest suite (138 tests) in well under a minute. It covers:

- money arithmetic
- fraud and cut-off routing
- the planner, including the shortfall order (statutory, then earliest cut-off, then cheapest across currencies) and a fee that waits for every wage still owed, fraud-held and cut-off-held included
- approval hashing, expiry after 12 hours, no self-approval, and the payee fingerprint
- tenant isolation
- the seed scenario
- the executor against an in-memory Airwallex: idempotency within a batch and across batches of one pay period, lost responses, returns, slippage, charges, the charge and conversion limits re-applied in the executor, a plan refused on another employer's account, and a released fraud hold paid only under an approval for that payday, amount and bank account
- client retry rules
- the Claude reader's schema mapping and fallback
- the exception explainer: a note with a number or currency not in the facts, look-alike digits, or an amount in words is discarded
- webhook verification (several subscription secrets, a non-numeric or seconds timestamp) and the HTTP endpoint
- the instant advance policy (opt-in channel and age, never for fraud or shortfall holds, only on a payout the employer has funded, the cap across a payday, the remainder) and the Metal rail: the offline mandate's refusals and once-per-payment-id, and parsing of `metal-agent` output
- the closing reconciliation (a payout missing at the bank, a different or unreported amount, or one not PAID is flagged)
- the full demo, which must end with every payout landed, held or escalated, and reconciled, and must release the held payout only to the account on file under a matching approval

Mutation checks confirmed that the tests fail when the fee rule, the tenant guard, idempotency (including the pay-period key) or terminal transfer states are broken.

## Project layout

```
src/airwallex/   REST client (token per account, retries) and typed API wrappers
src/tenant/      TenantClient / TenantRegistry: one Airwallex account per employer
src/policy/      Pure decision code: planner, fraud, routing, money, approvals
src/executor/    Plan -> API calls; node:sqlite store for idempotency and audit
src/agent/       Inbound message reading: Claude reader and rule-based fallback
src/webhooks/    Airwallex webhook verification, dedupe, tenant routing; subscriptions by API
src/metal/       Instant rail on Metal testnet: mandate-bound pulls via metal-agent, offline mirror
src/sandbox/     The only place simulation endpoints are called; offline bank
src/scenario/    Corridors (validated live) and the 3 x 12 seed scenario
src/demo/        The demo as code, offline and live environments
console/         Single-file console for the timeline
docs/evidence/   Live run timeline, full audit log, and checks
```

