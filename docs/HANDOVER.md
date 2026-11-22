# Handover guide

For Dr Khalid and the clinic. Everything the clinic needs to own, run and pay for the system.

## 1. What you own

| Item | Where it should live |
|---|---|
| The domain `royalclinicmedics.ie` | Your registrar account, in the clinic's name |
| The code, design and documents | A **private** GitHub repository in the clinic's account |
| The database (all patient and booking data) | A Neon account in the clinic's name |
| Payments | A Stripe account in the clinic's name; the money goes to the clinic's bank |
| The website hosting | A Netlify account in the clinic's name |
| Email sending | A Resend account in the clinic's name |

The developer is **invited as a member** of each account and removed when you ask. Nothing depends on the developer's
personal accounts. You can export all patient and booking data yourself at any time (Admin > Export data).

## 2. Accounts to create (all start free)

Create each with the clinic's email address and keep the logins in the clinic's password manager. Each step takes about 5 to 15 minutes.

| # | Account | What it does | Needed before launch |
|---|---|---|---|
| 1 | GitHub (private repository) | Holds the code; runs the nightly backup | Yes |
| 2 | Neon | The database | Yes |
| 3 | Netlify | Runs the website | Yes |
| 4 | Stripe | Card, Apple Pay and Google Pay payments | Yes (test mode first) |
| 5 | Resend | Sends the emails | Yes |
| 6 | Cloudflare | Free DNS and the "are you human" check (Turnstile) | Yes |
| 7 | cron-job.org | Calls the website every 5 minutes (reminders, clean-up) | Yes |
| 8 | Google Analytics + Search Console | Visitor numbers and search results | Optional |

## 3. Running costs (checked 22 Nov 2026; re-check on each provider's pricing page before launch)

| Service | At launch | When it would cost more |
|---|---|---|
| Domain renewal | About EUR 20 to 30 a year (existing) | |
| Netlify | EUR 0 (free plan allows commercial use; 300 credits a month) | Very high traffic. Watch usage in the first month |
| Neon database | EUR 0 (1 GB, sleeps when idle) | More data, or if you want it always awake: paid plan |
| Resend email | EUR 0 (100 emails a day, 3,000 a month) | About 25 bookings a day uses the daily limit (each booking sends about 4 emails). Then about USD 20 a month |
| Stripe | No monthly fee; about 1.5% + EUR 0.25 per standard EU card payment (premium and non-EU cards cost more) | |
| Cloudflare, GitHub, cron-job.org, Google Analytics | EUR 0 | |
| Developer maintenance plan | **To be agreed** | |

## 4. Settings to put in Netlify (Site settings > Environment variables)

Names only here. Never put the values in the code or send them by email.

| Name | What it is |
|---|---|
| `DATABASE_URL` | Connection string from Neon (use the **pooled** one) |
| `NEXT_PUBLIC_SITE_URL` | `https://www.royalclinicmedics.ie` |
| `DATA_ENCRYPTION_KEY` | 32 random bytes, base64. Encrypts staff two-factor secrets. **Keep a copy safe: if lost, every staff member must set up two-factor again** |
| `SIGNED_LINK_SECRET` | 32+ random characters. Signs the "manage your booking" links. **Set once; do not change it later** |
| `CRON_SECRET` | Long random text. Protects the scheduled-job address |
| `SETUP_TOKEN` | Long random text. Needed once to create the first administrator. Remove afterwards |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | From Stripe |
| `RESEND_API_KEY`, `EMAIL_FROM`, `CLINIC_NOTIFY_EMAIL` | From Resend; the sender address must be on your verified domain; the inbox that receives booking alerts |
| `EMAIL_TRANSPORT` | Leave unset in production (it then uses Resend) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | From Cloudflare Turnstile |
| `NEXT_PUBLIC_GA_ID` | Google Analytics measurement id (optional) |

Make random values with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

## 5. Go-live checklist

Work through these in order. Do not skip the tests with Stripe's test mode.

**Accounts and hosting**
- [ ] Create the accounts in section 2. Invite the developer as a member where needed.
- [ ] GitHub: make sure the repository is **private**, push the code, add the secrets `DATABASE_URL` and `BACKUP_PASSPHRASE` (Settings > Secrets > Actions).
- [ ] Neon: create the project in an EU region, copy the pooled connection string. Create the tables and starter content (the developer does this once, from a computer with the project, see RUNBOOK section 8).
- [ ] Netlify: "Add new site" > import the GitHub repository. Add every variable in section 4. Deploy.
- [ ] Domain: move DNS to Cloudflare (free), point `www` at Netlify as Netlify instructs, turn on HTTPS.
- [ ] Open `/admin/setup` once, using the `SETUP_TOKEN`, and create the first administrator. Then create a **second administrator** (so one lost phone cannot lock everyone out) and remove `SETUP_TOKEN`.

**Real information** (see [TBD.md](TBD.md))
- [ ] Admin > Settings: phone, email, address, Eircode, map search text, opening hours, Google reviews link.
- [ ] Admin > Doctors: real name, qualifications, Irish Medical Council number, photo text, working hours.
- [ ] Admin > Services and prices: the real list, prices, lengths, which can be paid at the clinic.
- [ ] Admin > Website content: FAQs, and the four legal pages. **Have a solicitor review the privacy policy, terms, cookie policy and cancellation policy before launch.** The text in the system is a template.
- [ ] Admin > Emails: read each email once and adjust the wording.
- [ ] Decide the medical card (GMS) policy and how long booking records are kept.

**Payments (Stripe)**
- [ ] Complete Stripe's business verification and add the clinic bank account.
- [ ] Test mode first: webhook endpoint `https://www.royalclinicmedics.ie/api/webhooks/stripe`, events `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`. Make a booking with card `4242 4242 4242 4242`. Check the booking is confirmed, the email arrives, and a cancellation refunds it.
- [ ] Apple Pay: in Stripe > Settings > Payment methods > Apple Pay, register the domain. Google Pay needs no extra step.
- [ ] Switch to live keys. Do one real EUR 1 test booking (create a EUR 1 service temporarily), then refund it.

**Email (Resend)**
- [ ] Add your domain in Resend, add the DNS records it shows (SPF and DKIM), wait until it says Verified.
- [ ] In Admin > Emails send a test of each email to yourself. Check they do not land in spam.

**Scheduled jobs**
- [ ] cron-job.org: a job that calls `https://www.royalclinicmedics.ie/api/cron/maintenance` with the method POST every 5 minutes and the header `Authorization: Bearer <your CRON_SECRET>`. Reminders and clean-up depend on this.

**Backups**
- [ ] GitHub Actions > "Nightly backup" > Run workflow once. Confirm an artifact appears.
- [ ] Do a **restore test** into an empty Neon database (RUNBOOK section 5). A backup you have never restored is not a backup.

**Final checks**
- [ ] Test on a real iPhone and an Android phone: book, pay, receive the email, cancel from the link.
- [ ] Run Google's PageSpeed test on the home page and the booking page.
- [ ] Google Search Console: add the site and submit `https://www.royalclinicmedics.ie/sitemap.xml`.
- [ ] Both administrators have signed in and set up their authenticator app.

## 6. When something needs the developer

Most day-to-day changes (prices, hours, closed days, FAQs, emails, staff) are done in the admin dashboard. You need
the developer for: new features, changing how booking works, upgrading the software, and Phase 2.
