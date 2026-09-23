import type { AuthTokens, AuthUser } from "./api";

const ACCESS_KEY = "jms_access";
const REFRESH_KEY = "jms_refresh";
const USER_KEY = "jms_user";
const REMEMBER_KEY = "jms_remember";
export const AUTH_COOKIE = "jms_authenticated";

function canUseDom() {
  return typeof window !== "undefined";
}

function storage(remember: boolean): Storage {
  return remember ? window.localStorage : window.sessionStorage;
}

function clearBothStorages() {
  for (const store of [window.localStorage, window.sessionStorage]) {
    store.removeItem(ACCESS_KEY);
    store.removeItem(REFRESH_KEY);
    store.removeItem(USER_KEY);
    store.removeItem(REMEMBER_KEY);
  }
}

function setAuthCookie(remember: boolean) {
  const maxAge = remember ? 60 * 60 * 24 * 30 : undefined;
  const parts = [`${AUTH_COOKIE}=1`, "Path=/", "SameSite=Lax"];
  if (maxAge !== undefined) {
    parts.push(`Max-Age=${maxAge}`);
  }
  document.cookie = parts.join("; ");
}

function clearAuthCookie() {
  document.cookie = `${AUTH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function saveSession(
  tokens: AuthTokens,
  user: AuthUser,
  remember: boolean
) {
  if (!canUseDom()) return;

  clearBothStorages();
  const store = storage(remember);
  store.setItem(ACCESS_KEY, tokens.access);
  store.setItem(REFRESH_KEY, tokens.refresh);
  store.setItem(USER_KEY, JSON.stringify(user));
  store.setItem(REMEMBER_KEY, remember ? "1" : "0");
  setAuthCookie(remember);
}

export function clearSession() {
  if (!canUseDom()) return;
  clearBothStorages();
  clearAuthCookie();
}

function readStore(): Storage | null {
  if (!canUseDom()) return null;
  if (window.localStorage.getItem(ACCESS_KEY)) return window.localStorage;
  if (window.sessionStorage.getItem(ACCESS_KEY)) return window.sessionStorage;
  return null;
}

export function getAccessToken(): string | null {
  return readStore()?.getItem(ACCESS_KEY) ?? null;
}

export function getRefreshToken(): string | null {
  return readStore()?.getItem(REFRESH_KEY) ?? null;
}

export function getStoredUser(): AuthUser | null {
  const raw = readStore()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function isRemembered(): boolean {
  return readStore()?.getItem(REMEMBER_KEY) === "1";
}

export function updateAccessToken(access: string) {
  const store = readStore();
  if (!store) return;
  store.setItem(ACCESS_KEY, access);
}
