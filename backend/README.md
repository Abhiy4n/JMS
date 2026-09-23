# Django backend

## Setup

From the repository root:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

The backend reads `DATABASE_URL` from the root `.env` file. Copy `backend/.env.example` to `backend/.env` only if you need backend-specific values.

## Run

```bash
cd backend
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 8000
```

The health endpoint is available at `http://localhost:8000/api/health/`.
