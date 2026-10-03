"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import CustomerDialog from "@/components/CustomerDialog";
import {
  type BusinessSource,
  type Customer,
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
        <button className="button button-primary" onClick={() => setDialogOpen(true)}>
          <span aria-hidden="true">+</span>
          New Customer
        </button>
      </section>

      {sources.length === 0 && !error && (
        <p className="notice notice-info">
          No source categories yet. You can add a customer here and create its new source category in the same form.
          {" "}<Link href="/dashboard">Open Business Sources</Link>
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
        <CustomerDialog
          sources={sources}
          initialSourceId={sourceFilter ? Number(sourceFilter) : undefined}
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
