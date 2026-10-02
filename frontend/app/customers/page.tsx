"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import {
  type BusinessSource,
  type Customer,
  createCustomer,
  fetchBusinessSources,
  fetchCustomers,
} from "@/lib/business-data";

export default function CustomersPage() {
  return (
    <Suspense fallback={<BusinessAppShell><p className="detail-loading">Loading customers...</p></BusinessAppShell>}>
      <CustomersDirectory />
    </Suspense>
  );
}

function CustomersDirectory() {
  const searchParams = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sources, setSources] = useState<BusinessSource[]>([]);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [sourceFilter, setSourceFilter] = useState(() => searchParams.get("source") ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetchBusinessSources()
      .then(setSources)
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Could not load business sources.");
      });
  }, [reloadKey]);

  useEffect(() => {
    let current = true;
    fetchCustomers(search, sourceFilter ? Number(sourceFilter) : undefined)
      .then((data) => {
        if (current) {
          setCustomers(data);
          setError("");
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setError(requestError instanceof Error ? requestError.message : "Could not load customers.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [search, sourceFilter, reloadKey]);

  return (
    <BusinessAppShell>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CUSTOMER DIRECTORY</p>
          <h1>Customers</h1>
          <p className="page-description">Customer records stay connected to the source that brought them in.</p>
        </div>
        <button className="button button-primary" onClick={() => setDialogOpen(true)} disabled={sources.length === 0}>
          <span aria-hidden="true">+</span>
          New Customer
        </button>
      </section>

      {sources.length === 0 && !error && (
        <p className="notice notice-info">
          Create a business source before adding customers. <Link href="/dashboard">Go to Business Sources</Link>
        </p>
      )}

      <div className="table-toolbar">
        <div className="table-title-group">
          <h2>All customers</h2>
          <span className="record-count">{customers.length}</span>
        </div>
        <div className="table-filters">
          <label className="local-search">
            <span className="search-glyph" aria-hidden="true">⌕</span>
            <span className="sr-only">Search customers</span>
            <input
              value={search}
              onChange={(event) => {
                setLoading(true);
                setSearch(event.target.value);
              }}
              placeholder="Name, phone, email..."
            />
          </label>
          <label className="filter-select-wrap">
            <span className="sr-only">Filter by source</span>
            <select
              value={sourceFilter}
              onChange={(event) => {
                setLoading(true);
                setSourceFilter(event.target.value);
              }}
            >
              <option value="">All sources</option>
              {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="data-table-wrap">
        <table className="data-table customer-table">
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Phone</th>
              <th scope="col">Email</th>
              <th scope="col">Business source</th>
              <th scope="col">Added</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="table-message">Loading customers...</td></tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={5} className="table-message empty-message">
                  <strong>{search || sourceFilter ? "No matching customers" : "No customers yet"}</strong>
                  <span>{search || sourceFilter ? "Clear or change the filters to see more records." : "Customers added here also update their business source automatically."}</span>
                </td>
              </tr>
            ) : customers.map((customer) => (
              <tr key={customer.id}>
                <td className="customer-name-cell">{customer.name}</td>
                <td>{customer.phone || "—"}</td>
                <td>{customer.email || "—"}</td>
                <td><Link className="source-name-link" href={`/business-sources/${customer.business_source}`}>{customer.source_name}</Link></td>
                <td>{new Date(customer.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialogOpen && (
        <NewCustomerDialog
          sources={sources}
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false);
            setLoading(true);
            setReloadKey((key) => key + 1);
          }}
        />
      )}
    </BusinessAppShell>
  );
}

function NewCustomerDialog({
  sources,
  onClose,
  onCreated,
}: {
  sources: BusinessSource[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [sourceId, setSourceId] = useState(String(sources[0]?.id ?? ""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await createCustomer({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        business_source: Number(sourceId),
      });
      onCreated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the customer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-panel modal-panel-narrow" role="dialog" aria-modal="true" aria-labelledby="customer-dialog-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">NEW RECORD</p>
            <h2 id="customer-dialog-title">Add customer</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
        </div>
        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Customer name <b>*</b></span>
            <input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
          <div className="form-grid">
            <label className="form-field">
              <span>Phone</span>
              <input type="tel" maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" />
            </label>
            <label className="form-field">
              <span>Email</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            </label>
          </div>
          <label className="form-field">
            <span>Business source <b>*</b></span>
            <select required value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
          </label>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="button button-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={submitting || !sourceId}>
              {submitting ? "Saving..." : "Save customer"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}