import { describe, expect, it } from "vitest";
import { sellAmountFor, toMajor, toMinor } from "../src/policy/money.ts";

describe("money", () => {
  it("round-trips major and minor units", () => {
    expect(toMinor("1234.5", "USD")).toBe(123450n);
    expect(toMinor(1234.5, "USD")).toBe(123450n);
    expect(toMajor(123450n, "USD")).toBe("1234.50");
    expect(toMinor("1500", "JPY")).toBe(1500n);
    expect(toMajor(1500n, "JPY")).toBe("1500");
    expect(toMajor(-5n, "EUR")).toBe("-0.05");
  });

  it("rejects more precision than the currency allows", () => {
    expect(() => toMinor("10.001", "USD")).toThrow();
    expect(() => toMinor("10.5", "JPY")).toThrow();
    expect(toMinor("10.100", "USD")).toBe(1010n);
  });

  it("rounds conversion cost up so the bought amount is always covered", () => {
    expect(sellAmountFor(toMinor("100", "EUR"), "EUR", "USD", "1.08")).toBe(toMinor("108", "USD"));
    // 0.01 EUR at 1.085 = 0.01085 USD, which must round up to 0.02
    expect(sellAmountFor(1n, "EUR", "USD", "1.085")).toBe(2n);
    // Across exponents: 10,000 JPY at 0.0066 USD/JPY = 66.00 USD
    expect(sellAmountFor(10000n, "JPY", "USD", "0.0066")).toBe(6600n);
    expect(sellAmountFor(0n, "EUR", "USD", "1.08")).toBe(0n);
  });
});
