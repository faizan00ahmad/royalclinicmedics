/** Money is always integer cents in EUR (CLAUDE.md section 4). */
export function assertCents(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Invalid amount in cents: ${value}`);
  }
  return value;
}

export function formatEuro(cents: number): string {
  assertCents(cents);
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);
}
