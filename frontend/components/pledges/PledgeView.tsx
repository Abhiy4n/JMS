"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import PledgePaperForm from "@/app/pledges/[id]/form/PledgePaperForm";
import { useToast } from "@/components/toast/ToastProvider";
import {
  closePledge,
  getPledge,
  getPledgeFinancialSummary,
  type Pledge,
  type PledgeFinancialSummary,
  type PledgePaymentType,
  type PledgeInterestPeriod,
} from "@/lib/pledge-data";
import { userFacingError } from "@/lib/user-facing-error";
import PledgePaymentHistory from "./PledgePaymentHistory";
import { PLEDGE_LABELS, PLEDGE_STATUS_LABELS } from "./pledge-labels";

const moneyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value: string) {
  return `${PLEDGE_LABELS.currency} ${moneyFormatter.format(Number(value))}`;
}

function formatPeriod(period: PledgeInterestPeriod) {
  const dateRange = period.start_date === period.end_date
    ? period.start_date
    : `${period.start_date} – ${period.end_date}`;
  if (period.kind === "UPFRONT") return `${PLEDGE_LABELS.upfront}: ${dateRange}`;
  if (period.kind === "PAUSED") return `${PLEDGE_LABELS.paused}: ${dateRange}`;
  return dateRange;
}

export default function PledgeView() {
  return (
    <Suspense fallback={<BusinessAppShell><p className="detail-loading">{PLEDGE_LABELS.loadingDetails}</p></BusinessAppShell>}>
      <PledgeDetail />
    </Suspense>
  );
}

