"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import styles from "./DatePicker.module.css";

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

type PopoverPosition = { top: number; left: number; placement: "above" | "below" };

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const POPOVER_WIDTH = 300;
const VIEWPORT_PADDING = 12;
const POPOVER_GAP = 6;

function parseDate(value?: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function makeCalendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstVisible = new Date(first);
  firstVisible.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstVisible);
    date.setDate(firstVisible.getDate() + index);
    return date;
  });
}

export default function DatePicker({
  value,
  onChange,
  id,
  className,
  min,
  max,
  disabled,
  required,
  placeholder = "mm/dd/yyyy",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: DatePickerProps) {
  const generatedId = useId();
  const triggerId = id ?? `date-picker-${generatedId}`;
  const dialogId = `${triggerId}-dialog`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const selectedDate = parseDate(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDate ?? today);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PADDING;
    const placement = spaceBelow < 360 && rect.top > spaceBelow ? "above" : "below";
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_PADDING),
      window.innerWidth - POPOVER_WIDTH - VIEWPORT_PADDING,
    );
    setPosition({
      top: placement === "below" ? rect.bottom + POPOVER_GAP : rect.top - POPOVER_GAP,
      left,
      placement,
    });
  }, []);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  function openCalendar() {
    if (disabled) return;
    setVisibleMonth(selectedDate ?? today);
    updatePosition();
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !dialogRef.current?.contains(target)) close(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [close, open]);

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openCalendar();
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  }

  function choose(date: Date) {
    onChange(formatValue(date));
    close();
  }

  const minDate = parseDate(min);
  const maxDate = parseDate(max);
  const calendarDays = makeCalendarDays(visibleMonth);
  const displayValue = selectedDate?.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const popoverStyle: CSSProperties | undefined = position ? {
    top: position.top,
    left: position.left,
    transform: position.placement === "above" ? "translateY(-100%)" : undefined,
  } : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        className={`${styles.trigger} ${className ?? ""}`}
        type="button"
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy ? `${ariaLabelledBy} ${triggerId}` : undefined}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        disabled={disabled}
        data-open={open}
        onClick={() => (open ? close() : openCalendar())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={displayValue ? styles.value : styles.placeholder}>{displayValue ?? placeholder}</span>
        <CalendarDays className={styles.icon} aria-hidden="true" />
      </button>

      {open && position && createPortal(
        <div
          ref={dialogRef}
          id={dialogId}
          className={styles.popover}
          role="dialog"
          aria-modal="false"
          aria-label={ariaLabel ? `${ariaLabel} calendar` : "Choose date"}
          data-placement={position.placement}
          style={popoverStyle}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          <div className={styles.header}>
            <button type="button" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
              <ChevronLeft aria-hidden="true" />
            </button>
            <strong>{visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
            <button type="button" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div className={styles.weekdays} aria-hidden="true">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className={styles.grid} role="grid">
            {calendarDays.map((date) => {
              const dateValue = formatValue(date);
              const unavailable = Boolean((minDate && date < minDate) || (maxDate && date > maxDate));
              return (
                <button
                  key={dateValue}
                  type="button"
                  role="gridcell"
                  aria-label={date.toLocaleDateString(undefined, { dateStyle: "full" })}
                  aria-selected={selectedDate ? isSameDay(date, selectedDate) : false}
                  disabled={unavailable}
                  data-outside={date.getMonth() !== visibleMonth.getMonth()}
                  data-today={isSameDay(date, today)}
                  onClick={() => choose(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className={styles.footer}>
            {!required && <button type="button" onClick={() => { onChange(""); close(); }}>Clear</button>}
            <button type="button" onClick={() => {
              if ((!minDate || today >= minDate) && (!maxDate || today <= maxDate)) choose(today);
              else setVisibleMonth(today);
            }}>Today</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
