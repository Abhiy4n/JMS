"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import BusinessAppShell from "@/components/BusinessAppShell";
import { createBill, fetchBill, type Bill, type BillRateUnit, type NewBill, updateBill } from "@/lib/bill-data";
import { type Customer, fetchCustomers } from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";

type ItemField =
  | "item_name"
  | "quantity"
  | "material"
  | "rate_unit"
  | "purity"
  | "purity_custom"
  | "gross_weight"
  | "stone_weight"
  | "rate"
  | "making_charge"
  | "discount";

type BillItemDraft = Record<ItemField, string> & { key: number };
type ItemErrors = Partial<Record<ItemField, string>>;
type Material = "GOLD" | "SILVER" | "PLATINUM" | "DIAMOND" | "GEMSTONE" | "OTHER";
type RateUnit = "GRAM" | "PIECE" | "CARAT" | "ITEM";

const MATERIALS: { value: Material; label: string; defaultUnit: RateUnit }[] = [
  { value: "GOLD", label: "Gold", defaultUnit: "GRAM" },
  { value: "SILVER", label: "Silver", defaultUnit: "GRAM" },
  { value: "PLATINUM", label: "Platinum", defaultUnit: "GRAM" },
  { value: "DIAMOND", label: "Diamond", defaultUnit: "PIECE" },
  { value: "GEMSTONE", label: "Gemstone", defaultUnit: "CARAT" },
  { value: "OTHER", label: "Other", defaultUnit: "ITEM" },
];

const RATE_UNITS: { value: RateUnit; label: string }[] = [
  { value: "GRAM", label: "Rs./g" },
  { value: "PIECE", label: "Rs./piece" },
  { value: "CARAT", label: "Rs./carat" },
  { value: "ITEM", label: "Rs./item" },
];

const API_RATE_UNITS: Record<RateUnit, BillRateUnit> = {
  GRAM: "g",
  PIECE: "piece",
  CARAT: "carat",
  ITEM: "item",
};

const FRONTEND_RATE_UNITS: Record<BillRateUnit, RateUnit> = {
  g: "GRAM",
  piece: "PIECE",
  carat: "CARAT",
  item: "ITEM",
};

const PURITY_OPTIONS: Partial<Record<Material, { value: string; label: string }[]>> = {
  GOLD: [
    { value: "24.000", label: "24K" },
    { value: "22.000", label: "22K" },
    { value: "18.000", label: "18K" },
    { value: "14.000", label: "14K" },
    { value: "10.000", label: "10K" },
  ],
  SILVER: [
    { value: "999.000", label: "999" },
    { value: "958.000", label: "958" },
    { value: "925.000", label: "925" },
    { value: "900.000", label: "900" },
  ],
  PLATINUM: [
    { value: "999.000", label: "999" },
    { value: "950.000", label: "950" },
    { value: "900.000", label: "900" },
  ],
};

const moneyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function numericValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function exceedsPrecision(value: string, places: number) {
  const fraction = value.split(".")[1] ?? "";
  return fraction.length > places;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: number) {
  return `Rs. ${moneyFormatter.format(value)}`;
}

function createEmptyItem(key: number): BillItemDraft {
  return {
    key,
    item_name: "",
    quantity: "1.000",
    material: "GOLD",
    rate_unit: "GRAM",
    gross_weight: "",
    stone_weight: "0.000",
    purity: "22.000",
    purity_custom: "",
    rate: "",
    making_charge: "0.00",
    discount: "0.00",
  };
}

function calculateNetWeight(item: BillItemDraft) {
  return numericValue(item.gross_weight) - numericValue(item.stone_weight);
}

function usesWeight(item: BillItemDraft) {
  return item.rate_unit === "GRAM" || item.rate_unit === "CARAT";
}

function hasApplicablePurity(material: string) {
  return material === "GOLD" || material === "SILVER" || material === "PLATINUM";
}

function calculateRateValue(item: BillItemDraft) {
  const basisQuantity = item.rate_unit === "GRAM"
    ? calculateNetWeight(item)
    : item.rate_unit === "CARAT"
      ? calculateNetWeight(item) * 5
      : numericValue(item.quantity);
  return roundMoney(basisQuantity * numericValue(item.rate));
}

