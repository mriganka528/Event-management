# Event Management

A full-stack application for event-service businesses: a public booking site, a
customer workspace, an administration area, staff operations, online payments,
and real-time updates.

## Requirements

- Node.js 20.9+
- PostgreSQL
- A Razorpay account for online checkout
- A Cloudinary account for image uploads
- SMTP for one-time codes and activation links (optional locally — codes are
  written to the server log instead)
- An SMS provider for phone codes (optional — email codes work without one)

## Setup

```bash
npm install
cp .env.example .env.local
npm run prisma:generate
npm run db:migrate
npm run db:seed
npm run admin:bootstrap
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The seed creates the four system roles and an empty settings record. There are
no accounts, so the application is unusable until `npm run admin:bootstrap`
creates the first super admin. That account is sent to the two-factor setup
screen on first sign-in.

## Environment variables

See `.env.example` for the full list. The ones without a sensible default:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (pooled URL is fine for the app) |
| `DIRECT_URL` | Optional non-pooled URL for migrations; Neon derives it automatically |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin, e.g. `https://planora-sage-ten.vercel.app` in production and `http://localhost:3000` locally |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Customer sign-in |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Payments |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Image uploads |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Email |
| `SESSION_FINGERPRINT_SALT` | Session salt — a long random value |
| `MAX_DEVICES_PER_ACCOUNT`, `SESSION_MAX_AGE_HOURS` | Session limits |

Server-only secrets must never be exposed through a `NEXT_PUBLIC_*` variable or
committed to the repository.

## Commands

```bash
npm run dev              # development server
npm run build            # production build
npm run start            # production server
npm run lint             # ESLint
npm test                 # unit tests
npm run prisma:generate  # regenerate the Prisma client
npm run db:migrate       # apply migrations
npm run db:seed          # create the system roles and settings
npm run admin:bootstrap  # create the first super admin
npm run auth:reset       # remove every login; requires -- --confirm
```

## Routes

| Area | Routes |
| --- | --- |
| Public | `/`, `/services`, `/packages`, `/bookings/new`, `/track` |
| Authentication | `/sign-in`, `/activate`, `/join-the-team`, `/customer/auth/*` |
| Customer | `/customer/dashboard`, `/customer/bookings/*`, `/customer/invoices/*` |
| Staff | `/staff` |
| Admin | `/admin` and its booking, calendar, catalog, inventory, payment, invoice, report, staff, customer, access, notification, and settings screens |

## Deployment

The app is built for a Node-compatible serverless platform such as Vercel.
`vercel.json` runs `prisma generate`, `prisma migrate deploy`, and `next build`.

Set the environment variables in the platform's dashboard, then deploy. Set
`NEXT_PUBLIC_SITE_URL` to the public origin (for this deployment,
`https://planora-sage-ten.vercel.app`). Locally it falls back to
`http://localhost:3000`. The server also accepts `SITE_URL` or `APP_URL`, and
uses Vercel's `VERCEL_PROJECT_PRODUCTION_URL` when system environment variables
are enabled, so email links use the deployment origin even if the public variable
is missing. A bare host such as `planora-sage-ten.vercel.app` is accepted and
given an `https://` scheme.

Migrations use a direct database connection: `prisma.config.ts` picks
`DIRECT_URL`, `DATABASE_URL_UNPOOLED`, or `POSTGRES_URL_NON_POOLING` when one is
present, and otherwise removes Neon's `-pooler` hostname. This avoids the
advisory-lock timeout (`P1002`) that a transaction-mode pooler can cause. The
Vercel build script also retries a busy migration lock so two overlapping
production builds do not fail each other.

Three things are worth checking before going live:

- Live notifications use Server-Sent Events, so they work on both a long-lived
  Node server and a serverless deployment such as Vercel. The browser falls back
  to polling every ten seconds if the stream is blocked; it no longer depends on
  the Socket.IO server in `server.mjs`, which a serverless platform does not run.
- `SESSION_FINGERPRINT_SALT` must be set to a long random string. Without it
  the application still runs, but it logs a warning and forgets which devices
  are signed in whenever an instance restarts.
- Replace every development credential with a production one.

Point the Razorpay webhook at `https://YOUR_DOMAIN/api/payments/razorpay/webhook`
and subscribe to `payment.captured`, `payment.failed`, `order.paid`, and
`order.expired`.

## Notes

- Package contents are copied onto each booking as a snapshot, so later catalog
  edits do not change existing requests.
- Stock is reserved on approval and released on cancellation, using conditional
  updates inside a transaction.
- Successful payments are the only rows counted as revenue. A late capture is
  flagged for reconciliation rather than consuming another order's reservation.
- Keep secrets in the platform's secret manager.
