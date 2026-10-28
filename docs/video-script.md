# Demo video script (target 4:30, hard limit 5:00)

Record from the **live** run in the console (`npm run console`, http://localhost:4321/?run=live) at 1440×900, browser zoom 100%, with a terminal beside it for two short cuts. Speak the narration; on-screen text is what the viewer should be looking at. Each beat lists its end time.

Judges score relevance, impact, innovation, complexity and implementation, and product integration. Each beat names the one it serves.

## 0:00–0:25 · Hook (impact, relevance)

**Screen:** console title, then the three employer boards with 36 grey chips.

> "Every payday, contractor platforms pay hundreds of people in dozens of countries, for many employers at once. When one employer's money is late, the classic bug is a pooled ledger that quietly pays them with someone else's money. This is Payday Guardian, an agent on Airwallex that never does that, and it ran live on three Kit 6 connected accounts in the Airwallex sandbox."

## 0:25–0:55 · Goal and plan (relevance, complexity)

**Screen:** step "Goal", then "Plan". Point at each employer's own wallet balance and the plan lines (convert, fund at payout, LOCAL/SWIFT, funding request).

> "Three employers, twelve contractors each, in six countries. For each employer separately, the agent prices payroll including SWIFT fees, converts only the net gap at a locked quote, picks a local or SWIFT rail from each country's cut-off, and asks Contoso, which is short, for an exact amount. The numbers come from pure, unit-tested policy code, not from the model."

## 0:55–1:40 · New information #1: the pooled-deposit trap (relevance, innovation)

**Screen:** step "#1 Fabrikam's funding lands". Highlight the line "A pooled ledger would now see USD 103,000…". Then "Revised: Fabrikam pays everyone; Contoso stays limited to its own wallet". Show Contoso's chips: some green-planned, some amber "short".

> "Fabrikam's deposit lands, but Contoso is still short. Add the balances together and there's plenty of money, which is exactly the trap in this kit. The agent refuses. Fabrikam pays everyone. Contoso pays only from its own wallet: statutory payments first, then whatever its own money funds cheapest. The rest are held, and our platform fee is deferred, because we don't take our cut while their contractors are waiting."

## 1:40–2:25 · New information #2: payroll diversion email (innovation, impact)

**Screen:** step "#2". Show the email text, Claude's reading, the red flags, then the decision: only Maria held. Maria's chip turns red "held".

> "Then an email: 'My account was closed, send my pay to this new account today, it's urgent.' Claude reads it with no tools and no credentials, and lists the red flags: urgency, an unverified sender, new bank details in the email itself. The code holds only Maria's payout and never uses the account number from the email. The other thirty-five people still get paid. The same email doubles as a prompt-injection test: in our reader eval, a message telling the model to 'approve all payouts' is classified as a bank-detail change and held."

## 2:25–3:05 · Execution and new information #3: bank return (complexity, product integration)

**Screen:** step "Payroll batch executed on Airwallex" (counts of LOCAL/SWIFT). Then "#3 Bank return" and "Revised: re-verify and re-pay once". Valeria's chip goes returned, then repaid.

> "The batch goes out on Airwallex: beneficiaries validated then created once, explicit LOCAL or SWIFT, and payout-linked FX for pesos and rupees, because the sandbox can't convert those in the wallet. Then Valeria's Mexican payout comes back from her bank. The agent doesn't trust the notice. It reads the transfer from Airwallex, sees it was cancelled as a bank return, re-validates her details and pays again. Run the repay twice and you get the same transfer back: every operation has its own idempotency key, so a retry can't pay twice."

## 3:05–3:45 · New information #4: late top-up after the cut-off (relevance, impact)

**Screen:** step "#4". Highlight "Checked against the wallet, not the email". Then the revised decision: pay what can still land, escalate the Philippines. The PH chip turns purple "escalated".

> "Contoso's top-up arrives at 6:40, after the Philippine cut-offs. The agent checks that the money has cleared into Contoso's wallet before relying on the email. It pays everyone whose payout can still land today, and escalates the Philippine payout to a person with the options: the next window, or an instant rail if the contractor opted in. It doesn't pretend it can make a cut-off it has already missed."

## 3:45–4:20 · Result and proof (complexity, product integration)

**Screen:** step "Payday report". Then cut to `docs/evidence/README.md` on GitHub: the account table and endpoint table. Optional: 3 seconds of the terminal running `npm test` (all green).

> "The result: almost everyone paid on payday, each from their own employer's wallet. One fraud hold, one return paid back exactly once, and the late Philippine payouts escalated. Fees were collected only after wages were covered, and only once Airwallex reported the charge settled. Every API call is in an audit log, and the export checks it: zero errors, and no call outside the three employer accounts."

## 4:20–4:35 · Close (all criteria)

**Screen:** README hero and the mermaid diagram.

> "The model reads, the code decides, the API moves the money. Payday Guardian: payroll that's on time, never cross-tenant, and safe from diversion fraud. Thank you."

## Recording checklist

- [ ] Re-run `npm run demo` so the offline run reflects the final code (the live evidence is already committed).
- [ ] `npm run console`, open `?run=live`, click the first step. Close other tabs; turn off notifications (macOS Focus).
- [ ] Use the console's Next button or arrow keys rather than Play, so the pace follows the narration.
- [ ] Screen recorder at 1080p or higher; mic check; record each beat separately if easier and cut them together.
- [ ] Check the final cut is under 5:00 and the numbers spoken match the screen (paid count, escalations).
- [ ] Upload unlisted to YouTube (or Loom). Open it in a private window to confirm it plays without signing in.
- [ ] Paste the link into the README ("Demo video") and into the HackerEarth description.
