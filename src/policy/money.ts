// Money is held as integer minor units (bigint) inside the policy engine.
// Airwallex takes major units, so convert only at the API boundary.

export type Currency = string;

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

export function exponent(currency: Currency): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

// "1234.5" or 1234.5 -> 123450n (USD). Rejects more precision than the currency has.
export function toMinor(major: string | number, currency: Currency): bigint {
  const text = typeof major === "number" ? major.toFixed(exponent(currency)) : major.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Invalid amount "${text}"`);
  const [, sign, whole, frac = ""] = match;
  const exp = exponent(currency);
  if (frac.replace(/0+$/, "").length > exp) throw new Error(`Amount ${text} has more than ${exp} decimals for ${currency}`);
  const minor = BigInt(whole) * 10n ** BigInt(exp) + BigInt((frac + "0".repeat(exp)).slice(0, exp) || "0");
  return sign ? -minor : minor;
}

// 123450n (USD) -> "1234.50", the string form Airwallex accepts for amounts.
export function toMajor(minor: bigint, currency: Currency): string {
  const exp = exponent(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  if (exp === 0) return `${negative ? "-" : ""}${abs}`;
  const scale = 10n ** BigInt(exp);
  return `${negative ? "-" : ""}${abs / scale}.${(abs % scale).toString().padStart(exp, "0")}`;
}

const RATE_SCALE = 10n ** 12n;

function parseRate(rate: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,12}))?$/.exec(rate.trim());
  if (!match) throw new Error(`Invalid rate "${rate}"`);
  const [, whole, frac = ""] = match;
  const scaled = BigInt(whole) * RATE_SCALE + BigInt(frac.padEnd(12, "0"));
  if (scaled === 0n) throw new Error("Rate must be positive");
  return scaled;
}

// How much `sell` currency buys `buyMinor` of `buy` currency, rounded up so the buy side is always covered.
// `rate` is units of sell currency per 1 unit of buy currency (e.g. USD per EUR = "1.08").
export function sellAmountFor(buyMinor: bigint, buy: Currency, sell: Currency, rate: string): bigint {
  if (buyMinor <= 0n) return 0n;
  const numerator = buyMinor * parseRate(rate) * 10n ** BigInt(exponent(sell));
  const denominator = RATE_SCALE * 10n ** BigInt(exponent(buy));
  return (numerator + denominator - 1n) / denominator;
}

// How much `buy` currency `sellMinor` of `sell` currency buys, rounded down so it never exceeds what is paid.
// `rate` is units of sell currency per 1 unit of buy currency, as in sellAmountFor.
export function buyAmountFor(sellMinor: bigint, sell: Currency, buy: Currency, rate: string): bigint {
  if (sellMinor <= 0n) return 0n;
  return (sellMinor * RATE_SCALE * 10n ** BigInt(exponent(buy))) / (parseRate(rate) * 10n ** BigInt(exponent(sell)));
}

export function sum(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}
