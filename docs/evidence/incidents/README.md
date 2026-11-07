# Live runs that did not go to plan (2026-11-07)

Three live attempts before the committed run hit sandbox behaviour the agent had to handle. Each log is the runner's own output, unedited except for local paths. Every attempt used freshly provisioned connected accounts.

| Log | What happened | What the agent did | What we changed |
|---|---|---|---|
| [pending-deposit](2026-11-07-pending-deposit.log) | Contoso's USD 32,000 top-up returned 201 but stayed `PENDING` (`GET /deposits`) for more than 13 minutes; deposits of 25,000 to 32,000 on the other accounts settled at once | Did not trust the email: planned with what the wallet held, held the payouts it could not fund, and refused an instant advance because the payout was unfunded. 28 of 36 paid | The ops lead's note now says the top-up had not reached the wallet (it said the funds had cleared) |
| [unapplied-paid-transition](2026-11-07-unapplied-paid-transition.log) | A `PAID` transition returned 200 but the transfer read back `SENT` minutes later | The closing reconciliation flagged it (`not_landed`) instead of reporting 35 of 35 | Transitions are read back and retried until the status shows ([`simulator.ts`](../../../src/sandbox/simulator.ts), [`simulator.test.ts`](../../../test/simulator.test.ts)) |
| [transition-500](2026-11-07-transition-500.log) | A transition answered `500 operation_failed` | The client never retries a POST on its own, so the run stopped before paying anyone else | A transition only moves the simulated bank's side, so it is now retried after an error and the read-back decides |

The committed run in [docs/evidence](../) came after these fixes.
