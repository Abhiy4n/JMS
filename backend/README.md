# Django backend

## Setup

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

The backend reads `DATABASE_URL` from the root `.env` file when it is set. Without it, local development uses `backend/db.sqlite3`; this file is ignored by Git. Set `DATABASE_URL` to your PostgreSQL URL for production or shared environments. Copy `backend/.env.example` to `backend/.env` only if you need backend-specific values.

## Run

```bash
cd backend
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 8000
```

The health endpoint is available at `http://localhost:8000/api/health/`.

## Login activity and JWT sessions

Every login and registration creates a revocable server-side session referenced by
the JWT `sid` claim. Tokens issued before this feature was deployed are intentionally
rejected, so existing users must sign in once after deployment.

Configuration is documented in `.env.example`. Activity writes are throttled by
`AUTH_SESSION_ACTIVITY_THROTTLE_SECONDS` (default 300). Sessions and login events
use `AUTH_SESSION_RETENTION_DAYS` (90) and `AUTH_LOGIN_EVENT_RETENTION_DAYS` (180),
and API event responses use `AUTH_LOGIN_EVENT_LIMIT` (100).

Forwarded client IPs are ignored unless the direct peer is included in
`AUTH_TRUSTED_PROXY_IPS`. Location lookup is optional: install `geoip2` and point
`AUTH_GEOIP2_DATABASE` to a local MaxMind GeoLite2 City `.mmdb` file. Private
addresses and unavailable lookups show no location.

Schedule retention cleanup (daily is sufficient):

```bash
python manage.py cleanup_auth_activity
```

Authenticated endpoints are available under `/api/auth/`: `sessions/`,
`sessions/<id>/revoke/`, `sessions/revoke-others/`, and `logout/`.
