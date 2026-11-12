# Claims and their evidence

Every claim we make in the README, the video and the submission, with how you can check it.

- **REPRODUCIBLE:** a command in this repo produces it on your machine.
- **VERIFIED-LIVE:** observed on the Airwallex sandbox or Metal testnet, and committed as evidence. The Airwallex evidence is our own export of our own audit store; checking it against Airwallex itself needs access to our sandbox, which we can grant to judges on request. The Metal transaction is public on the explorer.
- **NOT-CLAIMED:** things we do not claim, said so nobody reads them in.

| Claim | Tier | How to check |
|---|---|---|
| The full demo ran live on three Kit 6 connected accounts: 35 of 36 contractors paid on payday | VERIFIED-LIVE | [docs/evidence/live-run.json](docs/evidence/live-run.json), [live-audit.csv](docs/evidence/live-audit.csv) |
| 450 Airwallex API calls, 0 error responses, no employer call outside the three employer accounts | VERIFIED-LIVE | [live-audit.csv](docs/evidence/live-audit.csv) (`status` and `account` columns) |
| All 35 payouts read back from Airwallex as PAID, for exactly the ledger's amount and currency | VERIFIED-LIVE | Reconciliation table in [docs/evidence/README.md](docs/evidence/README.md) |
| A USD 50 instant advance paid on Metal testnet; the mandate refused a payee off it, one cent over the cap and a payment past the budget; `mandate verify` confirmed the payment | VERIFIED-LIVE (the payment on chain; the refusals sent nothing, so they are in our evidence, not on chain) | Explorer link and pull table in [docs/evidence/README.md](docs/evidence/README.md) |
| The three platform fees read back SETTLED | VERIFIED-LIVE | Fee table in [docs/evidence/README.md](docs/evidence/README.md) |
| 25 of 27 benchmark cases as expected, each outcome written before the run; the two misses are the offline fallback reader | REPRODUCIBLE | `npm run benchmark`; [docs/BENCHMARK-RESULTS.md](docs/BENCHMARK-RESULTS.md) |
| On the same bank, a naive agent lost or misdirected money in 4 cases and stalled payroll in 2; Payday Guardian did neither in any of the 6 | REPRODUCIBLE | `npm run benchmark` ("Against a naive agent") |
| Claude reads 7/7 labelled messages (incl. a prompt injection) and 9/10 held-out messages written by a separate reviewer | REPRODUCIBLE with an Anthropic key (`npm run reader:eval`, a few cents); our run is committed | [docs/evidence/reader-eval.json](docs/evidence/reader-eval.json) |
| The rule-based fallback reads 5/10 of the same held-out messages | REPRODUCIBLE | `npm run benchmark`; the sets are in [src/eval/reader-holdout.ts](src/eval/reader-holdout.ts) |
| 139 tests pass | REPRODUCIBLE | `npm test` |
| The offline demo pays 35 of 36 and reconciles 35 of 35 | REPRODUCIBLE | `npm run demo` |
| Removing any one of 16 protections makes the benchmark or the unit tests fail (16 of 16 caught) | REPRODUCIBLE | `npm run mutation`; [docs/evidence/mutation.json](docs/evidence/mutation.json) |

## Not claimed

- **Production readiness.** Everything ran on the Airwallex sandbox and Metal testnet; no real money moved.
- **Real banks.** Deposits and the beneficiary banks' side of each transfer are sandbox simulations, behind one interface.
- **Authenticated approvers.** The approver in the demo is scripted. Approvals are hash-bound, expire, are refused for the agent's own identity and are re-checked before execution, but nothing yet proves who the approver is.
- **Live webhooks.** The receiver verifies and dedupes signed `payout.transfer.*` events in the offline run; the committed live run had no public URL to receive them.
- **Two-way reconciliation.** The close reads back every payout in our ledger; it does not yet list each account's transfers to catch one the ledger lacks.
- **Real payroll inputs or cut-offs.** Contractors, amounts and opt-ins are seed data; cut-off times are illustrative policy settings, not Airwallex guarantees.
- **A Metal advance in money.** It is 50 USDZ on testnet, to a synthetic address.
