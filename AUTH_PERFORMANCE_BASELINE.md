# Authentication request baseline

Static baseline recorded before the authentication-flow changes on November 5, 2026.
Runtime latency measurements require the production-like Nginx/Gunicorn/PostgreSQL
environment and are intentionally not estimated here.

| Scenario | Requests before changes | Visible behavior before changes |
| --- | --- | --- |
| Successful login | 1 login POST, 1 immediate `/auth/me/`, plus an explicit router refresh | Full-screen verification before dashboard content |
| Successful signup | 1 register POST, 1 immediate `/auth/me/`, plus an explicit router refresh | Full-screen verification before dashboard content |
| Cold authenticated load | 1 `/auth/me/` before content mounts | Full-screen verification |
| Tab focus/visibility return | Up to 2 concurrent `/auth/me/` requests | Authenticated tree unmounts; page queries run again after remount |
| Normal authenticated navigation | Normally 0 auth requests | AuthGate remains mounted, except explicit refresh/navigation paths |
| Customer Folio window focus | Auth revalidation plus customer/document focus reloads | Folio data visibly reloads |

Counts after this implementation (encoded in the authentication regression tests):

| Scenario | Auth requests after changes |
| --- | --- |
| Successful login/signup | 1 login/register request, 0 immediate `/auth/me/` |
| Cold authenticated load | 1 silent `/auth/me/` when cached credentials exist |
| Tab focus/visibility return within 5 minutes | 0 |
| Tab focus/visibility return after 5 minutes | At most 1 deduplicated logical `/auth/me/` verification |
| Normal authenticated navigation | 0 |

The default minimum interval is 300,000 ms and can be changed with
`NEXT_PUBLIC_AUTH_REVALIDATE_MS` (minimum accepted value: 1,000 ms). A logical
idempotent GET can make one additional controlled attempt after a network,
timeout, 429, 502, 503, or 504 failure. Mutations are not retried.

The centralized API timeout defaults to 15,000 ms and can be configured with
`NEXT_PUBLIC_API_TIMEOUT_MS`. Browser timing events are emitted as
`jms-api-timing`; backend responses expose `Server-Timing` and `X-Request-ID`.

