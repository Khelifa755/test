# Kilo VPS — Paid-Subscription Enforcement Backend

## Goal

Add a thin VPS backend that gates every CLI command behind authentication,
device binding, and per-tier quota. Inference stays on the user's local Ollama
+ minimax-m3-cloud. **The VPS never pays for AI.** Subscription enforcement is
"honest-user enforcement" with strong server-side signals, not tamper-proof
DRM. Bypass is accepted as the cost of the business model.

## Non-goals

- Proxying or observing AI inference.
- Hosting / sharding Ollama for users.
- Stripe integration this iteration (D17 Tunisia / cash first; schema stays vendor-shaped).
- Multi-operator admin (single-operator MVP).
- Email delivery (no SMTP).
- Tamper detection on the binary.

## Architecture (data flow)

```
User types: kilo chat "..."
  │
  ▼
yargs middleware (src/index.ts)  ── POST /v1/heartbeat  ──▶  Hono VPS
  │   {access_jwt, device_id, command}                              │
  │                                                           Postgres
  ▼                                                           users / devices /
if (allowed:true, tier, remaining) → proceed                   refresh_tokens /
else (402)                  → "upgrade required"               usage_daily /
else (401)                  → refresh once, retry, else login    admin_grants /
else (403)                  → "revoked / banned"                schema_migrations
else (network)              → soft-fail (free/paid/grace),
                              hard-fail (flagged-for-payment-fail)
  ▼
CLI calls user's local Ollama (http://localhost:11434) with minimax-m3-cloud
  ▼
Stream response to TUI
```

## Decisions (locked)

| Decision | Choice | Reason |
|---|---|---|
| Host | Single VPS + Postgres | Cheapest at 10 users; $20/mo ceiling. |
| Stack | Bun + Hono + Postgres (Bun.sql) | Repo is already Bun-first; reuse CLI zod schemas. |
| Billing | Manual now, vendor-shaped schema | Cash / D17 first; Stripe slots in without schema churn. |
| Admin UI | Tiny static HTML served by Hono | One-operator dashboard. |
| Free meter | Daily count of `kilo` command starts | Easy server-side; matches "free N/day" framing. |
| Heartbeat | Per command | Strongest enforcement in the accepted set. |
| Bypass stance | Honest-user enforcement + detection | Tamper-proof impossible on user devices. |
| Migrations | On-boot, idempotent via `schema_migrations` | Safe for one operator. |
| Admin auth | Single env `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (bcrypt) + session cookie | Avoid user-table bloat. |
| Grace window | 30 days after expiry, then auto-downgrade to `free` | Forced renewals for cash-first cohorts. |
| Whitelist (no heartbeat) | `login`, `logout`, `help`, `--version`, `--help`, `serve`, `upgrade`, `uninstall`, `web`, `admin`, `stats` | Plus `--no-vps` hidden escape hatch. |

## Out of scope (explicit)

- Stripe Checkout, webhook signature verification, customer portal.
- Multi-admin RBAC.
- D17 Tunisia integration (schema pre-shaped for it).
- Email delivery (no SMTP / SES / Resend).
- Analytics beyond `usage_daily`.
- Heartbeat cryptography beyond RS256 access tokens.
- Tamper detection on the binary.
- OpenAI / Anthropic / Ollama adapter — VPS never sees prompts.

## Affected boundaries (no source edits this turn)

| Path | Change | Marker |
|---|---|---|
| `src/index.ts` | Extend the existing yargs `.middleware` to fire a heartbeat per command | kilocode_change |
| `src/kilocode/cli/setup.ts` | Add `KiloCli.heartbeat()` helper used by middleware | kilocode_change |
| `src/auth/` | Persist a `vps_token` field next to existing oauth/key in the existing `Auth` namespace | reuse existing |
| `vps/` (new) | Hono app, Postgres adapter, CLI routes, admin routes, schema migrations, dashboard HTML | new, outside `packages/opencode/` |

VPS code lives outside `packages/opencode/` to keep upstream merge clean.

## Postgres schema (final)

```
users(
  id            uuid pk default gen_random_uuid(),
  email         text unique not null,
  password_hash text,
  created_at    timestamptz default now(),
  tier          text not null default 'free',     -- 'free' | 'paid' | 'grace'
  grace_until   timestamptz,
  is_admin      boolean default false
)

