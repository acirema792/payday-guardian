# Demo video

**Watch:** https://youtu.be/jE588gNmAYU (4:45, Unlisted). Recorded from the live run in [docs/evidence](evidence/): Airwallex sandbox (three Kit 6 connected accounts) and Metal testnet.

Frames are the real console (`npm run console`, `?run=live`) and title cards, rendered at 1920×1080 with headless Chrome. The narration is Kokoro-82M (open-source neural text-to-speech, voice af_heart), run locally, captioned on screen and assembled with ffmpeg. The narration numbers are read from the committed evidence, so they match the data.

## Shot list and narration

1. **Console: 2026-11-06T04:50:00.000Z UTC, Approval: release Maria Garcia's pay to the account on file (highlighting: rejected, paid to the account)**
   > An email asked to send Maria's pay to a new account. A person approved her account on file instead, so for the email's account, the approval is rejected. This is Payday Guardian, a payroll agent on Airwallex.

2. **Title card**
   > Contractor platforms pay many people, for many employers, every payday. Each payout asks: whose money, which rail beats the cut-off, and is this request real?

3. **Console: 2026-11-06T04:00:00.000Z UTC, Initial plan from live balances**
   > Everything you'll see ran live on the Airwallex sandbox: three employers, each with its own connected account, and 36 contractors in six countries. The audit log of every call is in the repo.

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
   > Back to Maria. The ops lead calls her on the number on file; she never sent that email. The agent asks for an approval tied to the exact amount, currency, account, employer, and evidence.

11. **Console: 2026-11-06T04:50:00.000Z UTC, Approval: release Maria Garcia's pay to the account on file (highlighting: rejected, paid to the account)**
   > That's the approval from the start: it fails for the email's account, and for a bigger amount. Maria is paid to the account on file. The fraudster gets nothing.

12. **Console: 2026-11-06T05:30:00.000Z UTC, #3 Bank return on Valeria Flores's MXN payout**
   > Then Valeria's payout in Mexico bounces back from the bank.

13. **Console: 2026-11-06T05:30:00.000Z UTC, Revised: re-verify and re-pay once (highlighting: no duplicate)**
   > The agent doesn't just trust the notice. It confirms the return with Airwallex, re-validates the details, and pays once. Run the repay again, and you get the same transfer back.

14. **Console: 2026-11-06T06:40:00.000Z UTC, #4 Contoso's top-up arrives at 06:40 UTC (highlighting: Checked against the wallet)**
   > Contoso's top-up finally arrives at 6:40, after the Philippine cut-offs. The agent checks that the money actually landed in Contoso's wallet before believing the email.

15. **Console: 2026-11-06T06:40:00.000Z UTC, Revised: pay what can still land today, escalate what cannot (highlighting: Note for the ops lead)**
   > It pays everyone who can still be paid today. Andrea's Philippine payout can't land until the next window, so Claude's note offers the ops lead a choice: wait, or send an instant advance on Metal.

16. **Console: 2026-11-06T06:45:00.000Z UTC, Approval: instant advance for Andrea Cruz on Metal testnet (highlighting: opted in, Approval requested, Approved by)**
   > Andrea opted in weeks ago, through the verified portal. The ops lead approves fifty dollars, bound to that amount and address, paid from Contoso's own Metal account under a mandate that can only pay Andrea, at most fifty.

17. **Console: 2026-11-06T06:45:00.000Z UTC, Approval: instant advance for Andrea Cruz on Metal testnet (highlighting: Probe, Paid 50.00, already paid, remaining)**
   > This ran on Metal testnet. Metal itself refuses an address that isn't on the mandate, and one cent over the cap. Then it pays Andrea, and the same payment sent again pays nothing. The rest goes out in the next Philippine window.

18. **Console: 2026-11-06T07:00:00.000Z UTC, Payday report (highlighting: Reconciled with Airwallex)**
   > The result: 35 of 36 paid on payday, each from their own employer's wallet, and every payment read back from Airwallex and reconciled to the cent. The last one missed its cut-off and got an instant advance.

19. **Title card**
   > The design rule: the model reads, the code decides, and the API moves the money. Claude reads and explains, tested policy code decides, and money moves only on each employer's own account, on Airwallex and on Metal.

20. **Title card**
   > And you can check all of it. The repo has the live run's audit log: 335 Airwallex calls, 0 errors, nothing outside the three employer accounts, and the Metal payment on the explorer. Plus 115 tests, and an offline demo.

21. **Title card**
   > That's Payday Guardian, for contractor and E O R platforms on Airwallex: on time, never mixing up whose money is whose, and safe from fraud. Thanks for watching.
