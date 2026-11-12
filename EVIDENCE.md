# Evidence by judging criterion

The criteria from the build-phase shortlist email, with what we did and where to look.

| Criterion | What we did | Where to look |
|---|---|---|
| **Relevance** (Starter Kit 06) | Every Kit 06 rule from the builder guide is enforced in tested code: one connected account per employer, `x-on-behalf-of` on every call, SWIFT fees priced before converting, explicit rails, transfers driven to a terminal state, a defined rule for when the agent may charge a fee. The demo follows the guide's arc: goal, plan, new information, revised decision, result | [README: Kit 06 rules](README.md#kit-06-rules-and-where-they-live) |
| **Impact** | The payroll ops lead's four calls every payday (whose money, which rail in time, is this request real, did it land), each handled with a measured result. On the same bank, a naive agent diverted MXN 45,000 to a fraudster, a pooled-wallet platform spent USD 30,791 of other employers' money on Contoso's payroll, a blind retry paid one person twice, and trusting a funding email stalled payroll mid-run | [docs/BENCHMARK-RESULTS.md](docs/BENCHMARK-RESULTS.md) |
| **Innovation** | Approvals bound to a hash of exactly what executes (payday, amount, the payee's full bank details, employer, evidence) and re-checked by the executor; a closing reconciliation that caught a sandbox transfer acknowledged as PAID but left SENT; an explainer whose note is discarded if it introduces any number; an instant advance on Metal under a mandate the chain enforces even if our code is bypassed | [JUDGES.md](JUDGES.md), [docs/evidence/incidents](docs/evidence/incidents/) |
| **Complexity and implementation** | Pure policy code over integer minor units, an idempotent executor with recovery from lost responses, 144 tests, a 27-case benchmark with a naive baseline, a reader check on held-out messages written by a separate AI review agent, a mutation check that removes each protection in turn, and review rounds by separate AI reviewer agents (one found a stale beneficiary cache in the executor, now fixed and pinned by a test in [test/executor.test.ts](test/executor.test.ts)) | [docs/engineering.md](docs/engineering.md), [CLAIMS.md](CLAIMS.md) |
| **Product integration** | Connected accounts (create, submit, activate), Global Accounts and deposits, balances, FX quotes and conversions, payout-linked FX, beneficiary validate and create in six corridors, LOCAL and SWIFT transfers, transfer simulation, charges for the platform fee, a webhook receiver exercised offline (subscriptions by API are implemented but were not used in the committed run). 450 live calls with 0 error responses | [README: Airwallex integration](README.md#airwallex-integration), [docs/evidence](docs/evidence/) |
| **Metal Award** (Metal and Airwallex tooling) | One Metal account per employer, a mandate with one payee, a cap and a budget; the agent holds only the mandate key. Live on testnet: three out-of-mandate pulls refused, the approved advance paid once, the same payment id paid nothing the second time, `mandate verify` confirmed it | [README: Metal](README.md#metal-an-instant-rail-with-limits-enforced-on-chain), [docs/evidence/README.md](docs/evidence/README.md) |

## Required deliverables

| Deliverable | Status |
|---|---|
| Working demo | Click-through console of the live run (GitHub Pages), the offline demo (`npm run demo`), and the live demo on your own sandbox (`npm run demo:live`) |
| Video under five minutes | [4:44, recorded from the live run](https://youtu.be/IvPSarvIO9g) |
| Repository with setup steps | This repo; [docs/engineering.md](docs/engineering.md) has setup for your own sandbox |
| Uses Airwallex APIs | Every payroll payout, conversion and fee goes through Airwallex (the one instant advance went on Metal testnet); see [docs/evidence/live-audit.csv](docs/evidence/live-audit.csv) |