devices(
  id            uuid pk default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  device_id     text not null,
  platform      text,
  first_seen    timestamptz default now(),
  last_seen     timestamptz default now(),
  revoked       boolean default false,
  unique(user_id, device_id)
)
create index devices_device_id_idx on devices(device_id);

refresh_tokens(
  id            uuid pk default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  device_id     text not null,
  token_hash    text not null,                   -- sha256 of opaque refresh token
  created_at    timestamptz default now(),
  rotated_at    timestamptz,
  revoked_at    timestamptz
)
create index refresh_tokens_user_device_idx on refresh_tokens(user_id, device_id);

usage_daily(
  user_id       uuid not null references users(id) on delete cascade,
  device_id     text not null,
  day           date not null,                   -- UTC
  command_count int  not null default 0,
  primary key(user_id, device_id, day)
)

admin_grants(
  id            uuid pk default gen_random_uuid(),
  user_email    text not null,
  tier          text not null,                   -- 'paid' | 'grace'
  granted_days  int  not null,
  granted_at    timestamptz default now(),
  granted_by    text
)

revocations(
  id            uuid pk default gen_random_uuid(),
  user_id       uuid not null references users(id),
  reason        text,
  revoked_at    timestamptz default now(),
  revoked_by    text
)

schema_migrations(
  filename      text primary key,
  applied_at    timestamptz default now()
)
```

`users.tier` and `users.grace_until` are the ONLY subscription-state columns.
They are vendor-agnostic so D17/Stripe swap in later.

## VPS API surface (Hono)

### Public (CLI)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/auth/signup` | `{email, password, device_id}` | `{access_token, refresh_token}` |
| POST | `/v1/auth/login` | `{email, password, device_id}` | `{access_token, refresh_token}` |
| POST | `/v1/auth/refresh` | `{refresh_token, device_id}` | `{access_token, refresh_token}` |
| POST | `/v1/auth/logout` | `{refresh_token}` | `204` |
| POST | `/v1/heartbeat` | `{access_token, device_id, command, ts}` | `{allowed, tier, remaining, retry_after?}` |
| GET  | `/v1/me` | Bearer | `{email, tier, devices:[…]}` |
| POST | `/v1/devices/:device_id/revoke` | Bearer | `204` |

### Admin (cookie session)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET  | `/admin` | — | Dashboard HTML |
| POST | `/admin/login` | `{email, password}` | `302` + session cookie |
| POST | `/admin/logout` | — | `302` |
| GET  | `/admin/users` | — | `{users:[…]}` JSON |
| POST | `/admin/grant` | `{email, tier, days}` | `200` |
| POST | `/admin/revoke` | `{email, reason}` | `200` |

All admin routes: `is_admin` check + `HttpOnly; Secure; SameSite=Lax` cookie.

## Heartbeat decision algorithm

```
on POST /v1/heartbeat(access_token, device_id, command):
  user := verify(access_token)               // RS256, 15-min expiry
  if device(user.id, device_id).revoked: return {allowed:false, reason:'revoked'}
  if device_count(user.id) > limit(user.tier): return {allowed:false, reason:'too_many_devices'}
  free := user.tier == 'free'
  if user.tier == 'grace' and user.grace_until < now():
    update users set tier='free', grace_until=null
    return {allowed:false, reason:'grace_expired'}
  row := usage_daily(user.id, device_id, today_utc)
  if free and row.count >= 10:
    return {allowed:false, reason:'quota', retry_after:seconds_to_midnight_utc}
  upsert usage_daily.count += 1
  upsert devices.last_seen := now
  return {allowed:true, tier:user.tier, remaining: free ? 10 - count : null}
```

Network failure policy:

- Free / paid / grace: retry once with jitter, then **fail open**
  (run command) with a one-line warning banner "offline".
- Flagged-for-payment-failure users: **fail closed** after retry.
- Whitelisted commands always run without a heartbeat.

## CLI integration (smallest invasive surface)

The yargs middleware in `src/index.ts` already runs once per command. Extend
it:

