import { schema } from "@rmc/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db-types";
import { emitEvent } from "./events";

export const patientInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().min(6).max(30),
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  eircode: z.string().trim().max(10).optional(),
  medicalCard: z.boolean().default(false),
  guardianName: z.string().trim().max(160).optional(),
  marketingOptIn: z.boolean().default(false),
});
export type PatientInput = z.input<typeof patientInput>;

/**
 * Staff may book a walk-in who has no email. The public booking routes still validate with `patientInput`
 * (a real email is required) before anything reaches findOrCreatePatient.
 */
export const staffPatientInput = patientInput.extend({ email: z.union([z.literal(""), patientInput.shape.email]) });

/** EXT-04. Matches on name + date of birth + email so family members sharing an email stay separate. */
export async function findOrCreatePatient(tx: Database, raw: z.input<typeof staffPatientInput>): Promise<{ id: string; created: boolean }> {
  const p = staffPatientInput.parse(raw);
  const [existing] = await tx
    .select({ id: schema.patients.id })
    .from(schema.patients)
    .where(and(
      sql`lower(${schema.patients.firstName}) = ${p.firstName.toLowerCase()}`,
      sql`lower(${schema.patients.lastName}) = ${p.lastName.toLowerCase()}`,
      eq(schema.patients.dob, p.dob),
      sql`lower(${schema.patients.email}) = ${p.email}`,
      isNull(schema.patients.deletedAt),
      isNull(schema.patients.mergedIntoId),
    ))
    .limit(1);

  if (existing) {
    await tx.update(schema.patients)
      .set({
        phone: p.phone,
        addressLine1: p.addressLine1 ?? null,
        addressLine2: p.addressLine2 ?? null,
        city: p.city ?? null,
        eircode: p.eircode ?? null,
        medicalCard: p.medicalCard,
        guardianName: p.guardianName ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.patients.id, existing.id));
    return { id: existing.id, created: false };
  }

  const [row] = await tx.insert(schema.patients).values({
    firstName: p.firstName,
    lastName: p.lastName,
    dob: p.dob,
    email: p.email,
    phone: p.phone,
    addressLine1: p.addressLine1 ?? null,
    addressLine2: p.addressLine2 ?? null,
    city: p.city ?? null,
    eircode: p.eircode ?? null,
    medicalCard: p.medicalCard,
    guardianName: p.guardianName ?? null,
    marketingOptIn: p.marketingOptIn,
  }).returning({ id: schema.patients.id });
  await emitEvent(tx, { type: "patient.updated", aggregateType: "patient", aggregateId: row!.id, payload: { created: true } });
  return { id: row!.id, created: true };
}
