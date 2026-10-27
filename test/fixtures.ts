import { toMinor } from "../src/policy/money.ts";
import type { Contractor, Employer, PolicyConfig } from "../src/policy/types.ts";

export const PAYDAY = new Date("2026-11-06T00:00:00Z");
export const MORNING = new Date("2026-11-06T09:00:00Z");

export const config: PolicyConfig = {
  swiftFeeMinor: { EUR: toMinor("12.85", "EUR"), USD: toMinor("15", "USD"), PHP: toMinor("750", "PHP") },
  platformFeeMinor: 0n,
  fraudWindowDays: 5,
  autoApproveConversionMinor: toMinor("5000", "USD"),
  rails: {
    US: { localCurrency: "USD", localAvailable: true, localCutoffUtc: "21:00", swiftCutoffUtc: "20:00" },
    GB: { localCurrency: "GBP", localAvailable: true, localCutoffUtc: "15:00", swiftCutoffUtc: "14:00" },
    DE: { localCurrency: "EUR", localAvailable: false, swiftCutoffUtc: "14:00" },
    PH: { localCurrency: "PHP", localAvailable: true, localCutoffUtc: "06:00", swiftCutoffUtc: "05:00" },
  },
};

export const employerA: Employer = { employerId: "emp_a", name: "Northwind Labs", accountId: "acct_A", fundingCurrency: "USD" };
export const employerB: Employer = { employerId: "emp_b", name: "Contoso Health", accountId: "acct_B", fundingCurrency: "USD" };
export const employerC: Employer = { employerId: "emp_c", name: "Fabrikam Studio", accountId: "acct_C", fundingCurrency: "USD" };

export function contractor(partial: Partial<Contractor> & Pick<Contractor, "id" | "employerId">): Contractor {
  return {
    name: partial.id,
    country: "US",
    currency: "USD",
    amountMinor: toMinor("1000", "USD"),
    priority: "standard",
    ...partial,
  };
}