1. Read `process.argv[1..]` to derive `command`.
2. Skip heartbeat for whitelisted commands.
3. Resolve `device_id` from `~/.local/share/kilo/` storage (UUID v4 minted on
   first run, persisted in the same JSON store the existing `Auth` namespace
   uses).
4. Pull the current `access_token` from the existing `Auth` store, refresh
   silently on 401 via `POST /v1/auth/refresh`.
5. POST to `${KILO_VPS_URL}/v1/heartbeat`.
6. On `allowed:false` → friendly error, `process.exit(2)`.
7. Network retry once with backoff; on persistent failure, fail-open policy
   above.

Touched files (kilocode_change):

- `src/index.ts` — extend existing `.middleware`.
- `src/kilocode/cli/setup.ts` — new `heartbeat()` helper + `KILO_VPS_URL`
  env tag.

Everything else is new code under `vps/`. No merge impact beyond one small
extension of an existing middleware that upstream merges will preserve.

## Auth flow (CLI side)

1. `kilo login` → opens browser to `${KILO_VPS_URL}/auth/cli?device_id=…`,
   polls for completion (matches the existing OAuth PKCE flow used in this
   repo for `kilo console`). Fallback: email + password.
2. `kilo logout` → POST revocation, deletes local refresh token.
3. Refresh tokens rotated on every use; reuse detection revokes the entire
   family and forces re-login for that device.
4. JWT signing keys live on VPS only; CLI never sees the private key.
5. Per-tier device cap enforced server-side: free=1, paid=3, admin=50.

## Admin dashboard (minimum viable)

A single static HTML page served by Hono:

- **Users table** — email, tier, last_seen, device count, command count today.
- **Grant** — form: email, tier (paid / grace), days. Inserts `admin_grants`
  and flips `users.tier` and `grace_until`.
- **Revoke** — form: email, reason. Flips `users.tier = 'free'`, sets
  `devices.revoked = true` for all of that user's devices, inserts
  `revocations`.

No JS framework. Auth via `POST /admin/login` session cookie.

## Security model (honest)

| Risk | Accepted because | Mitigated by |
|---|---|---|
| User bypasses CLI, runs Ollama directly | We don't see inference anyway | Free is funnel only; paid is the business |
| User replays captured JWT | 15-minute window | Short expiry + refresh rotation + device binding |
| User shares password across N devices | Bearer model inherently shareable | Per-tier device cap; surplus devices see 403 |
| User re-uses `refresh_token` | Tracked server-side | Reuse revokes the entire family + force re-login |
| User edits CLI binary to skip heartbeat | No DRM on user hardware | All billing signal is server-side; honest-user default; stalled `last_seen` flagged and banned |
| MitM | Standard TLS | TLS 1.2+, HSTS, no client-side fallbacks |
| VPS admin pwned | Single operator | bcrypt password, audit log, revoke-everything action |
| Brute-force login | Standard | bcrypt cost ≥ 12, IP throttle, exponential backoff |
| DB dump leaks password hashes | Standard | bcrypt, audit log retention bound |

Bypass is **possible**, but in all cases the bypass either (a) skips the
product, (b) uses the user's own rate-limited bucket, or (c) is visible as a
stalled `last_seen` heartbeat stream.

## Cost model (10 paid users, single VPS)

