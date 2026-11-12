# Two-way reconciliation of the live run

The closing reconciliation in the live run read back every payout in our ledger from Airwallex. This checks the other direction, so a transfer we have no record of cannot hide: on 2026-11-12 we listed every transfer Airwallex holds on each employer's connected account (`GET /api/v1/transfers` with `x-on-behalf-of`, read-only) and compared it with every transfer our store recorded sending in the run (`live-20261107T024753.db`: payouts and repays). Each live run used freshly provisioned accounts, so each listing covers the account's whole life. Reproduce with `npm run reconcile:two-way` (needs our sandbox credentials).

| Employer | Connected account | Listed by Airwallex | Recorded by us | Listed but not recorded | Recorded but not listed | Statuses at Airwallex |
|---|---|---|---|---|---|---|
| Northwind Labs | `acct_y_y1JWKCP5mb-pGzOblpYg` | 12 | 12 | 0 | 0 | PAID 12 |
| Contoso Health | `acct_pgEQZnI6MvyeYgG3iRIZPA` | 11 | 11 | 0 | 0 | PAID 11 |
| Fabrikam Studio | `acct_yNJZekd_O4mKHna4-rp6ig` | 13 | 13 | 0 | 0 | PAID 12, CANCELLED 1 |
| **All three** | | **36** | **36** | **0** | **0** | |

Every transfer on the three accounts is one we recorded sending, and every transfer we recorded is on its own employer's account.
