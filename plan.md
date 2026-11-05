# JavaScript Backend Migration Plan

## 1. Goal

Replace the Django REST API with a TypeScript backend incrementally while:

- keeping the existing Next.js frontend working;
- keeping Django available as the reference implementation until migration is complete;
- continuing to use PostgreSQL;
- preserving the current `/api/...` routes and JSON contracts;
- avoiding a high-risk, all-at-once rewrite;
- protecting billing, credit, interest, authentication, and historical data.

This is a backend migration, not a frontend rewrite. The existing Next.js application should require little or no feature-level modification when the new API preserves the current contract.

## 2. Recommended Target Stack

- **Runtime:** Node.js (current active LTS)
- **Language:** TypeScript with strict mode enabled
- **HTTP framework:** Fastify
- **Database:** PostgreSQL
- **Database access:** Prisma initially mapped to the existing PostgreSQL schema
- **Validation:** Zod or Fastify JSON Schema
- **Authentication:** JWT access and refresh tokens with server-side revocable sessions
- **Testing:** Vitest for unit/integration tests and API contract tests
- **API documentation:** OpenAPI generated from route schemas
- **Logging:** Structured logs with request IDs and sensitive-field redaction

Express can be used instead of Fastify if the team is more familiar with it. The migration order and safety rules remain the same.

## 3. Core Migration Strategy

Use an incremental **strangler migration**:

1. Django remains the production backend at the beginning.
2. A new TypeScript service is added alongside it.
3. The existing Django implementation, tests, models, serializers, and API responses are treated as the behavioral specification.
4. Endpoints are implemented and verified in TypeScript one module at a time.
5. A reverse proxy or API gateway sends migrated routes to TypeScript and all other routes to Django.
6. Every route can be switched back to Django independently during the transition.
7. Django is removed only after all routes, background tasks, data ownership, and operational checks have migrated.

Do not rewrite the frontend and backend simultaneously. Do not change API behavior merely to make the migration easier. Intentional API improvements should be separate, reviewed changes after parity is achieved.

## 4. Non-Negotiable Compatibility Rules

The TypeScript API must preserve the following unless an explicit versioned change is approved:

- route paths, including trailing slash behavior;
- HTTP methods and status codes;
- request field names and query parameters;
- response field names, nesting, ordering where relevant, and nullability;
- validation rules and useful error responses;
- authorization rules;
- date formatting and the `Asia/Kathmandu` business timezone;
- pagination, search, filtering, and sorting behavior;
- money and weight values represented as decimal strings in JSON;
- interest calculations and rounding behavior;
- deletion protection and relationship constraints;
- session revocation and refresh-token behavior.

Never calculate money with ordinary JavaScript `number` arithmetic. Use PostgreSQL `numeric` columns and a decimal library such as `decimal.js`, and serialize monetary values as strings.

## 5. Repository Layout

Add the new service without moving the existing applications initially:

```text
jms/
├── frontend/              # Existing Next.js application
├── backend/               # Existing Django reference and fallback API
├── backend-js/            # New TypeScript API
│   ├── prisma/
│   ├── src/
│   │   ├── config/
│   │   ├── db/
│   │   ├── modules/
│   │   ├── plugins/
│   │   ├── shared/
│   │   └── app.ts
│   ├── tests/
│   └── package.json
└── plan.md
```

Organize `backend-js/src/modules/` by business capability rather than by generic controller/service folders:

```text
modules/
├── health/
├── auth/
├── customers/
├── business-sources/
├── bhaka-patras/
├── bills/
├── credits/
├── accounts/
└── pledges/
```

## 6. Database Ownership During Migration

Both services may connect to the same PostgreSQL database temporarily, but ownership must be explicit.

### Initial rule

- Django migrations remain the only source of schema changes.
- Prisma introspects and maps to the existing tables; it must not rename or recreate them.
- Prisma migrations must not be applied to shared or production databases yet.
- Django remains the writer for any module that has not been cut over.
- After a module is cut over, only the TypeScript service should write through that module's API routes.

### Safety rules

- Do not dual-write the same business operation from both services.
- Do not allow both ORMs to independently evolve the same table.
- Preserve existing primary keys and foreign keys during the migration.
- Use database transactions for multi-record operations.
- Reproduce `PROTECT`, `CASCADE`, uniqueness, check constraints, and row-locking semantics.
- Use a dedicated database user for each service so access can be audited and restricted.
- Back up and restore-test the database before every production schema or ownership change.

### Final ownership transfer

After all API modules have migrated and Django writes are disabled:

1. record the final Django migration state;
2. create a Prisma baseline matching the production schema;
3. verify that the baseline produces no destructive diff;
4. make Prisma migrations the only schema migration mechanism;
5. archive Django migrations with the retired backend.

## 7. Definition of Parity

