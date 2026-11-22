# Runbook

For whoever looks after the site (the developer or an IT person). Plain steps, in the order you will need them.

## 1. What runs where

```
Patients and staff  ->  Cloudflare (DNS)  ->  Netlify (the website + API)  ->  Neon (the database)
                                                    |-> Stripe (payments, calls back to /api/webhooks/stripe)
                                                    |-> Resend (emails)
cron-job.org  -> POST /api/cron/maintenance every 5 minutes
GitHub Actions -> nightly encrypted database backup
```

## 2. The scheduled job (the most important one)

Every 5 minutes cron-job.org calls `POST https://www.royalclinicmedics.ie/api/cron/maintenance` with the header
`Authorization: Bearer <CRON_SECRET>`. Each call:

1. frees expired booking holds;
2. cancels online bookings still unpaid 30 minutes after their hold expired, and cancels the Stripe payment;
3. sends queued emails (and retries any that failed);
4. sends the 24 hour and 2 hour reminders, once each;
5. runs the data clean-up (old enquiries, stale hold records, ended sessions, old email log lines).

**If it stops:** reminders stop, abandoned checkouts stay "pending" (the time stays blocked until the hold expires, so
patients are not harmed), and failed emails are not retried. Online bookings still work, and confirmation emails are sent straight after the booking (or by the next run of this job if that send did not happen). Check cron-job.org's history page; it shows each call's result. A healthy
response looks like `{"ok":true,"expiredUnpaid":0,...}`. A `401` means the secret is wrong; `503` means a setting is missing.

## 3. Stripe

