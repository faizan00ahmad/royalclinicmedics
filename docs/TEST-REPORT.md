# Test report: public website and admin

Run on 22 Nov 2026 against the local setup (in-process Postgres, console email, no Stripe, no Cloudflare, no real
services). Real browser at 375 px phone width for the public site, then the admin.

**Result: the booking flow and the admin work end to end. Three defects were found and fixed. Nothing was tested
against real Stripe, Neon, Resend, Netlify or a real phone, so this is not a launch sign-off.**

## Automated checks (after the fixes)

| Check | Result |
|---|---|
| `pnpm lint` and `pnpm typecheck` | Clean |
| `pnpm test` | **247 passing**: core 160, auth 33, db 8, web 46 (two new) |
| `pnpm build` (production) | Clean, middleware present |

## Defects found and fixed

| # | Defect | Effect | Fix |
|---|---|---|---|
| 1 | Cancel route required Stripe even for a pay-at-clinic booking | With no Stripe keys a patient got "not available yet" when cancelling | Uses the lazy gateway, so Stripe is only touched if money is involved |
| 2 | The 5-minute maintenance job required Stripe | With no Stripe keys the whole job failed: no hold clean-up, no reminders, no email retries | Same fix. Two new tests cover 1 and 2 |
| 3 | Header, footer and service links were 18-36 px tall on a phone | Below the 44 px tap-target rule | Raised to at least 44 px |

## Public website (phone width)

| Area | Result |
|---|---|
| All 11 pages, sitemap, robots, health, 404 page | Load; one H1 and a meta description each |
| Horizontal scroll | None on any page checked |
| Tap targets | Header, footer and service links fixed (above). Not re-scanned: the booking form fields, the manage page and one in-text "privacy policy" link on Contact (40 px) |
| Booking wizard | Service, free time, 10-minute hold, details, health questions, consents, confirmation: worked |
| Required consents and the smoker question | Form refuses to submit until completed |
| Manage page | Shows booking; Change and Cancel are disabled inside 24 hours with a "please phone" message; server enforces the same |
| Reschedule, cancel, cancel twice, calendar file | Work. The second cancel is refused. The freed time can be booked again |
| Wrong or missing manage token | 404, identical to "not found" |
| Health answers | Absent from API responses, calendar file and all emails (searched with marker words) |
| Contact form | Needs consent; sends a clinic alert and an auto-reply |

## Booking rules and security

| Check | Result |
|---|---|
| Five simultaneous holds on one time | Exactly one wins, four get "slot taken" |
| Past times, Sunday, 25 Dec, over 12 months ahead, closed hours | All refused |
| Bad body, oversized body | 400, 413 |
| Cross-origin POST | 403; same-origin and non-browser clients accepted |
| Cron without or with a wrong secret | 401 |
| Stripe webhook unsigned | 400 (with no keys a bad signature gives 503; with keys it will be 400) |
| Odd characters in a booking reference | 404, no error |
| Security headers | CSP, frame, content-type, referrer, HSTS, permissions policy all present |
| Site cannot be framed | Confirmed (blocked an iframe test) |

## Admin

| Check | Result |
|---|---|
| Signed out | Every admin page redirects to login; export and privacy downloads return 401 |
| Wrong password | Generic message; logged in the audit log |
| Wrong authenticator code | Refused; right code signs in |
| All 14 screens | Dashboard, Appointments, Walk-in, Enquiries, Services, Doctors, Closed days, Content, Settings, Emails, Staff, Export, Privacy, Audit: load without errors |
| Public booking shows in admin | Yes, including the cancelled one |
| Mark paid (cash) | Paid, with a receipt number |
| Check in | Done and in the appointment history |
| Show health answers | Shown, and an audit entry written; the audit log holds no health content |
| Walk-in on a taken time | Refused ("that time was just taken") |
| Walk-in on a free time | Booked; the time disappears from the public page |
| Staff cancel | Cancelled; the time returns to the public page |
| Closed day added | All slots for that day vanish publicly; removing it restores them |

## Not tested here (do before launch)

- **Money:** Stripe screens, card, Apple Pay, Google Pay, real refund, webhook with a real signature.
- **Real services:** Neon speed and sleep, Resend delivery and spam score, Netlify cold starts, Turnstile with real keys, cron-job.org.
- **Devices:** real iPhone and Android, screen reader, Lighthouse and PageSpeed.
- **Admin:** receptionist and doctor roles clicked through (the role rules are covered by automated tests only), staff create and two-factor reset, content, FAQ and settings editing, Move appointment, Export downloads, Privacy export and anonymise. The admin buttons are 40 px tall (made for a desk, not a phone).
- **Load:** many people booking at once on the real database.
- **Regression:** the two new tests were not run against the old code to confirm they fail there; the defects themselves were seen in the browser.

## Small observations (not fixed)

- The wizard asks for free times twice on load.
- The mobile menu is a sideways-scrolling row of links, so the last items start off screen.
- The appointment history does not list payment events, only status changes and consents.
- A click on an admin button sometimes needs two tries after the page scrolls. This looks like a test-tool effect, not a product bug, but it was not isolated.
