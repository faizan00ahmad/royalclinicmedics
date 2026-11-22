# Phase 1 Plan (tasks tagged with SRS IDs)

## M1 Setup and design
- [x] T01 Git init, pnpm, docs/DECISIONS.md
- [ ] T02 Monorepo skeleton: pnpm workspace, Turborepo, shared tsconfig, eslint [CLAUDE §4]
- [ ] T03 packages/config, packages/ui (brand tokens), packages/core, packages/db, packages/auth, packages/emails stubs [EXT-04, EXT-09]
- [ ] T04 apps/web Next.js App Router with Tailwind, home placeholder, /api/health [WEB-11]
- [x] T05 Drizzle schema core/cms/ops + empty clinical, slot_locks exclusion constraint [Sec 7, BK-21, EXT-02, EXT-03, EXT-06]
- [x] T06 Migrations + seed (services, doctor, hours, holidays, FAQs) [BK-15, Sec 4.1 seed]
- [ ] T07 Settings loader, env validation, .env.example [Sec 15]
- [ ] T08 CI workflow (lint, typecheck, test) [SEC-10]
- [ ] T09 docs/M1-REPORT.md

## M2 Website
- [x] Public pages: layout, Home, About, Services, Service details, Prices, FAQs, Contact, legal pages, sitemap, robots, cookie banner, booking wizard, manage page (WEB-00..WEB-14 mostly; GA4 events, Turnstile, email still to do)
- [ ] Layout, sticky header/mobile bar [WEB-00]; Home, About, Services, Service details, Prices, FAQs, Contact, legal [WEB-01..09]
- [ ] Cookie consent + GA4 consent mode [WEB-13, WEB-16]; SEO [WEB-14]; reviews [WEB-17]

## M3 Booking and payments
- [x] API routes: slots, hold, checkout, manage, cancel, reschedule, ics, Stripe webhook, cron (SRS section 8; contact and receipt.pdf pending)
- [x] Booking core: availability, holds, confirm, cancel, reschedule, patients, outbox events (BK-01..04, BK-20..23, BK-30..33, EXT-03, EXT-04)
- [ ] Slot engine + DST tests [BK-10..15]; holds/locks [BK-20..23]; wizard [BK-01..09]; questionnaire [BK-40..42]
- [x] Stripe + webhook, refunds, pay at clinic [PAY-01..05] (discounts PAY-06, PDF receipts PAY-07, GMS PAY-09 still to do)
- [ ] (remaining) Stripe + webhook [PAY-01..09]; emails + reminders [N-01..N-11]; manage links [BK-30..33]; outbox [EXT-03]

## M4 Admin
- [x] Admin: auth, 2FA, roles, dashboard, appointments, walk-ins, services, doctors, hours, closed days, content, settings, staff, export, audit (calendar drag and drop, patient list, rich text still to do)
- [ ] Auth + TOTP [SEC-02]; can() [EXT-05]; AD-01..AD-14

## M5 Testing and launch
- [ ] E2E, Lighthouse, security, backup restore, Netlify deploy, handover docs [Sec 14, 12]