- Webhook: Stripe > Developers > Webhooks > endpoint `https://www.royalclinicmedics.ie/api/webhooks/stripe`, events
  `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
- Failed deliveries show in Stripe's webhook page and are retried automatically for days. Handling is safe to repeat.
- **A paid booking that did not get confirmed:** find the payment in Stripe, copy its `payment_intent` id, look for it in the
  Admin > Audit log (`payment.amount_mismatch` means the amount differed from the price: nothing was confirmed, review by hand).
  If the slot was taken while the patient paid, the system cancels the booking and refunds in full by itself and emails the patient.
- Refunds: Admin > Appointments > the booking > Refund (administrators). Refunds made in the Stripe dashboard are copied back in by the webhook.

## 4. Email (Resend)

- Admin > Emails > "Recent emails" lists what was sent. Admin > Audit log shows `email.gave_up` if an email failed for 48 hours.
- Free plan: 100 a day. If it is reached, emails queue and go out the next day (the cron job retries). Upgrade if this happens often.
- Spam folder problems: re-check the SPF and DKIM records in Resend and that `EMAIL_FROM` uses the verified domain.

## 5. Backups and restore

**Nightly backup:** GitHub Actions workflow "Nightly backup" runs at 02:17 UTC, dumps the database, compresses it, encrypts it
with `BACKUP_PASSPHRASE` (AES-256) and keeps it as a private artifact for 30 days. The repository **must be private**.
Keep the passphrase in the clinic's password manager. **Without it a backup cannot be opened.**
Neon also offers its own history/restore feature; check how long it keeps history on your plan and do not rely on it alone.

**Restore test (do this before launch and every 3 months):**

1. GitHub > Actions > Nightly backup > the latest run > download the `database-backup` artifact and unzip it.
2. In Neon create a **new empty** project or branch called `restore-test`.
3. On a computer with `psql` and `gpg`: `./scripts/restore-backup.sh royal-medics-2026-12-01.sql.gz.gpg "<restore-test connection string>"`
4. Check it worked: `psql "<connection string>" -c "select count(*) from core.appointments;"`
5. Delete the `restore-test` database. Write the date of the test in the log below.

Target recovery: lose at most 24 hours of data; back online within 4 hours.

**Real recovery:** restore into a new Neon database (never over the live one), check the numbers, then change `DATABASE_URL`
in Netlify to the new connection string and redeploy.

| Date | Restore test done by | Result |
|---|---|---|
| | | |

## 6. Staff access problems

- **Forgot password:** there is no self-service reset yet. An administrator creates a new account (Admin > Staff) and deactivates the old one.
- **Lost phone (two-factor):** another administrator uses Admin > Staff > "Reset two-factor"; the person sets it up again at next sign in.
- **The only administrator lost their phone:** this is why two administrators are required. Last resort, in Neon's SQL editor:
  `update ops.users set totp_secret_enc = null, totp_confirmed_at = null, totp_last_step = null where email = '<their email>'; delete from ops.sessions where user_id = (select id from ops.users where email = '<their email>');`
  They sign in with their password and set up two-factor again. If the password is also lost, delete the staff rows
  (`delete from ops.users;`) and open `/admin/setup` again (it needs `SETUP_TOKEN` set in Netlify). Record this in the audit notes.
- **Account locked:** five wrong tries lock it for 15 minutes. Wait, or an administrator resets it.

## 7. Incidents

| Symptom | First checks |
|---|---|
| Website down | Netlify > Deploys (a failed deploy keeps the last good version live). Netlify status page. |
| Booking page says "try again" | Neon status; `DATABASE_URL` correct; Netlify function logs. The first request after a quiet period is slow (Neon wakes up). |
| Patients cannot pay | Stripe status; are the keys the live ones; webhook endpoint healthy |
| No emails | Resend dashboard; domain still Verified; Admin > Emails > Recent emails; cron job running |
| Double booking reported | Should be impossible (a database rule prevents it). Check Admin > Audit log for walk-ins outside hours, and keep the evidence for the developer |

## 8. First-time database setup, and updates

Run from a computer with the project and the production connection string. Do not paste the connection string into chat or email.

```powershell
$env:DATABASE_URL = "<Neon pooled connection string>"
pnpm install
pnpm db:migrate      # creates or updates the tables; safe to run again
pnpm db:seed         # first time only: starter services, doctor, hours, Irish public holidays, FAQs, legal templates
```

Every software update that changes the database includes a new file in `packages/db/migrations/`. Run `pnpm db:migrate`
**before** deploying that version. Take a backup first (run the "Nightly backup" workflow by hand).

## 9. Personal data breach procedure (GDPR)

A breach is any loss, theft or unauthorised access to patient data (a lost laptop signed in to admin, a leaked password,
an email sent to the wrong person, a database exposed).

1. **Contain (first hour):** deactivate affected staff accounts (Admin > Staff), change the Neon, Stripe, Resend and Netlify
   passwords and keys, rotate `CRON_SECRET`. Do **not** change `SIGNED_LINK_SECRET` or `DATA_ENCRYPTION_KEY` unless they were leaked (see section 10).
2. **Record:** what happened, when, which data, how many people. Admin > Audit log and Netlify/Neon logs help. Keep this record even if you decide not to report.
3. **Decide:** if the breach is likely to put people at risk, the clinic (as data controller) must report it to the Data Protection Commission **within 72 hours of becoming aware** (dataprotection.ie > Report a breach). If the risk to individuals is high, tell them without delay.
4. **Fix and learn:** close the cause, restore from a backup if data was damaged, write down what changes.

## 10. Rotating secrets

| Secret | Effect of changing it |
|---|---|
| `CRON_SECRET` | Also update the cron-job.org header. Safe. |
| `STRIPE_*`, `RESEND_API_KEY` | Update in Netlify and redeploy. Safe. |
| `SIGNED_LINK_SECRET` | "Manage" links in emails sent **afterwards** for **older** bookings stop working (links already sent keep working). Only rotate after a leak. |
| `DATA_ENCRYPTION_KEY` | Every staff two-factor secret becomes unreadable: all staff must be reset and set up two-factor again. Only after a leak. |

## 11. Data requests (GDPR)

Admin > Privacy requests (administrators only): find the person, **download all their data** (JSON) or **anonymise** them.
Anonymising removes name, contact details, date of birth, address and health answers but keeps booking and payment
records (the clinic's accounts need them), unlinked from the person. It is refused while they have an upcoming appointment.
Reply to the person within one month.

## 12. Updating the software

1. Run `pnpm lint && pnpm test && pnpm build` locally (CI does the same on every push).
2. Back up (run the backup workflow by hand), run `pnpm db:migrate` if there is a new migration file.
3. Merge to `main`; Netlify deploys. Check the home page, `/book`, and `/admin`.
4. Dependabot opens weekly pull requests for library updates; CI also fails the build on known serious vulnerabilities.
