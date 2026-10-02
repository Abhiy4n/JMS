# Business Sources and Customer Linking

## Overview

Business Sources is the customer-acquisition register shown on the dashboard. Its visual language follows the supplied reference: dark navy navigation, white work area, gold accents, blue channel labels, green active states, and compact table rows.

The app uses one canonical relationship: a business source has many customers, and each customer belongs to one source. The customer count on the source table is calculated from that relationship, not stored as a second counter. This keeps the source register, customer directory, and source detail view synchronized.

## User flows

- **Create a business source:** On `/dashboard`, choose **New Business Source**, enter the source name and channel, then add its first customer. The backend saves the source and first customer in one database transaction. If either insert fails, neither record is kept.
- **Open a source:** Select a source name to open `/business-sources/<id>`. The page lists each customer linked to that source, including their individual contact details.
- **Create a customer:** On `/customers`, choose **New Customer**, enter their details, and select a business source. The customer's row appears in the directory and the source's customer count/detail page immediately reflects it.
- **Search and filter:** The customer directory searches names, phone numbers, email addresses, and source names. It can also be filtered by source. The source register searches source names and channel types.

## Data model

`accounts.BusinessSource` stores a unique display name, channel type, active status, optional description, creator, and timestamps. `accounts.Customer.business_source` is a protected foreign key to that source. `on_delete=PROTECT` prevents deleting a source that still has customer records.

The supported channel values are `DIRECT`, `MARKETING`, `REFERRAL`, `DEALER`, `CORPORATE`, `BRANCH`, and `OTHER`.

## API

These endpoints require the same JWT bearer token as the rest of the authenticated API:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/business-sources/?search=<text>` | List sources with live customer counts |
| `POST` | `/api/business-sources/` | Create a source and its first customer atomically |
| `GET` | `/api/business-sources/<id>/` | Read one source and its live customer count |
| `GET` | `/api/customers/?search=<text>&business_source=<id>` | List/search customers, optionally by source |
| `POST` | `/api/customers/` | Create a customer linked to an existing source |

Example source creation body:

```json
{
  "name": "Referral - Hari",
  "channel_type": "REFERRAL",
  "description": "Introduced by Hari",
  "first_customer": {
    "name": "Nisha Karki",
    "phone": "9800000000",
    "email": "nisha@example.com"
  }
}
```

Example customer creation body:

```json
{
  "name": "Suman Shrestha",
  "phone": "9811111111",
  "email": "suman@example.com",
  "business_source": 1
}
```

## Billing columns

The reference includes bill count, revenue, collected, and outstanding columns, but this project does not yet have invoice or payment models. Those cells therefore display an em dash with a short explanation instead of invented zero values. Once invoice/payment records exist, aggregate them by customer and then by business source.

## Database setup

The initial schema migration is `backend/accounts/migrations/0002_businesssource_customer.py`. Apply migrations before using the source/customer endpoints:

```powershell
cd backend
python manage.py migrate
```

For the default local configuration, PostgreSQL must be available at the `DATABASE_URL` in `backend/config/settings.py`. Set `DATABASE_URL` in the environment to use another supported database.

## Code map

- `backend/accounts/models.py`: source and customer records and their relationship.
- `backend/accounts/serializers.py`: API validation and atomic source-plus-customer creation.
- `backend/accounts/views.py` and `backend/accounts/business_urls.py`: authenticated list, create, and detail endpoints.
- `frontend/lib/business-data.ts`: shared types and typed API calls used by both pages.
- `frontend/app/dashboard/page.tsx`: source table and create-source dialog.
- `frontend/app/business-sources/[id]/page.tsx`: source detail and linked customers.
- `frontend/app/customers/page.tsx`: customer directory, source filter, and create-customer dialog.
- `frontend/components/BusinessAppShell.tsx` and `frontend/app/globals.css`: navigation, visual tokens, and responsive styling.

The API relationship tests live in `backend/accounts/tests.py` and verify that creation in either flow updates the shared source/customer data.

## Frontend setup

Install a Node.js release supported by the project's Next.js version, then install the locked dependencies and start the app:

```powershell
cd frontend
npm ci
npm run dev
```

The current workspace did not have Node.js/npm or `frontend/node_modules`, so a Next.js build could not be run in this environment. The supplied `package-lock.json` already lists React and its type packages; `npm ci` is needed before the editor can resolve JSX runtime/types.