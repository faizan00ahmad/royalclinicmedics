# Decisions

## 2026-11-22 – Free-tier hosting target
- **Decision:** Develop locally against a Neon free dev branch; deploy on a free host that allows commercial use (first choice Netlify free; fallback Cloudflare Workers free if the OpenNext bundle fits, else Oracle free VM). Scheduled jobs via external pingers (cron-job.org for reminders and hold cleanup, GitHub Actions for nightly backup) calling the secured `/api/cron/*` endpoints. Stripe in test mode and console email until the clinic creates accounts.
- **Reason:** Owner is a beginner and wants everything free. SRS section 6.3 assumed Cloudflare Workers free, but its 3 MB compressed bundle and 10 ms CPU limits are likely too small for Next.js plus Stripe, Auth.js and PDF receipts.
- **Alternatives:** Cloudflare Workers paid ($5/mo); Oracle Cloud free VM with Docker (harder for a beginner); Vercel Hobby (non-commercial, not allowed).
- **Verified 2026-11-22 (re-check before launch):** Netlify free permits commercial use, credit-based (300 credits/month). Workers free: 3 MB compressed, 10 ms CPU. Neon free: 1 GB, 100 CU-hours/month, scale-to-zero after 5 min. Resend free: 100 emails/day, 3,000/month.

## Known limits of the free setup
- Resend: about 25 bookings/day at ~4 emails each. SRS NFR-06 (300/day) needs a paid email plan.
- Neon cold start after 5 min idle adds latency to the first request.
- Netlify credits are shared by all functions; monitor usage.

## 2026-11-22 – Seed data and holidays
- **Decision:** Seed is idempotent and never overwrites admin edits. Irish public holidays are computed in `packages/core/src/holidays.ts` (fixed rules, Easter algorithm) for this and next year. Weekend substitute days are not computed; admin adds them if the clinic closes.
- **Decision:** `modes` columns are `text[]` with a CHECK instead of a Postgres enum array, because Drizzle emits unqualified enum array types for non-public schemas and the migration fails.
- **Decision:** All clinic details, prices, hours and legal text in seed are `[TBD]` placeholders (see docs/TBD.md). Reviews and online consultations are off by default.

## 2026-11-22 – Slot engine rules
- **Decision:** `computeSlots` in `packages/core/src/slots.ts` is a pure function (no DB, no clock). A clinic holiday removes regular hours; a closed override removes everything for that doctor and date; a non-closed override ADDS an extra range and still opens on a holiday. Appointment must end within the working range, but its buffer may run past it. The slot plus its buffer must not overlap busy time or blocked time.
- **Reason:** SRS BK-10..BK-15 left override and holiday precedence open. Admin can still open a holiday by adding extra hours.
- **DST:** ranges are converted from Dublin wall clock to UTC, then stepped in real elapsed minutes. Tests cover 29 Mar and 25 Oct 2026.

## 2026-11-22 – Booking module and package layout
- **Decision:** `@rmc/core` depends on `@rmc/db` (not the reverse). Seed moved to `packages/core/src/seed` so it can use core holidays and default settings. Avoids a circular dependency that Turborepo rejects.
- **Decision:** Hold stays a HOLD lock while the patient pays. The appointment row is created on confirmation (Stripe webhook or pay-at-clinic), converting the lock in place, so the slot is never unprotected. If the hold expired meanwhile, the slot is re-locked if free, else `SlotTakenError` and the caller refunds (BK-23).
- **Decision:** Manage links use a random 32-byte token; only its SHA-256 hash is stored (SEC-04). Booking ref is `RMC-` plus 6 characters without 0/O/1/I.
- **Decision:** Patients are matched on name + date of birth + email, so family members sharing an email stay separate. Patients cannot cancel or reschedule inside the cancellation window; the clinic can.
- **Limits:** repeating time blocks (`recurrence_rule`) are not expanded yet. Availability rules ignore their `modes` column in Phase 1 (only IN_CLINIC is bookable).
- **Test caveat:** PGlite runs one connection, so the "two simultaneous requests" test proves correct outcomes but not true parallel contention. The exclusion-constraint path is exercised by the "hold expired and slot taken" test. A real two-connection test on Neon is still to do.

