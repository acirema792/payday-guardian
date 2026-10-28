# Demo video

**Watch:** https://youtu.be/GVIRaVwaD6A (4:03, Unlisted). Recorded from the live sandbox run in [docs/evidence](evidence/).

Frames are the real console (`npm run console`, `?run=live`) and five title cards, rendered at 1920×1080 with headless Chrome. The narration is macOS text-to-speech (Samantha), captioned on screen, and assembled with ffmpeg. The narration numbers are read from the committed evidence, so they match the data.

## Shot list and narration

1. **Title card**
   > This is Payday Guardian: a payroll agent for contractor platforms, built on Airwallex for Starter Kit six.

2. **Title card**
   > Contractor platforms pay people in many countries, for many employers at once. Every payday, someone has to decide whose money pays whom, which rail lands before the cut-off, whether a bank-detail change is real, and whether a returned payment was already sent again. Get it wrong, and someone is paid late, paid twice, paid to a fraudster, or paid with another employer's money.

3. **Console: 04:00 UTC, Initial plan from live balances**
   > Everything you'll see ran live on the Airwallex sandbox: three employers, each its own connected account, and thirty-six contractors in six countries. At four a.m., the agent plans each employer separately, from that employer's own wallet.

4. **Console: 04:00 UTC, Initial plan from live balances (highlighting: funding request)**
   > Policy code prices payroll including SWIFT fees, converts only the net gap at a locked quote, and picks a local or SWIFT rail from each country's cut-off. Contoso is short, so it gets an exact funding request.

5. **Console: 04:10 UTC, #1 Fabrikam's funding lands; Contoso is still short (highlighting: pooled ledger)**
   > New information: Fabrikam's deposit lands, while Contoso is still short. Add up all the wallets, and there's over a hundred thousand dollars. Enough to pay Contoso in full, with other employers' money.

6. **Console: 04:10 UTC, Revised: Fabrikam pays everyone; Contoso stays limited to its own wallet**
   > The agent refuses. Fabrikam pays everyone. Contoso pays only from its own wallet: statutory payments first, then the cheapest to fund. And our platform fee waits until Contoso's people are paid.

7. **Console: 04:20 UTC, #2 Email: "please send my pay to this new account today, urgent"**
   > Next, an email: my account was closed, send my pay to this new account today, it's urgent.

8. **Console: 04:20 UTC, Revised: hold one payout, not the payroll (highlighting: Red flags, Note for the ops lead)**
   > Claude reads it, with no tools and no credentials, and lists the red flags. Code holds only Maria's payout and never uses the account in the email. Then Claude writes the ops lead a plain note: why the agent stopped, and what would release it.

9. **Console: 04:30 UTC, Payroll batch executed on Airwallex**
   > The batch goes out on Airwallex. Beneficiaries are validated, then created once. Every payout has an explicit local or SWIFT rail. Pesos to the Philippines and rupees to India use payout-linked FX, because the sandbox can't convert those in the wallet.

10. **Console: 04:50 UTC, Approval: release Maria Garcia's pay to the account on file (highlighting: Approval requested)**
   > At four fifty, the ops lead calls Maria on the number on file. Maria never sent that email. The agent asks for an approval that is a hash of exactly what will execute: the amount, the currency, the account on file, the employer, and the evidence.

11. **Console: 04:50 UTC, Approval: release Maria Garcia's pay to the account on file (highlighting: rejected, paid to the account)**
   > The same approval is rejected for the account in the email, and for a larger amount. Maria is paid to the account on file. The fraudster gets nothing.

12. **Console: 05:30 UTC, #3 Bank return on Valeria Flores's MXN payout**
   > Then Valeria's Mexican payout comes back from the bank.

13. **Console: 05:30 UTC, Revised: re-verify and re-pay once (highlighting: no duplicate)**
   > The agent doesn't trust the notice. It reads the transfer from Airwallex, sees a bank return, re-validates the beneficiary, and pays once. Running the repay again returns the same transfer, because every operation has its own idempotency key.

14. **Console: 06:40 UTC, #4 Contoso's top-up arrives at 06:40 UTC (highlighting: Checked against the wallet)**
   > Contoso's top-up arrives at six forty, after the Philippine cut-offs. The agent checks that the money has cleared into Contoso's wallet before believing the email.

15. **Console: 06:40 UTC, Revised: pay what can still land today, escalate what cannot (highlighting: Note for the ops lead)**
   > It pays everyone whose payout can still land today, and escalates the Philippine payout to a person, with Claude's note on the options.

16. **Console: 07:00 UTC, Payday report**
   > The result: 35 of 36 contractors paid on payday, each from their own employer's wallet. One diversion stopped, one return paid back exactly once, and one escalation. Fees were collected only after wages, and only once Airwallex reported each charge settled.

17. **Title card**
   > The design rule: the model reads, the code decides, and the API moves the money. Claude reads and explains. Pure, tested policy code decides. The executor moves money with x on behalf of, on every employer call, with idempotent request IDs, verified webhooks, and an audit log of every call.

18. **Title card**
   > And it's verifiable. The repository holds the live run's full audit log: 297 Airwallex calls, zero errors, and no employer call outside the three employer accounts. Plus 96 tests, and an offline demo that runs in a minute with no credentials.

19. **Title card**
   > Payday Guardian. Payroll that's on time, never cross-tenant, and safe from diversion fraud. Thank you.