function getRateUnitLabel(item: BillItemDraft) {
  return RATE_UNITS.find((unit) => unit.value === item.rate_unit)?.label ?? "Rs./unit";
}

function getRateValueFormula(item: BillItemDraft) {
  if (item.rate_unit === "GRAM") return "Net weight × rate";
  if (item.rate_unit === "CARAT") return "Net weight × 5 carats/g × rate";
  return "Quantity × rate";
}

function calculateItemTotal(item: BillItemDraft) {
  return roundMoney(
    calculateRateValue(item)
      + numericValue(item.making_charge)
      - numericValue(item.discount)
  );
}

function validateItem(item: BillItemDraft): ItemErrors {
  const errors: ItemErrors = {};
  const quantity = Number(item.quantity);
  const grossWeight = Number(item.gross_weight);
  const stoneWeight = Number(item.stone_weight);
  const rate = Number(item.rate);
  const makingCharge = Number(item.making_charge);
  const discount = Number(item.discount);
  const purityRequired = hasApplicablePurity(item.material);
  const purityValue = item.purity === "CUSTOM" ? item.purity_custom : item.purity;
  const purity = Number(purityValue);

  if (!item.item_name.trim()) errors.item_name = "Enter an item name.";
  if (!item.quantity || !Number.isFinite(quantity) || quantity <= 0) {
    errors.quantity = "Quantity must be greater than zero.";
  } else if (exceedsPrecision(item.quantity, 3)) {
    errors.quantity = "Use at most 3 decimal places.";
  }
  if (item.gross_weight.trim() && (!Number.isFinite(grossWeight) || grossWeight < 0)) {
    errors.gross_weight = "Gross weight cannot be negative.";
  } else if (item.gross_weight.trim() && exceedsPrecision(item.gross_weight, 3)) {
    errors.gross_weight = "Use at most 3 decimal places.";
  }
  if (!Number.isFinite(stoneWeight) || stoneWeight < 0) {
    errors.stone_weight = "Stone weight cannot be negative.";
  } else if (Number.isFinite(grossWeight) && stoneWeight > grossWeight) {
    errors.stone_weight = "Stone weight cannot exceed gross weight.";
  } else if (exceedsPrecision(item.stone_weight, 3)) {
    errors.stone_weight = "Use at most 3 decimal places.";
  }
  if (usesWeight(item) && (!item.gross_weight.trim() || grossWeight <= 0)) {
    errors.gross_weight = "Enter a gross weight for weight-based pricing.";
  }
  if (purityRequired && (!purityValue.trim() || !Number.isFinite(purity) || purity <= 0)) {
    errors.purity = "Select or enter a purity greater than zero.";
  } else if (purityRequired && exceedsPrecision(purityValue, 3)) {
    errors.purity = "Use at most 3 decimal places.";
  }
  if (!item.rate.trim() || !Number.isFinite(rate) || rate < 0) {
    errors.rate = "Enter a non-negative rate.";
  } else if (exceedsPrecision(item.rate, 2)) {
    errors.rate = "Use at most 2 decimal places.";
  }
  if (!Number.isFinite(makingCharge) || makingCharge < 0) {
    errors.making_charge = "Making charge cannot be negative.";
  } else if (exceedsPrecision(item.making_charge, 2)) {
    errors.making_charge = "Use at most 2 decimal places.";
  }
  if (!Number.isFinite(discount) || discount < 0) {
    errors.discount = "Discount cannot be negative.";
  } else if (exceedsPrecision(item.discount, 2)) {
    errors.discount = "Use at most 2 decimal places.";
  }

  if (
    !errors.quantity && !errors.gross_weight && !errors.stone_weight
    && !errors.rate && !errors.making_charge && !errors.discount
  ) {
    const basisQuantity = item.rate_unit === "GRAM"
      ? grossWeight - stoneWeight
      : item.rate_unit === "CARAT"
        ? (grossWeight - stoneWeight) * 5
        : quantity;
    const beforeDiscount = basisQuantity * rate + makingCharge;
    if (discount > beforeDiscount) errors.discount = "Discount cannot exceed the item value.";
  }

  return errors;
}

