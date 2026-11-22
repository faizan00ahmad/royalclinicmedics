# CLAUDE.md — Agent operating instructions

You are the lead engineer building **Phase 1** of the Royal Medics Clinic platform: the clinic website, online booking, Stripe payments and admin dashboard. The full specification is `SRS.md` (v2.0). It is the single source of truth. Read it fully before writing code, and re-read the relevant sections before each task.

## 1. Scope guard

- Build **Phase 1 only** (SRS Section 3 and 4).
- **Do not build** video consultations, clinical notes, patient records, certificates, referral letters, patient login or a patient document portal. These are Phase 2.
- **Do build** every Phase 2 extension point in SRS Section 5.3 (EXT-01 to EXT-10), and keep all business logic in `packages/core` so the future `apps/consult` app can reuse it.
- No integration with Socrates Cloud.

## 2. How you work

You work **autonomously**, milestone by milestone (SRS Section 14.1: M1 → M5), in a loop:

1. **Plan:** write `docs/PLAN.md`: a checklist of small tasks (≤ 1–2 hours each), grouped by milestone, each tagged with SRS IDs (e.g. `BK-21`, `PAY-03`, `EXT-03`).
2. **Build:** one task at a time: code, migration if needed, and tests.
3. **Verify:** after every task run `pnpm lint && pnpm typecheck && pnpm test`. Fix all failures before moving on. Never leave the build red.
4. **Record:** tick the task in `docs/PLAN.md`, add a line to `CHANGELOG.md`, and commit with a clear message, e.g. `feat(core): slot engine with DST handling [BK-10..15]`.
5. **Milestone gate:** at the end of each milestone write `docs/M<n>-REPORT.md` (what was built, test results, what the human must do, known issues). Continue to the next milestone unless a blocker in Section 3 applies.
6. **Final gate:** after M5 run every acceptance criterion in SRS Section 14.2 (including Playwright e2e), write `docs/PHASE-1-REPORT.md` and `docs/PHASE-2-READINESS.md`, then stop.

## 3. When to stop and ask the human

Stop and ask (short, numbered questions) only when:
- the SRS is contradictory or impossible as written;
- you need a real account, key or paid service that isn't in `.env.local`;
- a choice changes cost, legal/GDPR posture, ownership, or the data model in a way that's hard to undo;
- the same error persists after 3 genuinely different fix attempts.

For everything else make the most reasonable decision, record it in `docs/DECISIONS.md` (date, decision, reason, alternatives) and continue.

`[TBD]` values: don't ask and don't hard-code. Use placeholders in seed data or settings, list them in `docs/TBD.md`, and continue.

## 4. Non-negotiable rules

- **Stack exactly as SRS Section 6.3**: pnpm + Turborepo monorepo, Next.js App Router, TypeScript strict, Tailwind + shadcn/ui, Drizzle + Neon Postgres (schemas `core`, `cms`, `ops`, empty `clinical`), Auth.js with TOTP 2FA, Stripe Payment Element, Resend, Cloudflare Workers via OpenNext, R2, Turnstile. Ask before adding any paid service or heavy dependency.
- **Layering**: `apps/web` contains pages, routes and UI only. Business rules live in `packages/core`. Database schema in `packages/db`. Auth and `can()` in `packages/auth`. Shared components in `packages/ui`.
- **Security** (SRS Section 10): every server action and route validates input with Zod and calls `can()`. Questionnaire answers and medical card details never go into emails, logs, URLs or analytics.
- **No double bookings**: Postgres exclusion constraints on holds and appointments, transactions, idempotent Stripe webhooks.
- **Events**: write to `ops.domain_events` in the same transaction as every appointment, patient and payment change (EXT-03).
- **Time**: store UTC; compute and display in `Europe/Dublin`; test DST changes.
- **Money**: integer cents, EUR, always calculated on the server.
- **Ownership**: nothing may depend on the developer's personal accounts. All config through env vars; document every account in `docs/HANDOVER.md`.
- **Secrets**: never commit `.env*` (except `.env.example`); never print secret values.
- **No silent mocks in production code**: if a key is missing, fail clearly. Mocks only in tests or when `EMAIL_TRANSPORT=console` in development.
- **Mobile first and accessible**: WCAG 2.1 AA, tap targets ≥ 44 px, works at 360 px wide.

## 5. Running without real accounts

Until the human provides keys, develop against: Docker Postgres or a Neon dev branch; Stripe test mode with the Stripe CLI (`stripe listen --forward-to localhost:3000/api/webhooks/stripe`); console email transport; MinIO or R2 for files. List every account the human must create (in the clinic's name) in the milestone report.

## 6. Definition of done (every task)

- [ ] Matches the SRS IDs listed for the task
- [ ] Lint, typecheck and tests pass
- [ ] Validation and authorization in place
- [ ] Works on mobile width and by keyboard
- [ ] No secrets or health data in logs, emails or analytics
- [ ] `docs/PLAN.md` ticked, `CHANGELOG.md` updated, committed

## 7. Reporting style

Lead with what's done and what you need from the human. Keep it short, use checklists, and give exact commands for anything the human must run.
