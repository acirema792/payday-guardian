# Build-week feedback

What we ran into on the Airwallex sandbox and Metal testnet while building, how we handled it, and what would have helped. Measured between 2026-10-27 and 2026-11-07.

## Airwallex sandbox

| What happened | How we handled it | Suggestion |
|---|---|---|
| A simulated deposit into a connected account stayed `PENDING` for over 13 minutes, while deposits of 25,000 to 32,000 on other accounts settled at once ([log](docs/evidence/incidents/2026-11-07-pending-deposit.log)) | The agent plans only with what the wallet holds, so it held what it could not fund and refused an advance on the unfunded payout | Document when a simulated deposit can stay `PENDING`, or let a simulation force it to settle |
| A `PAID` transition answered 200 but the transfer read back `SENT` minutes later ([log](docs/evidence/incidents/2026-11-07-unapplied-paid-transition.log)) | Our closing reconciliation flagged it; transitions are now read back and retried | Make the transition endpoint either apply or fail |
| A transition answered `500 operation_failed` ([log](docs/evidence/incidents/2026-11-07-transition-500.log)) | Transitions are retried after an error, and the read-back decides | |
| Wallet conversions into PHP and INR fail with `unable_to_resolve_valid_value_date`; MXN, GBP and EUR work | Those payouts are funded with payout-linked FX (`source_currency` plus a `quote_id`) | Note the affected currencies in the FX docs |
| The first FX call on a newly activated connected account returns `unconfigured_client_fee`; it worked about five minutes later | The setup waits before the first FX call | Return a retry-after, or configure the fee at activation |
| Connected account submit fails with `field_required` unless `business_person_details[].identifications.primary` was sent at create time, and fields cannot be added afterwards | Provisioning sends it at create | Validate it at create, or allow adding it before submit |
| Simulated deposits into connected accounts become available a few seconds after the 201 (the guide's note is for the platform wallet) | The agent polls the wallet after every deposit | A note in the Kit 6 guide |
| `GET /deposits` rejects `page_size` below 10 with `invalid_argument` | Use 10 | State the minimum in the docs |
| The MCP server authenticates as the platform and cannot send `x-on-behalf-of` | We used the docs MCP server for payload fields and REST for every employer call | An `on_behalf_of` parameter on MCP tools would make MCP usable for Kit 6 |
| A SWIFT USD payout costs a flat USD 15 (`amount_payer_pays` 45 for a 30 USD transfer) | Priced in before converting | List sandbox SWIFT fees per currency next to the EUR 12.85 in the guide |

## Metal testnet

| What happened | How we handled it | Suggestion |
|---|---|---|
| The console shows an RPC endpoint's secret (`mrpc_secret_...`) more prominently than its URL; `metal-agent` needs the URL | Setup refuses a value that is not an `https://` URL | Label which value the CLI expects |
| `account create` funds the owner address from the faucet, and the faucet then rate-limits the next `fund` for about 30 seconds | Setup funds the Metal account again after the wait | Mention the rate limit in `account create`'s output |
| A mandate's budget never resets, and pull records live under `~/.metal-agent/pulls/<mandate>/` | A fresh mandate (`mandate renew --replaces`) before each live run | A note on budgets for recurring payouts |

## HackerEarth

- The build-phase form silently refuses to save a description of about 8,480 characters of text (8,060 saved), with no message. A visible limit would help.
