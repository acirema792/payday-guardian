# Demo video

**Watch:** https://youtu.be/jE588gNmAYU (4:45, Unlisted). Recorded from the live sandbox run in [docs/evidence](evidence/).

Frames are the real console (`npm run console`, `?run=live`) and five title cards, rendered at 1920×1080 with headless Chrome. The narration is Kokoro-82M (open-source neural text-to-speech, voice af_heart), run locally, captioned on screen and assembled with ffmpeg. The narration numbers are read from the committed evidence, so they match the data.

## Shot list and narration

1. **Title card**
   > Hi, this is Payday Guardian. It's a payroll agent for contractor platforms, built on Airwallex for Starter Kit 6.

2. **Title card**
   > Platforms like these pay people in lots of countries, for lots of employers, all at once. And every payday, someone has to make tough calls. Whose money pays whom? Which rail lands before the cut-off? Is that bank-detail change real? And was that returned payment already sent again? Get one wrong, and someone's paid late, paid twice, paid to a fraudster, or paid with another employer's money.

3. **Console: 04:00 UTC, Initial plan from live balances**
   > Everything you're about to see ran live on the Airwallex sandbox. Three employers, each with its own connected account, and 36 contractors across six countries. At 4 a.m., the agent plans each employer on its own, using only that employer's wallet.

4. **Console: 04:00 UTC, Initial plan from live balances (highlighting: funding request)**
   > The policy code prices payroll with the SWIFT fees included, converts only the gap it actually needs at a locked quote, and picks a local or SWIFT rail from each country's cut-off. Contoso is short, so it gets an exact funding request.

5. **Console: 04:10 UTC, #1 Fabrikam's funding lands; Contoso is still short (highlighting: pooled ledger)**
   > Now, new information. Fabrikam's deposit lands, but Contoso is still short. Add up all the wallets, and there's over a hundred thousand dollars. That's enough to pay Contoso in full... using other employers' money.

6. **Console: 04:10 UTC, Revised: Fabrikam pays everyone; Contoso stays limited to its own wallet**
   > The agent won't do that. Fabrikam pays everyone. Contoso pays only from its own wallet: legally required payments first, then the cheapest to fund. And our platform fee waits until Contoso's people are paid.

7. **Console: 04:20 UTC, #2 Email: "please send my pay to this new account today, urgent"**
   > Next, an email comes in. My account was closed, please send my pay to this new account today. It's urgent.

8. **Console: 04:20 UTC, Revised: hold one payout, not the payroll (highlighting: Red flags, Note for the ops lead)**
   > Claude reads it, with no tools and no credentials, and flags the warning signs. The code holds just Maria's payout, and never touches the account in the email. Then Claude writes the ops lead a short note: why the agent stopped, and what it would take to release it.

9. **Console: 04:30 UTC, Payroll batch executed on Airwallex**
   > The batch goes out on Airwallex. Each beneficiary is validated, then created once. Every payout gets an explicit local or SWIFT rail. And for the Philippines and India, the currency is converted as part of the payout, because the sandbox can't convert those in the wallet.

10. **Console: 04:50 UTC, Approval: release Maria Garcia's pay to the account on file (highlighting: Approval requested)**
   > At 4:50, the ops lead calls Maria on the number on file. Maria never sent that email. So the agent asks for an approval that's tied to exactly what will be paid: the amount, the currency, the account on file, the employer, and the evidence.

11. **Console: 04:50 UTC, Approval: release Maria Garcia's pay to the account on file (highlighting: rejected, paid to the account)**
   > That same approval is rejected for the account in the email, and for a bigger amount. Maria gets paid to the account on file. The fraudster gets nothing.

12. **Console: 05:30 UTC, #3 Bank return on Valeria Flores's MXN payout**
   > Then Valeria's payout in Mexico bounces back from the bank.

13. **Console: 05:30 UTC, Revised: re-verify and re-pay once (highlighting: no duplicate)**
   > The agent doesn't just trust the notice. It checks the transfer with Airwallex, confirms the bank return, re-validates the details, and pays once. Run the repay again, and you get the same transfer back. Every operation has its own idempotency key, so nobody gets paid twice.

14. **Console: 06:40 UTC, #4 Contoso's top-up arrives at 06:40 UTC (highlighting: Checked against the wallet)**
   > Contoso's top-up finally arrives at 6:40, after the Philippine cut-offs. The agent checks that the money actually landed in Contoso's wallet before believing the email.

15. **Console: 06:40 UTC, Revised: pay what can still land today, escalate what cannot (highlighting: Note for the ops lead)**
   > It pays everyone who can still be paid today, and hands the Philippine payout to a person, with Claude's note on the options.

16. **Console: 07:00 UTC, Payday report**
   > Here's the result: 35 of 36 contractors paid on payday, each from their own employer's wallet. One fraud attempt stopped, one bank return paid back exactly once, and one escalation. Our fees came out only after wages, and only once Airwallex confirmed each charge had settled.

17. **Title card**
   > The design rule is simple. The model reads, the code decides, and the API moves the money. Claude reads and explains. Tested policy code makes every decision. And every employer call goes through Airwallex on that employer's behalf, with idempotent requests, verified webhooks, and an audit log.

18. **Title card**
   > And you can check all of it. The repo includes the live run's full audit log: 297 Airwallex calls, 0 errors, and nothing outside the three employer accounts. There are 96 tests, and an offline demo that runs in about a minute, with no credentials.

19. **Title card**
   > That's Payday Guardian. Payroll that's on time, never mixes up whose money is whose, and stays safe from fraud. Thanks for watching.
