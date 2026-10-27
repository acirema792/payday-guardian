# Winning strategy (loop engineering, 2026-10-27)

Shortlisted for the Build Phase (Oct 27 – Nov 13). Judging criteria from the shortlist email: **relevance, impact, innovation, complexity and implementation, product integration**. Targets: Judges' Choice ($20k), Founder's Choice ($30k), Metal Award ($15k) as a stretch.

## Loop 1: gap analysis against the judging criteria

| Criterion | Where we stand | Gap to close |
|---|---|---|
| Relevance | Exact Kit 6 scenario, including the cross-tenant deposit trap | Show the trap explicitly in the demo: "naive sum says enough money; the agent refuses" |
| Impact | Strong story: late wages and payroll diversion fraud | A payday report with business numbers (on-time %, fees and FX saved by netting, fraud held). Cite only sourced industry figures in the README |
| Innovation | Diversion email doubles as a prompt-injection test; hash-bound approvals | One memorable moment: the agent explains, in plain language, why it held Maria's payout and what would release it |
| Complexity and implementation | Plan is solid, nothing built yet | Real sandbox calls end to end, unit-tested policy engine, idempotent re-runs, audit log of every API call |
| Product integration | Uses accounts, Global Accounts, FX, beneficiaries, transfers, simulations, charges, webhooks | Every Airwallex call must be load-bearing (no decorative calls). Use the FX quote, not just the rate. Validate beneficiaries before creating them |

**Critical-path gap:** Kit 6 platform access. `POST /accounts/create` returns `This account cannot onboard business accounts` (checked 2026-10-27). Other Kit 5–8 teams are blocked the same way, and devhelp has only sent an auto-reply.

## Loop 2: red-team (what makes us lose)

1. **Platform access never arrives.** Mitigation: a tenant adapter from day 1, so each employer is a `TenantContext` and the policy engine never knows which mode is in use.
   - Mode A (preferred): connected accounts via `x-on-behalf-of`, once Airwallex enables them.
   - Mode B (self-serve fallback): extra business accounts in the same sandbox organisation (named "New Business Sandbox" so they are auto-approved), one scoped API key linked to all of them, and a token per employer via `x-login-as`. Each employer keeps a separate wallet, so tenant isolation is real. The platform fee becomes a ledgered transfer instead of `charges/create`.
2. **Scope creep (solo, 17 days).** Start with the corridors the guide documents (US/USD, GB/GBP, DE/EUR SWIFT). Add MX/PH/IN only if `beneficiaries/schema` and validate pass. Metal only after the core gate on Nov 6.
3. **Sandbox flakiness on demo day.** Slack already reports a card-simulation outage and Metal console billing hanging. Use a deterministic scenario runner with seeded data that can be re-run safely, and record the video from a clean run.
4. **LLM nondeterminism.** The model's output is schema-validated, and policy code decides. The demo still completes with the LLM off (rule-based reader fallback), which also demonstrates the design rule.
5. **Judges skim.** A README that opens with a 60-second GIF, an architecture diagram, and a section on how cross-tenant payments are prevented. Make the repo public before submitting.
6. **Submission-day surprises.** Submit early on Nov 13. The HackerEarth title must stay short (the 144-character title failed silently at idea phase).

## Loop 3: build plan with gates

| Dates | Deliverable | Gate |
|---|---|---|
| Oct 27–29 | Tenant adapter (modes A/B), policy engine (pricing with fees, priority on shortfall, tenant check, fraud hold, cut-off routing) with unit tests, seed scenario (3 employers × 12 contractors) | `npm test` green; Mode B can read balances per employer |
| Oct 30 – Nov 2 | Money movement: fund, FX quote and convert the net gap, beneficiary validate/create, transfers plus status simulation, returns re-pay without duplicates, fee collection, webhooks | One employer paid end to end in the sandbox |
| Nov 3–5 | Agent layer: Claude reader (employer email, bank return, contractor message), approval binding, scenario runner for new information #1–#4 | Full demo script runs unattended |
| **Nov 6** | **Gate:** core demo green, so build Metal (Nov 7–8); otherwise polish | |
| Nov 9–10 | Console (Goal → Plan → New information → Revised decision → Result), payday map, payday report | Looks good in a screen recording |
| Nov 11–12 | Video under 5 minutes, README, diagram, repo public, two dry runs | |
| Nov 13 | Submit before noon Bogota | |

## Immediate actions

- [x] Post the platform-access request in #platforms-kits-5-6-7-and-8 (posted 2026-10-27 11:54, tagging Cyrus and Dan Kim of Airwallex)
- [ ] Add two sandbox businesses named "New Business Sandbox" and a scoped key covering all three accounts (Mode B)
- [x] Build the tenant adapter and policy engine with tests (39 tests, 2026-10-27)
- [x] Seed scenario and money-movement layer; live smoke test green on the sandbox (62 tests, 2026-10-27). "One employer paid end to end in the sandbox" gate met early
