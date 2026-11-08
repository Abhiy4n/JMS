"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import PledgePaperForm from "@/app/pledges/[id]/form/PledgePaperForm";
import { closePledge, getPledge, type Pledge, type PledgeStatus } from "@/lib/pledge-data";
import { userFacingError } from "@/lib/user-facing-error";

const STATUS_LABELS: Record<PledgeStatus, string> = {
  ACTIVE: "Active",
  REDEEMED: "Redeemed",
  CANCELLED: "Cancelled",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function PledgeView() {
  return (
    <Suspense fallback={<BusinessAppShell><p className="detail-loading">Loading Pledge details...</p></BusinessAppShell>}>
      <PledgeDetail />
    </Suspense>
  );
}

function PledgeDetail() {
  const visitKey = useRouter().bfcacheId;
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [pledge, setPledge] = useState<Pledge | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [closingStatus, setClosingStatus] = useState<Exclude<PledgeStatus, "ACTIVE"> | null>(null);
  const [actionNotice, setActionNotice] = useState<{ pledgeId: number; message: string; error: boolean } | null>(null);
  const actionLock = useRef(false);
  const pledgeId = Number(id);
  const validId = Number.isSafeInteger(pledgeId) && pledgeId > 0;
  const revision = searchParams.get("updated") ?? "";
  const updated = Boolean(revision);
  const created = searchParams.get("created") === "1";
  const requestKey = `${id}:${revision}:${reloadKey}:${visitKey}`;

  useEffect(() => {
    let current = true;
    if (!validId) return () => { current = false; };

    getPledge(pledgeId)
      .then((data) => {
        if (current) {
          setPledge(data);
          setLoadedKey(requestKey);
          setError("");
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setPledge(null);
          setLoadedKey(requestKey);
          setError(userFacingError(requestError, "Could not load this Pledge. Please try again."));
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => { current = false; };
  }, [pledgeId, validId, requestKey]);

  const loadError = validId ? (loadedKey === requestKey ? error : "") : "This Pledge record could not be found.";
  const currentPledge = loadedKey === requestKey ? pledge : null;
  const isLoading = validId && !loadError && (loading || !currentPledge);

  async function handleClose(status: Exclude<PledgeStatus, "ACTIVE">) {
    if (!currentPledge || currentPledge.status !== "ACTIVE" || actionLock.current) return;
    const action = status === "REDEEMED" ? "Redeem" : "Cancel";
    if (!window.confirm(
      `${action} Pledge ${currentPledge.pledge_number}?\n\nThis will mark the Pledge as ${STATUS_LABELS[status].toLowerCase()}. It will remain in the records and can no longer be edited or reopened.`
    )) return;

    const recordId = currentPledge.id;
    actionLock.current = true;
    setClosingStatus(status);
    setActionNotice(null);
    try {
      const updatedPledge = await closePledge(recordId, status);
      setPledge((current) => current?.id === recordId ? updatedPledge : current);
      setActionNotice({ pledgeId: recordId, message: `Pledge ${STATUS_LABELS[updatedPledge.status].toLowerCase()} successfully.`, error: false });
    } catch (requestError) {
      setActionNotice({
        pledgeId: recordId,
        message: userFacingError(requestError, `Could not ${action.toLowerCase()} this Pledge. Please try again.`),
        error: true,
      });
      // Another session may have closed the record, or the response may have been lost.
      try {
        const latestPledge = await getPledge(recordId);
        setPledge((current) => current?.id === recordId ? latestPledge : current);
      } catch {
        // Keep the existing record and the original action error if reloading fails.
      }
    } finally {
      actionLock.current = false;
      setClosingStatus(null);
    }
  }

  return (
    <BusinessAppShell>
      <section className="page-heading pledge-detail-heading">
        <div>
          <p className="eyebrow">PLEDGE MANAGEMENT</p>
          <h1>Nepali Pledge Form</h1>
          {currentPledge && <p className="page-description">Pledge record: <strong>{currentPledge.pledge_number}</strong></p>}
          {currentPledge && (
            <div className="pledge-detail-status-line">
              <span className={`status-badge status-${currentPledge.status.toLowerCase()}`}>
                {STATUS_LABELS[currentPledge.status]}
              </span>
              {currentPledge.is_overdue && <span className="pledge-overdue-badge">Overdue</span>}
            </div>
          )}
        </div>
        <div className="pledge-detail-actions">
          <Link className="button button-secondary" href="/pledges">Back to Pledge Records</Link>
          {currentPledge?.status === "ACTIVE" && (
            <>
              {closingStatus ? (
                <button className="button button-primary" type="button" disabled>Edit Pledge</button>
              ) : (
                <Link className="button button-primary" href={`/pledges/${currentPledge.id}/edit`}>Edit Pledge</Link>
              )}
              <button className="button button-secondary" type="button" disabled={Boolean(closingStatus)} onClick={() => handleClose("REDEEMED")}>
                {closingStatus === "REDEEMED" ? "Redeeming..." : "Redeem Pledge"}
              </button>
              <button className="button button-danger-outline" type="button" disabled={Boolean(closingStatus)} onClick={() => handleClose("CANCELLED")}>
                {closingStatus === "CANCELLED" ? "Cancelling..." : "Cancel Pledge"}
              </button>
            </>
          )}
        </div>
      </section>

      {created && currentPledge && <p className="notice notice-success" role="status">Pledge created successfully.</p>}
      {updated && currentPledge && <p className="notice notice-success" role="status">Pledge changes saved successfully.</p>}
      {currentPledge && actionNotice?.pledgeId === currentPledge.id && (
        <p className={`notice ${actionNotice.error ? "notice-error" : "notice-success"}`} role={actionNotice.error ? "alert" : "status"}>
          {actionNotice.message}
        </p>
      )}
      {currentPledge && currentPledge.status !== "ACTIVE" && (
        <p className="notice pledge-readonly-notice" role="status">
          This Pledge is {STATUS_LABELS[currentPledge.status].toLowerCase()} and can no longer be edited.
        </p>
      )}

      {isLoading ? (
        <p className="detail-loading" role="status">Loading Pledge details...</p>
      ) : loadError ? (
        <div className="pledge-error-row">
          <p className="notice notice-error" role="alert">{loadError}</p>
          {validId && <button className="button button-secondary button-small" type="button" onClick={() => { setLoading(true); setError(""); setReloadKey((key) => key + 1); }}>Retry</button>}
        </div>
      ) : currentPledge ? (
        <div>
          <p className="page-description">
            Use this view to copy saved details onto the paper form. Blank spaces are for manual completion on paper.
            Dates use Gregorian (AD) YYYY-MM-DD; weights are grams. Scroll the paper sideways on small screens.
          </p>
          <PledgePaperForm pledge={currentPledge} />
          <section className="pledge-detail-card" aria-labelledby="pledge-record-info-heading">
            <div className="pledge-section-heading">
              <div><p className="eyebrow">HISTORY</p><h2 id="pledge-record-info-heading">Record Information</h2></div>
            </div>
            <dl className="pledge-view-grid pledge-record-grid">
              <div><dt>Created</dt><dd>{formatDateTime(currentPledge.created_at)}</dd></div>
              <div><dt>Last Updated</dt><dd>{formatDateTime(currentPledge.updated_at)}</dd></div>
              {currentPledge.status === "REDEEMED" && <div><dt>Redeemed Date</dt><dd>{formatDate(currentPledge.redeemed_date)}</dd></div>}
              {currentPledge.status === "CANCELLED" && <div><dt>Cancelled Date</dt><dd>{formatDate(currentPledge.cancelled_date)}</dd></div>}
            </dl>
          </section>
        </div>
      ) : null}
    </BusinessAppShell>
  );
}
