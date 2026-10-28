# Payday Guardian

An AI payroll agent for global contractor platforms. For each employer it funds, converts and routes every payout so it lands before the local payday cut-off. It never pays one employer's contractors with another employer's money, holds payouts after suspicious bank-detail changes, and escalates only the exceptions a human must decide.

Built on the Airwallex sandbox for the Agentic Banking Hackathon (Starter Kit 06, Multi-Employer Payroll Executor).

## Setup

1. **Node 24+**: `node -v`
2. **Install**: `npm install`
3. **Airwallex sandbox**: sign up at https://www.sandbox.airwallex.com. Name the business `Sandbox Business` or `New Business Sandbox`; other names stay In review.
4. **API key**: in the sandbox web app, go to Developer > API keys > New scoped key. Then `cp .env.example .env` and fill in `AWX_CLIENT_ID` and `AWX_API_KEY`.
5. **Platform access**: Kit 6 needs Connected Accounts and Platform Payments, which are not self-serve. Email devhelp@airwallex.com with your sandbox email and Client ID.
6. **Check**: `npm run check` logs in and reports global accounts, balances and whether connected accounts are enabled. It changes nothing.
7. **Employers**: `npm run provision` creates, submits and activates one connected account per demo employer (synthetic data) with a USD Global Account, and records them in `data/tenants.json`. Wait a few minutes after activation before FX, then `npm run smoke:connected` proves money movement on behalf of an employer, including the platform fee.
8. **Demo**: `npm run demo` (add `-- --reader claude` to have Claude read the messages) for the offline rehearsal, or `npm run demo:live -- --reader claude` to run it on the real sandbox's connected accounts. Then `npm run console` and open http://localhost:4321 (switch between the offline and live runs in the header). A second live run needs fresh employers: `npm run provision -- --fresh`, then wait about 5 minutes for FX to be configured

### Claude Code MCP servers (optional, for development)

```bash
claude mcp add-json --scope user airwallex-docs '{ "type": "http", "url": "https://mcp.sandbox.airwallex.com/docs" }'
claude mcp add-json --scope user airwallex-dev '{ "type": "http", "url": "https://mcp.sandbox.airwallex.com/developer" }'
```

Then sign in to `airwallex-dev` (a one-time browser login):

1. Open the Terminal app and run `claude`.
2. Type `/mcp` and press Enter.
3. Select `airwallex-dev` (shown as "needs authentication") and choose **Authenticate**.
4. A browser tab opens on the Airwallex sandbox login. Sign in with your sandbox account and approve access.
5. Back in the terminal, `/mcp` shows `airwallex-dev` as connected. Type `/exit`.
6. Check from any shell: `claude mcp list` should show both servers as ✔ Connected.

Test it in a new Claude session: "Using airwallex-dev, list my global accounts and balances."

## Setup checklist

- [x] Sandbox account and API key; `npm run check` passes
- [x] Platform access requested from devhelp@airwallex.com (2026-10-25)
- [x] Airwallex enabled Connected Accounts + Platform Payments (verified live 2026-10-27)
- [x] `airwallex-dev` MCP signed in
- [x] `ANTHROPIC_API_KEY` in `.env` (claim the hackathon's $100 Claude credits from the #announcements link)
- [ ] Webhook subscription + `AWX_WEBHOOK_SECRET` in `.env` (when the webhook receiver is built)

## Status

Built so far:

- Airwallex REST client and a read-only sandbox readiness check (`npm run check`)
- Tenant adapter: each employer is its own Airwallex account and wallet, reached through connected accounts (`x-on-behalf-of`) or, as a fallback, separate business accounts in one organisation (`x-login-as`)
- Policy engine (pure, unit-tested with `npm test`): tenant isolation, fraud holds for recent or emailed bank-detail changes, cut-off-aware rail choice, fee-inclusive pricing, net FX gap, statutory-first shortfall allocation, platform fee that never displaces wages, exact funding request, and hash-bound approvals

- Seed scenario: 3 employers x 12 contractors in the US, UK, Germany, Mexico, the Philippines and India
- Money movement on the Airwallex sandbox: quote-locked FX with a slippage guard, approval-gated conversions, beneficiaries validated then created once, transfers with explicit LOCAL/SWIFT rails, payout-linked FX for PHP and INR, recovery from lost responses by request_id, returned-transfer repay that never pays twice, platform fee, and an audit log of every API call. `npm run smoke` runs it live

- Demo runner (`npm run demo`): Goal → Plan → four pieces of new information → revised decisions → payday report, on a deterministic offline bank that mirrors the sandbox's measured behaviour:
  1. A deposit lands in Fabrikam's wallet while Contoso is short; a pooled ledger would pay Contoso with other employers' money, Payday Guardian does not
  2. "Please send my pay to this new account today, urgent": only Maria's payout is held, the account number in the email is never used
  3. An MXN payout comes back from the bank: re-verified and re-paid exactly once
  4. Contoso's top-up lands after the Philippine cut-offs: the rest are paid, the two PH payouts are escalated to a person
  Result: 33/36 paid on payday, every one from its own employer's wallet, with an audit log of every API call

- Claude reader (`src/agent/claude-interpreter.ts`): Claude Opus 5.5 turns each inbound message into a schema-constrained reading (kind, person, amount, red flags, summary) with no tools and no credentials; the deterministic reader takes over on any error or refusal. `npm run reader:eval` checks it on labelled messages, including a prompt-injection attempt (7/7 on 2026-10-27)
- Console (`npm run console`): steps through the demo timeline with every employer's own wallet and all 36 payouts coloured by status
- Kit 6 live: three employers provisioned as connected accounts; payouts, FX and the platform fee verified on behalf of an employer while the other tenants stay untouched (`npm run smoke:connected`)

Next: the video. See [docs/strategy.md](docs/strategy.md).
