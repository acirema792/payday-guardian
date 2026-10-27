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
- [ ] Airwallex confirms Connected Accounts + Platform Payments
- [x] `airwallex-dev` MCP signed in
- [ ] `ANTHROPIC_API_KEY` in `.env`
- [ ] Webhook subscription + `AWX_WEBHOOK_SECRET` in `.env` (when the webhook receiver is built)

## Status

Built so far:

- Airwallex REST client and a read-only sandbox readiness check (`npm run check`)
- Tenant adapter: each employer is its own Airwallex account and wallet, reached through connected accounts (`x-on-behalf-of`) or, as a fallback, separate business accounts in one organisation (`x-login-as`)
- Policy engine (pure, unit-tested with `npm test`): tenant isolation, fraud holds for recent or emailed bank-detail changes, cut-off-aware rail choice, fee-inclusive pricing, net FX gap, statutory-first shortfall allocation, platform fee that never displaces wages, exact funding request, and hash-bound approvals

Next: money movement against the sandbox, the Claude reader and the demo console. See [docs/strategy.md](docs/strategy.md).
