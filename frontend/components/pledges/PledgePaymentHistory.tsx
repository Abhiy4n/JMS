"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import BSDatePicker from "@/components/date-picker/BSDatePicker";
import { useToast } from "@/components/toast/ToastProvider";
import { ApiError } from "@/lib/auth/api";
import {
  createPledgePayment,
  fetchPledgeFormDefaults,
  getPledgePaymentDue,
  updatePledgePayment,
  type Pledge,
  type PledgePayment,
  type PledgePaymentType,
} from "@/lib/pledge-data";
import { userFacingError } from "@/lib/user-facing-error";
import { PLEDGE_LABELS } from "./pledge-labels";

function paymentTypeLabel(type: PledgePaymentType) {
  return type === "PRINCIPAL" ? PLEDGE_LABELS.principal : PLEDGE_LABELS.interest;
}

function formatMoney(value: string) {
  const [whole = "0", fraction = "00"] = value.split(".");
  return `${PLEDGE_LABELS.currency} ${Number(whole).toLocaleString("en-NP")}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function parseCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function formatCents(value: number) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${sign}${whole.toLocaleString("en-NP")}.${fraction}`;
}

function getAmountError(value: string, dueCents: number | null) {
  if (!value.trim()) return PLEDGE_LABELS.amountRequired;
  const cents = parseCents(value);
  if (cents === null) return PLEDGE_LABELS.amountPrecision;
  if (cents <= 0) return PLEDGE_LABELS.amountPositive;
  if (dueCents !== null && cents > dueCents) return PLEDGE_LABELS.amountExceedsDue;
  return "";
}

function getFieldError(error: unknown, field: string) {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object" || Array.isArray(error.details)) {
    return "";
  }
  const value = (error.details as Record<string, unknown>)[field];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join(" ");
  return "";
}

function formatTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat("en-NP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function comparePayments(a: PledgePayment, b: PledgePayment) {
  return a.payment_date.localeCompare(b.payment_date)
    || a.recorded_at.localeCompare(b.recorded_at)
    || a.id - b.id;
}

type Props = {
  pledge: Pledge;
  createType: PledgePaymentType | null;
  onCreateClose: () => void;
  onPaymentSaved: () => void;
};

type DueState =
  | { key: string; data: { principal_due: string; interest_due: string } }
  | { key: string; error: string };