An endpoint is not migrated merely because it returns a successful response. It reaches parity only when:

- success responses match the Django API contract;
- validation and error cases match intentionally;
- authentication and permissions are enforced;
- database writes and relationship behavior match;
- relevant Django test scenarios have TypeScript equivalents;
- contract comparison tests pass against both services;
- concurrency-sensitive behavior has been tested;
- logs and metrics are available;
- the route has a tested rollback switch.

For each endpoint, store representative request/response fixtures with secrets and personal data removed. Run the same fixture suite against Django and TypeScript and compare normalized responses.

## 8. Migration Phases

## Phase 0 — Baseline and Freeze the Contract

**Purpose:** Establish exactly what the current backend does before building its replacement.

### Work

- Run and record the complete Django test suite.
- Inventory all routes, methods, query parameters, response shapes, and permissions.
- Inventory PostgreSQL tables, columns, indexes, constraints, and relationships.
- Identify production-only settings, file storage, cleanup jobs, trusted proxy rules, and deployment configuration.
- Capture sanitized API fixtures for successful and failing requests.
- Document current known bugs separately so they are not accidentally treated as desired behavior.
- Record representative financial calculation cases, including rounding boundaries and historical payments.
- Add missing Django tests where behavior is important but currently implicit.

### Completion gate

- The current test suite passes or all existing failures are documented.
- Every current endpoint has an owner and a contract entry.
- Critical financial and authentication behavior has reproducible test data.

## Phase 1 — TypeScript Service Foundation

**Purpose:** Create a production-shaped service before porting business logic.

### Work

- Create `backend-js/` with TypeScript strict mode, formatting, linting, and tests.
- Add environment validation and separate development, test, and production configuration.
- Add Fastify application startup and graceful shutdown.
- Add structured logging, request IDs, error normalization, CORS, security headers, and body-size limits.
- Add PostgreSQL connectivity through Prisma using introspection of the current schema.
- Add transaction helpers and a decimal-number policy.
- Implement `/api/health/` with database readiness information suitable for deployment probes.
- Generate OpenAPI documentation from route schemas.
- Add CI jobs for type checking, linting, tests, and build verification.

### Completion gate

- The new service builds and starts independently.
- It connects read-only to a copy of the current database.
- Health checks, logs, errors, shutdown, and CI work.
- No production table or data has been modified by Prisma.

## Phase 2 — Routing and Contract Test Harness

**Purpose:** Make gradual cutover and instant rollback possible.

### Work

- Put Django and TypeScript behind one development reverse proxy or gateway.
- Default all `/api/` traffic to Django.
- Add route-level configuration that can forward selected endpoints to TypeScript.
- Preserve client IP and forwarding headers safely.
- Build contract tests that send equivalent requests to both backends.
- Normalize nondeterministic values such as IDs, generated tokens, and timestamps before comparison.
- Add a feature flag or deployment configuration for each migrated route group.

### Completion gate

- `/api/health/` can be switched between services without changing the frontend.
- A route can be rolled back to Django through configuration alone.
- Contract tests can compare both implementations.

## Phase 3 — Authentication and Sessions

**Purpose:** Reproduce the security boundary before migrating protected business endpoints.

### Existing behavior to preserve

- registration and login;
- password hashing and password validation;
- access and refresh JWTs;
- server-side revocable sessions;
- the JWT `sid` session reference behavior;
- token refresh and expiration;
- `me` and profile-picture behavior;
- session listing, current-session identification, revoking one session, revoking other sessions, and logout;
- device, browser, operating-system, IP, and optional location metadata;
- session activity throttling;
- login-event and session retention cleanup;
- trusted proxy handling.

### Work

- Choose a password implementation compatible with existing Django password hashes, or implement a forced password-reset/cutover strategy.
- Reproduce session-reference hashing and token claims.
- Port cleanup tasks to a scheduled TypeScript worker or deployment cron job.
- Add security tests for revoked, expired, malformed, legacy, and refreshed tokens.
- Verify that profile-picture storage and deletion work in every environment.

### Completion gate

- Existing users can log in without password changes unless a reset strategy was explicitly approved.
- The frontend authentication flow works unchanged.
- All session and token edge-case tests pass.
- Security review is complete before protected routes are sent to TypeScript.

## Phase 4 — Customers and Business Sources

**Purpose:** Migrate the core directory and relationship model before dependent financial modules.

### Order

1. customer types;
2. business-source list, search, filters, and summary;
3. business-source create, update, and delete;
4. customer list, search, filters, and detail;
5. customer create, update, activation, and delete;
6. customer-to-business-source linking;
7. source customer-entry synchronization.

### Important behavior

- Preserve unique source names and contact validation.
- Preserve source/customer type rules and dynamic credit terms.
- Preserve `source_entry` one-to-one behavior.
- Preserve protected deletion when dependent data exists.
- Port transactional synchronization logic rather than relying on eventual consistency.

