const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function loadTypeScript(entry) {
  const modules = new Map();
  function load(filename) {
    const resolved = path.resolve(filename);
    if (modules.has(resolved)) return modules.get(resolved).exports;
    const loadedModule = { exports: {} };
    modules.set(resolved, loadedModule);
    const compiled = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const localRequire = (specifier) => {
      if (!specifier.startsWith(".")) return require(specifier);
      const candidate = path.resolve(path.dirname(resolved), specifier);
      return load(path.extname(candidate) ? candidate : `${candidate}.ts`);
    };
    new Function("require", "module", "exports", compiled)(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load(entry);
}

function json(body, status = 200, headers = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function setup() {
  const windowTarget = new EventTarget();
  windowTarget.localStorage = new MemoryStorage();
  windowTarget.sessionStorage = new MemoryStorage();
  global.window = windowTarget;
  global.document = { cookie: "" };
  const api = loadTypeScript(path.resolve(__dirname, "../lib/auth/api.ts"));
  return { api, storage: windowTarget.localStorage };
}

test("safe GET requests retry once, while POST mutations never retry", async () => {
  const { api } = setup();
  let getCalls = 0;
  global.fetch = async () => ++getCalls === 1 ? json({ detail: "busy" }, 503) : json({ ok: true });
  assert.deepEqual(await api.apiRequest("/api/read/", {}, null, { retries: 1 }), { ok: true });
  assert.equal(getCalls, 2);

  let postCalls = 0;
  global.fetch = async () => { postCalls += 1; return json({ detail: "busy" }, 503); };
  await assert.rejects(
    api.apiRequest("/api/payment/", { method: "POST", body: "{}" }),
    (error) => error instanceof api.ApiError && error.kind === "server"
  );
  assert.equal(postCalls, 1);
});

test("timeouts, caller cancellation, and HTML success responses are structured errors", async () => {
  const { api } = setup();
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  });
  await assert.rejects(
    api.apiRequest("/api/slow/", {}, null, { timeoutMs: 10, retries: 0 }),
    (error) => error instanceof api.ApiError && error.kind === "timeout"
  );

  const controller = new AbortController();
  const cancelled = api.apiRequest("/api/cancel/", { signal: controller.signal }, null, { retries: 0 });
  controller.abort();
  await assert.rejects(cancelled, (error) => error instanceof api.ApiError && error.kind === "cancelled");

  global.fetch = async () => new Response("<html>login</html>", { status: 200, headers: { "Content-Type": "text/html" } });
  await assert.rejects(
    api.apiRequest("/api/redirected/", {}, null, { retries: 0 }),
    (error) => error instanceof api.ApiError && error.kind === "invalid_response"
  );
});

test("parallel 401 responses share one refresh and retry with the renewed token", async () => {
  const { api, storage } = setup();
  storage.setItem("jms_access", "old-access");
  storage.setItem("jms_refresh", "refresh-token");
  let refreshCalls = 0;
  let resourceCalls = 0;
  global.fetch = async (url, options) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/api/auth/token/refresh/") {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return json({ access: "new-access" });
    }
    resourceCalls += 1;
    return options.headers.get("Authorization") === "Bearer new-access"
      ? json({ ok: true })
      : json({ detail: "expired" }, 401);
  };
  const results = await Promise.all([
    api.apiRequest("/api/resource/", {}, "old-access"),
    api.apiRequest("/api/resource/", {}, "old-access"),
  ]);
  assert.deepEqual(results, [{ ok: true }, { ok: true }]);
  assert.equal(refreshCalls, 1);
  assert.equal(resourceCalls, 4);
  assert.equal(storage.getItem("jms_access"), "new-access");
});

test("temporary refresh network failure preserves stored credentials", async () => {
  const { api, storage } = setup();
  storage.setItem("jms_access", "old-access");
  storage.setItem("jms_refresh", "refresh-token");
  global.fetch = async (url) => {
    if (new URL(url).pathname === "/api/auth/token/refresh/") throw new TypeError("offline");
    return json({ detail: "expired" }, 401);
  };
  await assert.rejects(
    api.apiRequest("/api/resource/", {}, "old-access"),
    (error) => error instanceof api.ApiError && error.kind === "network"
  );
  assert.equal(storage.getItem("jms_access"), "old-access");
  assert.equal(storage.getItem("jms_refresh"), "refresh-token");
});

test("confirmed refresh rejection clears credentials once", async () => {
  const { api, storage } = setup();
  storage.setItem("jms_access", "old-access");
  storage.setItem("jms_refresh", "bad-refresh");
  let expiredEvents = 0;
  window.addEventListener("jms-session-expired", () => { expiredEvents += 1; });
  global.fetch = async () => json({ detail: "invalid token" }, 401);
  await Promise.allSettled([
    api.apiRequest("/api/one/", {}, "old-access"),
    api.apiRequest("/api/two/", {}, "old-access"),
  ]);
  assert.equal(expiredEvents, 1);
  assert.equal(storage.getItem("jms_access"), null);
  assert.equal(storage.getItem("jms_refresh"), null);
});

test("requests include correlation IDs and emit timing details", async () => {
  const { api } = setup();
  let receivedId = "";
  let timing;
  window.addEventListener(api.API_TIMING_EVENT, (event) => { timing = event.detail; });
  global.fetch = async (_url, options) => {
    receivedId = options.headers.get("X-Request-ID");
    return json({ ok: true }, 200, { "X-Request-ID": receivedId });
  };
  await api.apiRequest("/api/timed/");
  assert.match(receivedId, /\S+/);
  assert.equal(timing.requestId, receivedId);
  assert.equal(timing.serverRequestId, receivedId);
  assert.equal(timing.path, "/api/timed/");
  assert.equal(timing.status, 200);
  assert.ok(timing.durationMs >= 0);
});

test("HTTP failures are classified without retrying mutations", async () => {
  const { api } = setup();
  const expectations = [
    [400, "validation"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [500, "server"],
  ];
  for (const [status, kind] of expectations) {
    let calls = 0;
    global.fetch = async () => { calls += 1; return json({ detail: `status ${status}` }, status); };
    await assert.rejects(
      api.apiRequest("/api/mutation/", { method: "POST", body: "{}" }),
      (error) => error instanceof api.ApiError && error.status === status && error.kind === kind
    );
    assert.equal(calls, 1);
  }
});

test("Next proxy excludes API paths from frontend authentication redirects", () => {
  const { unstable_doesMiddlewareMatch } = require("next/experimental/testing/server");
  const { config } = loadTypeScript(path.resolve(__dirname, "../proxy.ts"));
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/auth/me/" }), false);
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/business-sources" }), true);
});
