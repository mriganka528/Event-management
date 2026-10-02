# Event Management

A full-stack event-management application for tent, decor, catering, lighting, and event-service businesses. It includes a public booking site, customer workspace, role-protected administration, staff operations, online payments, and real-time operational updates.

## Features

- Admin-managed service, package, inventory, staff, event, customer, payment, invoice, report, notification, and settings screens.
- Empty-by-default catalog: no demo services, packages, inventory, or staff are created by the normal seed.
- Cloudinary image uploads for package, service, and inventory records.
- Archive/restore controls for catalog and inventory records; hard deletion is allowed only when no historical references exist.
- Public booking requests with server-side pricing, package-content snapshots, inventory-safe approval, and idempotency keys.
- **Two identity systems by design.** Staff and administrators authenticate first-party (password + mandatory one-time code). Customers sign in with Google or email through Clerk, which is exchanged for the same local session. See [Access control](#access-control).
- Database-backed `SUPER_ADMIN`, `ADMIN`, `STAFF`, and `CUSTOMER` roles.
- **Password + mandatory second factor** for every admin and super admin account, delivered by email or SMS.
- **Self-service credentials.** An administrator can change their own email address and password at `/admin/settings/credentials`. Both require the current password, and a new address is only applied once a code sent to *it* is returned.
- **Approval-gated team access:** nobody can join the team themselves. See [Access control](#access-control).
- **Four-device limit:** an account cannot be signed in on more than four devices at once.
- Razorpay test-mode checkout, server-side signature verification, payment-order persistence, webhook signature verification, and idempotent settlement.
- Socket.IO live admin updates. New bookings, status changes, payments, inventory changes, and catalog changes refresh open admin screens without a manual browser refresh.
- PDF invoice generation and authenticated invoice downloads.
- Serializable, retryable transactions for booking creation, status workflows, inventory reservations/releases, and payment settlement.

## Access control

There are two sign-in surfaces, and the split is deliberate.

**Staff and administrators authenticate first-party.** Passwords are hashed with `scrypt`, sessions are opaque server-side tokens, and one-time codes are sent by email or SMS. Nothing in that path depends on a third-party provider, which is enforced by a unit test over `lib/auth/session.ts`, `lib/auth/server.ts`, and `lib/auth/sign-in.ts`.

**Customers sign in through Clerk**, with Google or an email address. A verified Clerk identity is exchanged at `/customer/auth/complete` for the *same* local `AuthSession` row and cookie the rest of the application already uses, so the edge proxy, the Socket.IO handshake, the device limit, and every booking query keep working without knowing a provider is involved.

That exchange can only ever produce a `CUSTOMER`. The rule lives in `resolveExternalIdentityClaim` in `lib/access-policy.ts` and is deny-by-default: an address that already belongs to a staff, admin, or super admin account is refused rather than linked, so signing up with `owner@thebusiness.com` cannot inherit that account. A rejected, suspended, or deactivated customer is never resurrected by a sign-in, and two provider identities cannot both claim one address.

A password proves **identity**, not **authorization**. A local `User` row must
also be `isActive` **and** `accountStatus = ACTIVE` before any protected page or
API route is served.

```text
STAFF / ADMIN                          CUSTOMER
email + password                       Google or email (Clerk)
        |                                      |
        v                                      v
  password correct?  -- no --> generic     Clerk session verified
        | yes                                (address already proven)
        v                                      |
  second factor sent (email or SMS)              v
        | code verified                 local User row, role CUSTOMER
        v                                (may not claim a team account)
  device slots free?  -- no --> refused              |
        | yes                                          v
        |                                    device slots free? -- no --> refused
        v                                              | yes
  session issued (hash of an opaque token, HttpOnly cookie)
        |                                                 |
        +------------------------+------------------------+
                                 v
   local account ACTIVE?  -- no --> gate screen: "not accepted by the admin"
        | yes
        v
   role permits the area? -- no --> gate screen
        | yes
        v
   workspace
```

### How people get accounts

| Path | Who can do it | Result |
| --- | --- | --- |
| `npm run admin:bootstrap` | Server operator, once | The first `SUPER_ADMIN`. Refuses to create a second one. |
| `/join-the-team` | Anyone, no account needed | Submits an access request. A super admin is notified and decides. Nothing is granted until they approve. |
| `/admin/admins` | A super admin | Creates a staff or admin account directly, without a request. |
| `/customer/auth/sign-up` | Anyone | A `CUSTOMER` account, created by Clerk. The address is verified before the account is usable. |

Approving a request never hands out a password. It issues a single-use activation
link; the recipient chooses their own password and enrols a second factor.

### Changing your own credentials

`/admin/settings/credentials` lets a signed-in administrator replace their email
address and password. Holding an unlocked session is not proof of ownership, so:

- Both operations re-check the **current password**.
- A new address receives a 6-digit code, and the swap happens only once that code
  is entered. The address is read back out of the stored challenge rather than
  trusted from the form, and the code is bound to the session that requested it.
- Uniqueness is re-checked at the moment of the write, so an address claimed while
  the code was in flight is refused rather than overwritten.
- Changing the password signs out **every other device**; the current one stays.
- Both outcomes, and both refusals, are written to the security log as
  `EMAIL_CHANGED`, `PASSWORD_CHANGED`, or `CREDENTIAL_CHANGE_BLOCKED`.

### Account states

| State | Meaning | Can reach |
| --- | --- | --- |
| `PENDING_APPROVAL` | Account exists, decision outstanding | Only the "awaiting approval" screen |
| `ACTIVE` | Approved by a super admin | Its own workspace |
| `REJECTED` | Request declined | Only the "not accepted" screen |
| `SUSPENDED` | Previously approved, now blocked | Only the "not accepted" screen |
| deactivated (`isActive = false`) | Deactivated flag | Only the "not accepted" screen |

### Rules

- **A password alone never grants a privileged session.** Every role must clear a
  one-time code before a session cookie is issued, and an admin that has not
  enrolled a second factor cannot reach any admin page.
- **The first super admin is created out of band.** There is no admin sign-up.
  Until `admin:bootstrap` has been run, nobody can sign in as an administrator.
- **Team access is never self-service.** The public form needs no account, but
  approval is a super admin's decision. Administrator access can only be granted
  by a `SUPER_ADMIN`; granting `SUPER_ADMIN` is restricted to `SUPER_ADMIN`.
- **Nobody may modify their own access.**
- **Approval and privilege are separate.** Approving grants *workspace* access;
  changing a role grants *privilege* and is a distinct, separately audited action.
- **Revocation is immediate.** Role changes, suspensions, and rejections are
  re-checked on every request and revoke live sessions, so access is withdrawn on
  the next request rather than when a cookie happens to expire.
- **Four devices per account.** A fifth concurrent sign-in is refused rather
  than silently evicting an existing session. Re-authenticating on a device that
  already holds a session rotates it in place instead of consuming a new slot.
- **Account enumeration is resisted.** An unknown email costs the same
  `scrypt` work as a wrong password, and the error message is identical for both.
  Failed attempts lock the account for 15 minutes.
- **Sessions cannot be replayed from a database leak.** Only the SHA-256 hash of
  the session token is stored. The cookie is `__Host-` prefixed, `HttpOnly`,
  `SameSite=Lax`, and `Secure` in production.
- **One-time codes are single use.** They are stored as hashes, expire after ten
  minutes, count attempts, and are burned after five wrong tries.
- **Breached passwords are rejected.** New passwords are checked against the
  Have I Been Pwned range API, which only ever sees the first five characters of
  the hash. The check fails open so an outage cannot lock everyone out.
- **Every decision is audited.** Sign-ins, code attempts, device limits,
  approvals, rejections, suspensions, and role changes are written to the
  append-only `SecurityEvent` table and shown at `/admin/security` (super admin
  only).
- **Open redirects are blocked.** Caller-supplied `returnTo` values are matched
  against an explicit allowlist.

### Gate screens

| Route | When |
| --- | --- |
| `/access-pending` | Signed in, awaiting a decision |
| `/access-denied` | Rejected, suspended, or deactivated |
| `/two-factor-required` | An admin session exists but no second factor is enrolled |
| `/two-factor-setup` | Enrolment screen. There is no "skip" control. |
| `/activate` | Redeeming a single-use activation link to set a password |

### Where the rules live

| Module | Responsibility |
| --- | --- |
| `lib/access-policy.ts` | Pure decision rules, including the provider-identity claim rule. No server-only imports, unit-tested directly. |
| `lib/auth/server.ts` | Resolves the session and applies the policy for pages, actions, and API routes. |
| `lib/auth/cookie-names.ts` | Cookie names, chosen per request so the `__Host-` prefix and `Secure` always agree. |
| `lib/auth/clerk.ts` | Exchanges a verified Clerk identity for a `CUSTOMER` account. The only bridge to the provider. |
| `lib/auth/password.ts` | `scrypt` hashing, strength policy, and the breach check. |
| `lib/auth/otp.ts` | Issues, verifies, and throttles one-time codes. |
| `lib/auth/session.ts` | Session lifecycle and the per-account device cap. |
| `lib/auth/sign-in.ts` | Credential verification, lockout, and session issuance. |
| `lib/auth/team.ts` | Public access requests, approval, invitations, and activation. |
| `lib/access-management.ts` | Approve / reject / suspend / reactivate / change role. |
| `lib/security-audit.ts` | Append-only audit writes (never fail a request). |
| `proxy.ts` | Edge layer: provider session, session presence, CSRF, and no-store headers only. |

Role and approval checks require the database, so they run in the layout, page,
server action, and API route rather than in middleware. Middleware intentionally
only establishes that a session exists.


## Requirements

- Node.js 20.9+
- PostgreSQL
- SMTP for one-time codes and activation links (optional locally: codes are logged instead)
- An SMS provider if you want phone codes (optional; email codes work without one)
- A Razorpay test account for online checkout
- A Cloudinary account for image uploads

## Environment variables

Copy `.env.example` to `.env.local` (or update the existing local `.env`) and provide:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/event_management?schema=public"
NEXT_PUBLIC_SITE_URL="https://events.example.com"

# Customer sign-in provider (Clerk). Staff and administrators do not use it.
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/customer/auth/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/customer/auth/sign-up"
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL="/customer/auth/complete"

# One-time codes and activation links. Optional locally: without SMTP the code
# is written to the server log instead of being emailed.
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_USER="..."
SMTP_PASSWORD="..."
SMTP_FROM="you@yourdomain.com"

# Phone codes. Leave unset to keep phone two-factor disabled; the UI hides the
# phone option rather than offering a code that cannot be delivered.
# SMS_PROVIDER="http"        # or "msg91"
# SMS_PROVIDER_URL="https://..."
# SMS_PROVIDER_TOKEN="..."

MAX_DEVICES_PER_ACCOUNT="4"
SESSION_MAX_AGE_HOURS="12"
SESSION_FINGERPRINT_SALT="a-long-random-value"

NEXT_PUBLIC_RAZORPAY_KEY_ID="rzp_test_..."
RAZORPAY_KEY_ID="rzp_test_..."
RAZORPAY_KEY_SECRET="..."
RAZORPAY_WEBHOOK_SECRET="..."

NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_API_KEY="..."
CLOUDINARY_API_SECRET="..."
```

`RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are server-only. Never expose them through `NEXT_PUBLIC_*` variables or commit them.

## Local setup

```bash
npm install
npm run prisma:generate
npm run db:push
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The seed creates only the four system roles and an empty business-settings record. There are no accounts, so the application is unusable until you create the first super admin:

```bash
npm run admin:bootstrap
```

It asks for an email, a name, an optional phone, and a password (typed twice, not echoed). The password is checked against the same policy used everywhere else: 12+ characters with an uppercase letter, a lowercase letter, a number, and a symbol.

Then sign in at `/sign-in` with that email and password. A privileged account is then sent to `/two-factor-setup` and the admin panel stays closed until a second factor is enrolled — that step has no "skip" control, and it is enforced in `lib/auth/server.ts`, not in this script.

Re-running the command for the **same** email resets that password. It refuses to create a second super admin under a different address; invite more from `/admin/admins` after signing in.

For CI and scripted deploys, set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, and optionally `BOOTSTRAP_ADMIN_NAME` / `BOOTSTRAP_ADMIN_PHONE`. When `BOOTSTRAP_ADMIN_EMAIL` is set the command runs non-interactively and does not prompt.

> The npm script passes `--conditions=react-server` to tsx. `lib/auth/password.ts` has `import "server-only"`, which throws under plain Node, so this flag is required for the CLI to load it at all.

### Removing all accounts

`npm run auth:reset -- --confirm` deletes every session, code, and activation link, then **anonymises** each account: no password, no phone, no name, and a placeholder email.

It anonymises rather than deletes because a `Customer` row owns booking history, and `Booking` owns payments, invoices, and inventory reservations. Deleting a user would cascade into real financial records. Bookings, payments, and invoices are left completely untouched.

### Removing an older demo database

### Removing an older demo database

For a database previously populated by the old demo seed, run the explicit cleanup command:

```bash
npm run db:clean-demo -- --confirm
```

The cleanup preserves customers, bookings, payments, and other real history. Referenced demo catalog records are archived instead of deleted; unrelated demo records are removed. It also clears the old demo business contact values.

## Database migrations

`npm run db:push` is appropriate for the current local/prototyping workflow. The committed `0001_init` and `0002_admin_catalog_payments` migrations are for fresh or deliberately baselined deployments. If the database was previously created with `db:push`, baseline its existing migration history before using `npm run db:migrate`; do not blindly deploy `0001_init` over an existing schema.

`0005_admin_access_control` adds the approval gate and the audit trail. It runs
in one transaction and backfills every pre-existing account to `ACTIVE`, so
deploying it does not lock anyone out. Accounts created after it default to
`PENDING_APPROVAL` and need approval.

`0006_first_party_auth` replaces the hosted identity provider with local
authentication. It adds the `AuthSession`, `OtpChallenge`, `ActivationToken`,
and `LoginAttempt` tables, adds the password and second-factor columns to `User`,
drops `clerkId` and `mfaEnforcedAt`, and makes `AdminAccessRequest.requesterId`
optional so the public "join the team" form needs no account.

Existing users keep their email, name, and phone, so bookings, invoices, and
payments are unaffected — but they have **no credential** after this migration and
cannot sign in until a super admin issues an activation link. That is deliberate:
an account that was only ever reachable through the old provider must not become
reachable by guessing. Run `npm run auth:reset -- --confirm` first if you want a
clean slate instead.

### Re-adding the customer sign-in provider

`0007_customer_sign_in_provider` adds a nullable, unique `User.clerkId` and the
`CREDENTIAL_CHANGE_BLOCKED` and `EMAIL_CHANGED` audit types. The column is NULL
for every staff and admin account, so nothing about the first-party flow changes,
and no existing row is rewritten.

Because it is a nullable unique column, adding it cannot conflict: PostgreSQL
treats every NULL as distinct. A customer's address is only linked to a provider
identity when no team account holds it (see
`resolveExternalIdentityClaim` in `lib/access-policy.ts`).

## Roles and routes

Authentication and access:

- `/sign-in` — staff and administrator sign-in (password, then a one-time code)
- `/customer/auth/sign-in`, `/customer/auth/sign-up` — customer sign-in via Clerk (Google or email)
- `/customer/auth/complete` — exchanges the provider session for the local one; never linked directly
- `/register` — permanently redirected to `/customer/auth/sign-up`
- `/join-the-team` — public staff/admin access request, no account required
- `/verify-two-factor`, `/two-factor-setup` — in-progress flows
- `/activate` — redeem a single-use activation link to set a password
- `/access-pending`, `/access-denied`, `/two-factor-required` — gate screens

Workspaces:

- `/customer/bookings/new` — public booking request
- `/customer/dashboard` — customer bookings, balances, notifications, and invoices
- `/customer/bookings/[id]` — booking details and Razorpay payment button
- `/customer/track?token=...` — public status tracking
- `/customer/access` — a signed-in user's own access-request state
- `/admin` — operational dashboard
- `/admin/bookings`, `/admin/events`, `/admin/calendar` — booking and event operations
- `/admin/inventory`, `/admin/packages`, `/admin/services` — catalog and stock management
- `/admin/payments`, `/admin/invoices`, `/admin/reports` — finance and reporting
- `/admin/staff`, `/admin/customers`, `/admin/admins`, `/admin/notifications`, `/admin/settings` — operations and access management
- `/admin/settings/credentials` — change your own email address and password
- `/admin/security` — security audit log (super admin only)
- `/staff` — staff assignment workspace

## Useful commands

```bash
npm run dev             # custom Next.js + Socket.IO development server
npm run build           # production build and type-check
npm run start           # custom production server
npm run lint            # ESLint
npm test                # unit tests
npm run prisma:generate # regenerate Prisma client
npm run db:push         # synchronize schema for local prototyping
npm run db:migrate      # deploy committed migrations
npm run db:seed         # create system roles and empty settings only
npm run db:clean-demo   # explicit old-demo cleanup; requires -- --confirm
npm run db:harden       # apply database-level balance/inventory checks
npm run admin:bootstrap # create the first super admin; refuses to create a second
npm run auth:reset      # remove every login; requires -- --confirm
```

## Real-time architecture

`server.mjs` runs Next.js and Socket.IO on the same HTTP server. The socket handshake is authenticated with the same `HttpOnly` session cookie the pages use: the server hashes it, looks up an `ACTIVE` session, and re-checks that the account is still `isActive` and `accountStatus = ACTIVE`. No token is ever exposed to client JavaScript, and a suspended account loses live updates within minutes. Authenticated admin sockets join the `admins` room. Server mutations publish small invalidation events only; PostgreSQL remains authoritative, and the client calls `router.refresh()` after an event. If a socket disconnects, a reconnect/reconciliation refresh restores missed updates.

This deployment shape requires a long-lived Node process with WebSocket support. For multiple application instances, add a Socket.IO Redis adapter and sticky sessions before scaling horizontally.

## Cloudinary and payments

Cloudinary uploads use the authenticated route `/api/admin/uploads`; the Cloudinary secret is never sent to the browser. Razorpay checkout uses `/api/payments/razorpay/order` and `/api/payments/razorpay/verify`. The browser amount is never trusted: the server reads the booking balance, converts rupees to integer paise, and settles the booking, invoice, payment, and notification in one serializable transaction. Configure the Razorpay webhook URL as:

```text
https://YOUR_DOMAIN/api/payments/razorpay/webhook
```

Subscribe to `payment.captured`, `payment.failed`, `order.paid`, and `order.expired` events. Test-mode keys should be used until the complete webhook, cancellation/refund, and reconciliation workflow has been verified in production.

## SEO and security deployment notes

- Set `NEXT_PUBLIC_SITE_URL` to the single canonical HTTPS origin. It is used for metadata, canonical URLs, JSON-LD, sitemap entries, host redirects, and Socket.IO origin protection.
- `app/robots.ts` and `app/sitemap.ts` publish only public pages and active catalog slugs. Admin, staff, customer, authentication, tracking, and API routes are excluded and receive private/noindex headers.
- Public pages include canonical metadata, OpenGraph/Twitter metadata, responsive Cloudinary images, and Organization/WebSite/OfferCatalog JSON-LD. Add verified `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` values when available.
- Configure a trusted reverse proxy/WAF or Redis-backed limiter for multi-instance production. The included limiter is process-local and is intended as a defense-in-depth baseline, not a replacement for edge/WAF limits; configure the proxy to overwrite forwarded IP headers rather than pass client-supplied values.
- Keep the CSP allowlist aligned with any future payment or analytics providers. Test Razorpay Checkout in the target browser before enabling production payments.
- Never log full booking, payment, webhook, or public tracking URLs. Rotate all development credentials before production.
- Set `SESSION_FINGERPRINT_SALT` to a long random value and keep `SESSION_MAX_AGE_HOURS` short for admin accounts. Session tokens are bearer credentials: treat any leak of one as a full compromise of that account.
- The app-side limiter is process-local. For multiple instances, put a trusted WAF or Redis-backed limiter in front, and configure the proxy to overwrite forwarded IP headers rather than pass client-supplied values.
- `SecurityEvent` rows are an audit trail, not a log to trim. Archive them to cold storage rather than deleting them, and alert on a rise in `SIGN_IN_BLOCKED`, `TWO_FACTOR_FAILED`, or `DEVICE_LIMIT_REACHED` at `/admin/security`.

## Data integrity notes

- Package contents are copied onto each booking as a snapshot, so later catalog edits do not change inventory requirements for existing requests.
- Inventory counters use conditional updates and serializable transactions; archived inventory is excluded from new reservations.
- Successful payments are the only rows included in revenue reports. Pending/failed/late Razorpay attempts remain in `PaymentOrder` and `PaymentWebhookEvent`; late captures are marked `RECONCILIATION_REQUIRED` rather than consuming another order's reservation.
- Paid bookings cannot be cancelled until a controlled refund workflow is implemented; successful payment records are never deleted.
- Keep database, SMTP, SMS, Cloudinary, Razorpay, and production webhook secrets in the deployment platform's secret manager.
- `User.accountStatus` is the authoritative access decision. Do not rely on `isActive` alone: suspension and rejection clear it, and it says nothing about whether an account was ever approved.
