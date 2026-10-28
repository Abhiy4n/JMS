import { Braces, KeyRound, ServerCog } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8000";

export default function Page() {
  return (
    <div className="api-overview">
      <section className="page-heading">
        <div>
          <p className="eyebrow">DEVELOPER WORKSPACE</p>
          <h1>API documentation</h1>
          <p className="page-description">A quick reference for connecting internal tools to JMS.</p>
        </div>
      </section>

      <div className="api-base-url">
        <span>Current API base URL</span>
        <code>{API_URL}</code>
      </div>

      <div className="api-card-grid">
        <article className="api-card"><span><ServerCog aria-hidden="true" /></span><h2>REST endpoints</h2><p>Application endpoints are grouped below <code>/api/</code>, including authentication, customers, sources, bills, pledges, and credit.</p></article>
        <article className="api-card"><span><KeyRound aria-hidden="true" /></span><h2>Authentication</h2><p>Sign in through <code>/api/auth/login/</code>, then send the access token with the Bearer authorization scheme.</p></article>
        <article className="api-card"><span><Braces aria-hidden="true" /></span><h2>JSON responses</h2><p>Requests and responses use JSON. Validation errors identify the affected field so clients can show useful feedback.</p></article>
      </div>
    </div>
  );
}
