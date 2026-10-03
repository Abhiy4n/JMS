"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

import BusinessAppShell from "@/components/BusinessAppShell";
import CustomerDialog from "@/components/CustomerDialog";
import {
  CHANNEL_TYPES,
  type BusinessSource,
  type ChannelType,
  createBusinessSource,
  fetchBusinessSources,
  isValidContactEmail,
} from "@/lib/business-data";

const CHANNEL_LABELS: Record<ChannelType, string> = {
  DIRECT: "Direct",
  MARKETING: "Marketing",
  REFERRAL: "Referral",
  DEALER: "Dealer",
  CORPORATE: "Corporate",
  BRANCH: "Branch",
  OTHER: "Other",
};

export default function DashboardPage() {
  const [sources, setSources] = useState<BusinessSource[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [customerDialogSourceId, setCustomerDialogSourceId] = useState<number>();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchBusinessSources(search)
        .then((data) => {
          if (current) {
            setSources(data);
            setError("");
          }
        })
        .catch((requestError: unknown) => {
          if (current) {
            setError(requestError instanceof Error ? requestError.message : "Could not load business sources.");
          }
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 200);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [search, reloadKey]);

  return (
    <BusinessAppShell>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CUSTOMER ACQUISITION</p>
          <h1>Business Acquisition Sources</h1>
          <p className="page-description">
            Track walk-in counters, social channels, referrals and dealer relationships.
          </p>
        </div>
        <button className="button button-primary" onClick={() => setDialogOpen(true)}>
          <span aria-hidden="true">+</span>
          New Business Source
        </button>
      </section>

      <div className="table-toolbar">
        <div className="table-title-group">
          <h2>Sources</h2>
          <span className="record-count">{sources.length}</span>
        </div>
        <label className="local-search">
          <span className="search-glyph" aria-hidden="true">⌕</span>
          <span className="sr-only">Filter business sources</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter sources..."
          />
        </label>
      </div>

      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="data-table-wrap">
        <table className="data-table source-table">
          <thead>
            <tr>
              <th scope="col">Source name</th>
              <th scope="col">Channel type</th>
              <th scope="col">Customers</th>
              <th scope="col">Total bills</th>
              <th scope="col">Total revenue</th>
              <th scope="col">Collected</th>
              <th scope="col">Outstanding</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="table-message">Loading business sources...</td></tr>
            ) : sources.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-message empty-message">
                  <strong>{search ? "No matching sources" : "No business sources yet"}</strong>
                  <span>{search ? "Try another source name or channel." : "Create a source and its first customer to get started."}</span>
                </td>
              </tr>
            ) : sources.map((source) => (
              <tr key={source.id}>
                <td>
                  <Link className="source-name-link" href={`/business-sources/${source.id}`}>
                    {source.name}
                  </Link>
                </td>
                <td>
                  <span className={`channel-badge channel-${source.channel_type.toLowerCase()}`}>
                    {CHANNEL_LABELS[source.channel_type]}
                  </span>
                </td>
                <td>{source.customer_count}</td>
                <td className="unavailable-value" title="Invoice records are not connected yet">—</td>
                <td className="unavailable-value" title="Invoice records are not connected yet">—</td>
                <td className="unavailable-value" title="Payment records are not connected yet">—</td>
                <td className="unavailable-value" title="Payment records are not connected yet">—</td>
                <td>
                  <span className={`status-badge status-${source.status.toLowerCase()}`}>
                    {source.status}
                  </span>
                </td>
                <td>
                  <button
                    className="table-action"
                    type="button"
                    onClick={() => setCustomerDialogSourceId(source.id)}
                  >
                    Add customer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-footnote">
        Customer totals are linked live. Billing and payment totals appear when those records are connected.
      </p>

      {dialogOpen && (
        <NewSourceDialog
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false);
            setReloadKey((key) => key + 1);
          }}
        />
      )}
      {customerDialogSourceId !== undefined && (
        <CustomerDialog
          sources={sources}
          initialSourceId={customerDialogSourceId}
          onClose={() => setCustomerDialogSourceId(undefined)}
          onCreated={() => {
            setCustomerDialogSourceId(undefined);
            setReloadKey((key) => key + 1);
          }}
        />
      )}
    </BusinessAppShell>
  );
}

function NewSourceDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("DIRECT");
  const [description, setDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await createBusinessSource({
        name: name.trim(),
        channel_type: channelType,
        description: description.trim(),
        first_customer: {
          name: customerName.trim(),
          phone: customerPhone.trim(),
          email: customerEmail.trim(),
        },
      });
      onCreated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the business source.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="source-dialog-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">NEW RECORD</p>
            <h2 id="source-dialog-title">Add business source</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
        </div>
        <p className="modal-intro">
          Add the source and its first customer together. More customers can be linked from the Customers page.
        </p>
        <form className="form-stack" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label className="form-field">
              <span>Source name <b>*</b></span>
              <input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Walk-in Customer" />
            </label>
            <label className="form-field">
              <span>Channel type <b>*</b></span>
              <select value={channelType} onChange={(event) => setChannelType(event.target.value as ChannelType)}>
                {CHANNEL_TYPES.map((channel) => (
                  <option key={channel} value={channel}>{CHANNEL_LABELS[channel]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="form-field">
            <span>Description</span>
            <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional notes about this source" />
          </label>
          <div className="form-section-title">First customer details</div>
          <label className="form-field">
            <span>Customer name <b>*</b></span>
            <input required maxLength={255} value={customerName} onChange={(event) => setCustomerName(event.target.value)} autoComplete="name" />
          </label>
          <div className="form-grid">
            <label className="form-field">
              <span>Phone</span>
              <input type="tel" inputMode="numeric" pattern="[0-9]{9,10}" maxLength={10} value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value.replace(/[^0-9]/g, "").slice(0, 10))} autoComplete="tel" title="Enter 9 or 10 digits." />
            </label>
            <label className="form-field">
              <span>Email</span>
              <input type="email" value={customerEmail} onChange={(event) => {
                setCustomerEmail(event.target.value);
                event.currentTarget.setCustomValidity(isValidContactEmail(event.target.value) ? "" : "Use a valid email address with a recognized domain such as .com or .np.");
              }} autoComplete="email" />
            </label>
          </div>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="button button-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create source"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}