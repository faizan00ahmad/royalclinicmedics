import { schema } from "@rmc/db";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db-types";
import { BookingError } from "./errors";

const PAGE_KEY = { TERMS: "terms", PRIVACY: "privacy", CANCELLATION: "cancellation" } as const;

export interface ConsentInput {
  appointmentId: string;
  ip?: string;
  terms: boolean;
  privacy: boolean;
  cancellation: boolean;
  marketing?: boolean;
}

/**
 * BK-07, GDPR-02. Stores which version of each document was accepted, when, and from which IP.
 * Terms, privacy and cancellation are mandatory; marketing is optional.
 */
export async function recordConsents(db: Database, input: ConsentInput): Promise<void> {
  if (!input.terms || !input.privacy || !input.cancellation) {
    throw new BookingError("POLICY", "Terms, privacy policy and cancellation policy must be accepted");
  }
  await db.transaction(async (tx) => {
    const [appt] = await tx.select({ patientId: schema.appointments.patientId })
      .from(schema.appointments).where(eq(schema.appointments.id, input.appointmentId));
    if (!appt) throw new BookingError("NOT_FOUND", "Appointment not found");

    const versionOf = async (key: string) => {
      const [r] = await tx.select({ v: sql<number>`coalesce(max(${schema.pages.version}), 1)::int` })
        .from(schema.pages).where(eq(schema.pages.key, key));
      return String(r?.v ?? 1);
    };

    const rows = [
      ...(["TERMS", "PRIVACY", "CANCELLATION"] as const).map(async (type) => ({
        type, documentVersion: await versionOf(PAGE_KEY[type]),
      })),
      ...(input.marketing ? [Promise.resolve({ type: "MARKETING" as const, documentVersion: "1" })] : []),
    ];
    const resolved = await Promise.all(rows);
    await tx.insert(schema.consents).values(resolved.map((r) => ({
      patientId: appt.patientId, appointmentId: input.appointmentId, type: r.type,
      documentVersion: r.documentVersion, ip: input.ip ?? null,
    })));
    if (input.marketing) {
      await tx.update(schema.patients).set({ marketingOptIn: true }).where(eq(schema.patients.id, appt.patientId));
    }
  });
}