export default function PledgePaymentHistory({
  pledge,
  createType,
  onCreateClose,
  onPaymentSaved,
}: Props) {
  const toast = useToast();
  const { user } = useAuth();
  const canEditPayments = Boolean(user?.is_staff);
  const [editedPayment, setEditedPayment] = useState<PledgePayment | null>(null);
  const [detailsPayment, setDetailsPayment] = useState<PledgePayment | null>(null);
  const [today, setToday] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [dueState, setDueState] = useState<DueState | null>(null);
  const [dateSaveError, setDateSaveError] = useState("");
  const [amountSaveError, setAmountSaveError] = useState("");
  const [reasonSaveError, setReasonSaveError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [reasonTouched, setReasonTouched] = useState(false);

  const activeType = editedPayment?.type ?? createType;
  const isEditing = Boolean(editedPayment);
  const orderedPayments = useMemo(
    () => pledge.payments.filter((payment) => !payment.is_voided).sort(comparePayments),
    [pledge.payments],
  );
  const editIndex = editedPayment
    ? orderedPayments.findIndex((payment) => payment.id === editedPayment.id)
    : -1;
  const previousPayment = editIndex > 0 ? orderedPayments[editIndex - 1] : null;
  const nextPayment = editIndex >= 0 ? orderedPayments[editIndex + 1] ?? null : null;
  const dateMin = isEditing
    ? previousPayment?.payment_date ?? pledge.pledge_date
    : orderedPayments[orderedPayments.length - 1]?.payment_date ?? pledge.pledge_date;
  const dateMax = isEditing ? nextPayment?.payment_date ?? today : today;

  useEffect(() => {
    if (!activeType) return;
    let current = true;
    fetchPledgeFormDefaults()
      .then((defaults) => {
        if (!current) return;
        setToday(defaults.today_bs);
        if (!editedPayment) {
          setSelectedDate((currentDate) => currentDate || defaults.today_bs);
        }
      })
      .catch((requestError: unknown) => {
        if (current) setFormError(userFacingError(requestError, PLEDGE_LABELS.paymentDefaultsError));
      });
    return () => { current = false; };
  }, [activeType, createType, editedPayment, pledge.id]);

  const dueKey = `${activeType ?? ""}:${selectedDate}:${editedPayment?.id ?? ""}`;
  useEffect(() => {
    if (!activeType || !today || !selectedDate) return;
    let current = true;
    getPledgePaymentDue(pledge.id, selectedDate, editedPayment?.id)
      .then((result) => {
        if (current) setDueState({ key: dueKey, data: result });
      })
      .catch((requestError: unknown) => {
        if (current) setDueState({
          key: dueKey,
          error: userFacingError(requestError, PLEDGE_LABELS.paymentDueError),
        });
      });
    return () => { current = false; };
  }, [activeType, dueKey, editedPayment?.id, pledge.id, selectedDate, today]);

  const dueResult = dueState?.key === dueKey ? dueState : null;
  const due = dueResult && "data" in dueResult ? dueResult.data : null;
  const dueError = dueResult && "error" in dueResult ? dueResult.error : "";
  const defaultsLoading = Boolean(activeType && !today && !formError);
  const dueLoading = Boolean(activeType && today && selectedDate && !dueResult);
  const dueAmount = activeType && due
    ? activeType === "PRINCIPAL" ? due.principal_due : due.interest_due
    : null;
  const dueCents = dueAmount === null ? null : parseCents(dueAmount);
  const invalidDueAmount = dueAmount !== null && dueCents === null;
  const amountCents = parseCents(amount);
  const amountError = ((submitted || amountTouched) && dueCents !== null ? getAmountError(amount, dueCents) : "") || amountSaveError;
  const reasonError = ((submitted || reasonTouched) && isEditing && reason.trim().length < 5 ? PLEDGE_LABELS.reasonRequired : "") || reasonSaveError;
  const dateError = dueError || dateSaveError;
  const nothingDue = dueCents !== null && dueCents <= 0;
  const remaining = dueCents !== null && amountCents !== null
    ? formatCents(dueCents - amountCents)
    : "—";

  function closePaymentForm() {
    setEditedPayment(null);
    setToday("");
    setSelectedDate("");
    setAmount("");
    setReason("");
    setDueState(null);
    setDateSaveError("");
    setAmountSaveError("");
    setReasonSaveError("");
    setFormError("");
    setSubmitted(false);
    setAmountTouched(false);
    setReasonTouched(false);
    onCreateClose();
  }

  function openEdit(payment: PledgePayment) {
    setDetailsPayment(null);
    setEditedPayment(payment);
    setToday("");
    setSelectedDate(payment.payment_date);
    setAmount(payment.amount);
    setReason("");
    setDueState(null);
    setDateSaveError("");
    setAmountSaveError("");
    setReasonSaveError("");
    setFormError("");
    setSubmitted(false);
    setAmountTouched(false);
    setReasonTouched(false);
    onCreateClose();
  }

  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeType || saving) return;
    setSubmitted(true);
    setFormError("");
    setDateSaveError("");
    setAmountSaveError("");
    setReasonSaveError("");
    if (pledge.status !== "ACTIVE") {
      setFormError(PLEDGE_LABELS.paymentInactive);
      return;
    }
    if (!selectedDate || dueCents === null || dueLoading || dueError || nothingDue) return;
    const validationError = getAmountError(amount, dueCents);
    if (validationError || (isEditing && reason.trim().length < 5)) return;
    setSaving(true);
    try {
      if (editedPayment) {
        await updatePledgePayment(editedPayment.id, {
          payment_date: selectedDate,
          amount: amount.trim(),
          reason: reason.trim(),
        });
      } else {
        await createPledgePayment(pledge.id, {
          payment_date: selectedDate,
          type: activeType,
          amount: amount.trim(),
        });
      }
      toast.success(PLEDGE_LABELS.paymentSaved);
      closePaymentForm();
      onPaymentSaved();
    } catch (requestError) {
      const amountFieldError = getFieldError(requestError, "amount");
      const reasonFieldError = getFieldError(requestError, "reason");
      const dateFieldError = getFieldError(requestError, "payment_date");
      if (amountFieldError) setAmountSaveError(amountFieldError);
      else if (reasonFieldError) setReasonSaveError(reasonFieldError);
      else if (dateFieldError) setDateSaveError(dateFieldError);
      else setFormError(userFacingError(requestError, PLEDGE_LABELS.paymentSaveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="pledge-detail-card pledge-payment-history" aria-labelledby="pledge-payment-history-title">
        <div className="pledge-section-heading">
          <h2 id="pledge-payment-history-title">{PLEDGE_LABELS.paymentHistory}</h2>
        </div>
        {orderedPayments.length === 0 ? (
          <p className="table-message">{PLEDGE_LABELS.noPayments}</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table pledge-payment-table">
              <thead>
                <tr>
                  <th>{PLEDGE_LABELS.date}</th>
                  <th>{PLEDGE_LABELS.type}</th>
                  <th>{PLEDGE_LABELS.amount}</th>
                  <th>{PLEDGE_LABELS.dueBefore}</th>
                  <th>{PLEDGE_LABELS.remainingAfter}</th>
                  <th>{PLEDGE_LABELS.recordedBy}</th>
                  <th>{PLEDGE_LABELS.actions}</th>
                </tr>
              </thead>
              <tbody>
                {[...orderedPayments].reverse().map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.payment_date}</td>
                    <td>{paymentTypeLabel(payment.type)}</td>
                    <td>{formatMoney(payment.amount)}</td>
                    <td>{formatMoney(payment.due_before)}</td>
                    <td>{formatMoney(payment.remaining_after)}</td>
                    <td>{payment.recorded_by}</td>
                    <td>
                      <div className="pledge-payment-row-actions">
                        <button className="button button-secondary button-small" type="button" onClick={() => setDetailsPayment(payment)}>
                          {PLEDGE_LABELS.details}
                        </button>
                        {canEditPayments && pledge.status === "ACTIVE" && (
                          <button className="button button-secondary button-small" type="button" onClick={() => openEdit(payment)}>
                            {PLEDGE_LABELS.editPayment}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {activeType && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) closePaymentForm();
        }}>
          <section className="modal-panel modal-panel-narrow" role="dialog" aria-modal="true" aria-labelledby="pledge-payment-title">
            <div className="modal-heading">
              <h2 id="pledge-payment-title">
                {activeType === "PRINCIPAL" ? PLEDGE_LABELS.principalPayment : PLEDGE_LABELS.interestPayment}
              </h2>
              <button className="icon-button" type="button" disabled={saving} onClick={closePaymentForm} aria-label={PLEDGE_LABELS.cancel}>×</button>
            </div>
            <form onSubmit={savePayment} noValidate>
              <div className="pledge-payment-form-grid">
                <label className="form-field">
                  <span>{PLEDGE_LABELS.type}</span>
                  <input type="text" readOnly value={paymentTypeLabel(activeType)} />
                </label>
                <div className="form-field">
                  <span>{PLEDGE_LABELS.paymentDate}</span>
                  {today && (
                    <BSDatePicker
                      id="pledge-payment-date"
                      label={PLEDGE_LABELS.paymentDate}
                      value={selectedDate}
                      today={today}
                      min={dateMin}
                      max={dateMax}
                      error={dateError || undefined}
                      onChange={(value) => { setDateSaveError(""); setSelectedDate(value); }}
                    />
                  )}
                  {defaultsLoading && <span>{PLEDGE_LABELS.paymentWhenLoading}</span>}
                </div>
                <label className="form-field">
                  <span>{PLEDGE_LABELS.dueAmount}</span>
                  <input type="text" readOnly value={dueAmount === null ? "" : formatMoney(dueAmount)} />
                </label>
                <label className="form-field">
                  <span>{PLEDGE_LABELS.amountPaying}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    aria-invalid={Boolean(amountError)}
                    onChange={(event) => { setAmountTouched(true); setAmountSaveError(""); setAmount(event.target.value); }}
                  />
                  {amountError && <span className="pledge-payment-field-error" role="alert">{amountError}</span>}
                </label>
                <label className="form-field">
                  <span>{PLEDGE_LABELS.remaining}</span>
                  <input type="text" readOnly value={remaining === "—" ? remaining : `${PLEDGE_LABELS.currency} ${remaining}`} />
                </label>
                {isEditing && (
                  <label className="form-field">
                    <span>{PLEDGE_LABELS.reason}</span>
                    <input
                      type="text"
                      maxLength={500}
                      value={reason}
                      aria-invalid={Boolean(reasonError)}
                      onChange={(event) => { setReasonTouched(true); setReasonSaveError(""); setReason(event.target.value); }}
                    />
                    {reasonError && <span className="pledge-payment-field-error" role="alert">{reasonError}</span>}
                  </label>
                )}
              </div>
              {nothingDue && <p className="notice" role="status">{PLEDGE_LABELS.nothingDue}</p>}
              {invalidDueAmount && <p className="notice notice-error" role="alert">{PLEDGE_LABELS.paymentDueError}</p>}
              {formError && <p className="notice notice-error" role="alert">{formError}</p>}
              {dueLoading && <p className="detail-loading" role="status">{PLEDGE_LABELS.paymentWhenLoading}</p>}
              <div className="modal-actions">
                <button className="button button-secondary" type="button" disabled={saving} onClick={closePaymentForm}>
                  {PLEDGE_LABELS.cancel}
                </button>
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={saving || defaultsLoading || dueLoading || dueCents === null || nothingDue || Boolean(dueError)}
                >{saving ? PLEDGE_LABELS.savingPayment : PLEDGE_LABELS.savePayment}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {detailsPayment && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDetailsPayment(null);
        }}>
          <section className="modal-panel modal-panel-narrow" role="dialog" aria-modal="true" aria-labelledby="pledge-payment-details-title">
            <div className="modal-heading">
              <h2 id="pledge-payment-details-title">{PLEDGE_LABELS.details}</h2>
              <button className="icon-button" type="button" onClick={() => setDetailsPayment(null)} aria-label={PLEDGE_LABELS.cancel}>×</button>
            </div>
            <dl className="pledge-payment-details-grid">
              <div><dt>{PLEDGE_LABELS.date}</dt><dd>{detailsPayment.payment_date}</dd></div>
              <div><dt>{PLEDGE_LABELS.type}</dt><dd>{paymentTypeLabel(detailsPayment.type)}</dd></div>
              <div><dt>{PLEDGE_LABELS.amount}</dt><dd>{formatMoney(detailsPayment.amount)}</dd></div>
              <div><dt>{PLEDGE_LABELS.dueBefore}</dt><dd>{formatMoney(detailsPayment.due_before)}</dd></div>
              <div><dt>{PLEDGE_LABELS.remainingAfter}</dt><dd>{formatMoney(detailsPayment.remaining_after)}</dd></div>
              <div><dt>{PLEDGE_LABELS.recordedBy}</dt><dd>{detailsPayment.recorded_by}</dd></div>
              <div><dt>{PLEDGE_LABELS.recordedAt}</dt><dd>{formatTimestamp(detailsPayment.recorded_at)}</dd></div>
            </dl>
            <h3 className="pledge-payment-edit-history-title">{PLEDGE_LABELS.editHistory}</h3>
            {detailsPayment.edit_history.length === 0 ? (
              <p>{PLEDGE_LABELS.noEditHistory}</p>
            ) : (
              <ul className="pledge-payment-edit-history">
                {detailsPayment.edit_history.map((edit) => (
                  <li key={edit.id}>
                    <strong>{edit.field.replaceAll("_", " ")}</strong>: {edit.old_value} → {edit.new_value}
                    <span>{PLEDGE_LABELS.changedBy}: {edit.changed_by} · {formatTimestamp(edit.changed_at)}</span>
                    <span>{PLEDGE_LABELS.reason}: {edit.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            {canEditPayments && pledge.status === "ACTIVE" && (
              <div className="modal-actions">
                <button className="button button-secondary" type="button" onClick={() => openEdit(detailsPayment)}>
                  {PLEDGE_LABELS.editPayment}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