### Completion gate

- All customer and business-source contract tests pass.
- Referential and deletion behavior matches PostgreSQL/Django behavior.
- The relevant frontend pages work against TypeScript.
- These route groups can be enabled and rolled back independently.

## Phase 5 — Bhaka Patra / Customer Folio

**Purpose:** Migrate customer documents after customer identity is stable.

### Work

- Port customer folio summary.
- Port Bhaka Patra list, create, retrieve, and update behavior.
- Port nested item validation and transactional replacement/update behavior.
- Preserve decimal serialization, unique references, totals, ordering, and protected customer relations.

### Completion gate

- Document and nested-item transactions are atomic.
- Summary totals match Django on the same database snapshot.
- Existing frontend document workflows pass browser and contract tests.

## Phase 6 — Pledges

**Purpose:** Port the smaller financial domain before the more complex billing system.

### Work

- Port pledge listing, filtering, creation, retrieval, and update.
- Preserve Nepal-date defaults and timezone behavior.
- Preserve generated pledge-number uniqueness.
- Preserve allowed status transitions and redemption/cancellation dates.
- Preserve due-date validation and overdue behavior.
- Reproduce atomic item sequencing and concurrency protection.

### Completion gate

- Invalid status transitions cannot be written through the API or service layer.
- Concurrent item creation cannot create duplicate sequence values.
- Pledge calculations and list ordering match Django.

## Phase 7 — Bills and Bill Items

**Purpose:** Migrate the main transaction domain with full financial precision.

### Order

1. read-only bill list and detail;
2. filtering, searching, ordering, and date ranges;
3. bill-item calculations;
4. bill creation in a transaction;
5. bill update and payment changes with locking;
6. bill deletion and protected relationships;
7. sale/purchase distinctions and status recalculation.

### Important behavior

- Port all `Decimal` calculations using an exact decimal library.
- Match half-up money rounding and three-decimal weight precision.
- Reproduce net-weight, rate-unit, making-charge, discount, subtotal, VAT, grand-total, paid, and due calculations.
- Reproduce status rules for draft, unpaid, partial, paid, and cancelled bills.
- Preserve the frozen credit terms stored on historical bills.
- Use database transactions and appropriate row locks for concurrent payment updates.
- Do not calculate authoritative totals only in the frontend.

### Completion gate

- Golden financial fixtures match exactly at every decimal boundary.
- Concurrent payment/update tests pass.
- Bills created by TypeScript can still be read correctly by Django during the rollback window.
- Bills created previously by Django are returned unchanged by TypeScript.

## Phase 8 — Credits, Payments, and Interest

**Purpose:** Port the highest-risk financial behavior only after bills are stable.

### Work

- Port manual customer credit creation and retrieval.
- Port principal and interest payment recording.
- Port legacy bill credit adjustments.
- Port fixed-period simple-interest calculations.
- Preserve 15-day company and 30-day non-company periods.
- Preserve charge-date ordering, same-day payment behavior, non-compounding interest, and frozen terms.
- Port customer account summaries and combine bill and manual-credit balances correctly.
- Test past dates, future dates, zero balances, overpayments, multiple same-day events, and rounding boundaries.

### Completion gate

- TypeScript calculations match Django across an approved golden test matrix.
- Historical account totals match on a production-like database copy.
- Financial review/sign-off is complete.
- No route is enabled in production if even a one-paisa unexplained difference remains.

## Phase 9 — Business-Source Accounts and Reporting

**Purpose:** Port aggregate queries and statements after the underlying writes are stable.

### Work

- Port account totals and status counts.
- Port search, status filters, date filters, and pagination.
- Port running and opening balances.
- Reproduce transaction ordering deterministically using date and ID.
- Add indexes based on measured query plans.
- Compare reports against Django on identical snapshots.

### Completion gate

- Aggregate totals and every paginated running balance match Django.
- Query performance is acceptable on production-scale test data.
- Relevant exports or printable views are verified end to end.

## Phase 10 — Full Cutover and Schema Ownership Transfer

**Purpose:** Make TypeScript the primary backend without immediately deleting the fallback.

### Work

- Route every API group to TypeScript.
- Disable Django write traffic while retaining read-only emergency access temporarily.
- Run full API, frontend, browser, security, and financial regression suites.
- Reconcile record counts and financial control totals.
- Monitor error rates, latency, database locks, failed logins, and calculation discrepancies.
- Baseline the existing PostgreSQL schema in Prisma.
- Transfer migration ownership from Django to Prisma only after the baseline is verified.

### Completion gate

- TypeScript has handled all production API traffic for an agreed stabilization period.
- No unresolved reconciliation differences exist.
- Backup restoration and rollback procedures have been rehearsed.
- Prisma is the documented and sole schema owner.

## Phase 11 — Django Retirement

