// Money is integer sen everywhere. These helpers only format and convert, never use floats.

/** A Postgres bigint read by Prisma, as a number of sen. Throws if it cannot be exact. */
export function senFromBigInt(value: bigint): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new Error("Amount out of range");
  }
  return Number(value);
}

/** 150050 -> 'RM 1,500.50'. */
export function formatSen(sen: number): string {
  const sign = sen < 0 ? "-" : "";
  const abs = Math.abs(sen);
  const ringgit = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}RM ${ringgit}.${String(abs % 100).padStart(2, "0")}`;
}

/** 150050 -> '1,500.50', for pre-filling an amount input. */
export function senToRinggitInput(sen: number): string {
  return formatSen(sen).replace(/^-?RM /, "");
}
