# Payday Guardian

Multi-employer contractor payroll agent on Airwallex. Airwallex Agentic Banking Hackathon, Starter Kit 06 (Multi-Employer Payroll Executor), plus an optional Metal testnet fallback rail. Build submissions are due 2026-11-13 and need a working demo, a video under 5 minutes, and this repo with setup steps.

## Airwallex context

- Sandbox only. No production, no real money. Base URL `https://api.sandbox.airwallex.com`, paths start with `/api/v1`.
- MCP servers (user scope): `airwallex-docs` (no login) for exact payload fields; `airwallex-dev` (sandbox login). MCP authenticates as the platform and cannot send `x-on-behalf-of`, so use REST (`src/airwallex/client.ts`) for every employer-scoped call.
- Amounts are major units, not cents. 100 is one hundred dollars.
- `request_id`: new UUID per new operation; reuse it only when retrying the same operation. Reuse within 7 days returns `duplicate_request_id`.
- Login token lasts 30 minutes.
- Builder guide: https://airwallexdev.com/guide

## Design rule

The model reads, the code decides, the API moves the money.
- Claude reads unstructured input (employer emails, bank return notices, contractor messages), proposes a plan and explains exceptions. It gets typed tools only, never credentials.
- Amounts, priorities, limits, tenant checks, cut-offs and fraud holds live in pure, unit-tested policy code.
- Each approval is bound to a hash of amount, currency, beneficiary, employer account and evidence.
- Sandbox simulation calls sit behind one interface.

## Kit 6 rules (from the builder guide)

- One connected account per employer. Never use one employer's balance for another's payroll, and never sum balances across tenants. The demo has a deposit land in Employer C while Employer B stays short.
- Send `x-on-behalf-of: acct_...` on every employer call: balances, beneficiaries, FX, transfers, global accounts, deposit and transfer simulations. Without it FX converts the platform wallet and still returns 201. Read balances back after converting.
- Price payroll including per-payout SWIFT fees (flat EUR 12.85 each; LOCAL is free) BEFORE converting, or the last payout fails.
- Set `transfer_method` (LOCAL or SWIFT) explicitly per contractor.
- `transfers/create` takes `transfer_currency` and `transfer_amount`. Request ids must be 10 to 50 characters.
- Customer transfers stay PROCESSING until moved with `POST /simulation/transfers/{id}/transition`. Go to SENT before FAILED; a failed transfer ends CANCELLED with a `failure_type`.
- FX: leave `x-api-version` off. Quotes are single-use. Book conversions over REST.
- Beneficiaries: call `/beneficiaries/schema` first. Validate with `/beneficiaries/validate`, wrapped as `{"beneficiary": {...}, "transfer_methods": ["LOCAL"]}`. US: `account_routing_type1: "aba"` and `bank_account_category` "Checking"/"Savings". GB: `bank_name` plus lowercase `sort_code`. DE: IBAN plus `swift_code`. Use real routing codes with synthetic account numbers.
- Connected account setup: create (put `business_person_details`, `business_details` and an EIN in `business_identifiers` in the create call; fields lock after submit), then submit, then `POST /simulation/accounts/{id}/update_status {"next_status":"ACTIVE","force":true}`. Wait a few minutes before the first FX call (`unconfigured_client_fee`). Account addresses use `address_line1`/`suburb`; beneficiary addresses use `street_address`/`city`.
- Platform fee: `POST /charges/create` with `source` as a plain acct id, a required `reference`, and `reason: "professional_business_services"`. Payroll top-ups use `wages_salary`. Both return NEW, so poll until SETTLED.
- Insufficient funds codes differ: `balance_insufficient` (transfers), `insufficient_fund` (charges), `insufficient...` (fx).
- Webhooks: verify HMAC-SHA256 over `x-timestamp` + raw body; dedupe on event id.

## Code layout

- `src/airwallex/client.ts`: REST client (token per account; `asAccount(id)` logs in with `x-login-as`)
- `src/tenant/adapter.ts`: `TenantClient` / `TenantRegistry`. Every employer-scoped call goes through it. Mode `connected` uses `x-on-behalf-of`; mode `org-entity` (fallback while connected accounts are not enabled) is a separate business account in the same organisation, reached via `x-login-as`
- `src/policy/`: pure decision code, no I/O. Money is bigint minor units (`money.ts`); `toMajor` only at the API boundary. `planner.ts` builds one employer's plan (tenant guard, fraud holds, cut-off routing, fee-inclusive pricing, net FX gap, shortfall priority, platform fee, funding request). `approval.ts` binds approvals to a hash of what is executed
- `src/airwallex/api.ts`: typed wrappers (balances, beneficiaries, quotes, conversions, transfers, charges) over the `Api` interface that `TenantClient` implements
- `src/executor/`: `execute.ts` turns an `EmployerPlan` into API calls (quote-locked FX with a slippage guard, approval gate, beneficiary once per employer, transfers with explicit rails, ambiguous-response recovery by request_id, returned-transfer repay, platform fee). `store.ts` is node:sqlite: operation key -> request_id/result (idempotency) and the audit log of every API call
- `src/sandbox/simulator.ts`: the only place sandbox simulation endpoints are called
- `src/scenario/`: `corridors.ts` (beneficiary shapes validated live for US, GB, DE, MX MXN/USD, PH, IN) and `seed.ts` (3 employers x 12 contractors, policy config)
- `test/`: vitest. `fixtures.ts` holds the shared policy config and employers; `fake-airwallex.ts` is the in-memory API used by executor tests

## Sandbox facts measured live (2026-10-27)

- SWIFT USD fee is 15 USD per payout (`amount_payer_pays` 45 for a 30 USD transfer)
- PHP and INR wallet conversions fail with `unable_to_resolve_valid_value_date`; fund those payouts from USD with `source_currency` + `quote_id` (payout-linked FX, `policyConfig.payoutLinkedFx`). MXN, GBP and EUR wallet conversions work
- Beneficiary routing: MX MXN puts the CLABE in `account_number` with no routing type; IN uses `account_routing_type1: "bank_code"` with the IFSC; PH needs `swift_code`; DE EUR validates for both LOCAL (SEPA) and SWIFT
- A transfer moved to FAILED reads back as CANCELLED with its `failure_type`
- `npm run smoke` runs the executor live on your own account as a single employer (org-entity mode)

## Open setup items

Remind the user of unchecked items in the README "Setup checklist" (Airwallex platform-access reply, `airwallex-dev` sign-in, `ANTHROPIC_API_KEY`, webhook secret), especially before starting work that needs them.

## Commands

- `npm run check`: read-only sandbox readiness check (login, global accounts, balances, connected-account access)
- `npm run smoke`: live money-movement smoke test on the sandbox (small amounts; writes `data/smoke.db`)
- `npm run typecheck`, `npm test`
