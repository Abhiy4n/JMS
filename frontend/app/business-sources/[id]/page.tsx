"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import {
  BUSINESS_SOURCE_TYPE_LABELS,
  type BusinessSource,
  fetchBusinessSource,
} from "@/lib/business-data";
import {
  fetchPledges,
  getBusinessSourcePledgeSummary,
  type BusinessSourcePledgeSummary,
  type Pledge,
} from "@/lib/pledge-data";
import { userFacingError } from "@/lib/user-facing-error";
import { PLEDGE_LABELS } from "@/components/pledges/pledge-labels";

const moneyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value: string) {
  return `${PLEDGE_LABELS.currency} ${moneyFormatter.format(Number(value))}`;
}

export default function BusinessSourceDetailPage() {
  const params = useParams<{ id: string }>();
  const sourceId = Number(params.id);
  const [source, setSource] = useState<BusinessSource | null>(null);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [pledgeSummary, setPledgeSummary] = useState<BusinessSourcePledgeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    if (!Number.isInteger(sourceId) || sourceId < 1) {
      return () => { current = false; };
    }

    Promise.all([
      fetchBusinessSource(sourceId),
      fetchPledges({ business_source: String(sourceId) }),
      getBusinessSourcePledgeSummary(sourceId),
    ])
      .then(([sourceData, pledgeData, summaryData]) => {
        if (current) {
          setSource(sourceData);
          setPledges(pledgeData);
          setPledgeSummary(summaryData);
          setError("");
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setError(userFacingError(requestError, "Could not load this business source."));
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => { current = false; };
  }, [sourceId]);

  return (
    <>
      <Link href="/business-sources" className="back-link">
        <span aria-hidden="true">←</span> Business Sources
      </Link>
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
              <p className="eyebrow">{BUSINESS_SOURCE_TYPE_LABELS[source.source_type]} SOURCE</p>
              <h1>{source.name}</h1>
              {source.description && <p className="page-description">{source.description}</p>}
            </div>
            <div className="detail-actions">
              <span className={`status-badge status-${source.status.toLowerCase()}`}>{source.status}</span>
            </div>
          </section>

          <section className="source-detail-panel" aria-labelledby="source-details-heading">
            <h2 id="source-details-heading">Source Details</h2>
            <dl className="source-detail-grid">
              <div><dt>Source Type</dt><dd>{BUSINESS_SOURCE_TYPE_LABELS[source.source_type]}</dd></div>
              <div><dt>Phone</dt><dd>{source.phone || "—"}</dd></div>
              <div><dt>Address</dt><dd>{source.address || "—"}</dd></div>
              <div><dt>Email</dt><dd>{source.email || "—"}</dd></div>
              {source.pan_vat_number && <div><dt>PAN/VAT Number</dt><dd>{source.pan_vat_number}</dd></div>}
              <div>
                <dt>Interest Terms</dt>
                <dd>
                  {source.interest_percentage != null
                    ? `${source.interest_percentage}% · ${source.days ?? "—"} days`
                    : source.interest_amount != null
                      ? `${PLEDGE_LABELS.currency} ${source.interest_amount} · ${source.days ?? "—"} days`
                      : "—"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="source-account-section" aria-labelledby="source-pledges-heading">
            <div className="source-account-heading">
              <div>
                <p className="eyebrow">PLEDGES</p>
                <h2 id="source-pledges-heading">Pledge Totals</h2>
              </div>
            </div>

            <p className="page-description">
              {PLEDGE_LABELS.asOf} {pledgeSummary?.as_of ?? "—"}
            </p>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col"></th>
                    <th scope="col">{PLEDGE_LABELS.total}</th>
                    <th scope="col">{PLEDGE_LABELS.paid}</th>
                    <th scope="col">{PLEDGE_LABELS.due}</th>
                  </tr>
                </thead>
                <tbody>
                  {(["principal", "interest", "total"] as const).map((rowName) => {
                    const row = pledgeSummary?.summary[rowName];
                    const label = rowName === "principal"
                      ? PLEDGE_LABELS.principal
                      : rowName === "interest"
                        ? PLEDGE_LABELS.interest
                        : PLEDGE_LABELS.total;
                    return (
                      <tr key={rowName}>
                        <th scope="row">{label}</th>
                        <td>{row ? formatMoney(row.total) : "—"}</td>
                        <td>{row ? formatMoney(row.paid) : "—"}</td>
                        <td>{row ? formatMoney(row.due) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <h2>All Pledges</h2>
            <div className="data-table-wrap">
              <table className="data-table source-account-table">
                <thead>
                  <tr>
                    <th scope="col">Pledge</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Date</th>
                    <th scope="col">Principal Due</th>
                    <th scope="col">Interest Due</th>
                    <th scope="col">Total Due</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="table-message">Loading pledges...</td></tr>
                  ) : pledges.length === 0 ? (
                    <tr><td colSpan={7} className="table-message">No pledges for this source.</td></tr>
                  ) : pledges.map((pledge) => (
                    <tr key={pledge.id}>
                      <td><Link className="source-name-link" href={`/pledges/${pledge.id}/form`}>{pledge.pledge_number}</Link></td>
                      <td>{pledge.customer_name}</td>
                      <td>{pledge.pledge_date}</td>
                      <td className="source-account-amount">{formatMoney(pledge.calculation.outstanding_principal)}</td>
                      <td className="source-account-amount">{formatMoney(pledge.calculation.unpaid_interest)}</td>
                      <td className="source-account-amount">{formatMoney(pledge.calculation.total_outstanding)}</td>
                      <td><span className={`status-badge status-${pledge.status.toLowerCase()}`}>{pledge.status_label}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
