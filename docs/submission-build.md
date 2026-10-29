# HackerEarth Build Phase submission (saved as a draft on 2026-10-29; Oscar submits)

The Build Phase needs its **own** submission. On the dashboard: Submissions > Build Phase > New Submission. The form has four fields and **no video field**, so the video link goes at the top of the description.

- **Title** (keep it short; the idea phase silently rejected a 144-character title):
  `Payday Guardian: tenant-safe multi-employer payroll agent on Airwallex (Kit 6)`
- **Parent Submission:** `Payday Guardian — Multi-Employer Payroll Agent (on time, tenant-isolated, fraud-aware)`
- **Repository URL:** `https://github.com/acirema792/payday-guardian` (must be public, or shared with the judges, before submitting)
- **Description:** everything below the line. Paste it into the editor and re-apply bold, headings and links if the paste loses them.

---

**Demo video (4:45, recorded from the live sandbox run):** https://youtu.be/jE588gNmAYU
**Click-through demo (no install):** https://acirema792.github.io/payday-guardian/
**Repository:** https://github.com/acirema792/payday-guardian · **Live run evidence:** https://github.com/acirema792/payday-guardian/tree/main/docs/evidence

**Track:** Multi-Tenant Platforms, Starter Kit 06 (Multi-Employer Payroll Executor).

### What it is
Payday Guardian is an AI payroll agent for contractor platforms on Airwallex. It pays each employer's contractors from that employer's own wallet, prices fees in before it converts currency, and routes each payout to land before its local cut-off. It holds a payout when an email asks to redirect someone's pay, re-pays a bank return exactly once, and escalates to a person only the cases code cannot decide.

### It ran live
We ran the full demo on the Airwallex sandbox against **three Kit 6 connected accounts**, with Claude reading the inbound messages. **35 of 36 contractors were paid on payday.** One diversion attempt was stopped, and that payout was released to the account on file after a person approved. One payout was escalated after the Philippine cut-off, and one bank return was re-paid exactly once. The audit log of that run is committed: **297 Airwallex API calls, 0 errors, and no employer-scoped call outside the three employer accounts**. The three platform fees read back SETTLED.

### The demo: goal, plan, four pieces of new information, result
1. **Pooled-deposit trap:** Fabrikam's deposit lands while Contoso is short. Summed across tenants there is USD 103,000, enough to pay Contoso in full with other employers' money. The agent refuses. Contoso pays from its own wallet only, statutory payments first and then the cheapest to fund. The rest are held, and the platform fee is deferred until wages are covered.
2. **Diversion email:** "send my pay to this new account today, urgent". Claude lists the red flags. Code holds only that one payout and never uses the account number in the email, and everyone else is paid. Claude writes the ops lead a plain-language note: why the agent stopped and what would release it.
   **Human approval:** after a call-back to the number on file, a person approves releasing the payout to the account on file. The approval is a SHA-256 of exactly what executes: amount, currency, account, employer and evidence. The same approval is rejected for the email's account and for a larger amount. The fraudster gets nothing.
3. **Bank return:** a signed `payout.transfer.failed` webhook is verified (HMAC-SHA256) and its redelivery ignored. The return is confirmed from the API, not the email. The beneficiary is re-validated and the payout re-paid once; running the repay again returns the same transfer.
4. **Late top-up after the Philippine cut-offs:** the agent checks that the money has cleared into the wallet before relying on the email. It pays every payout that can still land today and escalates the rest to a person.

### Design: the model reads, the code decides, the API moves the money
- **Claude Opus 5.5 reads** emails and bank notices into a schema-validated reading, with no tools and no credentials, falling back to a rule-based reader. Our eval passes 7/7, including a prompt-injection email.
- **Claude explains** each exception to the person who must act. Code supplies the facts and the allowed options, and a note containing any number not in the facts is discarded.
- **Pure, unit-tested policy code decides**:
  - tenant guard
  - fraud holds
  - cut-off-aware LOCAL/SWIFT choice
  - SWIFT fees priced in before converting
  - net FX gap
  - shortfall order
  - fee deferral
  - exact funding request

  Approvals are bound to a SHA-256 hash of the amount, currency, counterparty, employer account and evidence.
- **The executor moves money on Airwallex** with `x-on-behalf-of` on every employer call:
  - quote-locked FX with a slippage guard
  - beneficiaries validated then created once
  - explicit rails
  - payout-linked FX for PHP and INR
  - request_id idempotency, with recovery from lost responses
  - fee charges confirmed at SETTLED
  - an audit log of every call

### Airwallex products used
Connected accounts (create, submit, activate), Global Accounts and deposit simulation, balances, FX quotes and conversions, beneficiary validate and create (US, GB, DE, MX, PH, IN), transfers with LOCAL and SWIFT, transfer simulation (SENT, PAID, FAILED with failure type), charges for the platform fee, and webhooks (`payout.transfer.*`).

### Try it in 60 seconds
`npm ci && npm run demo && npm run console` runs the whole story on a deterministic offline bank, with no credentials. The console's **Live sandbox** switch shows the committed live run. `npm test` runs 96 tests. Setup for your own sandbox is in the README.

### What we learned on the sandbox
- Deposits into connected accounts clear a few seconds after the simulation call.
- PHP and INR wallet conversions fail, while payout-linked FX works.
- A SWIFT USD payout costs a flat USD 15.
- A failed transfer reads back as CANCELLED with its failure type.
- Each corridor has its own routing quirks (the CLABE goes in `account_number`, IN needs IFSC as `bank_code`, PH needs a SWIFT code).

Built solo by Oscar Ariza (team VALOR).
