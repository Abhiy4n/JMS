"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import BusinessAppShell from "@/components/BusinessAppShell";
import CustomerEditDialog from "@/components/CustomerEditDialog";
import CustomerFolioDialog from "@/components/CustomerFolioDialog";
import CustomerActions from "@/components/CustomerActions";
import { CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS, type CustomerType, type Customer, type BusinessSourceSort, BUSINESS_SOURCE_SORTS, fetchCustomers } from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";
import { fetchCustomerBhakaPatraTotals, type CustomerBhakaPatraTotals } from "@/lib/bhaka-patra-api";
import { formatBhakaPatraAmount, formatBhakaPatraDate } from "@/lib/customer-bhaka-patra";

export default function CustomersPage() {
  return <Suspense fallback={<BusinessAppShell><p className="detail-loading">Loading customers...</p></BusinessAppShell>}><CustomersDirectory /></Suspense>;
}

function CustomersDirectory() {
  const params = useSearchParams();
  const router = useRouter();
  const search = params.get("q") ?? "";
  const typeParam = params.get("type") ?? "";
  const typeFilter = CUSTOMER_TYPES.includes(typeParam as CustomerType) ? typeParam as CustomerType : "";
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reload, setReload] = useState(0);
  const selectedParam = params.get("customer");
  const selectedId = selectedParam && /^\d+$/.test(selectedParam) ? Number(selectedParam) : null;
  const sortParam = params.get("ordering");
  const ordering: BusinessSourceSort = BUSINESS_SOURCE_SORTS.includes(sortParam as BusinessSourceSort) ? sortParam as BusinessSourceSort : "first_added";
  const [totals, setTotals] = useState<CustomerBhakaPatraTotals | null>(null);
  const [totalsError, setTotalsError] = useState("");
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  const closeFolio = useCallback(() => {
    // Close only the selected windows; preserve directory search, type and ordering.
    const query = new URLSearchParams(params.toString());
    query.delete("customer"); query.delete("patra");
    router.replace(`/customers${query.size ? `?${query}` : ""}`, { scroll: false });
    refresh();
  }, [params, router, refresh]);

  useEffect(() => {
    let current = true;
    // Overall KPIs are fetched independently, so narrowing the directory cannot change them.
    fetchCustomerBhakaPatraTotals().then((data) => { if (current) { setTotals(data); setTotalsError(""); } })
      .catch((failure) => { if (current) setTotalsError(userFacingError(failure, "Could not load overall Rakha Patra totals.")); });
    return () => { current = false; };
  }, [reload]);

  useEffect(() => {
    // Ignore a previous response after filters change or this directory unmounts.
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchCustomers(search, typeFilter || undefined, undefined, ordering)
        .then((data) => { if (current) { setCustomers(data); setError(""); } })
        .catch((failure) => { if (current) setError(userFacingError(failure, "Could not load customers.")); })
        .finally(() => { if (current) setLoading(false); });
    }, 150);
    return () => { current = false; window.clearTimeout(timer); };
  }, [search, typeFilter, ordering, reload]);

  useEffect(() => {
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  function filter(name: string, value: string) {
    const query = new URLSearchParams(params.toString());
    ["source", "status"].forEach((key) => query.delete(key));
    if (value) query.set(name, value); else query.delete(name);
    setLoading(true);
    router.replace(`/customers${query.size ? `?${query}` : ""}`, { scroll: false });
  }
  return <BusinessAppShell><div className="customer-directory">
    <section className="page-heading"><div><p className="eyebrow">CUSTOMERS</p><h1>Customers</h1><p className="page-description">Review customer folios and records connected to your business sources.</p></div></section>
    <div className="portfolio-kpis customer-bhaka-patra-kpis customer-overall-kpis" aria-label="Overall customer Rakha Patra totals">
      <section className="bill-detail-panel"><span>Total Rakha Patra</span><strong>{totalsError ? "Unavailable" : totals ? totals.total_rakha_patra : "Loading..."}</strong></section>
      <section className="bill-detail-panel"><span>Total Amount</span><strong>{totalsError ? "Unavailable" : totals ? formatBhakaPatraAmount(totals.total_amount) : "Loading..."}</strong></section>
    </div>
    {totalsError && <p className="notice notice-error" role="alert">{totalsError} <button className="button button-secondary button-small" onClick={refresh}>Retry totals</button></p>}
    <div className="table-toolbar customer-directory-toolbar">
      <div className="table-title-group"><h2>All customers</h2><span className="record-count">{loading ? "Loading..." : customers.length}</span></div>
      <div className="table-filters">
        <label className="local-search"><span className="sr-only">Search customers</span><input value={search} onChange={(event) => filter("q", event.target.value)} placeholder="Name, phone, email, source..." /></label>
        <label className="filter-select-wrap"><span className="sr-only">Customer type</span><select value={typeFilter} onChange={(event) => filter("type", event.target.value)}><option value="">All customer types</option>{CUSTOMER_TYPES.map((kind) => <option key={kind} value={kind}>{CUSTOMER_TYPE_LABELS[kind]}</option>)}</select></label>
        <label className="filter-select-wrap"><span className="sr-only">Sort customers</span><select aria-label="Sort customers" value={ordering} onChange={(event) => filter("ordering", event.target.value)}><option value="first_added">First created first</option><option value="recently_added">Last created first</option><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option></select></label>
        {(search || typeFilter) && <button className="button button-secondary button-small" onClick={() => { setLoading(true); router.replace("/customers", { scroll: false }); }}>Clear filters</button>}
      </div>
    </div>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {success && <p className="notice notice-success" role="status">{success}</p>}
    <div className="data-table-wrap"><table className="data-table customer-table customer-directory-table">
      <thead><tr>{["SN", "Customer Name", "Phone", "Email", "Customer type", "Added", "Actions"].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{loading ? <tr><td colSpan={7} className="table-message">Loading customers...</td></tr> : error ? <tr><td colSpan={7} className="table-message"><button className="button button-secondary" onClick={() => { setLoading(true); setReload((value) => value + 1); }}>Retry loading customers</button></td></tr> : customers.length === 0 ? <tr><td colSpan={7} className="table-message empty-message"><strong>{search || typeFilter ? "No matching customers" : "No customers found"}</strong><span>{search || typeFilter ? "Change your search or customer type to see more records." : "Create a business source to display its corresponding customer entry here."}</span><Link className="source-name-link" href="/business-sources">Go to Business Sources</Link></td></tr> : customers.map((customer, index) => <tr key={customer.id}>
        <td>{index + 1}</td><td className="customer-name-cell"><Link className="customer-folio-link source-name-link" scroll={false} href={`/customers?${new URLSearchParams({ ...Object.fromEntries(params.entries()), customer: String(customer.id) })}`}>{customer.name}</Link></td>
        <td>{customer.phone || "—"}</td><td>{customer.email || "—"}</td><td>{CUSTOMER_TYPE_LABELS[customer.customer_type]}</td><td>{formatBhakaPatraDate(customer.created_at)}</td>
        <td><CustomerActions customer={customer} onEdit={setEditing} onChanged={() => { setSuccess("Customer entry updated."); setReload((value) => value + 1); }} onDeleted={() => { setSuccess("Customer deleted."); setReload((value) => value + 1); }} /></td>
      </tr>)}</tbody>
    </table></div>
    {selectedId !== null && <CustomerFolioDialog key={selectedId} customerId={selectedId} onClose={closeFolio} onUpdated={refresh} />}
    {editing && <CustomerEditDialog customer={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setSuccess("Customer updated."); setReload((value) => value + 1); }} />}
  </div></BusinessAppShell>;
}