## 2026-11-22 – Stripe payments
- **Decision:** Online bookings are created as PENDING_PAYMENT before payment (new column `appointments.hold_id`, migration 0002) so the questionnaire and patient details are stored server-side and never sent to Stripe. The webhook confirms the booking. `confirmAppointment` no longer accepts ONLINE; use `startOnlineCheckout`.
- **Decision:** Stripe sits behind a `PaymentGateway` interface (`packages/core/src/payments/gateway.ts`). Tests use a fake. `createStripeGatewayFromEnv` throws if keys are missing.
- **Decision:** Webhook idempotency is three-layered: processed event ids (stored only after success so Stripe retries failures), row locks (`FOR UPDATE`), and state checks. A lost slot after payment cancels the booking and refunds in full (BK-23). A paid amount that differs from the database price is NOT confirmed and is written to the audit log for manual review.
- **Decision:** Cleanup job `expireUnpaidAppointments` cancels unpaid online bookings 30 minutes after the hold expires and cancels the PaymentIntent. A late payment after that is taken then refunded.
- **Decision:** Receipt numbers are `RC-<year>-<6 chars>`. Payment method is recorded as CARD for Stripe payments for now; Apple Pay / Google Pay detection needs the `charge.succeeded` event (to do).
- **To do before launch:** register the domain for Apple Pay in the Stripe dashboard, enable the payment methods, create the webhook endpoint (`/api/webhooks/stripe`, events: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded), and test with the Stripe CLI.

## 2026-11-22 – API routes
- **Decision:** Routes live in `apps/web/src/app/api` and only parse, validate (Zod), rate-limit and call `@rmc/core`. Errors are mapped centrally in `lib/http.ts`; only error names and codes are logged, because database and validation errors can contain patient data. Validation responses return field paths and rule messages, never submitted values.
- **Decision:** The booking manage token is sent in the `x-manage-token` header. Only the ICS download also accepts `?token=` so email links work. Unknown reference and wrong token both return the same 404.
- **Decision:** Checkout requires `terms`, `privacy` and `cancellation` to be exactly `true` before anything is created. Consents are recorded after the booking. A failure there surfaces as a 500 for staff to fix; it does not silently skip consent.
- **Limit:** Rate limiting is in memory per server instance (SEC-06). On Netlify each function instance has its own counter, so it only slows basic abuse. Cloudflare Turnstile on checkout and contact is still to add; the exclusion constraint is the real double-booking protection.
- **Cron:** one job, `POST /api/cron/maintenance` with `Authorization: Bearer $CRON_SECRET`, releases expired holds and cancels abandoned online checkouts. Reminder emails will be added to it with email sending.
- **Not built yet:** `POST /api/contact`, `GET /api/bookings/[ref]/receipt.pdf`, discount codes, Turnstile.

## 2026-11-22 – Website pages and local dev database
- **Decision:** Local development uses `DATABASE_URL=pglite:<folder>`: real Postgres (PGlite) inside the Next.js process, data in `.devdb/` (git-ignored). Create or update it with `pnpm dev:db` (it exits when done; do not run it while the site is running). Refused when `NODE_ENV=production`. A PGlite socket server was tried first and dropped connections (ECONNRESET). No accounts or Docker needed to see and test the site.
- **Decision:** Public pages are server-rendered on demand (`force-dynamic`) from the database via `packages/core/src/content.ts`, so admin edits appear immediately. Caching with revalidation can be added later if Netlify credit use is high.
- **Decision:** Values still marked `[TBD]` are never shown to patients: the phone button becomes "Contact", the map shows a placeholder, doctor bio and IMC number are hidden until real values are entered.
- **Decision:** The manage-booking token travels in the URL fragment (`/booking/RMC-XXXXXX#token=...`) so it is never sent to the server or in Referer headers. Old-style `?token=` links still work. The calendar download link must use `?token=` because it is a plain link.
- **Decision:** Medical card (GMS) patients are asked to phone the clinic (setting `booking.gmsPolicy = ASK_TO_CALL`); ticking the box in the wizard blocks online booking and shows the phone number.
- **Decision:** Cookie banner stores the choice in localStorage for 12 months, loads Google Analytics only after "Accept all" (or an analytics choice), and "Cookie settings" in the footer reopens it. Full GA4 consent mode and the booking events (`begin_booking`, `select_slot`, `begin_checkout`, `booking_confirmed`, `click_to_call`, `contact_submit`) are still to do (WEB-16).
- **Not built yet from the wizard spec:** choosing a doctor (BK-02, only one doctor today; "first available" is used), discount code field (PAY-06), Google and Outlook calendar links (only the .ics file), service-specific questionnaire questions (BK-41), Cloudflare Turnstile, contact email notification and auto-reply (needs email sending).
