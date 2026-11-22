# Changelog

Newest first. Dates are 2026.

## 22 Nov: hardening and handover
- Content Security Policy with per-request nonce, HSTS, frame, referrer and permissions headers
- Cloudflare Turnstile on checkout and the contact form; same-origin check on public POST routes
- Fixed four high-severity dependency advisories (drizzle-orm, postcss, zod); CI runs `pnpm audit`
- Privacy requests: find a person, export all their data, anonymise; daily retention clean-up in the cron job
- Production database migration runner (`pnpm db:migrate`)
- Nightly encrypted backup workflow, restore script, Netlify config, Dependabot
- Phase 2 extension stubs: video provider, storage, shared design tokens
- README, HANDOVER, RUNBOOK, ADMIN-GUIDE, PHASE-1-REPORT, PHASE-2-READINESS

## 22 Nov: automatic emails
- Confirmations, reminders (24 h and 2 h), moved, cancelled, refund, "did not go ahead", contact form, clinic alerts
- Outbox with retries, once-only sending, editable templates in admin, signed manage links

## 22 Nov: admin dashboard
- Staff sign-in with password and authenticator app, roles and permissions, audit log
- Dashboard, appointments, walk-ins, services and prices, doctors' hours, closed days, content, settings, staff, export

## 22 Nov: public website
- All pages, booking wizard, manage page, contact form, cookie banner, SEO, local development database

## 22 Nov: booking engine and payments
- Slot engine, holds, no-double-booking database rule, confirm, cancel, reschedule
- Stripe checkout, idempotent webhook, refunds, pay at clinic, cleanup of abandoned checkouts

## 22 Nov: foundation
- Monorepo, database schema, seed data, Irish public holidays, time and money helpers
