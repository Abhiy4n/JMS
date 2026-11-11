import {
  clearSession,
  getRefreshToken,
  SESSION_EXPIRED_EVENT,
  updateAccessToken,
} from "./storage";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  company_name: string;
  profile_picture?: string;
  role: string;
  is_staff: boolean;
};

export type AuthTokens = { access: string; refresh: string };
export type AuthResponse = AuthTokens & { user: AuthUser };

export type LoginActivitySession = {
  id: string;
  device_name: string;
  device_type: string;
  browser: string;
  operating_system: string;
  ip_address: string | null;
  location: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  status: "active" | "expired" | "revoked";
  current: boolean;
};

export type LoginActivityEvent = {
  id: number;
  session_id: string | null;
  is_new_device: boolean;
  device_name: string;
  device_type: string;
  browser: string;
  operating_system: string;
  ip_address: string | null;
  location: string;
  occurred_at: string;
};

export type LoginActivity = {
  sessions: LoginActivitySession[];
  login_events: LoginActivityEvent[];
};

export type ApiErrorKind =
  | "timeout"
  | "cancelled"
  | "network"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "validation"
  | "server"
  | "invalid_response";

export class ApiError extends Error {
  status: number;
  details: unknown;
  kind: ApiErrorKind;
  requestId: string;
  durationMs: number;
  retryAfterMs: number | null;

