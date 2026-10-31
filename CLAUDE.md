# bns-back local development

## Purpose

`bns-back` is the Express API used by `bns-front` (BNS corporate portal: admin, HR, IT support, vacations). It uses Neon Postgres for all data and Vercel Blob private storage for employee documents.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to the Neon connection string and `BLOB_READ_WRITE_TOKEN` to the Vercel Blob token.
3. Install dependencies with `pnpm install`.
4. Apply migrations with `pnpm db:migrate`.
5. Optionally load demo data with `pnpm db:seed` (skipped when users/employees already exist; demo logins: `admin`/`admin123`, others `demo123`).
6. Start the API with `pnpm dev`.

The API runs on port `4000` by default. Set `CORS_ORIGIN` to the frontend origin; multiple origins may be comma-separated.

## Layout

- `src/server.ts` — app setup, router mounting, error mapping (`HttpError`, multer, unique violations).
- `src/db/` — pool, migrations, `tables.ts` (camelCase entity ↔ snake_case row mapping, `transaction`, `nextNumber`), `seed.ts`.
- `src/domain/` — auth/sessions, permissions-aware business rules, Blob uploads.
- `src/routes/` — one router per area.
- `src/lib/` — enums, permissions, format helpers and DTO types mirrored from `bns-front/lib`; keep both copies in sync.

## Auth

Cookie session `bns_session` (httpOnly, SameSite=Lax, 12h) stored in `sessions`. The frontend proxies `/api/*` through Next.js rewrites, so the cookie is first-party on the frontend domain. Permissions come from roles (`roles.permissions`).

## Endpoints

- `GET /health` checks the API and database connection.
- `/api/auth`: `POST /login`, `POST /logout`, `GET /me`.
- `/api/admin`: `users` (GET, POST, PATCH `:id` with `action` = `update` | `reset_password`), `roles` (GET, POST, GET/PATCH/DELETE `:id`).
- `/api/audit`: GET with `app`, `entityId`, `userId`, `from`, `to`, `q`, `limit`.
- `/api/hr`: `stats`, `departments` (+ `:id`), `employees` (+ `:id`, `:id/documents` multipart upload field `file`), `documents` (+ `:id` download/delete, `?inline=1`).
- `/api/hardware` (+ `:id` with `action` = `assign` | `unassign` | `update`), `/api/my/hardware`.
- `/api/tickets` (+ `:id` with `action`, `:id/comments`), `/api/purchases` (+ `:id` with `action` = `approve` | `reject` | `deliver`).
- `/api/leave` (`scope` = `my` | `approvals` | `employee` | `all`), `balance`, `calendar`, `:id` (PATCH `action` = `approve` | `reject` | `cancel`).
- `/api/lookup`: `employees`, `departments`, `engineers`.

## Conventions

- Keep database changes as ordered SQL files in `src/db/migrations`.
- Run migrations before starting the API after schema changes.
- Never commit `.env`, database URLs, or Blob tokens.
- Keep private Blob URLs server-side; documents are streamed through `GET /api/hr/documents/:id`.
- Every route must call `requireAuth` and the relevant `requirePermission` before touching data.
- Use parameterized SQL queries and validate request input.
- Wrap multi-statement writes in `transaction()`; numbered entities get their number via `nextNumber()`.
- The legacy `files` table (migration 001) is unused and can be dropped once its Blob objects are no longer needed.
