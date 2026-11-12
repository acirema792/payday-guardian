# Review Payday Guardian in five minutes

No account, key or install needed for steps 1 to 4.

| Step | Do this | What to look for |
|---|---|---|
| 1 (1 min) | Open the [click-through console](https://acirema792.github.io/payday-guardian/). It opens on the committed **Live sandbox** run. (No internet? The same console is in [docs/console](docs/console/); `npm run console` serves it) | Three employers, each with its own wallet, and 36 payouts coloured by status. The left rail is the payday: goal, plan, four pieces of new information, result |
| 2 (1 min) | Click **04:10** and **04:20** | 04:10: a pooled ledger would see USD 93,000 and pay Contoso with other employers' money; the agent keeps Contoso within its own wallet. 04:20: an email asks to redirect Maria's pay; Claude lists the red flags, code holds only her payout |
| 3 (1 min) | Click **04:50**, then **06:45** | 04:50: the release approval is rejected for the email's account, a larger amount, another payday, 12 hours later and the agent's own identity; Maria is paid to the account on file. 06:45: Metal itself refuses a payee off the mandate, a cent over the cap and a second payment; the paid transaction has an explorer link |
| 4 (1 min) | Open [docs/BENCHMARK-RESULTS.md](docs/BENCHMARK-RESULTS.md) | 25 of 27 cases as expected, each outcome written before the run; the two misses are the offline fallback reader, explained. Against a naive agent on the same bank: money lost or misdirected in 4 cases, payroll stalled in 2; Payday Guardian neither. `npm run mutation` removes each protection in turn and shows which benchmark cases fail and how many unit tests fail |
| 5 (1 min, optional) | `npm ci && npm run benchmark && npm run demo && npm run console` (Node 24) | The benchmark and the whole payday on a deterministic offline bank, no credentials. Then http://localhost:4321 |

Prefer video? [4:44 walkthrough](https://youtu.be/IvPSarvIO9g) recorded from the same live run (it shows 138 tests; the suite has 146 now).

## Check a claim yourself

- **It ran live on Kit 6 connected accounts:** [docs/evidence/live-audit.csv](docs/evidence/live-audit.csv) has every Airwallex call, in order, with the account it was made on behalf of. Filter the `account` column: three employer accounts, and blank for the platform's own calls (the fee charges), nothing else.
- **Every payout reconciled to the cent:** the reconciliation table in [docs/evidence/README.md](docs/evidence/README.md) lists each payout's amount in our ledger and as Airwallex read it back. The other direction, every transfer on the three accounts being one we recorded, is in [docs/evidence/two-way-reconciliation.md](docs/evidence/two-way-reconciliation.md).
- **The Metal advance:** the transaction link in [docs/evidence/README.md](docs/evidence/README.md) opens on the Metal testnet explorer. The mandate's three refusals are on chain too: [docs/evidence/metal-refusals.md](docs/evidence/metal-refusals.md) links each one, with `mandate verify` listing the payment and the refusals.
- **What went wrong on the way:** [docs/evidence/incidents](docs/evidence/incidents/) has the raw logs of three live attempts that hit sandbox problems, and what each changed.
- **Every claim and how strong its evidence is:** [CLAIMS.md](CLAIMS.md). **Each judging criterion and where to look:** [EVIDENCE.md](EVIDENCE.md).

## Where each claim lives in the code

| Claim | Code | Test |
|---|---|---|
| One employer's money never pays another's people | [`src/tenant/adapter.ts`](src/tenant/adapter.ts), [`src/policy/planner.ts`](src/policy/planner.ts), [`src/executor/execute.ts`](src/executor/execute.ts) | [`test/tenant.test.ts`](test/tenant.test.ts), [`test/executor.test.ts`](test/executor.test.ts), benchmark A01, A15 |
| An email can hold a payout but never redirect it | [`src/policy/fraud.ts`](src/policy/fraud.ts), [`src/agent/messages.ts`](src/agent/messages.ts) | benchmark A02 (A03, a documented miss of the offline fallback reader, still pays only the account on file) |
| An approval pays exactly what was approved, once | [`src/policy/approval.ts`](src/policy/approval.ts), `releaseSubject` in [`src/executor/execute.ts`](src/executor/execute.ts) | [`test/approval.test.ts`](test/approval.test.ts), benchmark A05 to A09, C03 |
| Nobody is paid twice | `sendTransfer` and `payPeriodOf` in [`src/executor/execute.ts`](src/executor/execute.ts) | benchmark A10 to A12 |
| Fees are priced before converting, and never displace wages | [`src/policy/planner.ts`](src/policy/planner.ts) | benchmark A13, A14 |
| The model reads and explains, but cannot introduce a number | [`src/agent/claude-interpreter.ts`](src/agent/claude-interpreter.ts), [`src/agent/explainer.ts`](src/agent/explainer.ts) | [`test/explainer.test.ts`](test/explainer.test.ts), benchmark A18 |
| The day closes reconciled, both ways | [`src/policy/reconcile.ts`](src/policy/reconcile.ts), [`scripts/reconcile-two-way.ts`](scripts/reconcile-two-way.ts) | [`test/reconcile.test.ts`](test/reconcile.test.ts) |
| Metal pays only under the employer's mandate | [`src/metal/`](src/metal/), [`src/policy/advance.ts`](src/policy/advance.ts) | [`test/metal.test.ts`](test/metal.test.ts), [`test/advance.test.ts`](test/advance.test.ts), benchmark A16, A17, C05 |
