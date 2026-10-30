import { describe, expect, it } from "vitest";
import { parseLines, parsePull } from "../src/metal/cli.ts";
import { OfflineMetal } from "../src/metal/offline.ts";

const andrea = "0xa0000000000000000000000000000000000000c2";
const rail = () =>
  new OfflineMetal({ employerId: "emp_b", account: "0xc0000000000000000000000000000000000000b2", balanceMinor: 10000n, payees: [andrea], capMinor: 5000n, budgetMinor: 5000n, optIns: {} });

describe("offline Metal account under a mandate", () => {
  it("refuses an unlisted payee, an amount over the cap, and a payment past the budget, sending nothing", async () => {
    const metal = rail();
    expect(await metal.pull("0x000000000000000000000000000000000000dEaD", 100n, "p1")).toMatchObject({ outcome: "refused", sent: false, reason: expect.stringMatching(/^mandate_payee_not_listed/) });
    expect(await metal.pull(andrea, 5001n, "p2")).toMatchObject({ outcome: "refused", reason: expect.stringMatching(/^mandate_cap_exceeded/) });
    expect(await metal.pull(andrea, 5000n, "p3")).toMatchObject({ outcome: "paid", again: false });
    expect(await metal.pull(andrea, 100n, "p4")).toMatchObject({ outcome: "refused", reason: expect.stringMatching(/^mandate_budget_spent/) });
    expect((await metal.status()).spentMinor).toBe(5000n);
  });

  it("pays a payment id at most once and refuses to reuse it for another payment", async () => {
    const metal = rail();
    const first = await metal.pull(andrea, 2500n, "same");
    const again = await metal.pull(andrea, 2500n, "same");
    expect(again).toEqual({ ...first, again: true });
    await expect(metal.pull(andrea, 2600n, "same")).rejects.toThrow(/another payment/);
    expect((await metal.status()).payments).toBe(1);
  });
});

describe("metal-agent output parsing", () => {
  it("reads a paid pull", () => {
    const out = "transaction 0xabc\noutcome paid\nspent 50.00 *USDZ of 50.00 *USDZ\npayer 0xc0\npayee 0xa0\namount 50.00 *USDZ\nexplorer https://testnet.metalntwx.com/tx/0xabc\ngas 91000\n";
    expect(parsePull(out)).toEqual({ outcome: "paid", transaction: "0xabc", explorer: "https://testnet.metalntwx.com/tx/0xabc", spentMinor: 5000n, again: false });
  });

  it("reads a repeated pull as the same payment", () => {
    const out = "already paid, nothing sent\ntransaction 0xabc\noutcome paid\nspent 50.00 *USDZ of 50.00 *USDZ\n";
    expect(parsePull(out)).toMatchObject({ outcome: "paid", transaction: "0xabc", again: true });
  });

  it("reads a refusal that was not sent", () => {
    const out = "outcome refused, not sent\nreason mandate_cap_exceeded (the amount is above the mandate's per-payment cap)\nrecorded no\n";
    expect(parsePull(out)).toEqual({ outcome: "refused", sent: false, reason: "mandate_cap_exceeded (the amount is above the mandate's per-payment cap)" });
  });

  it("fails loudly when no outcome is printed", () => {
    expect(() => parsePull("error: the facilitator did not answer\n")).toThrow(/facilitator did not answer/);
  });

  it("collects repeated keys in order", () => {
    const out = parseLines("payee 0x1 Andrea\npayee 0x2\nbound yes\n");
    expect(out.all("payee")).toEqual(["0x1 Andrea", "0x2"]);
    expect(out.get("bound")).toBe("yes");
  });
});
