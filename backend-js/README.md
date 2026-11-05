# TypeScript backend

This service is the incremental replacement for the Django API. Django remains
the schema owner and fallback API while modules are migrated.

## Setup

The service requires PostgreSQL; it does not fall back to SQLite.

```bash
cd backend-js
cp .env.example .env
npm install
npm run check
npm run dev
```

It listens on `http://127.0.0.1:8001` by default.

- `GET /api/health/` preserves Django's `{ "status": "ok" }` contract.
- `GET /api/ready/` checks PostgreSQL and returns HTTP 503 when it is unavailable.

## Database safety during coexistence

- Django migrations are the only schema-change mechanism.
- Do not run `prisma migrate` against a shared database.
- `npm run db:pull` introspects the existing PostgreSQL schema and should first
  be reviewed against a disposable or development database.
- The generated Prisma client is ignored because it is recreated by builds.
- The TypeScript service must not write a module's tables until that module has
  passed contract tests and its routes have formally moved from Django.

## Commands

```bash
npm run dev          # watch mode
npm run build        # generate Prisma client and compile
npm run check        # lint, typecheck, and tests
npm run db:validate  # validate Prisma schema without changing the database
npm run db:pull      # introspect an existing PostgreSQL database
```
