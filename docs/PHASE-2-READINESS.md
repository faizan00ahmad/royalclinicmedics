# Phase 2 readiness

Phase 2 is an independent online consultation platform: secure doctor login, video consultations, clinical notes, patient
records, medical certificates, referral letters and patient access to documents. **None of that is built.** Phase 1 was
structured so it can be added as a second app (`apps/consult`) without rebuilding the website.

## The plan

- Same repository, a second app `apps/consult` at `consult.royalclinicmedics.ie`, sharing `packages/core`, `packages/db`, `packages/auth` and `packages/ui`.
- Same database. Clinical data goes in the **`clinical` schema**, which already exists and is empty. Phase 1 code never reads it. It can later move to its own database without touching Phase 1.
- Phase 2 reuses the same patients, doctors, services and appointments, so nothing is copied.

## The ten extension points (SRS 5.3)

| ID | What | Status | Where |
|---|---|---|---|
| EXT-01 | Appointment mode `IN_CLINIC / VIDEO / PHONE`; per-service `modes`; global switch `features.onlineConsultations` (off) | Done | `packages/db/src/schema/core.ts`; the booking code refuses non-clinic modes while the switch is off |
| EXT-02 | `appointments.consultation_id`, `appointments.external_ref` (empty, nullable) | Done | `core.appointments` |
| EXT-03 | Event outbox: `appointment.confirmed / rescheduled / cancelled / checked_in`, `patient.updated`, `payment.succeeded / refunded`, plus `enquiry.created`, written in the same transaction as the change | Done | `ops.domain_events`, `packages/core/src/booking/events.ts`. Phase 2 reads rows with `processed_at is null` for its own consumer; Phase 1's email sender marks them processed, so Phase 2 should either use its own "processed by" column or read the full history |
| EXT-04 | Booking functions reused by any app: `getAvailability`, `createHold`, `confirmAppointment`, `cancelAppointment`, `rescheduleAppointment`, `findOrCreatePatient` | Done | `packages/core/src/booking/` |
| EXT-05 | Roles and one `can(user, action, resource)`; patient and clinical roles can be added there | Done (roles); single sign-on across sub-domains **not done** | `packages/auth/src/permissions.ts`. Sign-in uses a host-only cookie (`__Host-`), so sharing one login with `consult.` needs a design decision (shared cookie domain vs a token exchange) when Phase 2 starts |
| EXT-06 | `core.patients` holds identity and contact only; a stable `id` everywhere | Done | `core.patients` |
| EXT-07 | Questionnaire stored as versioned JSON (`version: 1`) | Done | `packages/core/src/booking/questionnaire.ts` |
| EXT-08 | Video provider interface (no implementation) | Done | `packages/core/src/video/provider.ts` |
| EXT-09 | Shared design tokens | Done (colours and font) | `packages/ui`. Components stay in `apps/web` for now; move them to `packages/ui` when a second app needs them |
| EXT-10 | Storage helper with private and public buckets | Interface only; fails clearly if used | `packages/core/src/storage/index.ts` |

## Before building Phase 2

1. **Legal and clinical:** a Data Protection Impact Assessment (health data at scale), the clinic's clinical governance for
   online consultations, and the Irish Medical Council's guidance on remote consultations.
2. **Stronger separation for clinical data:** separate encryption keys, separate database role, access logging for every read.
3. **Storage:** pick a private object store (Cloudflare R2 or similar) and implement `StorageService`; signed, short-lived links only.
4. **Video:** pick a provider (for example Daily.co), implement `VideoProvider`, decide recording policy.
5. **Patient login:** passwordless email link or code; add the `PATIENT` role.
6. **Shared login with the website:** see EXT-05 above.
7. **Phase 1 changes it will need:** switch `features.onlineConsultations` on from a Phase 2 settings screen (it is deliberately not editable in Phase 1 admin), add a mode choice to the booking wizard (the code already carries the mode), and add the consultation link to the confirmation and reminder emails.
