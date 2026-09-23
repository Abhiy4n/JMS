# JMS

JMS is organized as a small monorepo with separate frontend and backend services:

```text
jms/
├── frontend/   # Next.js application
├── backend/    # Django API
├── production.md
└── README.md
```

The frontend runs on `http://localhost:3000`, the Django API runs on `http://localhost:8000`, and PostgreSQL is the database.

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
