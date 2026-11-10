"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import PledgePaperForm from "@/app/pledges/[id]/form/PledgePaperForm";
import { useToast } from "@/components/toast/ToastProvider";
import { closePledge, getPledge, type Pledge } from "@/lib/pledge-data";
import { userFacingError } from "@/lib/user-facing-error";

const STATUS_LABELS = {
  ACTIVE: "सक्रिय",
  CLOSED: "बन्द",
  FORFEITED: "जफत",
} as const;

export default function PledgeView() {
  return (
    <Suspense fallback={<BusinessAppShell><p className="detail-loading">भाखा पत्र विवरण लोड हुँदैछ…</p></BusinessAppShell>}>
      <PledgeDetail />
    </Suspense>
  );
}

function PledgeDetail() {
  const visitKey = useRouter().bfcacheId;
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [pledge, setPledge] = useState<Pledge | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [closing, setClosing] = useState(false);
  const shownSaveToast = useRef("");
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
          setError(userFacingError(requestError, "भाखा पत्र लोड गर्न सकिएन।"));
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => { current = false; };
  }, [pledgeId, validId, requestKey]);

  const loadError = validId ? (loadedKey === requestKey ? error : "") : "भाखा पत्र भेटिएन।";
  const currentPledge = loadedKey === requestKey ? pledge : null;
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
    toast.success(created ? "भाखा पत्र बनाइयो।" : "भाखा पत्रका विवरण सुरक्षित गरियो।");
  }, [created, currentPledge, revision, toast, updated]);

  async function handleClose() {
    if (
      !currentPledge
      || currentPledge.status !== "ACTIVE"
      || currentPledge.calculation.total_outstanding !== "0.00"
      || actionLock.current
    ) return;
    if (!window.confirm(`भाखा पत्र ${currentPledge.pledge_number} बन्द गर्ने?`)) return;

    const recordId = currentPledge.id;
    actionLock.current = true;
    setClosing(true);
    try {
      const updatedPledge = await closePledge(recordId);
      setPledge((current) => current?.id === recordId ? updatedPledge : current);
      toast.success("भाखा पत्र बन्द गरियो।");
    } catch (requestError) {
      toast.error(userFacingError(requestError, "भाखा पत्र बन्द गर्न सकिएन।"));
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

  return (
    <BusinessAppShell>
      <section className="page-heading pledge-detail-heading">
        <div>
          <p className="eyebrow">भाखा पत्र</p>
          <h1>भाखा पत्र</h1>
          {currentPledge && <p className="page-description">दर्ता नं.: <strong>{currentPledge.pledge_number}</strong></p>}
          {currentPledge && (
            <div className="pledge-detail-status-line">
              <span className={`status-badge status-${currentPledge.status.toLowerCase()}`}>
                {STATUS_LABELS[currentPledge.status]}
              </span>
            </div>
          )}
        </div>
        <div className="pledge-detail-actions">
          <Link className="button button-secondary" href="/pledges">भाखा पत्र सूची</Link>
          {currentPledge?.status === "ACTIVE" && (
            <>
              {currentPledge.payments.length === 0 && (
                closing ? (
                  <button className="button button-primary" type="button" disabled>खुल्दैछ…</button>
                ) : (
                  <Link className="button button-primary" href={`/pledges/${currentPledge.id}/edit`}>सच्याउनुहोस्</Link>
                )
              )}
              <button
                className="button button-secondary"
                type="button"
                disabled={closing || currentPledge.calculation.total_outstanding !== "0.00"}
                title={currentPledge.calculation.total_outstanding === "0.00" ? undefined : "बाँकी रकम शून्य भएपछि मात्र बन्द गर्न सकिन्छ।"}
                onClick={handleClose}
              >{closing ? "बन्द हुँदैछ…" : "भाखा पत्र बन्द गर्नुहोस्"}</button>
            </>
          )}
        </div>
      </section>

      {currentPledge && currentPledge.status !== "ACTIVE" && (
        <p className="notice pledge-readonly-notice" role="status">
          यो भाखा पत्र {STATUS_LABELS[currentPledge.status]} भएकाले सच्याउन मिल्दैन।
        </p>
      )}

      {currentPledge && (
        <section className="credit-summary-grid" aria-label="बाँकी रकम">
          <div><span>बाँकी साँवा</span><strong>रु. {currentPledge.calculation.outstanding_principal}</strong></div>
          <div><span>बाँकी ब्याज</span><strong>रु. {currentPledge.calculation.unpaid_interest}</strong></div>
          <div><span>जम्मा बाँकी</span><strong>रु. {currentPledge.calculation.total_outstanding}</strong></div>
        </section>
      )}

      {isLoading ? (
        <p className="detail-loading" role="status">भाखा पत्र विवरण लोड हुँदैछ…</p>
      ) : loadError ? (
        <div className="pledge-error-row">
          <p className="notice notice-error" role="alert">{loadError}</p>
          {validId && <button className="button button-secondary button-small" type="button" onClick={() => { setLoading(true); setError(""); setReloadKey((key) => key + 1); }}>फेरि प्रयास गर्नुहोस्</button>}
        </div>
      ) : currentPledge ? (
        <PledgePaperForm pledge={currentPledge} />
      ) : null}
    </BusinessAppShell>
  );
}
