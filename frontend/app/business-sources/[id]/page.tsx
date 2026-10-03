"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import CustomerDialog from "@/components/CustomerDialog";
import { type BusinessSource, type Customer, fetchBusinessSource, fetchCustomers } from "@/lib/business-data";

export default function BusinessSourceDetailPage() {
  const params = useParams<{ id: string }>();
  const sourceId = Number(params.id);
  const [source, setSource] = useState<BusinessSource | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    if (!Number.isInteger(sourceId) || sourceId < 1) {
      return () => { current = false; };
    }

    Promise.all([fetchBusinessSource(sourceId), fetchCustomers("", sourceId)])
      .then(([sourceData, customerData]) => {
        if (current) {
          setSource(sourceData);
          setCustomers(customerData);
          setError("");
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setError(requestError instanceof Error ? requestError.message : "Could not load this business source.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [sourceId, reloadKey]);

  return (
    <BusinessAppShell>
      <Link href="/dashboard" className="back-link"><span aria-hidden="true">←</span> Business Sources</Link>
      {!Number.isInteger(sourceId) || sourceId < 1 ? (
        <p className="notice notice-error" role="alert">This business source could not be found.</p>
      ) : error ? (
        <p className="notice notice-error" role="alert">{error}</p>
      ) : loading ? (
        <p className="detail-loading">Loading business source...</p>
      ) : source && (
        <>
          <section className="detail-heading">
            <div>
              <p className="eyebrow">{source.channel_type} SOURCE</p>
              <h1>{source.name}</h1>
              <p className="page-description">{source.description || "Customers connected to this acquisition source."}</p>
            </div>
            <div className="detail-actions">
              <span className={`status-badge status-${source.status.toLowerCase()}`}>{source.status}</span>
              <button className="button button-primary" type="button" onClick={() => setCustomerDialogOpen(true)}>
                <span aria-hidden="true">+</span> Add customer
              </button>
            </div>
          </section>

          <div className="detail-summary">
            <span className="detail-summary-icon" aria-hidden="true">♙</span>
            <span><strong>{customers.length}</strong><small>{customers.length === 1 ? "customer linked" : "customers linked"}</small></span>
          </div>

          <div className="table-toolbar">
            <div className="table-title-group"><h2>Customers from this source</h2><span className="record-count">{customers.length}</span></div>
            <Link className="button button-primary button-small" href={`/customers?source=${source.id}`}>View customer directory</Link>
          </div>
          <div className="data-table-wrap">
            <table className="data-table customer-table">
              <thead><tr><th scope="col">Customer</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col">Added</th></tr></thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr><td colSpan={4} className="table-message empty-message"><strong>No customers linked yet</strong><span>New customers linked to this source will appear here.</span></td></tr>
                ) : customers.map((customer) => (
                  <tr key={customer.id}>
                    <td className="customer-name-cell">{customer.name}</td>
                    <td>{customer.phone || "—"}</td>
                    <td>{customer.email || "—"}</td>
                    <td>{new Date(customer.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {customerDialogOpen && source && (
        <CustomerDialog
          sources={[source]}
          initialSourceId={source.id}
          onClose={() => setCustomerDialogOpen(false)}
          onCreated={() => {
            setCustomerDialogOpen(false);
            setReloadKey((key) => key + 1);
          }}
        />
      )}
    </BusinessAppShell>
  );
}