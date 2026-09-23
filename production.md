# Local Development Setup Guide

This project has two services:

- **Frontend:** Next.js at `http://localhost:3000`
- **Backend:** Django API at `http://localhost:8000`
- **Database:** PostgreSQL

## Run the Application

Open two terminal windows from the project root.

### Terminal 1: Backend

```bash
cd backend
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 8000
```

The backend health check is available at `http://localhost:8000/api/health/`.

### Terminal 2: Frontend

```bash
cd frontend
npm run dev
```

Open the frontend at `http://localhost:3000`.

## Prerequisites

Install Node.js, npm, Python, PostgreSQL, and Git. Check the installed versions:

```bash
node -v
npm -v
python3 --version
psql --version
```

Use the project or team-approved versions. Do not upgrade major versions without checking with the project team.

## Clone the Project

```bash
git clone <repository-url>
cd <project-folder>
git checkout <branch-name>
```

## Environment Configuration

Create a root `.env` file:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/jms"
```

The Django backend reads this root `.env` file automatically. Do not commit it. The file is excluded by `.gitignore`.

Optional backend settings can be placed in `backend/.env`, using `backend/.env.example` as a template:

```env
DJANGO_SECRET_KEY="replace-this-in-development"
DJANGO_DEBUG="true"
DJANGO_ALLOWED_HOSTS="localhost,127.0.0.1"
CORS_ALLOWED_ORIGINS="http://localhost:3000"
```

## PostgreSQL

Make sure PostgreSQL is running and create the project database:

```text
Database: jms
Host: localhost
Port: 5432
```

The database can initially be empty. Django creates the required tables through migrations.

## Backend Setup

From the project root:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
```

See [backend/README.md](backend/README.md) for more backend setup details.

Create an administrator account when needed:

```bash
.venv/bin/python manage.py createsuperuser
```

Then open the Django admin at `http://localhost:8000/admin/`.

## Frontend Setup

From the project root:

```bash
cd frontend
npm install
```

Start the frontend with:

```bash
npm run dev
```

## Database Changes

Django models are the source of truth for the database. After changing a model:

```bash
cd backend
.venv/bin/python manage.py makemigrations
.venv/bin/python manage.py migrate
```

Commit the generated migration files. Django migrations are the only database migration workflow for the backend.

## Quick Setup

```bash
git clone <repository-url>
cd <project-folder>

# Create .env and add DATABASE_URL

cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
cd ../frontend
npm install
```

Then use two terminals:

```bash
# Terminal 1
cd backend && .venv/bin/python manage.py runserver 8000

# Terminal 2
cd frontend && npm run dev
```

## Common Commands

Check the Django configuration:

```bash
cd backend
.venv/bin/python manage.py check
```

Run backend tests:

```bash
cd backend
.venv/bin/python manage.py test
```

Install exact frontend dependencies when a lockfile is committed:

```bash
cd frontend
npm ci
```

## Team Rules

1. Do not commit `.env` files or secrets.
2. Commit `package.json` and `package-lock.json` when frontend dependencies change.
3. Commit Django model and migration changes.
4. Run `makemigrations` and `migrate` after changing Django models.
5. Run both the backend and frontend during full-stack development.
6. Use Django migrations for all new database changes.
