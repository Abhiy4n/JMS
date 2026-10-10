"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import PledgeEditor from "@/components/pledges/PledgeEditor";
import PledgePaperForm from "../form/PledgePaperForm";
import { getPledge, type Pledge } from "@/lib/pledge-data";
import { userFacingError } from "@/lib/user-facing-error";

export default function EditPledgePage() {
  return <Suspense fallback={<BusinessAppShell><p role="status">Loading Pledge...</p></BusinessAppShell>}><EditPledge /></Suspense>;
}

function EditPledge() {
  const visitKey = useRouter().bfcacheId;
  const { id } = useParams<{ id: string }>();
  const pledgeId = Number(id);
  const validId = Number.isSafeInteger(pledgeId) && pledgeId > 0;
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<{ key: string; pledge: Pledge | null; error: string } | null>(null);
  const requestKey = `${id}:${visitKey}:${reloadKey}`;

  useEffect(() => {
    let current = true;
    if (!validId) return;
    getPledge(pledgeId)
      .then((pledge) => { if (current) setResult({ key: requestKey, pledge, error: "" }); })
      .catch((error: unknown) => {
        if (current) setResult({ key: requestKey, pledge: null, error: userFacingError(error, "Could not load this Pledge. Please try again.") });
      });
    return () => { current = false; };
  }, [pledgeId, validId, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const error = validId ? current?.error : "This Pledge record could not be found.";
  if (current?.pledge?.status === "ACTIVE") {
    return <PledgeEditor key={requestKey} mode="edit" pledge={current.pledge} />;
  }
  return (
    <BusinessAppShell>
      <section className="page-heading">
        <h1>Edit Pledge</h1>
        <Link className="button button-secondary" href={validId ? `/pledges/${pledgeId}/form` : "/pledges"}>Back to Nepali Form</Link>
      </section>
      {error ? (
        <div className="pledge-error-row">
          <p className="notice notice-error" role="alert">{error}</p>
          {validId && <button className="button button-secondary" type="button" onClick={() => setReloadKey((key) => key + 1)}>Retry</button>}
        </div>
      ) : current?.pledge ? (
        <>
          <p className="notice pledge-readonly-notice" role="status">This Pledge is {current.pledge.status.toLowerCase()} and can no longer be edited.</p>
          <PledgePaperForm pledge={current.pledge} />
        </>
      ) : <p className="detail-loading" role="status">Loading Pledge for editing...</p>}
    </BusinessAppShell>
  );
}
