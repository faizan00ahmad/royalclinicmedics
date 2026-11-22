/**
 * EXT-05, SEC-03. One function decides every permission. Every server action calls can().
 * Phase 2 adds a PATIENT role and clinical permissions here, without touching callers.
 */
export type Role = "ADMIN" | "RECEPTIONIST" | "DOCTOR";

export type Action =
  | "dashboard:read"
  | "appointments:read" | "appointments:write" | "appointments:questionnaire"
  | "walkin:create"
  | "payments:markPaid" | "payments:refund"
  | "patients:read"
  | "services:write"
  | "doctors:write"
  | "schedules:write" | "schedules:writeOwn"
  | "content:write"
  | "enquiries:read" | "enquiries:write"
  | "settings:write"
  | "staff:write"
  | "export:run"
  | "privacy:manage" // find a person, export or anonymise their data (GDPR-04). Administrators only.
  | "audit:read";

const RECEPTIONIST: Action[] = [
  "dashboard:read", "appointments:read", "appointments:write", "appointments:questionnaire", "walkin:create", "payments:markPaid", "patients:read",
  "schedules:write", "content:write", "enquiries:read", "enquiries:write",
];

// SRS section 2: doctors see their own schedule, appointments and booking questionnaires, and can block their own time.
const DOCTOR: Action[] = ["dashboard:read", "appointments:read", "appointments:questionnaire", "schedules:writeOwn"];

export interface Principal {
  id: string;
  role: Role;
  /** The doctors.id this login belongs to, for DOCTOR users. */
  doctorId?: string | null;
}

export interface Resource {
  /** The doctor an appointment or schedule belongs to. */
  doctorId?: string | null;
}

/** ADMIN may do everything. */
export function can(user: Principal | null | undefined, action: Action, resource: Resource = {}): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const allowed = user.role === "RECEPTIONIST" ? RECEPTIONIST : DOCTOR;
  if (!allowed.includes(action)) return false;
  if (user.role === "DOCTOR") {
    // Doctors only ever touch their own rows.
    if (!user.doctorId) return false;
    if (action === "dashboard:read") return true;
    return resource.doctorId === user.doctorId;
  }
  return true;
}

export class ForbiddenError extends Error {
  constructor(public readonly action: Action) {
    super("You do not have permission to do that.");
  }
}

export function assertCan(user: Principal | null | undefined, action: Action, resource: Resource = {}): asserts user is Principal {
  if (!can(user, action, resource)) throw new ForbiddenError(action);
}
