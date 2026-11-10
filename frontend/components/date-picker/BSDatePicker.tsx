"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { fetchPledgeCalendar, type PledgeCalendarMonth } from "@/lib/pledge-data";
import styles from "./BSDatePicker.module.css";

const MONTHS = [
  "Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  id: string;
  label: string;
  value: string;
  today: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  min?: string;
  max?: string;
};

function parseMonth(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1975 && year <= 2100 && month >= 1 && month <= 12
    ? { year, month }
    : null;
}

function formatDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function BSDatePicker({
  id,
  label,
  value,
  today,
  onChange,
  disabled = false,
  required = false,
  error,
  min,
  max,
}: Props) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parseMonth(value) ?? parseMonth(today) ?? { year: 2083, month: 1 });
  const [calendar, setCalendar] = useState<PledgeCalendarMonth | null>(null);
  const [failedMonth, setFailedMonth] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number; placement: "above" | "below" | "pinned" } | null>(null);

  function openCalendar() {
    if (disabled) return;
    setMonth(parseMonth(value) ?? parseMonth(today) ?? { year: 2083, month: 1 });
    setFailedMonth("");
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const placement = spaceBelow >= 340
        ? "below"
        : spaceAbove >= 340
          ? "above"
          : "pinned";
      setPosition({
        top: placement === "above" ? rect.top - 6 : placement === "below" ? rect.bottom + 6 : 12,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 316)),
        placement,
      });
    }
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  function moveMonth(amount: number) {
    const nextMonth = month.month + amount;
    const next = nextMonth < 1
      ? { year: month.year - 1, month: 12 }
      : nextMonth > 12
        ? { year: month.year + 1, month: 1 }
        : { year: month.year, month: nextMonth };
    if (next.year >= 1975 && next.year <= 2100) {
      setFailedMonth("");
      setMonth(next);
    }
  }

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetchPledgeCalendar(month.year, month.month)
      .then((result) => {
        if (active) setCalendar(result);
      })
      .catch(() => {
        if (active) setFailedMonth(`${month.year}-${month.month}`);
      });
    return () => { active = false; };
  }, [month, open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !popoverRef.current?.contains(target)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selected = parseMonth(value);
  const todayMonth = parseMonth(today);
  const maxMonth = parseMonth(max ?? "2100-12-31") ?? { year: 2100, month: 12 };
  const minMonth = parseMonth(min ?? "1975-01-01") ?? { year: 1975, month: 1 };
  const canGoNext = month.year < maxMonth.year || (month.year === maxMonth.year && month.month < maxMonth.month);
  const canGoPrevious = month.year > minMonth.year || (month.year === minMonth.year && month.month > minMonth.month);
  const monthKey = `${month.year}-${month.month}`;
  const currentCalendar = calendar && calendar.year === month.year && calendar.month === month.month
    ? calendar
    : null;
  const loading = open && !currentCalendar && failedMonth !== monthKey;
  const loadError = failedMonth === monthKey;
  const days = currentCalendar?.days ?? [];
  const cells = currentCalendar ? [
    ...Array.from({ length: currentCalendar.first_weekday }, (_, index) => ({ key: `blank-${index}`, day: null })),
    ...days.map((day) => ({ key: String(day), day })),
  ] : [];
  const todayAvailable = Boolean(
    today
    && (!max || today <= max)
    && (!min || today >= min),
  );

  return (
    <div className={styles.root} ref={anchorRef}>
      <div className={styles.control}>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="YYYY-MM-DD"
          value={value}
          disabled={disabled}
          required={required}
          aria-label={label}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={openCalendar}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className={styles.trigger}
          aria-label={`Open ${label} calendar`}
          aria-expanded={open}
          disabled={disabled}
          onClick={openCalendar}
        ><CalendarDays size={16} aria-hidden="true" /></button>
      </div>
      {error && <span id={`${id}-error`} className={styles.error} data-field-error>{error}</span>}
      {open && position && createPortal(
        <div
          ref={popoverRef}
          className={styles.popover}
          role="dialog"
          aria-label={`${label} Bikram Sambat calendar`}
          style={{
            top: position.top,
            left: position.left,
            transform: position.placement === "above" ? "translateY(-100%)" : undefined,
          }}
        >
          <div className={styles.header}>
            <button type="button" aria-label="Previous month" disabled={!canGoPrevious} onClick={() => moveMonth(-1)}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <strong>{MONTHS[month.month - 1]} {month.year}</strong>
            <button type="button" aria-label="Next month" disabled={!canGoNext} onClick={() => moveMonth(1)}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div className={styles.weekdays} aria-hidden="true">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className={styles.grid} role="grid" aria-busy={loading}>
            {cells.map(({ key, day }) => {
              if (day === null) return <span className={styles.emptyDay} key={key} />;
              const date = formatDate(month.year, month.month, day);
              const isSelected = selected?.year === month.year && selected.month === month.month && Number(value.slice(8, 10)) === day;
              const isToday = todayMonth?.year === month.year && todayMonth.month === month.month && Number(today.slice(8, 10)) === day;
              return (
                <button
                  type="button"
                  role="gridcell"
                  key={key}
                  aria-label={`${MONTHS[month.month - 1]} ${day}, ${month.year}`}
                  aria-selected={isSelected}
                  data-today={isToday}
                  disabled={loading || Boolean(
                    (max && date > max)
                    || (min && date < min),
                  )}
                  onClick={() => { onChange(date); close(); }}
                >{day}</button>
              );
            })}
          </div>
          {loadError && <p className={styles.loadError} role="alert">Could not load the BS calendar. Please try again.</p>}
          <div className={styles.footer}>
            <button type="button" disabled={!todayAvailable} onClick={() => { onChange(today); close(); }}>Today</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
