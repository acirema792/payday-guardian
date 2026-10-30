import { describe, expect, it } from "vitest";
import { planInstantAdvance, type AdvanceInput } from "../src/policy/advance.ts";
import { toMinor } from "../src/policy/money.ts";
import { PAYDAY, contractor } from "./fixtures.ts";

const optIn = { address: "0xa0000000000000000000000000000000000000c2", optedInAt: new Date("2026-10-02T15:00:00Z"), channel: "verified_portal" as const };
const missed = [{ code: "cutoff_missed" as const, detail: "PH cut-off passed" }];

function input(overrides: Partial<AdvanceInput> = {}): AdvanceInput {
  return {
    contractor: contractor({ id: "andrea", employerId: "emp_b", country: "PH", currency: "PHP", amountMinor: toMinor("260000", "PHP") }),
    holdReasons: missed,
    optIn,
    usdRates: { PHP: "0.0175" },
    payday: PAYDAY,
    fraudWindowDays: 5,
    config: { token: "USDZ", maxAdvanceMinor: toMinor("50", "USD") },
    ...overrides,
  };
}

describe("instant advance policy", () => {
  it("offers the capped advance and leaves the rest for the next window, never paying more than the cap", () => {
    const d = planInstantAdvance(input());
    expect(d).toEqual({
      status: "offer",
      address: optIn.address,
      advanceMinor: toMinor("50", "USD"),
      advanceLocalMinor: toMinor("2857.14", "PHP"), // 50 / 0.0175, rounded down
      remainderMinor: toMinor("257142.86", "PHP"),
    });
  });

  it("advances the whole payout when it is below the cap", () => {
    const d = planInstantAdvance(input({ contractor: contractor({ id: "small", employerId: "emp_b", currency: "USD", amountMinor: toMinor("30", "USD") }) }));
    expect(d).toMatchObject({ status: "offer", advanceMinor: toMinor("30", "USD"), remainderMinor: 0n });
  });

  it("never pays around a fraud hold or a funding shortfall", () => {
    const fraud = planInstantAdvance(input({ holdReasons: [...missed, { code: "unverified_instruction_channel", channel: "email" }] }));
    const short = planInstantAdvance(input({ holdReasons: [{ code: "insufficient_funds" }] }));
    expect(fraud.status).toBe("none");
    expect(short.status).toBe("none");
  });

  it("needs an opt-in from the verified portal, older than the fraud window", () => {
    expect(planInstantAdvance(input({ optIn: undefined }))).toMatchObject({ status: "none", reason: expect.stringMatching(/not opted in/) });
    expect(planInstantAdvance(input({ optIn: { ...optIn, channel: "email" } }))).toMatchObject({ status: "none", reason: expect.stringMatching(/by email/) });
    expect(planInstantAdvance(input({ optIn: { ...optIn, optedInAt: new Date("2026-11-05T12:00:00Z") } }))).toMatchObject({ status: "none", reason: expect.stringMatching(/less than 5 days/) });
  });

  it("offers nothing when the employer allows no advance", () => {
    expect(planInstantAdvance(input({ config: { token: "USDZ", maxAdvanceMinor: 0n } })).status).toBe("none");
  });
});