**Purpose:** Remove the old service only after it is no longer required for operation or rollback.

### Work

- Take a final tagged archive of the Django backend and its migrations.
- Export final OpenAPI and contract documentation.
- Remove Django from runtime deployment and monitoring.
- Remove obsolete environment variables, jobs, database credentials, proxy rules, and dependencies.
- Update root setup, development, deployment, backup, and incident-response documentation.
- Remove the Django source from the active tree only in a separate reviewed change after the retention period.

### Completion gate

- No production traffic, scheduled task, media operation, or migration depends on Django.
- The new backend can be built, deployed, operated, restored, and developed using current documentation alone.
- The team explicitly approves retirement.

## 9. Testing Strategy

Each migrated module should have four layers of tests:

1. **Unit tests** for validation, state transitions, decimal calculations, and pure business logic.
2. **Repository/integration tests** against a real PostgreSQL test database, not mocked SQL.
3. **Contract tests** that compare normalized Django and TypeScript responses.
4. **End-to-end tests** through the existing Next.js frontend for critical user workflows.

Required golden workflows include:

- register, login, refresh, logout, and session revocation;
- create and link a business source and customer;
- create and update Bhaka Patra records with items;
- create, edit, redeem, and cancel a pledge;
- create sale and purchase bills with multiple item rate units;
- make partial and full payments;
- issue manual credit and record principal/interest payments;
- calculate customer and business-source balances across historical dates;
- reject invalid dates, invalid transitions, protected deletions, and concurrent conflicting writes.

## 10. Deployment and Rollback

Every production route-group cutover should follow this sequence:

1. deploy TypeScript with the route disabled;
2. run smoke and contract tests against production-like data;
3. enable the route for internal or test traffic if infrastructure supports it;
4. enable a small percentage or one deployment instance;
5. monitor logs, latency, errors, and database effects;
6. enable the route fully;
7. retain the Django route and rollback switch during the stabilization period.

Rollback must change routing back to Django without requiring a code deployment. If TypeScript has written data, verify beforehand that Django can still read that data correctly. Never roll application code back across an incompatible database migration without an approved database rollback procedure.

## 11. Observability and Reconciliation

Track at minimum:

- request count, latency, and error rate by route and service;
- database query latency, pool utilization, locks, and transaction failures;
- authentication failures and session-revocation failures;
- validation failures by endpoint;
- background cleanup-job results;
- bill, credit, payment, pledge, and customer write counts;
- financial reconciliation totals by day.

During parallel operation, run read-only reconciliation jobs that compare:

- table and relationship counts;
- bill grand totals, paid amounts, and due amounts;
- manual-credit principal and interest totals;
- customer account summaries;
- business-source account summaries;
- pledge counts by status.

## 12. Security Checklist

- Keep secrets out of source control and validate required environment variables at startup.
- Use short-lived access tokens and securely handled refresh tokens.
- Store only hashed session references where the current design requires it.
- Rate-limit authentication endpoints.
- Redact passwords, tokens, authorization headers, and sensitive personal data from logs.
- Validate content type, upload size, and image type for profile pictures.
- Restrict trusted proxies explicitly.
- Use parameterized database access through the ORM.
- Apply least-privilege PostgreSQL roles.
- Run dependency and container security scans in CI.
- Perform an authentication-focused review before Phase 3 cutover.

## 13. Migration Tracking Template

Create one checklist entry for every route:

```text
Route:
Current Django implementation:
TypeScript owner:
Request schema captured:
Response schema captured:
Permission behavior captured:
Success fixtures complete:
Failure fixtures complete:
TypeScript unit tests complete:
PostgreSQL integration tests complete:
Contract comparison passing:
Frontend workflow passing:
Concurrency behavior verified:
Observability added:
Rollback tested:
Production routing status:
Notes:
```

## 14. Recommended Implementation Order Summary

The order from first to last is:

1. Baseline and contract inventory
2. TypeScript service foundation
3. Gateway and contract test harness
4. Authentication and sessions
5. Customers and business sources
6. Bhaka Patra / customer folio
7. Pledges
8. Bills and bill items
9. Credits, payments, and interest
10. Account summaries and reporting
11. Full traffic cutover and Prisma schema ownership
12. Django retirement

The financial modules intentionally come later. They depend on customer data, require exact decimal behavior, and contain the greatest transaction and reconciliation risk.

## 15. First Concrete Milestone

The first implementation milestone should include only:

- the `backend-js/` TypeScript project;
- validated environment configuration;
- logging and error handling;
- a read-only PostgreSQL connection mapped to the existing schema;
- `/api/health/`;
- CI checks;
- the contract-test harness;
- route switching between Django and TypeScript for the health endpoint.

Do not start by porting bills or authentication. Completing this foundation proves that both backends can coexist safely and gives every later module the same testing and rollback path.
