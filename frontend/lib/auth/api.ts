import { clearSession, getRefreshToken, updateAccessToken } from "./storage";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
};

export type AuthTokens = {
  access: string;
  refresh: string;
};

export type AuthResponse = AuthTokens & {
  user: AuthUser;
};

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function formatDrfError(data: unknown, prefix = ""): string {
  if (typeof data === "string") {
    return prefix ? `${prefix}: ${data}` : data;
  }

  if (Array.isArray(data)) {
    return data
      .map((item) => formatDrfError(item, prefix))
      .filter(Boolean)
      .join(" ");
  }

  if (!data || typeof data !== "object") {
    return "";
  }

  const record = data as Record<string, unknown>;

  if (typeof record.detail === "string") {
    return record.detail;
  }

  const parts = Object.entries(record).map(([key, value]) => {
    const field = key === "non_field_errors"
      ? prefix
      : [prefix, key].filter(Boolean).join(".");
    return formatDrfError(value, field);
  });

  return parts.filter(Boolean).join(" ");
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:8000";

let refreshInFlight: Promise<string> | null = null;

function sendRequest(
  path: string,
  options: RequestInit,
  accessToken?: string | null
) {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return fetch(`${API_URL}${path}`, { ...options, headers });
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getRenewedAccessToken() {
  if (!refreshInFlight) {
    const refresh = getRefreshToken();
    if (!refresh) return Promise.reject(new Error("No refresh token is available."));

    // Reuse one refresh request when several API calls fail at the same time.
    refreshInFlight = refreshAccessToken(refresh)
      .then(({ access }) => {
        updateAccessToken(access);
        return access;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

function expireSession() {
  clearSession();
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null
): Promise<T> {
  let response = await sendRequest(path, options, accessToken);

  if (response.status === 401 && accessToken) {
    try {
      const renewedAccess = await getRenewedAccessToken();
      response = await sendRequest(path, options, renewedAccess);
    } catch {
      expireSession();
      throw new ApiError("Your session has expired. Please log in again.", 401);
    }

    if (response.status === 401) {
      const data = await parseResponse(response);
      expireSession();
      throw new ApiError("Your session has expired. Please log in again.", 401, data);
    }
  }

  const data = await parseResponse(response);
  if (!response.ok) {
    throw new ApiError(
      formatDrfError(data) || "Something went wrong. Please try again.",
      response.status,
      data
    );
  }

  return data as T;
}

export function register(payload: {
  name: string;
  email: string;
  password: string;
}) {
  return apiRequest<AuthResponse>("/api/auth/register/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: { email: string; password: string }) {
  return apiRequest<AuthResponse>("/api/auth/login/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMe(accessToken: string) {
  return apiRequest<AuthUser>(
    "/api/auth/me/",
    { method: "GET" },
    accessToken
  );
}

export function refreshAccessToken(refresh: string) {
  return apiRequest<{ access: string }>("/api/auth/token/refresh/", {
    method: "POST",
    body: JSON.stringify({ refresh }),
  });
}
