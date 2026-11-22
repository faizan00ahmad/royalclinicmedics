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
- [ ] Layout, sticky header/mobile bar [WEB-00]; Home, About, Services, Service details, Prices, FAQs, Contact, legal [WEB-01..09]
- [ ] Cookie consent + GA4 consent mode [WEB-13, WEB-16]; SEO [WEB-14]; reviews [WEB-17]

## M3 Booking and payments
- [x] Booking core: availability, holds, confirm, cancel, reschedule, patients, outbox events (BK-01..04, BK-20..23, BK-30..33, EXT-03, EXT-04)
- [ ] Slot engine + DST tests [BK-10..15]; holds/locks [BK-20..23]; wizard [BK-01..09]; questionnaire [BK-40..42]
- [ ] Stripe + webhook [PAY-01..09]; emails + reminders [N-01..N-11]; manage links [BK-30..33]; outbox [EXT-03]

## M4 Admin
- [ ] Auth + TOTP [SEC-02]; can() [EXT-05]; AD-01..AD-14

## M5 Testing and launch
- [ ] E2E, Lighthouse, security, backup restore, Netlify deploy, handover docs [Sec 14, 12]
