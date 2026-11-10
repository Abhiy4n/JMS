# Business Sources

## Pledge interest terms

Every Business Source has type `INDIVIDUAL`, `COMPANY`, or `DYNAMIC`. These terms determine the interest terms copied to a new pledge. A pledge stores its own snapshot; later Business Source edits do not change existing pledges.

| Type | Upfront percent | Upfront days | Daily percent | Divisor |
|---|---:|---:|---:|---:|
| Individual | 2 | 30 | 2 | 30 |
| Company | 1 | 15 | 2 | 30 |
| Dynamic | entered by the superuser | entered by the superuser | entered by the superuser | entered by the superuser |

Percentages are `Decimal` values from 0 through 100, with up to two decimal places. `upfront_days` is an integer of at least 0; `daily_divisor` is an integer of at least 1. Dynamic sources require all four values; they have no rate defaults. Individual and Company values are code presets, not stored editable terms.

An inactive or incomplete source cannot be selected when creating a pledge. A source may be deactivated. It cannot be deleted while any pledge refers to it; the API returns HTTP 409 and recommends deactivation. Source creation, editing, deactivation, and deletion require a superuser. Authenticated users can view sources.

Effective pledge-term changes to a source are recorded in an append-only term edit log. A superuser must provide a trimmed reason of at least five characters; each changed term receives a row with the editor, timestamp, old/new values, and a shared edit ID.

## Source identity and customer relationship

Source names remain unique, and source identity/contact validation and the representative customer relationship are unchanged. Creating a source through the Business Source API continues to create its representative customer atomically. Customer and billing/credit behavior is outside the pledge interest calculation; legacy source credit-term fields remain for compatibility and do not determine pledge interest.

## API

| Methods | Endpoint | Purpose |
|---|---|---|
| GET/POST | `/api/business-sources/` | List sources; superusers create sources. |
| GET | `/api/business-sources/summary/` | Source and linked-customer totals. |
| GET/PATCH/PUT/DELETE | `/api/business-sources/<id>/` | Read or superuser-manage a source. |

For a Dynamic source, include all pledge terms, for example:

```json
{
  "name": "Variable Terms",
  "source_type": "DYNAMIC",
  "phone": "9800000000",
  "address": "Kathmandu",
  "upfront_percent": "1.50",
  "upfront_days": 20,
  "daily_percent": "1.25",
  "daily_divisor": 30
}
```

The current UI is a separate frontend concern; this backend does not change it.