function PledgeDetail() {
  const router = useRouter();
  const visitKey = router.bfcacheId;
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [pledge, setPledge] = useState<Pledge | null>(null);
  const [financialSummary, setFinancialSummary] = useState<PledgeFinancialSummary | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [closing, setClosing] = useState(false);
  const [paymentMenuOpen, setPaymentMenuOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<PledgePaymentType | null>(null);
  const shownSaveToast = useRef("");
  const actionLock = useRef(false);
  const pledgeId = Number(id);
  const validId = Number.isSafeInteger(pledgeId) && pledgeId > 0;
  const revision = searchParams.get("updated") ?? "";
  const paymentRevision = searchParams.get("payment") ?? "";
  const updated = Boolean(revision);
  const created = searchParams.get("created") === "1";
  const requestKey = `${id}:${revision}:${paymentRevision}:${reloadKey}:${visitKey}`;

  useEffect(() => {
    let current = true;
    if (!validId) return () => { current = false; };

    Promise.all([getPledge(pledgeId), getPledgeFinancialSummary(pledgeId)])
      .then(([data, summary]) => {
        if (current) {
          setPledge(data);
          setFinancialSummary(summary);
          setLoadedKey(requestKey);
          setError("");
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setPledge(null);
          setFinancialSummary(null);
          setLoadedKey(requestKey);
          setError(userFacingError(requestError, PLEDGE_LABELS.loadError));
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => { current = false; };
  }, [pledgeId, validId, requestKey]);

  const loadError = validId ? (loadedKey === requestKey ? error : "") : PLEDGE_LABELS.notFound;
  const currentPledge = loadedKey === requestKey ? pledge : null;
  const currentFinancialSummary = loadedKey === requestKey ? financialSummary : null;
  const isLoading = validId && !loadError && (loading || !currentPledge);

  useEffect(() => {
    if (!currentPledge) return;
    const toastKey = created
      ? `created:${currentPledge.id}`
      : updated
        ? `updated:${currentPledge.id}:${revision}`
        : "";
    if (!toastKey || shownSaveToast.current === toastKey) return;

    shownSaveToast.current = toastKey;
    toast.success(created ? PLEDGE_LABELS.created : PLEDGE_LABELS.saved);
  }, [created, currentPledge, revision, toast, updated]);

  async function handleClose() {
    if (
      !currentPledge
      || currentPledge.status !== "ACTIVE"
      || currentPledge.calculation.total_outstanding !== "0.00"
      || actionLock.current
    ) return;
    if (!window.confirm(PLEDGE_LABELS.closeConfirmation(currentPledge.pledge_number))) return;

    const recordId = currentPledge.id;
    actionLock.current = true;
    setClosing(true);
    try {
      const updatedPledge = await closePledge(recordId);
      setPledge((current) => current?.id === recordId ? updatedPledge : current);
      toast.success(PLEDGE_LABELS.closed);
    } catch (requestError) {
      toast.error(userFacingError(requestError, PLEDGE_LABELS.closeError));
      try {
        const latestPledge = await getPledge(recordId);
        setPledge((current) => current?.id === recordId ? latestPledge : current);
      } catch {
        // Keep the existing record and original action error if reload fails.
      }
    } finally {
      actionLock.current = false;
      setClosing(false);
    }
  }

  function handlePaymentSaved() {
    setPaymentType(null);
    setPaymentMenuOpen(false);
    setLoading(true);
    router.replace(`/pledges/${pledgeId}/form?payment=${Date.now()}`, { scroll: false });
  }

  return (
    <BusinessAppShell>
      <section className="page-heading pledge-detail-heading">
        <div>
          <h1>{PLEDGE_LABELS.detailTitle}</h1>
          {currentPledge && <p className="page-description">{PLEDGE_LABELS.recordNumber} <strong>{currentPledge.pledge_number}</strong></p>}
          {currentPledge && (
            <div className="pledge-detail-status-line">
              <span className={`status-badge status-${currentPledge.status.toLowerCase()}`}>
                {PLEDGE_STATUS_LABELS[currentPledge.status]}
              </span>
            </div>
          )}
        </div>
        <div className="pledge-detail-actions">
          {currentPledge && (
            <div className="pledge-payment-action">
              <button
                className="button button-secondary"
                type="button"
                disabled={currentPledge.status !== "ACTIVE"}
                title={currentPledge.status !== "ACTIVE" ? PLEDGE_LABELS.paymentInactive : undefined}
                aria-label={currentPledge.status !== "ACTIVE" ? `${PLEDGE_LABELS.payment}. ${PLEDGE_LABELS.paymentInactive}` : PLEDGE_LABELS.payment}
                aria-haspopup="menu"
                aria-expanded={paymentMenuOpen}
                onClick={() => setPaymentMenuOpen((open) => !open)}
              >{PLEDGE_LABELS.payment}</button>
              {currentPledge.status !== "ACTIVE" && (
                <span className="pledge-payment-disabled-reason">{PLEDGE_LABELS.paymentInactiveReason}</span>
              )}
              {paymentMenuOpen && currentPledge.status === "ACTIVE" && (
                <div className="pledge-payment-menu" role="menu" aria-label={PLEDGE_LABELS.paymentMenuLabel}>
                  <button type="button" role="menuitem" onClick={() => { setPaymentMenuOpen(false); setPaymentType("PRINCIPAL"); }}>
                    {PLEDGE_LABELS.principal}
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setPaymentMenuOpen(false); setPaymentType("INTEREST"); }}>
                    {PLEDGE_LABELS.interest}
                  </button>
                </div>
              )}
            </div>
          )}
          <Link className="button button-secondary" href="/pledges">{PLEDGE_LABELS.list}</Link>
          {currentPledge?.status === "ACTIVE" && (
            <>
              {!currentPledge.has_payments && (
                closing ? (
                  <button className="button button-primary" type="button" disabled>{PLEDGE_LABELS.opening}</button>
                ) : (
                  <Link className="button button-primary" href={`/pledges/${currentPledge.id}/edit`}>{PLEDGE_LABELS.edit}</Link>
                )
              )}
              <button
                className="button button-secondary"
                type="button"
                disabled={closing || currentPledge.calculation.total_outstanding !== "0.00"}
                title={currentPledge.calculation.total_outstanding === "0.00" ? undefined : PLEDGE_LABELS.closeDisabled}
                onClick={handleClose}
              >{closing ? PLEDGE_LABELS.closing : PLEDGE_LABELS.close}</button>
            </>
          )}
        </div>
      </section>

      {currentPledge && currentPledge.status !== "ACTIVE" && (
        <p className="notice pledge-readonly-notice" role="status">
          {PLEDGE_LABELS.cannotEdit(PLEDGE_STATUS_LABELS[currentPledge.status])}
        </p>
      )}

      {currentPledge && (
        currentFinancialSummary && (
          <section className="pledge-summary-section" aria-label={PLEDGE_LABELS.outstandingBalance}>
            <p className="page-description">
              {PLEDGE_LABELS.asOf} {currentFinancialSummary.as_of}
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
                  <tr>
                    <th scope="row">{PLEDGE_LABELS.principal}</th>
                    <td>{formatMoney(currentFinancialSummary.summary.principal.total)}</td>
                    <td>{formatMoney(currentFinancialSummary.summary.principal.paid)}</td>
                    <td>{formatMoney(currentFinancialSummary.summary.principal.due)}</td>
                  </tr>
                  <tr>
                    <th scope="row">{PLEDGE_LABELS.interest}</th>
                    <td>{formatMoney(currentFinancialSummary.summary.interest.total)}</td>
                    <td>{formatMoney(currentFinancialSummary.summary.interest.paid)}</td>
                    <td>{formatMoney(currentFinancialSummary.summary.interest.due)}</td>
                  </tr>
                  <tr>
                    <th scope="row">{PLEDGE_LABELS.total}</th>
                    <td>{formatMoney(currentFinancialSummary.summary.total.total)}</td>
                    <td>{formatMoney(currentFinancialSummary.summary.total.paid)}</td>
                    <td>{formatMoney(currentFinancialSummary.summary.total.due)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <h2>{PLEDGE_LABELS.interestBreakdown}</h2>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{PLEDGE_LABELS.period}</th>
                    <th scope="col">{PLEDGE_LABELS.days}</th>
                    <th scope="col">{PLEDGE_LABELS.principalUsed}</th>
                    <th scope="col">{PLEDGE_LABELS.rate}</th>
                    <th scope="col">{PLEDGE_LABELS.interestAmount}</th>
                  </tr>
                </thead>
                <tbody>
                  {currentFinancialSummary.interest_breakdown.map((period, index) => (
                    period.kind === "PRINCIPAL_PAYMENT" ? (
                      <tr key={`payment-${period.start_date}-${index}`}>
                        <td colSpan={5}>
                          {PLEDGE_LABELS.principalPaymentMarker(
                            period.start_date,
                            formatMoney(period.payment_amount ?? "0.00"),
                            formatMoney(period.new_principal ?? period.principal_used),
                          )}
                        </td>
                      </tr>
                    ) : (
                      <tr key={`${period.kind}-${period.start_date}-${period.end_date}-${index}`}>
                        <td>{formatPeriod(period)}</td>
                        <td>{period.days}</td>
                        <td>{formatMoney(period.principal_used)}</td>
                        <td>{period.rate}</td>
                        <td>{formatMoney(period.interest)}</td>
                      </tr>
                    )
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={4}>{PLEDGE_LABELS.totalInterest}</th>
                    <td>{formatMoney(currentFinancialSummary.summary.interest.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )
      )}

      {isLoading ? (
        <p className="detail-loading" role="status">{PLEDGE_LABELS.loadingDetails}</p>
      ) : loadError ? (
        <div className="pledge-error-row">
          <p className="notice notice-error" role="alert">{loadError}</p>
          {validId && <button className="button button-secondary button-small" type="button" onClick={() => { setLoading(true); setError(""); setReloadKey((key) => key + 1); }}>{PLEDGE_LABELS.retry}</button>}
        </div>
      ) : currentPledge ? (
        <>
          <PledgePaperForm pledge={currentPledge} />
          <PledgePaymentHistory
            pledge={currentPledge}
            createType={paymentType}
            onCreateClose={() => setPaymentType(null)}
            onPaymentSaved={handlePaymentSaved}
          />
        </>
      ) : null}
    </BusinessAppShell>
  );
}
