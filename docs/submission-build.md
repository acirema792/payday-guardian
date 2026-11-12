# HackerEarth Build Phase submission (draft re-saved 2026-11-12 19:25 UTC with exactly this description; deadline 2026-11-15 18:29 UTC; Oscar submits)

The Build Phase needs its **own** submission. On the dashboard: Submissions > Build Phase > New Submission. The form has four fields and **no video field**, so the video link goes at the top of the description.

- **Title** (keep it short; the idea phase silently rejected a 144-character title):
  `Payday Guardian: tenant-safe multi-employer payroll agent on Airwallex (Kit 6)`
- **Parent Submission:** `Payday Guardian — Multi-Employer Payroll Agent (on time, tenant-isolated, fraud-aware)`
- **Repository URL:** `https://github.com/acirema792/payday-guardian` (must be public, or shared with the judges, before submitting)
- **Description:** everything below the line. Paste it into the editor and re-apply bold, headings and links if the paste loses them. The form silently refuses to save a description much over 8,000 characters of text (about 8,060 saved; about 8,480 did not), so keep it this length.

---

**Demo video (4:44, recorded from the live sandbox run):** https://youtu.be/IvPSarvIO9g
**Click-through demo (no install):** https://acirema792.github.io/payday-guardian/
**Repository:** https://github.com/acirema792/payday-guardian · **Live run evidence:** https://github.com/acirema792/payday-guardian/tree/main/docs/evidence

**Track:** Multi-Tenant Platforms, Starter Kit 06 (Multi-Employer Payroll Executor), with an instant rail on Metal testnet.

### What it is
An AI payroll agent for contractor platforms on Airwallex. It pays each employer's contractors from that employer's own wallet, prices fees in before converting, routes each payout to land before its cut-off, holds a payout when an email asks to redirect pay, re-pays a bank return exactly once, and escalates only what code cannot decide; a missed cut-off can get an instant advance on Metal testnet under a mandate Metal enforces on chain.

### It ran live
We ran the full demo on the Airwallex sandbox against **three Kit 6 connected accounts**, with Claude reading the inbound messages. **35 of 36 contractors were paid on payday.** One diversion attempt was stopped, and that payout was released to the account on file after a person approved. The 36th missed the Philippine cut-off because the employer's own money ran out first and its top-up arrived after the cut-off; it was escalated and got a **USD 50 instant advance on Metal testnet** ([transaction](https://testnet.metalntwx.com/tx/0x265f023a9aeebf2913ec893ab92c085b892dcafab53058a69b8632dd22210265)), and one bank return was re-paid exactly once. The audit log of that run is committed: **450 Airwallex API calls, 0 error responses, and no employer-scoped call outside the three employer accounts**. At the close, all 35 payouts were read back from Airwallex, PAID, and matched the ledger to the cent; every transfer on the three accounts is one we recorded (36/36). The three platform fees read back SETTLED. Deposits and the banks' side of each transfer are sandbox simulations.

### Measured, not asserted
25 of 27 benchmark cases as expected, each outcome written before the run (the two misses are the offline fallback reader; Claude reads both correctly). On the same bank a naive agent diverted MXN 45,000 to a fraudster, spent other employers' money on payroll and paid a contractor twice: money lost or misdirected in 4 cases, payroll stalled in 2, Payday Guardian in none. Claude read 16 of 17 labelled and held-out messages. `npm run mutation` removes each protection in turn and shows which benchmark cases and how many unit tests then fail. Details: [docs/BENCHMARK-RESULTS.md](https://github.com/acirema792/payday-guardian/blob/main/docs/BENCHMARK-RESULTS.md); five-minute review: [JUDGES.md](https://github.com/acirema792/payday-guardian/blob/main/JUDGES.md).

### The demo: goal, plan, four pieces of new information, result
1. **Pooled-deposit trap:** Fabrikam's deposit lands while Contoso is short. Summed across tenants there is USD 93,000, enough to pay Contoso in full with other employers' money. The agent refuses. Contoso pays from its own wallet only: statutory wages first, then the earliest cut-off, then the cheapest to fund. The rest are held, and the platform fee is deferred until wages are covered.
2. **Diversion email:** "send my pay to this new account today, urgent". Claude lists the red flags. Code holds only that one payout and never uses the account number in the email, and everyone else is paid. Claude writes the ops lead a plain-language note: why the agent stopped and what would release it.
   **Human approval:** after a call-back to the number on file, a person approves releasing the payout to the account on file. The approval is a SHA-256 of exactly what executes: this payday, the amount, the full bank details on file, the employer and the evidence, and the executor re-checks it before sending. The same approval fails for the email's account, a larger amount, next week's payday, 12 hours later, and with the agent's own identity as approver. The fraudster gets nothing.
