export type BookingErrorCode =
  | "SLOT_TAKEN"
  | "NOT_FOUND"
  | "HOLD_USED"
  | "POLICY"
  | "INVALID_STATE";

export class BookingError extends Error {
  constructor(public readonly code: BookingErrorCode, message: string) {
    super(message);
    this.name = "BookingError";
  }
}

export class SlotTakenError extends BookingError {
  constructor() {
    super("SLOT_TAKEN", "Sorry, that time was just taken. Please choose another.");
  }
}

/** Postgres exclusion_violation. Works for node-postgres and PGlite errors, wrapped or not. */
export function isExclusionViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23P01" || e?.cause?.code === "23P01";
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
