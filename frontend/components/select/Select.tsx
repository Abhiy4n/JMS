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
import { Check, ChevronDown, type LucideIcon } from "lucide-react";

import styles from "./Select.module.css";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Optional colour for the dot shown before the label. */
  tone?: string;
};

type SelectProps<T extends string> = {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  icon?: LucideIcon;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

type MenuPosition = { top: number; left: number; width: number; maxHeight: number; placement: "below" | "above" };

const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 300;
const VIEWPORT_PADDING = 12;

export default function Select<T extends string>({
  value,
  options,
  onChange,
  icon: Icon,
  id,
  className,
  disabled,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SelectProps<T>) {
  const generatedId = useId();
  const triggerId = id ?? `select-${generatedId}`;
  const listId = `${triggerId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: "", timer: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PADDING;
    const spaceAbove = rect.top - VIEWPORT_PADDING;
    const placement = spaceBelow < 180 && spaceAbove > spaceBelow ? "above" : "below";
    const available = (placement === "below" ? spaceBelow : spaceAbove) - MENU_GAP;
    const width = Math.max(rect.width, 190);
    const left = Math.min(Math.max(rect.left, VIEWPORT_PADDING), window.innerWidth - width - VIEWPORT_PADDING);
    setPosition({
      top: placement === "below" ? rect.bottom + MENU_GAP : rect.top - MENU_GAP,
      left,
      width,
      maxHeight: Math.max(Math.min(MENU_MAX_HEIGHT, available), 120),
      placement,
    });
  }, []);

  const openMenu = useCallback((index = selectedIndex) => {
    if (disabled) return;
    updatePosition();
    setActiveIndex(index < 0 ? 0 : index);
    setOpen(true);
  }, [disabled, selectedIndex, updatePosition]);

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    closeMenu();
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
      if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) closeMenu(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, closeMenu]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  useEffect(() => () => window.clearTimeout(typeahead.current.timer), []);

  function moveActive(step: number) {
    setActiveIndex((index) => (index + step + options.length) % options.length);
  }

  function handleTypeahead(key: string) {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.text += key.toLowerCase();
    state.timer = window.setTimeout(() => { state.text = ""; }, 500);
    const match = options.findIndex((option) => option.label.toLowerCase().startsWith(state.text));
    if (match < 0) return;
    if (open) setActiveIndex(match);
    else if (options[match].value !== value) onChange(options[match].value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (open) moveActive(1); else openMenu();
        break;
      case "ArrowUp":
        event.preventDefault();
        if (open) moveActive(-1); else openMenu();
        break;
      case "Home":
        if (open) { event.preventDefault(); setActiveIndex(0); }
        break;
      case "End":
        if (open) { event.preventDefault(); setActiveIndex(options.length - 1); }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) choose(activeIndex); else openMenu();
        break;
      case "Escape":
        if (open) { event.preventDefault(); event.stopPropagation(); closeMenu(); }
        break;
      case "Tab":
        if (open) closeMenu(false);
        break;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) handleTypeahead(event.key);
    }
  }

  const menuStyle: CSSProperties | undefined = position
    ? {
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
        transform: position.placement === "above" ? "translateY(-100%)" : undefined,
      }
    : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={`${styles.trigger} ${className ?? ""}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy ? `${ariaLabelledBy} ${triggerId}` : undefined}
        disabled={disabled}
        data-open={open}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
      >
        {Icon && <Icon className={styles.leadingIcon} aria-hidden="true" />}
        {selected?.tone && <i className={styles.dot} style={{ background: selected.tone }} aria-hidden="true" />}
        <span className={styles.value}>{selected?.label ?? ""}</span>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </button>

      {open && position && createPortal(
        <ul
          ref={listRef}
          id={listId}
          className={styles.menu}
          role="listbox"
          aria-labelledby={ariaLabelledBy}
          aria-label={ariaLabelledBy ? undefined : ariaLabel}
          data-placement={position.placement}
          style={menuStyle}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value || "__empty"}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                data-index={index}
                data-active={index === activeIndex}
                className={styles.option}
                onPointerMove={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                {option.tone && <i className={styles.dot} style={{ background: option.tone }} aria-hidden="true" />}
                <span>{option.label}</span>
                {isSelected && <Check className={styles.check} aria-hidden="true" />}
              </li>
            );
          })}
        </ul>,
        document.body
      )}
    </>
  );
}