3. **Bank return:** a signed `payout.transfer.failed` webhook is verified (HMAC-SHA256) and its redelivery ignored (offline in the payday run; proven live separately). The return is confirmed from the API, not the email. The beneficiary is re-validated and the payout re-paid once; running the repay again returns the same transfer.
4. **Late top-up after the Philippine cut-offs:** Contoso's own money went first to its statutory Indian wages (the agent does not stake statutory pay on a promised top-up), then to the earliest cut-off; Andrea's payout no longer fit before 06:30, and the top-up lands at 06:40. The agent checks that the money has cleared into the wallet before relying on the email. It pays every payout that can still land today and escalates the rest to a person, with Claude's note offering two options: wait for the next window, or an instant advance.
   **Instant advance on Metal:** Andrea opted in weeks earlier through the verified portal. The ops lead approves USD 50, bound to a SHA-256 of the amount and the opted-in address. The agent pays it in USDZ on Metal testnet from Contoso's own Metal account, under a mandate that pays only Andrea, at most 50 per payment and 50 in total. It holds the mandate key, never the owner's key. With our policy code bypassed, Metal itself refused an address off the mandate, a cent over the cap and a second payment; the same pull again paid nothing.

### Design: the model reads, the code decides, the API moves the money
- **Claude Opus 5.5 reads** emails and bank notices into a schema-validated reading, with no tools and no credentials (a rule-based reader takes over if it fails), and **explains** each exception to the person who must act. A note with any number or currency not in the facts is discarded.
- **Pure, unit-tested policy code decides**: tenant guard, fraud holds, cut-off-aware rails, SWIFT fees priced before converting, the net FX gap, the shortfall order (statutory, earliest cut-off, cheapest), a fee that waits for every wage still owed and a charge limit, exact funding requests, and advances only for a funded payout that missed its cut-off, to a portal opt-in. Approvals are a SHA-256 of what executes (pay period included), expire after 12 hours, refuse the agent's own identity, and are re-checked by the executor.
- **The executor moves money on Airwallex** with `x-on-behalf-of` on every employer call: quote-locked FX with a slippage guard, beneficiaries validated then created once, explicit rails, payout-linked FX for PHP and INR, request_id idempotency with recovery from lost responses (payouts and the fee once per pay period), fees confirmed at SETTLED, an audit log, and a closing reconciliation.

### Airwallex products used
Connected accounts (create, submit, activate), Global Accounts and deposit simulation, balances, FX quotes and conversions, beneficiary validate and create (US, GB, DE, MX, PH, IN), transfers with LOCAL and SWIFT, transfer simulation (SENT, PAID, FAILED with failure type), charges for the platform fee, and webhooks: subscriptions by API, five signed `payout.transfer.*` events verified live by our receiver ([evidence](https://github.com/acirema792/payday-guardian/blob/main/docs/evidence/webhooks-live.md)).

### Metal
One Metal account per employer, like Airwallex. `metal-agent` (pinned 0.3.3): the owner creates the account, funds it from the faucet and binds a mandate (payee, per-payment cap, budget); the agent only runs `mandate status`, `pull --payment-id` and `verify`. We later re-sent the three refused pulls with `--record-refusal`, so the refusals are on chain too ([evidence](https://github.com/acirema792/payday-guardian/blob/main/docs/evidence/metal-refusals.md)). All four transactions are public; `mandate verify`, run with the owner's signed mandate, checks each one against it.

### What our own checks caught on the live sandbox
The closing reconciliation found a transfer the sandbox had acknowledged as PAID but left at SENT, and another run stopped when a transition answered with a 500; transitions are now read back and retried. A top-up that stayed PENDING was never trusted: the agent planned with what the wallet held and refused an advance on an unfunded payout. The redacted logs of those runs are in [docs/evidence/incidents](https://github.com/acirema792/payday-guardian/tree/main/docs/evidence/incidents).

### Try it in 60 seconds
`npm ci && npm run benchmark && npm run demo && npm run console` runs the benchmark and the whole payday on a deterministic offline bank, no credentials.

Built solo by Oscar Ariza (team VALOR).
