# JMS

Agents: Before adding or changing a feature, read [PROJECT_RULES.md](PROJECT_RULES.md) for existing project requirements.

See [PROGRESS.md](PROGRESS.md) for the timeline and current features, [CUSTOMERS.md](CUSTOMERS.md) for the Customer Folio/document workflow, and [BUSINESS_SOURCES.md](BUSINESS_SOURCES.md) for source management and customer linking.

JMS is organized as a small monorepo with separate frontend and backend services:

```text
jms/
├── frontend/   # Next.js application
├── backend/    # Django API
├── backend-js/ # Incremental TypeScript API replacement
├── production.md
└── README.md
```

The frontend runs on `http://localhost:3000`, the Django API runs on `http://localhost:8000`, and local development uses SQLite when `DATABASE_URL` is unset. Set `DATABASE_URL` to use PostgreSQL in a deployed/shared environment.

## Quick Start

Follow [production.md](production.md) for the complete setup guide. In short, install each service and run them in separate terminals:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 8000
```

```bash
cd frontend
npm install
npm run dev
```

The backend health endpoint is available at `http://localhost:8000/api/health/`.

## TypeScript Backend Migration

The new service under `backend-js/` is being built alongside Django according
to [plan.md](plan.md). Django remains the active API and PostgreSQL schema owner
until individual route groups pass parity testing and are explicitly switched.

The TypeScript service currently provides the foundation and health/readiness
routes. See [backend-js/README.md](backend-js/README.md) for setup and safety
rules. It uses port `8001` by default and requires PostgreSQL.