export default function NewBillPage() {
  return (
    <Suspense fallback={<BusinessAppShell><p className="detail-loading">Loading bill form...</p></BusinessAppShell>}>
      <NewBillFormContents />
    </Suspense>
  );
}

function NewBillFormContents() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sourceParam = searchParams.get("business_source");
  const sourceId = sourceParam && /^\d+$/.test(sourceParam) ? Number(sourceParam) : undefined;
  const editParam = searchParams.get("edit");
  const editing = editParam !== null;
  const billId = editParam === null ? undefined : /^\d+$/.test(editParam) ? Number(editParam) : -1;
  const submitLock = useRef(false);
  const nextItemKey = useRef(2);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [billLoading, setBillLoading] = useState(billId !== undefined);
  const [savedBill, setSavedBill] = useState<Bill | null>(null);
  const [customerError, setCustomerError] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [billDate, setBillDate] = useState("");
  const [items, setItems] = useState<BillItemDraft[]>([createEmptyItem(1)]);
  const [billDiscount, setBillDiscount] = useState("0.00");
  const [vat, setVat] = useState("0.00");
  const [amountPaid, setAmountPaid] = useState("0.00");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [itemErrors, setItemErrors] = useState<Record<number, ItemErrors>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let current = true;
    fetchCustomers("", sourceId)
      .then((data) => {
        if (current) {
          setCustomers(data);
          if (sourceId !== undefined && data.length === 1) {
            setCustomerId(String(data[0].id));
          }
          setCustomerError("");
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setCustomerError(userFacingError(requestError, "Could not load customers. Please try again."));
        }
      })
      .finally(() => {
        if (current) setCustomersLoading(false);
      });
    return () => { current = false; };
  }, [sourceId]);

  useEffect(() => {
    if (billId === undefined) return;
    let current = true;
    fetchBill(billId)
      .then((bill) => {
        if (!current) return;
        setSavedBill(bill);
        setBillNumber(bill.bill_number);
        setCustomerId(String(bill.customer));
        setBillDate(bill.bill_date);
        setBillDiscount(bill.discount);
        setVat(bill.vat);
        setAmountPaid(bill.amount_paid);
        setPaymentMethod(bill.payment_method);
        setItems(bill.items.map((item, index) => {
          const material = item.material as Material;
          const knownPurities = PURITY_OPTIONS[material] ?? [];
          const knownPurity = knownPurities.some((option) => option.value === item.purity);
          const purity = Number(item.purity) > 0 ? (knownPurity ? item.purity : "CUSTOM") : "";
          return {
            key: index + 1,
            item_name: item.item_name,
            quantity: item.quantity,
            material,
            rate_unit: FRONTEND_RATE_UNITS[item.rate_unit],
            gross_weight: item.gross_weight,
            stone_weight: item.stone_weight,
            purity,
            purity_custom: purity === "CUSTOM" ? item.purity : "",
            rate: item.rate,
            making_charge: item.making_charge,
            discount: item.discount,
          };
        }));
        nextItemKey.current = bill.items.length + 1;
      })
      .catch((requestError: unknown) => {
        if (current) {
          setFormError(userFacingError(requestError, "Could not load this bill."));
        }
      })
      .finally(() => {
        if (current) setBillLoading(false);
      });
    return () => { current = false; };
  }, [billId]);

  const selectedCustomer = customers.find((customer) => String(customer.id) === customerId);
  const subtotal = roundMoney(items.reduce((sum, item) => sum + calculateItemTotal(item), 0));
  const discountAmount = numericValue(billDiscount);
  const vatAmount = numericValue(vat);
  const paidAmount = numericValue(amountPaid);
  const grandTotal = roundMoney(subtotal - discountAmount + vatAmount);
  const amountDue = roundMoney(grandTotal - paidAmount);
  const paymentStatus = grandTotal > 0 && amountDue === 0
    ? "PAID"
    : paidAmount > 0 ? "PARTIAL" : "UNPAID";

  function updateItem(key: number, field: ItemField, value: string) {
    setItems((current) => current.map((item) => (
      item.key === key ? { ...item, [field]: value } : item
    )));
    setItemErrors((current) => ({
      ...current,
      [key]: { ...current[key], [field]: "" },
    }));
  }

  function updateMaterial(key: number, value: string) {
    const material = value as Material;
    const materialConfig = MATERIALS.find((option) => option.value === material);
    const defaultPurity = material === "GOLD"
      ? "22.000"
      : material === "SILVER"
        ? "925.000"
        : material === "PLATINUM"
          ? "950.000"
          : "";

    setItems((current) => current.map((item) => item.key === key
      ? {
          ...item,
          material,
          rate_unit: materialConfig?.defaultUnit ?? "ITEM",
          purity: defaultPurity,
          purity_custom: "",
        }
      : item));
    setItemErrors((current) => ({ ...current, [key]: {} }));
  }

  function clearFieldError(field: string) {
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }

  function validateForm() {
    const nextFieldErrors: Record<string, string> = {};
    const nextItemErrors: Record<number, ItemErrors> = {};

    if (!billNumber.trim()) nextFieldErrors.bill_number = "Bill number is required.";
    if (!customerId) nextFieldErrors.customer = "Select a customer.";
    if (!billDate) nextFieldErrors.bill_date = "Bill date is required.";

    items.forEach((item) => {
      const errors = validateItem(item);
      if (Object.keys(errors).length > 0) nextItemErrors[item.key] = errors;
    });

    const discountIsValid = Number.isFinite(discountAmount) && discountAmount >= 0 && !exceedsPrecision(billDiscount, 2);
    const vatIsValid = Number.isFinite(vatAmount) && vatAmount >= 0 && !exceedsPrecision(vat, 2);
    const paidIsValid = Number.isFinite(paidAmount) && paidAmount >= 0 && !exceedsPrecision(amountPaid, 2);
    if (!discountIsValid) nextFieldErrors.discount = "Enter a non-negative amount with at most 2 decimal places.";
    else if (discountAmount > subtotal) nextFieldErrors.discount = "Bill discount cannot exceed subtotal.";
    if (!vatIsValid) nextFieldErrors.vat = "Enter a non-negative amount with at most 2 decimal places.";
    if (!paidIsValid) nextFieldErrors.amount_paid = "Enter a non-negative amount with at most 2 decimal places.";
    else if (paidAmount > grandTotal) nextFieldErrors.amount_paid = "Amount paid cannot exceed grand total.";

    setFieldErrors(nextFieldErrors);
    setItemErrors(nextItemErrors);
    return Object.keys(nextFieldErrors).length === 0 && Object.keys(nextItemErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || submitting) return;
    setFormError("");
    if (!validateForm()) {
      setFormError("Review the highlighted fields and correct them before submitting.");
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    try {
      const payload: NewBill = {
        bill_number: billNumber.trim(),
        customer: Number(customerId),
        bill_date: billDate,
        items: items.map((item) => ({
          item_name: item.item_name.trim(),
          material: item.material as Material,
          rate_unit: API_RATE_UNITS[item.rate_unit as RateUnit],
          quantity: item.quantity,
          gross_weight: item.gross_weight || "0.000",
          stone_weight: item.stone_weight || "0.000",
          purity: hasApplicablePurity(item.material)
            ? item.purity === "CUSTOM" ? item.purity_custom : item.purity
            : "0.000",
          rate: item.rate,
          making_charge: item.making_charge || "0.00",
          discount: item.discount || "0.00",
        })),
        discount: billDiscount || "0.00",
        vat: vat || "0.00",
        amount_paid: amountPaid || "0.00",
        payment_method: paymentMethod.trim(),
      };
      const saved = editing && billId !== undefined
        ? await updateBill(billId, payload)
        : await createBill(payload);
      router.push(`/bills/${saved.id}`);
    } catch (requestError) {
      setFormError(userFacingError(
        requestError,
        editing ? "Could not update the bill. Please review the fields and try again." : "Could not create the bill. Please review the fields and try again."
      ));
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  function addItem() {
    const key = nextItemKey.current++;
    setItems((current) => [...current, createEmptyItem(key)]);
  }

  function removeItem(key: number) {
    setItems((current) => current.length > 1 ? current.filter((item) => item.key !== key) : current);
    setItemErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  return (
    <BusinessAppShell>
      <Link href={editing ? `/bills/${billId}` : "/bills"} className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> {editing ? "Bill Detail" : "Bills"}
      </Link>
      <section className="page-heading bill-create-heading">
        <div>
          <p className="eyebrow">SALES &amp; BILLING</p>
          <h1>{editing ? `Edit ${savedBill?.bill_number ?? "Bill"}` : "Create Bill"}</h1>
          <p className="page-description">{editing ? "Update the saved bill. Totals are recalculated by the server." : "Record a customer sale and its payment details."}</p>
        </div>
      </section>

      {billLoading ? (
        <p className="detail-loading">Loading bill for editing...</p>
      ) : editing && !savedBill ? (
        <>
          <p className="notice notice-error" role="alert">{formError || "Could not load this bill for editing."}</p>
          <Link className="button button-secondary" href="/bills">Back to Bills</Link>
        </>
      ) : editing && savedBill?.status === "CANCELLED" ? (
        <p className="notice notice-info" role="status">Cancelled Bills are retained as financial history and cannot be edited.</p>
      ) : (
      <form className="bill-create-form" noValidate onSubmit={handleSubmit}>
        {formError && <p className="notice notice-error" role="alert">{formError}</p>}

        <div className="bill-form-columns">
          <div className="bill-form-main">
            <section className="bill-form-section" aria-labelledby="bill-information-heading">
              <div className="bill-section-heading">
                <div>
                  <p className="eyebrow">SECTION 01</p>
                  <h2 id="bill-information-heading">Bill Information</h2>
                </div>
              </div>
              <div className="form-grid bill-info-grid">
                <label className="form-field">
                  <span>Bill Number <b>*</b></span>
                  <input
                    required
                    maxLength={64}
                    value={billNumber}
                    aria-invalid={Boolean(fieldErrors.bill_number)}
                    aria-describedby={fieldErrors.bill_number ? "bill-number-error" : undefined}
                    onChange={(event) => {
                      setBillNumber(event.target.value);
                      clearFieldError("bill_number");
                    }}
                  />
                  {fieldErrors.bill_number && <span className="bill-field-error" id="bill-number-error">{fieldErrors.bill_number}</span>}
                </label>
                <label className="form-field">
                  <span>Bill Date <b>*</b></span>
                  <input
                    required
                    type="date"
                    value={billDate}
                    aria-invalid={Boolean(fieldErrors.bill_date)}
                    aria-describedby={fieldErrors.bill_date ? "bill-date-error" : undefined}
                    onChange={(event) => {
                      setBillDate(event.target.value);
                      clearFieldError("bill_date");
                    }}
                  />
                  {fieldErrors.bill_date && <span className="bill-field-error" id="bill-date-error">{fieldErrors.bill_date}</span>}
                </label>
                <label className="form-field">
                  <span>Customer <b>*</b></span>
                  <select
                    required
                    value={customerId}
                    aria-invalid={Boolean(fieldErrors.customer)}
                    aria-describedby={customerError ? "customer-load-error" : fieldErrors.customer ? "customer-error" : undefined}
                    onChange={(event) => {
                      setCustomerId(event.target.value);
                      clearFieldError("customer");
                    }}
                    disabled={customersLoading || Boolean(customerError) || (sourceId !== undefined && customers.length === 1)}
                  >
                    <option value="">{customersLoading ? "Loading customers..." : "Select a customer"}</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}{customer.phone ? ` · ${customer.phone}` : ""}
                      </option>
                    ))}
                  </select>
                  {sourceId !== undefined && customers.length === 1 && (
                    <span className="bill-field-hint">Customer selected from this Business Source.</span>
                  )}
                  {customerError && <span className="bill-field-error" id="customer-load-error">{customerError}</span>}
                  {!customerError && fieldErrors.customer && <span className="bill-field-error" id="customer-error">{fieldErrors.customer}</span>}
                </label>
                <div className="form-field">
                  <span>Business Source</span>
                  <div className="bill-source-value" aria-live="polite">
                    {selectedCustomer?.source_name || customers[0]?.source_name || "Set by the selected customer"}
                  </div>
                </div>
              </div>
            </section>

            <section className="bill-form-section" aria-labelledby="bill-items-heading">
              <div className="bill-section-heading bill-items-heading">
                <div>
                  <p className="eyebrow">SECTION 02</p>
                  <h2 id="bill-items-heading">Bill Items</h2>
                </div>
                <span className="record-count">{items.length}</span>
              </div>
              <div className="bill-item-list">
                {items.map((item, index) => {
                  const errors = itemErrors[item.key] ?? {};
                  const netWeight = calculateNetWeight(item);
                  const itemTotal = calculateItemTotal(item);
                  return (
                    <fieldset className="bill-item-editor" key={item.key}>
                      <legend className="sr-only">Bill item {index + 1}</legend>
                      <div className="bill-item-header">
                        <h3>
                          Item {String(index + 1).padStart(2, "0")}
                          {item.item_name.trim() ? ` — ${item.item_name.trim()}` : " — New item"}
                        </h3>
                        <button
                          className="bill-remove-item"
                          type="button"
                          onClick={() => removeItem(item.key)}
                          disabled={items.length === 1}
                          aria-label={`Remove item ${index + 1}`}
                          title={items.length === 1 ? "A bill needs at least one item" : "Remove item"}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          Remove
                        </button>
                      </div>
                      <div className="bill-item-grid">
                        <label className="form-field bill-item-name-field">
                          <span>Item Name <b>*</b></span>
                          <input
                            required
                            maxLength={255}
                            value={item.item_name}
                            aria-invalid={Boolean(errors.item_name)}
                            onChange={(event) => updateItem(item.key, "item_name", event.target.value)}
                          />
                          {errors.item_name && <span className="bill-field-error">{errors.item_name}</span>}
                        </label>
                        <label className="form-field">
                          <span>Quantity <b>*</b></span>
                          <input
                            required
                            type="number"
                            min="0.001"
                            step="0.001"
                            inputMode="decimal"
                            value={item.quantity}
                            aria-invalid={Boolean(errors.quantity)}
                            onChange={(event) => updateItem(item.key, "quantity", event.target.value)}
                          />
                          {errors.quantity && <span className="bill-field-error">{errors.quantity}</span>}
                        </label>
                        <label className="form-field">
                          <span>Material <b>*</b></span>
                          <select
                            required
                            value={item.material}
                            onChange={(event) => updateMaterial(item.key, event.target.value)}
                          >
                            {MATERIALS.map((material) => (
                              <option key={material.value} value={material.value}>{material.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="form-field">
                          <span className="bill-field-label">
                            Gross Weight {usesWeight(item) && <b>*</b>}<small>g</small>
                          </span>
                          <input
                            required={usesWeight(item)}
                            type="number"
                            min="0"
                            step="0.001"
                            inputMode="decimal"
                            placeholder="0.000"
                            value={item.gross_weight}
                            aria-invalid={Boolean(errors.gross_weight)}
                            onChange={(event) => updateItem(item.key, "gross_weight", event.target.value)}
                          />
                          {errors.gross_weight && <span className="bill-field-error">{errors.gross_weight}</span>}
                        </label>
                        <label className="form-field">
                          <span className="bill-field-label">Stone Weight<small>g</small></span>
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            inputMode="decimal"
                            placeholder="0.000"
                            value={item.stone_weight}
                            aria-invalid={Boolean(errors.stone_weight)}
                            onChange={(event) => updateItem(item.key, "stone_weight", event.target.value)}
                          />
                          {errors.stone_weight && <span className="bill-field-error">{errors.stone_weight}</span>}
                        </label>
                        <div className="form-field">
                          <span className="bill-field-label">Net Weight<small>g · calculated</small></span>
                          <output className="bill-calculated-value">{netWeight.toFixed(3)} g</output>
                        </div>
                        {hasApplicablePurity(item.material) ? (
                          <label className="form-field">
                            <span className="bill-field-label">Purity <b>*</b><small>{item.material === "GOLD" ? "karat" : "fineness"}</small></span>
                            <select
                              required
                              value={item.purity}
                              aria-invalid={Boolean(errors.purity)}
                              onChange={(event) => {
                                updateItem(item.key, "purity", event.target.value);
                                if (event.target.value !== "CUSTOM") updateItem(item.key, "purity_custom", "");
                              }}
                            >
                              <option value="">Select purity</option>
                              {(PURITY_OPTIONS[item.material as Material] ?? []).map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                              <option value="CUSTOM">Other purity</option>
                            </select>
                            {errors.purity && <span className="bill-field-error">{errors.purity}</span>}
                          </label>
                        ) : (
                          <div className="form-field">
                            <span>Purity</span>
                            <output className="bill-calculated-value">Not applicable</output>
                          </div>
                        )}
                        {hasApplicablePurity(item.material) && item.purity === "CUSTOM" && (
                          <label className="form-field">
                            <span className="bill-field-label">Custom Purity <b>*</b><small>{item.material === "GOLD" ? "karat" : "fineness"}</small></span>
                            <input
                              required
                              type="number"
                              min="0.001"
                              step="0.001"
                              inputMode="decimal"
                              placeholder={item.material === "GOLD" ? "e.g. 20.000" : "e.g. 875.000"}
                              value={item.purity_custom}
                              aria-invalid={Boolean(errors.purity)}
                              onChange={(event) => updateItem(item.key, "purity_custom", event.target.value)}
                            />
                            {errors.purity && <span className="bill-field-error">{errors.purity}</span>}
                          </label>
                        )}
                        <div className="bill-rate-field">
                          <label className="form-field">
                            <span className="bill-field-label">Rate <b>*</b><small>{getRateUnitLabel(item)}</small></span>
                            <div className="bill-input-with-prefix">
                              <span>Rs.</span>
                              <input
                                required
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={item.rate}
                                aria-invalid={Boolean(errors.rate)}
                                onChange={(event) => updateItem(item.key, "rate", event.target.value)}
                              />
                            </div>
                            {errors.rate && <span className="bill-field-error">{errors.rate}</span>}
                          </label>
                          <label className="form-field">
                            <span>Rate Unit</span>
                            <select
                              value={item.rate_unit}
                              onChange={(event) => updateItem(item.key, "rate_unit", event.target.value)}
                            >
                              {RATE_UNITS.map((unit) => (
                                <option key={unit.value} value={unit.value}>{unit.label}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label className="form-field">
                          <span className="bill-field-label">Making Charge<small>manual Rs.</small></span>
                          <div className="bill-input-with-prefix">
                            <span>Rs.</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={item.making_charge}
                              aria-invalid={Boolean(errors.making_charge)}
                              onChange={(event) => updateItem(item.key, "making_charge", event.target.value)}
                            />
                          </div>
                          {errors.making_charge && <span className="bill-field-error">{errors.making_charge}</span>}
                        </label>
                        <label className="form-field">
                          <span className="bill-field-label">Item Discount<small>manual Rs.</small></span>
                          <div className="bill-input-with-prefix">
                            <span>Rs.</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={item.discount}
                              aria-invalid={Boolean(errors.discount)}
                              onChange={(event) => updateItem(item.key, "discount", event.target.value)}
                            />
                          </div>
                          {errors.discount && <span className="bill-field-error">{errors.discount}</span>}
                        </label>
                      </div>
                      <dl className="bill-item-calculation" aria-label={`Calculation for item ${index + 1}`}>
                        <div>
                          <dt>Rate Value <small>{getRateValueFormula(item)}</small></dt>
                          <dd>{formatMoney(calculateRateValue(item))}</dd>
                        </div>
                        <div>
                          <dt>Making Charge <small>Manual amount, added once</small></dt>
                          <dd>{formatMoney(numericValue(item.making_charge))}</dd>
                        </div>
                        <div>
                          <dt>Item Discount</dt>
                          <dd className="bill-item-discount">− {formatMoney(numericValue(item.discount))}</dd>
                        </div>
                        <div className="bill-item-calculation-total">
                          <dt>Item Total</dt>
                          <dd><output>{formatMoney(itemTotal)}</output></dd>
                        </div>
                      </dl>
                    </fieldset>
                  );
                })}
              </div>
              <button className="button button-secondary bill-add-item" type="button" onClick={addItem}>
                <Plus size={15} aria-hidden="true" /> Add Item
              </button>
            </section>

            <section className="bill-form-section" aria-labelledby="bill-payment-heading">
              <div className="bill-section-heading">
                <div>
                  <p className="eyebrow">SECTION 04</p>
                  <h2 id="bill-payment-heading">Payment</h2>
                </div>
              </div>
              <div className="form-grid bill-info-grid">
                <label className="form-field">
                  <span>Amount Paid</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={amountPaid}
                    aria-invalid={Boolean(fieldErrors.amount_paid)}
                    onChange={(event) => {
                      setAmountPaid(event.target.value);
                      clearFieldError("amount_paid");
                    }}
                  />
                  {fieldErrors.amount_paid && <span className="bill-field-error">{fieldErrors.amount_paid}</span>}
                </label>
                <label className="form-field">
                  <span>Payment Method</span>
                  <input
                    maxLength={40}
                    placeholder="e.g. Cash, card, bank transfer"
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                  />
                </label>
              </div>
            </section>
          </div>

          <aside className="bill-form-aside">
            <section className="bill-summary-panel" aria-labelledby="bill-summary-heading">
              <div className="bill-section-heading">
                <div>
                  <p className="eyebrow">SECTION 03</p>
                  <h2 id="bill-summary-heading">Bill Summary</h2>
                </div>
              </div>
              <dl className="bill-summary-list">
                <div><dt>Subtotal</dt><dd>{formatMoney(subtotal)}</dd></div>
                <div className="bill-summary-input-row">
                  <dt><label htmlFor="bill-discount">Bill Discount</label></dt>
                  <dd>
                    <input
                      id="bill-discount"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={billDiscount}
                      aria-invalid={Boolean(fieldErrors.discount)}
                      onChange={(event) => {
                        setBillDiscount(event.target.value);
                        clearFieldError("discount");
                      }}
                    />
                  </dd>
                </div>
                {fieldErrors.discount && <div className="bill-summary-error">{fieldErrors.discount}</div>}
                <div className="bill-summary-input-row">
                  <dt><label htmlFor="bill-vat">VAT</label></dt>
                  <dd>
                    <input
                      id="bill-vat"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={vat}
                      aria-invalid={Boolean(fieldErrors.vat)}
                      onChange={(event) => {
                        setVat(event.target.value);
                        clearFieldError("vat");
                      }}
                    />
                  </dd>
                </div>
                {fieldErrors.vat && <div className="bill-summary-error">{fieldErrors.vat}</div>}
                <div className="bill-summary-total"><dt>Grand Total</dt><dd>{formatMoney(grandTotal)}</dd></div>
                <div><dt>Amount Due</dt><dd>{formatMoney(amountDue)}</dd></div>
                <div className="bill-summary-status">
                  <dt>Payment Status</dt>
                  <dd><span className={`status-badge status-${paymentStatus.toLowerCase()}`}>{paymentStatus}</span></dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>

        <div className="bill-form-actions">
          <Link className="button button-secondary" href={editing ? `/bills/${billId}` : "/bills"}>Cancel</Link>
          <button className="button button-primary" type="submit" disabled={submitting || customersLoading || Boolean(customerError)}>
            {submitting ? (editing ? "Updating..." : "Creating..." ) : (editing ? "Save Changes" : "Create Bill")}
          </button>
        </div>
      </form>
      )}
    </BusinessAppShell>
  );
}