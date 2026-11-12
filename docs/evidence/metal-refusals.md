# Metal refusals recorded on chain

The committed live run paid Andrea Cruz's USD 50 advance under mandate `0x877be7cb169a3427aeff4f104c76177f1bd77ad9e47575526fe289c3fae1923b` (Contoso Health's Metal account `0xd97e0bbf4cF241F9E1b91E1E18Bf1A650730b34B`, signed by its owner). In that run, the three pulls outside the mandate were refused by `metal-agent` before sending, so they were not on chain.

On 2026-11-12 we sent the same three pulls under the same mandate with `metal-agent mandate pull --record-refusal` (`npm run metal:refusals`). The mandate refused each one on chain, in a transaction that moves nothing. The gas came from a separate key (`0x176D8cBbD3d2783e9d338b1866FBd5d76173891C`, faucet USDZ) with no authority over the account; the agent's mandate key signed, and the owner's key was not used.

| Pull | Refused by the mandate on chain | Transaction |
|---|---|---|
| 50.00 USDZ to 0x0000…dEaD, an address not on the mandate | mandate_payee_not_listed (the payee is not one the mandate allows) | [0x9f74…fc7f](https://testnet.metalntwx.com/tx/0x9f74e41e1ba754188b7cc7199ad5e851603b8e77314afc6714a226538d2cfc7f) |
| 50.01 USDZ to Andrea Cruz, one cent over the cap | mandate_cap_exceeded (the amount is above the mandate's per-payment cap) | [0xf601…db39](https://testnet.metalntwx.com/tx/0xf60195575d846c6cb836c25b10ce92df5fb85c21ce85bd60b6b6013cfca3db39) |
| another 50.00 USDZ to Andrea Cruz under a new payment id | mandate_budget_spent (the amount would take the mandate past its budget) | [0xc997…f4f5](https://testnet.metalntwx.com/tx/0xc9978f5572f3a940822ebd0997128a2a69dd1bb87954d51ac2ecccc59260f4f5) |

Spent under the mandate: 50.00 USDZ before, 50.00 USDZ after; payments 1 before, 1 after.

`metal-agent mandate verify` (checks the chain against the owner's signed mandate): verified yes.

```
payment 0x265f023a9aeebf2913ec893ab92c085b892dcafab53058a69b8632dd22210265 block 18852858: 50 *USDZ to 0xA3aE54Af869eD8769854fa40E5309303F93A31DF, nonce 0x877be7cb169a3427aeff4f108e82a3da9a3b16b950dc90a2e1f96b730fbbf80f
refusal (mandate_payee_not_listed) 0x9f74e41e1ba754188b7cc7199ad5e851603b8e77314afc6714a226538d2cfc7f block 26427453: 50 *USDZ to 0x000000000000000000000000000000000000dEaD, nonce 0x877be7cb169a3427aeff4f10dad6721784c3273f0ec21a16a49dc0921c958d9f
refusal (mandate_cap_exceeded) 0xf60195575d846c6cb836c25b10ce92df5fb85c21ce85bd60b6b6013cfca3db39 block 26427617: 50.01 *USDZ to 0xA3aE54Af869eD8769854fa40E5309303F93A31DF, nonce 0x877be7cb169a3427aeff4f10713232e8a394ffbb73e84591dc854218f0d5f773
refusal (mandate_budget_spent) 0xc9978f5572f3a940822ebd0997128a2a69dd1bb87954d51ac2ecccc59260f4f5 block 26427753: 50 *USDZ to 0xA3aE54Af869eD8769854fa40E5309303F93A31DF, nonce 0x877be7cb169a3427aeff4f100496640c5aa32dfed3716da9fef989ba27914c56
```
