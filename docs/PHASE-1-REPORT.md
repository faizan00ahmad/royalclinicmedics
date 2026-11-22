# Phase 1 report

Status on 22 Nov 2026. Written to be honest about what has and has not been proven.

**Summary:** the whole Phase 1 system is built and works end to end on a test setup. It has **not** yet been run
against the real services (Neon, Stripe, Resend, Netlify) because those accounts do not exist yet, and a few of the
SRS items are not built. It is not ready to launch until the "Before launch" list below is done.

## What was verified, and how

| Check | Result |
|---|---|
| Automated tests (`pnpm test`) | **245 passing**: 160 business rules, 33 sign-in and permissions, 44 web routes and security, 8 database |
| Type check (`pnpm lint`) | Clean |
| Production build (`pnpm build`) | Clean |
| Known vulnerabilities in shipped libraries (`pnpm audit --prod`) | None (four serious ones were found and fixed on 22 Nov) |
| Real browser, local database | Home, services, booking (hold, details, confirm), manage page, admin sign-in with two-factor, dashboard, appointment actions (check in, mark paid), audited health answers, price change visible on the public site, admin Emails page, emails produced for a real booking, manage and calendar links taken from the email |
| Security headers | Present on a production build; every script on dynamic pages carries the per-request nonce; no policy violations in the browser |
| Phone-width layout | Checked in an emulated phone viewport for Home only |

What the automated tests specifically prove: the same time can never be booked twice (a database rule, tested including
overlaps and buffers); clock changes in March and October; refunds happen exactly once and in the right cases;
a repeated or simultaneous Stripe webhook confirms a booking once; no health data appears in any email, event, export or audit entry;
wrong links and tokens look identical to "not found"; staff roles can only do what the matrix allows; emails are sent once, retried after an outage and
given up after 48 hours.

## Acceptance criteria (SRS 14.2)

| Criterion | Status |
|---|---|
| Patient on a phone can book, pay by card / Apple Pay / Google Pay, get email with calendar file and manage link | **Partly proven.** Booking, email, calendar file and manage link are proven. The Stripe screens have not been run (no Stripe account yet); Apple/Google Pay need domain registration in Stripe |
| Pay at clinic only where allowed; staff mark paid | Done and tried in the browser |
| Only free times shown; two people at once: only one wins | Done; race proven by a database rule and tests (not yet by two real connections on Neon) |
| Hours, holidays, overrides, blocks, notice, window, clock changes respected | Done (tested) |
| Cancel and reschedule from the email link; automatic refund outside the window; policy inside | Done with a fake Stripe; real refund untested |
| Reminders sent once at the set times | Done (tested). Needs the cron-job.org job to run |
| Staff add a walk-in, **drag** an appointment to a new time, block time | Walk-in and block time done. **Drag and drop is not built**: appointments are moved with a form, and the patient is emailed |
| Admin changes service, price, doctor, schedule, holiday, FAQ, page text without a developer, and the site updates | Done; price change seen live |
| Export patients, appointments, payments to CSV; exports audited | Done |
| Staff login needs two-factor; receptionist cannot open settings, staff, exports | Done (admin flow tried in the browser; the receptionist limits are proven by tests, not clicked through) |
| Health answers never in emails, logs or analytics | Emails, events, exports, audit log proven by tests. Analytics: no booking events are sent at all yet |
| Cookie banner blocks Google Analytics until consent; GA receives booking events after consent | Banner and blocking done. **The booking events are not built** |
| Lighthouse thresholds; tested on iPhone Safari and Android Chrome | **Not measured, not tested** |
| Nightly backup runs; a restore to a test database succeeded | Workflow and restore script written. **Never run** |
| All accounts owned by the clinic; handover pack delivered | Pack written (README, HANDOVER, RUNBOOK, ADMIN-GUIDE). **Accounts not yet created** |
| Phase 2 extension points EXT-01 to EXT-10 exist and are documented | Done, see [PHASE-2-READINESS.md](PHASE-2-READINESS.md) (single sign-on across sub-domains is deferred to Phase 2 design) |

## Not built (from the SRS)

- Calendar view with drag and drop (AD-02); the Appointments list with a date range covers day and week
- Patient list and merging duplicates (AD-06); the Privacy requests page can find a person
- Choosing a doctor in the booking wizard (BK-02; only one doctor exists, "first available" is used)
- Extra questions per service (BK-41); discount codes (PAY-06); PDF receipts (PAY-07); Google and Outlook calendar links (the .ics file works)
- Medical card rules beyond "please phone the clinic" (PAY-09)
- Google Analytics booking events (WEB-16) and GA4 consent mode; live Google reviews (the reviews block is hidden until the Irish Medical Council advertising question is checked)
- Rich text editor and image upload for website content (AD-10); the website text is edited as plain text
- Staff invite and password reset emails (N-10), the 07:00 daily schedule for doctors (N-11), repeating blocked time
- Playwright end-to-end tests and a Lighthouse run
- Cloudflare Turnstile is built but untested against Cloudflare (no keys yet)

## Known limits of the free setup

- Resend free plan: 100 emails a day (about 25 bookings a day). The SRS capacity of 300 appointments a day needs a paid email plan.
- Neon free database sleeps when idle: the first visit after a quiet spell is slow.
- Rate limiting is per server instance (it slows casual abuse). Turnstile and the database rule are the real protections.
- No self-service password reset yet; an administrator creates a new account.
- Netlify credit use for this app is unmeasured: watch it in the first month.

## Before launch (in order)

1. Create the accounts and fill in the real information: [HANDOVER.md](HANDOVER.md) section 5, [TBD.md](TBD.md).
2. **Solicitor review of the privacy policy, terms, cookie policy and cancellation policy.** The text in the system is a template.
3. Stripe test-mode run of the whole flow, then live with a EUR 1 payment; register the domain for Apple Pay.
4. Domain verification in Resend; send a test of every email.
5. Create the cron-job.org job and watch it run.
6. Run the nightly backup once and do a restore test.
7. Check the Content Security Policy against Stripe, Google Maps, Analytics and Turnstile on the real site (it is built for them but untested with the real scripts).
8. Test on a real iPhone and Android; run PageSpeed.
9. Decide: medical card policy, how long booking records are kept, whether to show Google reviews.
10. Create two administrators.

## Milestones

| | Delivered |
|---|---|
| M1 Setup | Monorepo, database (including the no-double-booking rule), seed, shared design tokens, CI |
| M2 Website | All public pages, SEO, cookie consent, contact form, map, booking wizard, manage page |
| M3 Booking and payments | Slot engine, holds, Stripe checkout and webhook, refunds, pay at clinic, emails with retries, reminders |
| M4 Admin | Sign-in with two-factor, roles, all admin screens, exports, audit log, privacy requests |
| M5 Testing and launch | Security headers, Turnstile, CSRF check, dependency fixes, backup workflow, handover pack. **Launch testing against real services still to do** |
