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

function formatDrfError(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "Something went wrong. Please try again.";
  }

  const record = data as Record<string, unknown>;

  if (typeof record.detail === "string") {
    return record.detail;
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      parts.push(
        ...value.map((item) =>
          typeof item === "string" ? item : JSON.stringify(item)
        )
      );
    } else if (typeof value === "string") {
      parts.push(key === "non_field_errors" ? value : `${key}: ${value}`);
    }
  }

  return parts.join(" ") || "Something went wrong. Please try again.";
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:8000";

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new ApiError(formatDrfError(data), response.status, data);
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
