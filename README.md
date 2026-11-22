# Royal Medics Clinic: website, booking and payments (Phase 1)

A clinic website with online booking, Stripe payments, automatic emails and an admin dashboard for staff.
Built so a separate online-consultation app (Phase 2) can be added later without rebuilding anything.

Start with these documents:

| Document | For |
|---|---|
| [docs/HANDOVER.md](docs/HANDOVER.md) | The clinic owner: accounts to create, running costs, go-live checklist |
| [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md) | Reception and doctors: everyday use of the admin dashboard |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Whoever looks after the site: scheduled jobs, backups, restore, incidents, data breaches |
| [docs/PHASE-1-REPORT.md](docs/PHASE-1-REPORT.md) | What is finished, what was tested, and what is not done |
| [docs/PHASE-2-READINESS.md](docs/PHASE-2-READINESS.md) | How the consultation platform plugs in later |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why things were built the way they were |
| [docs/TBD.md](docs/TBD.md) | Information still needed from the clinic |
| [SRS.md](SRS.md) | The full requirements |

## Run it on your computer

You need Node.js 20 or newer and pnpm (`npm i -g pnpm`). Nothing else: no Docker, no accounts.

```powershell
pnpm install
pnpm dev:db        # creates and fills the local test database (run once, and after updates; not while the site is running)
```

Create `apps/web/.env.local` with the values below, then:

```powershell
pnpm --filter @rmc/web dev     # opens http://localhost:3000
```

Minimum `apps/web/.env.local` for local development:

```
DATABASE_URL=pglite:D:/path/to/this/project/.devdb
NEXT_PUBLIC_SITE_URL=http://localhost:3000
CRON_SECRET=any-long-random-text
DATA_ENCRYPTION_KEY=<32 random bytes, base64>
SIGNED_LINK_SECRET=<32+ random characters>
EMAIL_TRANSPORT=console
```

Make the two secrets with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Emails are saved as files in `apps/web/.devmail/` instead of being sent. Open `/admin` and create the first administrator.

## Everyday commands

```powershell
pnpm lint      # type checks
pnpm test      # all automated tests (about 240)
pnpm build     # production build
```

## What is where

```
apps/web        the website, booking pages, API and admin dashboard (Next.js)
apps/consult    Phase 2 placeholder (nothing built)
packages/core   ALL business rules: slots, booking, payments, emails, admin operations
packages/db     database tables and migrations (Drizzle, PostgreSQL)
packages/auth   staff sign-in, two-factor, permissions
packages/ui     shared colours (used by both apps)
docs/           documentation
scripts/        backup restore script
```

Rule: pages and API routes only collect input and call `packages/core`. Anything that decides something
(who may book, what a price is, whether a refund is due) lives in `packages/core` and has tests.
