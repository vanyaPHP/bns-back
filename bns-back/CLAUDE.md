# bns-back local development

## Purpose

`bns-back` is the Express API used by `bns-front`. It uses Neon Postgres for metadata and Vercel Blob private storage for uploaded files.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to the Neon connection string and `BLOB_READ_WRITE_TOKEN` to the Vercel Blob token.
3. Install dependencies with `pnpm install`.
4. Apply migrations with `pnpm db:migrate`.
5. Start the API with `pnpm dev`.

The API runs on port `4000` by default. Set `CORS_ORIGIN` to the frontend origin; multiple origins may be comma-separated.

## Endpoints

- `GET /health` checks the API and database connection.
- `GET /api/files` lists stored file metadata. Optional `ownerId` filters results.
- `POST /api/files` accepts a multipart form field named `file`; optional `ownerId` stores ownership metadata.
- `DELETE /api/files/:id` deletes both the database record and private Blob object.

## Conventions

- Keep database changes as ordered SQL files in `src/db/migrations`.
- Run migrations before starting the API after schema changes.
- Never commit `.env`, database URLs, or Blob tokens.
- Keep private Blob URLs server-side; return pathname and metadata only.
- Add authentication and enforce owner scoping before exposing this API publicly.
- Use parameterized SQL queries and validate request input.
