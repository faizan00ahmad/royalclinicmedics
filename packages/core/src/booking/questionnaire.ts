import { z } from "zod";

/** EXT-07: versioned so Phase 2 can import answers into the consultation record. */
export const QUESTIONNAIRE_VERSION = 1;

export const CONDITIONS = ["DIABETES", "HEART_DISEASE", "ASTHMA", "PREGNANCY", "OTHER"] as const;

/** BK-40. Basic questions for every booking. Stored with the appointment, never emailed or logged (SEC-07). */
export const basicQuestionnaire = z.object({
  symptoms: z.string().trim().max(1000).default(""),
  allergies: z.object({ has: z.boolean(), details: z.string().trim().max(500).optional() }),
  medications: z.string().trim().max(1000).default(""),
  conditions: z.array(z.enum(CONDITIONS)).max(CONDITIONS.length).default([]),
  conditionsOther: z.string().trim().max(300).optional(),
  smoker: z.boolean(),
  notes: z.string().trim().max(1000).optional(),
}).strict();

export type BasicQuestionnaire = z.infer<typeof basicQuestionnaire>;

export function parseQuestionnaire(raw: unknown): { version: number } & BasicQuestionnaire {
  return { version: QUESTIONNAIRE_VERSION, ...basicQuestionnaire.parse(raw) };
}