  constructor(options: {
    message: string;
    kind: ApiErrorKind;
    status?: number;
    details?: unknown;
    requestId: string;
    durationMs: number;
    retryAfterMs?: number | null;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.kind = options.kind;
    this.status = options.status ?? 0;
    this.details = options.details;
    this.requestId = options.requestId;
    this.durationMs = options.durationMs;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export type ApiTimingDetail = {
  requestId: string;
  serverRequestId: string | null;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  attempt: number;
};

export const API_TIMING_EVENT = "jms-api-timing";

type ApiRequestConfig<T> = {
  timeoutMs?: number;
  retries?: number;
  validate?: (value: unknown) => value is T;
};

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
const loopbackApiUrl = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i;
const API_URL = process.env.NODE_ENV === "production" && loopbackApiUrl.test(configuredApiUrl)
  ? ""
  : configuredApiUrl || (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000");
const parsedTimeout = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || "15000");
export const DEFAULT_API_TIMEOUT_MS = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 15000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

let refreshInFlight: Promise<string> | null = null;
let expirationAnnounced = false;

function clock() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function makeRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `jms-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDrfError(data: unknown, prefix = ""): string {
  if (typeof data === "string") {
    if (/<!doctype html|<html[\s>]/i.test(data)) return "";
    return prefix ? `${prefix}: ${data}` : data;
  }
  if (Array.isArray(data)) return data.map((item) => formatDrfError(item, prefix)).filter(Boolean).join(" ");
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail;
  return Object.entries(record)
    .map(([key, value]) => formatDrfError(value, key === "non_field_errors" ? prefix : [prefix, key].filter(Boolean).join(".")))
    .filter(Boolean)
    .join(" ");
}

function getRetryAfterMs(response: Response) {
  const value = response.headers.get("Retry-After");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function emitTiming(detail: ApiTimingDetail) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ApiTimingDetail>(API_TIMING_EVENT, { detail }));
  }
}

function wait(milliseconds: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Request cancelled.", "AbortError"));
      return;
    }
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const cancel = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Request cancelled.", "AbortError"));
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

async function parseBody(response: Response, id: string, durationMs: number) {
  if (response.status === 204 || response.status === 205) return null;
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) return text;
    throw new ApiError({
      message: "The server returned an unexpected response.",
      kind: "invalid_response",
      status: response.status,
      details: text,
      requestId: id,
      durationMs,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError({
      message: "The server returned invalid JSON.",
      kind: "invalid_response",
      status: response.status,
      details: text,
      requestId: id,
      durationMs,
    });
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "validation";
}

function fallbackMessage(status: number) {
  if (status === 401) return "Your session is no longer valid.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 429) return "Too many requests. Please wait and try again.";
  if (status >= 500) return "The server could not complete this request. Please try again.";
  return "The request could not be completed.";
}

async function requestOnce<T>(
  path: string,
  options: RequestInit,
  accessToken: string | null | undefined,
  config: ApiRequestConfig<T>,
  id: string,
  attempt: number,
) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Request-ID", id);
  headers.set("Accept", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Request timed out.", "TimeoutError"));
  }, config.timeoutMs ?? DEFAULT_API_TIMEOUT_MS);
  const callerSignal = options.signal;
  const cancel = () => controller.abort(callerSignal?.reason ?? new DOMException("Request cancelled.", "AbortError"));
  callerSignal?.addEventListener("abort", cancel, { once: true });
  const startedAt = clock();

  try {
    const response = await fetch(`${API_URL}${path}`, { ...options, headers, signal: controller.signal });
    const durationMs = clock() - startedAt;
    emitTiming({
      requestId: id,
      serverRequestId: response.headers.get("X-Request-ID"),
      method,
      path,
      status: response.status,
      durationMs,
      attempt,
    });
    if (response.redirected) {
      throw new ApiError({
        message: "The API request was unexpectedly redirected.",
        kind: "invalid_response",
        status: response.status,
        details: response.url,
        requestId: id,
        durationMs,
      });
    }
    const data = await parseBody(response, id, durationMs);
    if (!response.ok) {
      throw new ApiError({
        message: formatDrfError(data) || fallbackMessage(response.status),
        kind: kindForStatus(response.status),
        status: response.status,
        details: data,
        requestId: response.headers.get("X-Request-ID") || id,
        durationMs,
        retryAfterMs: getRetryAfterMs(response),
      });
    }
    if (config.validate && !config.validate(data)) {
      throw new ApiError({
        message: "The server returned data in an unexpected format.",
        kind: "invalid_response",
        status: response.status,
        details: data,
        requestId: id,
        durationMs,
      });
    }
    return data as T;
  } catch (error) {
    const durationMs = clock() - startedAt;
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      const abortError = new ApiError({
        message: timedOut ? "The request timed out. Please try again." : "The request was cancelled.",
        kind: timedOut ? "timeout" : "cancelled",
        requestId: id,
        durationMs,
      });
      emitTiming({ requestId: id, serverRequestId: null, method, path, status: 0, durationMs, attempt });
      throw abortError;
    }
    const networkError = new ApiError({
      message: "Unable to reach the server. Check your connection and try again.",
      kind: "network",
      details: error,
      requestId: id,
      durationMs,
    });
    emitTiming({ requestId: id, serverRequestId: null, method, path, status: 0, durationMs, attempt });
    throw networkError;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", cancel);
  }
}

async function requestWithRetry<T>(
  path: string,
  options: RequestInit,
  accessToken: string | null | undefined,
  config: ApiRequestConfig<T>,
  id: string,
) {
  const method = (options.method || "GET").toUpperCase();
  const retries = method === "GET" || method === "HEAD" ? Math.max(0, config.retries ?? 1) : 0;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestOnce<T>(path, options, accessToken, config, id, attempt);
    } catch (error) {
      const retryable = error instanceof ApiError && (
        error.kind === "network" || error.kind === "timeout" || RETRYABLE_STATUSES.has(error.status)
      );
      if (!retryable || attempt > retries || options.signal?.aborted) throw error;
      const waitMs = Math.min(error.retryAfterMs ?? 200 * (2 ** (attempt - 1)), 2000);
      try {
        await wait(waitMs, options.signal);
      } catch {
        throw new ApiError({
          message: "The request was cancelled.",
          kind: "cancelled",
          requestId: id,
          durationMs: 0,
        });
      }
    }
  }
}

function announceExpiredSession() {
  if (expirationAnnounced) return;
  expirationAnnounced = true;
  clearSession();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

export function resetExpirationAnnouncement() {
  expirationAnnounced = false;
}

function getRenewedAccessToken() {
  if (!refreshInFlight) {
    const refresh = getRefreshToken();
    if (!refresh) {
      return Promise.reject(new ApiError({
        message: "No refresh token is available.",
        kind: "unauthorized",
        status: 401,
        requestId: makeRequestId(),
        durationMs: 0,
      }));
    }
    refreshInFlight = refreshAccessToken(refresh)
      .then(({ access }) => {
        updateAccessToken(access);
        return access;
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null,
  config: ApiRequestConfig<T> = {},
): Promise<T> {
  const id = makeRequestId();
  try {
    return await requestWithRetry<T>(path, options, accessToken, config, id);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !accessToken) throw error;
  }

  try {
    const renewedAccess = await getRenewedAccessToken();
    return await requestWithRetry<T>(path, options, renewedAccess, { ...config, retries: 0 }, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) announceExpiredSession();
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!isRecord(value)) return false;
  return typeof value.id === "number" && typeof value.name === "string" &&
    typeof value.email === "string" && typeof value.role === "string" &&
    typeof value.is_staff === "boolean" &&
    (value.company_name === undefined || typeof value.company_name === "string");
}

function isAuthResponse(value: unknown): value is AuthResponse {
  return isRecord(value) && typeof value.access === "string" && typeof value.refresh === "string" && isAuthUser(value.user);
}

export function register(payload: { name: string; email: string; password: string }) {
  return apiRequest<AuthResponse>("/api/auth/register/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, null, { validate: isAuthResponse });
}

export function login(payload: { email: string; password: string }) {
  return apiRequest<AuthResponse>("/api/auth/login/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, null, { validate: isAuthResponse });
}

export function fetchMe(accessToken: string, signal?: AbortSignal) {
  return apiRequest<AuthUser>("/api/auth/me/", { method: "GET", signal }, accessToken, { validate: isAuthUser });
}

export function uploadProfilePicture(file: File, accessToken: string) {
  const body = new FormData();
  body.append("profile_picture", file);
  return apiRequest<AuthUser>("/api/auth/me/profile-picture/", { method: "POST", body }, accessToken, { validate: isAuthUser });
}

export function removeProfilePicture(accessToken: string) {
  return apiRequest<AuthUser>("/api/auth/me/profile-picture/", { method: "DELETE" }, accessToken, { validate: isAuthUser });
}

export function updateCompanyName(companyName: string, accessToken: string) {
  return apiRequest<AuthUser>("/api/auth/me/company-name/", {
    method: "PATCH",
    body: JSON.stringify({ company_name: companyName }),
  }, accessToken, { validate: isAuthUser });
}

export function fetchLoginActivity(accessToken: string, signal?: AbortSignal) {
  return apiRequest<LoginActivity>("/api/auth/sessions/", { method: "GET", signal }, accessToken);
}

export function revokeLoginActivitySession(sessionId: string, accessToken: string) {
  return apiRequest<void>(`/api/auth/sessions/${encodeURIComponent(sessionId)}/revoke/`, { method: "POST" }, accessToken);
}

export function revokeOtherLoginActivitySessions(accessToken: string) {
  return apiRequest<{ revoked: number }>("/api/auth/sessions/revoke-others/", { method: "POST" }, accessToken);
}

export function logoutCurrentSession(accessToken: string) {
  return apiRequest<void>("/api/auth/logout/", { method: "POST" }, accessToken);
}

export function refreshAccessToken(refresh: string) {
  return apiRequest<{ access: string }>("/api/auth/token/refresh/", {
    method: "POST",
    body: JSON.stringify({ refresh }),
  }, null, {
    validate: (value): value is { access: string } => isRecord(value) && typeof value.access === "string",
  });
}
