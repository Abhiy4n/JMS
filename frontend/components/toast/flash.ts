import type { ToastType } from "./ToastProvider";

const FLASH_KEY = "jms_flash_toast";

type FlashToast = { type: ToastType; message: string };

/** Queue a toast that survives a full page reload, such as `window.location.replace`. */
export function queueFlashToast(type: ToastType, message: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(FLASH_KEY, JSON.stringify({ type, message }));
}

export function takeFlashToast(): FlashToast | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(FLASH_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(FLASH_KEY);
  try {
    return JSON.parse(raw) as FlashToast;
  } catch {
    return null;
  }
}
