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
