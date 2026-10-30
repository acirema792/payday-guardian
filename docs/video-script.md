# Demo video

**Watch:** https://youtu.be/jE588gNmAYU (4:45, Unlisted). Recorded from the live run in [docs/evidence](evidence/): Airwallex sandbox (three Kit 6 connected accounts) and Metal testnet.

Frames are the real console (`npm run console`, `?run=live`) and five title cards, rendered at 1920×1080 with headless Chrome. The narration is Kokoro-82M (open-source neural text-to-speech, voice af_heart), run locally, captioned on screen and assembled with ffmpeg. The narration numbers are read from the committed evidence, so they match the data.

## Shot list and narration

1. **Title card**
   > Hi, this is Payday Guardian. It's a payroll agent for contractor platforms, built on Airwallex for Starter Kit 6.

2. **Title card**
   > Platforms like these pay people in lots of countries, for lots of employers, all at once. Every payday, someone decides whose money pays whom, which rail lands before the cut-off, and whether a bank-detail change is real. Get one wrong, and someone's paid late, paid twice, or paid to a fraudster.

3. **Console: 2026-11-06T04:00:00.000Z UTC, Initial plan from live balances**
   > Everything you're about to see ran live on the Airwallex sandbox: three employers, each with its own connected account, and 36 contractors in six countries. The agent plans each employer from its own wallet.

4. **Console: 2026-11-06T04:00:00.000Z UTC, Initial plan from live balances (highlighting: funding request)**
   > Policy code prices in the SWIFT fees, converts only the gap at a locked quote, and picks each rail from the local cut-off. Contoso is short, so it gets an exact funding request.

5. **Console: 2026-11-06T04:10:00.000Z UTC, #1 Fabrikam's funding lands; Contoso is still short (highlighting: pooled ledger)**
   > Now, new information. Fabrikam's deposit lands, but Contoso is still short. Add up all the wallets, and there's over a hundred thousand dollars. That's enough to pay Contoso in full... using other employers' money.

6. **Console: 2026-11-06T04:10:00.000Z UTC, Revised: Fabrikam pays everyone; Contoso stays limited to its own wallet**
   > The agent won't do that. Fabrikam pays everyone. Contoso pays only from its own wallet: legally required payments first, then the cheapest to fund. And our platform fee waits until Contoso's people are paid.

7. **Console: 2026-11-06T04:20:00.000Z UTC, #2 Email: "please send my pay to this new account today, urgent"**
   > Next, an email comes in. My account was closed, please send my pay to this new account today. It's urgent.

8. **Console: 2026-11-06T04:20:00.000Z UTC, Revised: hold one payout, not the payroll (highlighting: Red flags, Note for the ops lead)**
   > Claude reads it, with no tools and no credentials, and flags the warning signs. Code holds just Maria's payout and never touches the account in the email. Claude writes the ops lead a short note: why, and what would release it.

9. **Console: 2026-11-06T04:30:00.000Z UTC, Payroll batch executed on Airwallex**
   > The batch goes out on Airwallex. Each beneficiary is validated, then created once, and every payout gets an explicit local or SWIFT rail.

10. **Console: 2026-11-06T04:50:00.000Z UTC, Approval: release Maria Garcia's pay to the account on file (highlighting: Approval requested)**
   > At 4:50, the ops lead calls Maria on the number on file. She never sent that email. So the agent asks for an approval tied to exactly what will be paid: amount, currency, account on file, employer, and evidence.

11. **Console: 2026-11-06T04:50:00.000Z UTC, Approval: release Maria Garcia's pay to the account on file (highlighting: rejected, paid to the account)**
   > That same approval is rejected for the account in the email, and for a bigger amount. Maria gets paid to the account on file. The fraudster gets nothing.

12. **Console: 2026-11-06T05:30:00.000Z UTC, #3 Bank return on Valeria Flores's MXN payout**
   > Then Valeria's payout in Mexico bounces back from the bank.

13. **Console: 2026-11-06T05:30:00.000Z UTC, Revised: re-verify and re-pay once (highlighting: no duplicate)**
   > The agent doesn't just trust the notice. It confirms the return with Airwallex, re-validates the details, and pays once. Run the repay again, and you get the same transfer back.

14. **Console: 2026-11-06T06:40:00.000Z UTC, #4 Contoso's top-up arrives at 06:40 UTC (highlighting: Checked against the wallet)**
   > Contoso's top-up finally arrives at 6:40, after the Philippine cut-offs. The agent checks that the money actually landed in Contoso's wallet before believing the email.

15. **Console: 2026-11-06T06:40:00.000Z UTC, Revised: pay what can still land today, escalate what cannot (highlighting: Note for the ops lead)**
   > It pays everyone who can still be paid today. Andrea's Philippine payout can't land until the next window, so Claude's note offers the ops lead a choice: wait, or send an instant advance on Metal.

16. **Console: 2026-11-06T06:45:00.000Z UTC, Approval: instant advance for Andrea Cruz on Metal testnet (highlighting: opted in, Approval requested, Approved by)**
   > Andrea opted in weeks ago, through the verified portal. The ops lead approves fifty dollars now, bound to that exact amount and address. Contoso pays it from its own Metal account, under a mandate that can only pay Andrea, at most fifty dollars.

17. **Console: 2026-11-06T06:45:00.000Z UTC, Approval: instant advance for Andrea Cruz on Metal testnet (highlighting: Probe, Paid 50.00, already paid, remaining)**
   > This ran on Metal testnet. Metal itself refuses an address that isn't on the mandate, and one cent over the cap. Then it pays Andrea, and the same payment sent again pays nothing. The rest goes out in the next Philippine window.

18. **Console: 2026-11-06T07:00:00.000Z UTC, Payday report**
   > Here's the result: 35 of 36 paid on payday, each from their own employer's wallet. One fraud attempt stopped, one bank return repaid once, and one late payout covered by an instant advance. Our fees came out only after wages, once each charge settled.

19. **Title card**
   > The design rule: the model reads, the code decides, and the API moves the money. Claude reads and explains, tested policy code decides, and money moves only on each employer's own account, on Airwallex and on Metal.

20. **Title card**
   > And you can check all of it. The repo has the live run's audit log: 300 Airwallex calls, 0 errors, nothing outside the three employer accounts, and the Metal payment on the explorer. Plus 111 tests, and an offline demo.

21. **Title card**
   > That's Payday Guardian. Payroll that's on time, never mixes up whose money is whose, and stays safe from fraud. Thanks for watching.
