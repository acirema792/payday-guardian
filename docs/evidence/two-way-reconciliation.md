# Two-way reconciliation of the live run

The closing reconciliation in the live run read back every payout in our ledger from Airwallex. This checks the other direction, so a transfer we have no record of cannot hide: on 2026-11-12 we listed every transfer Airwallex holds on each employer's connected account (`GET /api/v1/transfers` with `x-on-behalf-of`, read-only) and compared it with every transfer our store recorded sending in the run (`live-20261107T024753.db`: payouts and repays). Each live payday run used freshly provisioned accounts, so each listing covers the account's whole life. A transfer made on one of these accounts afterwards by one of our own checks is counted only if that check's evidence records it, and is shown in its own column. Reproduce with `npm run reconcile:two-way` (needs our sandbox credentials).

| Employer | Connected account | Listed by Airwallex | Recorded in the payday run | Later checks (recorded in their evidence) | Listed but not recorded | Recorded but not listed | Statuses at Airwallex |
|---|---|---|---|---|---|---|---|
| Northwind Labs | `acct_y_y1JWKCP5mb-pGzOblpYg` | 12 | 12 | 0 | 0 | 0 | PAID 12 |
| Contoso Health | `acct_pgEQZnI6MvyeYgG3iRIZPA` | 11 | 11 | 0 | 0 | 0 | PAID 11 |
| Fabrikam Studio | `acct_yNJZekd_O4mKHna4-rp6ig` | 14 | 13 | 1 (webhook check, CANCELLED) | 0 | 0 | CANCELLED 2, PAID 12 |
| **All three** | | **37** | **36** | **1** | **0** | **0** | |

Every transfer on the three accounts is one we recorded sending (36 in the payday run, 1 by the later webhook check), and every transfer the payday run recorded is on its own employer's account.