| Item | Monthly |
|---|---|
| Hetzner CPX21 (4 GB) | ~€8 |
| Managed Postgres (or self-hosted in Docker) | €0–15 |
| Domain + TLS (Let's Encrypt free) | €0 |
| **Total** | **€8–23/mo** |

Per-command auth roundtrip: ~150 ms p95. Acceptable for a CLI command.

## Rollout / migration

1. Stand up VPS, run migrations on first boot.
2. Set env: `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`,
   `JWT_PRIVATE_KEY_PEM`, `JWT_PUBLIC_KEY_PEM`, `KILO_VPS_URL`.
3. Self-test: create user, grant `paid`, run heartbeat, see `200`.
4. First cohort: grant each email manually via the dashboard.
5. CLI bump: add `KILO_VPS_URL` default pointing at staging URL, ship CLI
   with `--no-vps` hidden flag for the first two weeks of verification.
6. After 30 days, evaluate payment provider (D17 Tunisia → Stripe).

## Validation plan (definition of done)

1. `bun run typecheck` clean in both `packages/opencode/` and `vps/`.
2. `bun test` in `packages/opencode/` covers the new heartbeat module.
3. End-to-end curl reproduction of every API path with asserts.
4. End-to-end CLI run: `kilo login` → `kilo chat "hi"` →
   `usage_daily.command_count = 1` in Postgres.
5. Free-user quota: simulate 11 commands in one day → 12th gets `quota`.
6. Grace expiry: fast-forward `grace_until` → next command flips tier to
   `free`.
7. Reuse detection: refresh twice with same token → second returns `401`
   and revokes family.
8. Admin grant: `kilo admin grant test@x paid --days 30` → user row
   updated, next heartbeat sees `tier=paid`.
9. Network fail-open: stop VPS, run command, command succeeds with offline
   banner.

## Open questions

- **D17 Tunisia integration:** out of scope this iteration. Schema already
  accommodates it via `users.tier` + `admin_grants`. Drop a `payments`
  table when ready.
- **Multi-admin RBAC:** single env-var login only this iteration. Add
  `users.is_admin` management under a future iteration.
- **Heartbeat latency budget:** 150 ms p95 target. Revisit if users
  complain.
- **Reverse proxy:** assume Hetzner direct. Add Cloudflare in front if/when
  DDoS becomes a concern.

## Stage 1 — 10-20 users (MVP)

**Profile:** single operator (you), cash / D17 payments, manual grants,
forgiving UX. Every architectural choice is "good enough at this scale,
won't fight us later."

### Infrastructure
- 1× Hetzner CPX21 (4 GB ARM, ~€8/mo) running the Hono VPS.
- 1× Hetzner-managed Postgres (or a second small VPS running Postgres in
  Docker with `pg_dump` cron to a Hetzner Storage Box — €0).
- TLS via Let's Encrypt (`certbot --nginx` or Caddy).
- Domain: `vps.kilo.example.com` A-record to the VPS IP.

### Cost ceiling
- ~€8 VPS + €0-15 Postgres + €0 domain + €0 TLS = **€8-23/mo** total.

### Operations you actually do
- **Backups:** nightly `pg_dump` → Hetzner Storage Box, retained 14 days,
  manual restore drill once per month.
- **Migrations:** applied on `kilo serve` boot, idempotent.
- **Rollback:** keep previous binary on disk as `kilo.prev`; revert is a
  one-line symlink swap.
- **Monitoring:** SSH in, run `journalctl -u kilo --since "1 hour ago"` and
  `psql -c "select count(*), tier from users group by tier"`. No
  third-party tools. 5 minutes a day.
- **Alerts:** none. You check it.

### Billing
- Manual only. `POST /admin/grant` from the dashboard.
- D17 Tunisia integration: **drop in when you cross 15 paying users.**
  Until then, schema already mirrors what D17 would need.
- No Stripe yet.

### Admin
- One operator. Single `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` env.
- Dashboard is plain HTML, served by Hono, no JS framework.

### Security posture
- TLS 1.2+, HSTS, RS256 JWT (15 min) + refresh tokens (60 days).
- bcrypt cost 12 (fine at this traffic).
- Per-tier device cap server-side: free=1, paid=3, admin=50.
- Per-IP login throttle (5/min, exponential backoff after 3 fails).
- Reuse-detection on refresh tokens.
- Single VPS, single operator — no MFA on admin yet.

### What you explicitly **don't** build at this stage
- No Stripe / D17 yet.
- No HA / failover.
- No log aggregation.
- No MFA.
- No co-admin.
- No payment-failure handling beyond `is_admin`-visible warning.
- No SLA, no on-call.

### Hard ceiling — when this plan must change

Promote to Stage 2 the first time **any** of these fire:

| Trigger | Why it matters |
|---|---|
| Active paying users > 20 | Manual grants no longer scale |
| You want to take a vacation | No one else can administer the box |
| A VPS outage has cost you ≥ 1 cancelled renewal | Single point of failure bites |
| You need to issue an actual invoice for tax / accounting | Manual ops won't survive audit |
| You onboard a co-founder / employee | Multi-admin becomes non-optional |
| Any payment failure reported to you | Without automation, you lose paying users |
| Auth logs show > 10 probes / day from non-users | Brute-force threat grows |
| `users where tier='paid' and grace_until < now - 7 days` ≥ 5 | Quiet revenue bleed |

If **none** of these fire at 100 users, the MVP keeps running another quarter.
If **two or more** fire by the time you hit 30 users, jump to Stage 2 immediately.

## Stage 2 — 100-500 users

**Profile:** you now have real revenue, real uptime expectations, real
abuse surface. Keep the same Postgres schema; add the operational muscle
that the business needs.

### Infrastructure changes
- 2× Hetzner CPX31 (8 GB ARM, ~€16/mo each).
- One runs the Hono VPS (active).
- Second runs Postgres with streaming replication to a hot standby on a
  third CPX21 (~€8/mo). Promote standby on primary failure.
- Hetzner Load Balancer (or HAProxy on a small VPS) fronts both, fail-over
  in ~30 s.
- Hetzner Storage Box for offsite backups, retained 30 days.
- PITR enabled on Postgres (3 days rolling).
- Optional: Cloudflare in front for DDoS protection and edge rate limiting
  on auth endpoints.

### Cost ceiling
- 2× CPX31 + 1× CPX21 + Storage Box + LB + Cloudflare = **~€50-70/mo**.
- Inference still $0 (you're not proxying AI).
- At 100 paying users × €20/mo that's €2k/mo revenue; infra is 2.5-3.5%.

### Operations you actually do
- **Backups:** nightly `pg_dump` + WAL archive + 14-day retention. PITR
  available up to 3 days.
- **Migrations:** still on-boot, but gated behind a `--migrate` flag (or
  a `migrate` subcommand) so prod boots don't silently apply.
- **Monitoring:** Uptime Kuma or Better Stack (free tier covers this) for
  uptime + Postgres lag + JWT errors. Page alerts: VPS down, Postgres
  replica lag > 60s, heartbeat 5xx > 1%, login 5xx > 1%, disk > 80%, RAM
  > 85%.
- **Logs:** journald → syslog → a small VPS running Loki, or direct to
  Better Stack's log drain. 30-day retention.
- **Rollback:** blue/green deployment via systemd unit swap, keep previous
  binary on disk 2 versions deep.
- **Runbook:** a Markdown file in `vps/runbook/` with on-call procedures
  for the top 5 incident types.
- **Restore drill:** quarterly.

### Billing
- Pick a vendor (D17 Tunisia continues, or Stripe). Plan-only choice:
  gated by where your users are and what their banks support.
- Webhooks (signed) flip `users.tier` and `grace_until` automatically.
- Dunning: email-on-file (Resend / SES, ~€0-5/mo for 500 users).
- Stripe Customer Portal (or vendor equivalent) for self-serve upgrades
  and invoice downloads.
- Service is paid through tier transitions; admin grants exist only for
  comp accounts.

### Admin
- Replace env-var login with `users.is_admin = true` row + bcrypt. The
  same login form (`/admin/login`) but the DB is the source of truth.
- Add a second admin before onboarding anyone who needs admin (principle
  of two).
- Audit log: every admin action goes to `admin_audit_log`.
- MFA on admin login (TOTP). Both of you install Authy/1Password.
- 24-hour session for admin, forced re-login for sensitive actions
  (grant, revoke).

### Security posture
- Switch password hashing from bcrypt → **argon2id** (memory-hard,
  GPU-resistant).
- Cloudflare WAF rules in front of `/v1/auth/*` (geofencing optional).
- Per-IP login throttle moves to Cloudflare or Redis-backed on VPS.
- Mandatory CLI update channel pinned to `stable`; old versions get
  `min_version` rejection on `/v1/heartbeat`.
- Sign the JWT private key with HSM / cloud KMS (or at minimum rotate
  quarterly).
- Bug-bounty program opened on Open Bug Bounty or Huntr (free-ish for
  indie projects).
- CSP / SameSite=Strict / cookie prefixes (`__Host-`) on admin cookies.

### What you explicitly build at this stage
- Stage-2 schema additions:
  ```sql
  create table payments (
    id            uuid pk default gen_random_uuid(),
    user_id       uuid not null references users(id),
    provider      text not null,            -- 'd17' | 'stripe'
    external_id   text unique not null,
    amount_cents  int not null,
    currency      text not null,
    status        text not null,            -- 'pending' | 'succeeded' | 'failed' | 'refunded'
    created_at    timestamptz default now()
  );
  create table admin_audit_log (
    id            bigserial pk,
    admin_id      uuid not null references users(id),
    action        text not null,            -- 'grant' | 'revoke' | 'login' | etc.
    target        text,                     -- email or id
    metadata      jsonb,
    at            timestamptz default now()
  );
  create table sessions (
    id            uuid pk default gen_random_uuid(),
    user_id       uuid not null references users(id),
    device_id     text not null,
    issued_at     timestamptz default now(),
    last_seen_at  timestamptz default now(),
    revoked_at    timestamptz,
    ip            inet,
    user_agent    text
  );
  ```
- Optional but recommended: `provisioning` table tracking per-user Ollama
  install-state for the rare user who can't self-install (support team
  handles this manually). Don't automate it.
- Optional but recommended: `tickets` table for when support requests
  enter the DB. Plain JSON + an email bridge is enough.

### What you **don't** build at this stage
- Multi-region (still single region; ~50ms p95 from anywhere is fine).
- Compliance certifications (SOC2, ISO27001) — only when a customer asks.
- Self-serve sign-up SLA beyond "works most days".
- Email infrastructure beyond vendor-dunning notifications.

### Hard ceiling — when Stage 2 itself must change

| Trigger | Action |
|---|---|
| Active paying users > 500 | Multi-region + managed Postgres (Crunchy / Neon) |
| Free-tier command denials > 1k/day | Quota too aggressive; reconsider pricing |
| Reverse proxy CPU > 70% sustained | Move to dedicated HAProxy + WAF |
| Postgres > 100 GB | Migrate to managed + read replica |
| You hire your first support hire | Add SLA + on-call rotation |
| First paid customer requests SSO | OIDC, add `external_identities` table |
| Compliance requested | SOC2 Type I, then II |

Stage 1 → Stage 2 conversion is **the** biggest operational jump on this
list. Plan a quarter of runway before starting it; do not half-build it.

## Implementation task list (when the user switches to an implementer)

1. **VPS skeleton**
   - `vps/package.json` (Bun + Hono + zod)
   - `vps/migrations/0001_init.sql` (schema above, no `is_admin` until later)
   - `vps/src/db.ts` — Postgres pool via `Bun.sql`, migration runner
   - `vps/src/server.ts` — Hono app wiring + CORS + rate limit middleware
2. **Auth**
   - `vps/src/routes/auth.ts` — signup / login / refresh / logout
   - `vps/src/routes/me.ts`
   - `vps/src/util/jwt.ts` — RS256 key load + issue/verify
   - `vps/src/util/passwords.ts` — bcrypt cost 12 + login throttle
3. **Heartbeat**
   - `vps/src/routes/heartbeat.ts` — implements the decision algorithm
4. **Admin**
   - `vps/src/routes/admin.ts` — login/logout/grant/revoke/users
   - `vps/src/admin/index.html` — single static dashboard
   - `vps/src/admin/session.ts` — cookie session store
5. **CLI integration** (kilocode_change)
   - `src/index.ts` — extend existing `.middleware`
   - `src/kilocode/cli/setup.ts` — add `heartbeat()` helper + env tag
   - tests in `packages/opencode/test/kilocode/heartbeat.test.ts`
6. **Operator scripts**
   - `vps/script/seed-admin.ts` — hash `ADMIN_PASSWORD` and print
   - `vps/script/jwt-keys.ts` — generate RS256 keypair
   - `vps/script/backup.sh` — `pg_dump` to Storage Box, 14-day retention
7. **Validation**
   - `vps/test/api.test.ts` — Bun test covering every endpoint
   - Manual CLI run per Definition of Done items 4–9 above

### Stage 2 follow-up migrations (do not write now)
- `vps/migrations/0002_payments.sql`
- `vps/migrations/0003_admin_audit_log.sql`
- `vps/migrations/0004_sessions.sql`
- `vps/migrations/0005_argon2_passwords.sql` — add `password_alg` column,
  dual-hash on next login, drop bcrypt once migration complete
