// End-to-end authentication regression test with a real Next server and Chromium.
// API responses are mocked in the browser; no project database records are changed.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("next/dist/compiled/ws");

const appPort = 3102;
const debugPort = 9230;
const base = `http://127.0.0.1:${appPort}`;
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function installMockApi() {
  const user = { id: 1, name: "Auth tester", email: "auth@example.com", company_name: "Admin", profile_picture: "", role: "Admin" };
  const state = window.__authTest = { requests: [], meMode: "success", meDelay: 0, user };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, options);
    const method = (options.method || "GET").toUpperCase();
    state.requests.push({ path: url.pathname, method, requestId: new Headers(options.headers).get("X-Request-ID") });
    const response = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "X-Request-ID": new Headers(options.headers).get("X-Request-ID") || "test" },
    });
    if (url.pathname === "/api/auth/login/") return response({ access: "access-login", refresh: "refresh-login", user });
    if (url.pathname === "/api/auth/register/") return response({ access: "access-signup", refresh: "refresh-signup", user });
    if (url.pathname === "/api/auth/me/") {
      if (state.meDelay) await new Promise((resolve) => setTimeout(resolve, state.meDelay));
      if (state.meMode === "network") throw new TypeError("offline");
      if (state.meMode === "expired") return response({ detail: "expired" }, 401);
      return response(user);
    }
    if (url.pathname === "/api/auth/token/refresh/") {
      return state.meMode === "expired" ? response({ detail: "invalid refresh" }, 401) : response({ access: "renewed-access" });
    }
    if (url.pathname === "/api/auth/logout/") return response(null, 204);
    if (url.pathname === "/api/business-sources/summary/") return response({ total_sources: 0, total_linked_customers: 0 });
    if (url.pathname === "/api/business-sources/") return response([]);
    if (url.pathname === "/api/customers/summary/") return response({ total_rakha_patra: 0, total_amount: "0.00" });
    if (url.pathname === "/api/customers/") return response([]);
    return response({ detail: `Unexpected test API request: ${url.pathname}` }, 500);
  };
}

async function waitForServer(process) {
  let output = "";
  process.stdout.on("data", (data) => { output = (output + data).slice(-5000); });
  process.stderr.on("data", (data) => { output = (output + data).slice(-5000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`Next server exited early:\n${output}`);
    try {
      const response = await fetch(`${base}/login`);
      if (response.ok) return;
    } catch {}
    await pause(250);
  }
  throw new Error(`Timed out waiting for Next server:\n${output}`);
}

async function main() {
  const nextBin = path.resolve(__dirname, "../node_modules/next/dist/bin/next");
  const next = spawn(process.execPath, [nextBin, "dev", "--webpack", "-p", String(appPort)], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      NEXT_PUBLIC_API_URL: "http://localhost:8000",
      NEXT_PUBLIC_AUTH_REVALIDATE_MS: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const profile = mkdtempSync(path.join(os.tmpdir(), "jms-auth-ui-"));
  const chrome = spawn("chromium", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let socket;
  try {
    await waitForServer(next);
    const apiProbe = await fetch(`${base}/api/auth/me/`, { redirect: "manual" });
    assert.notEqual(apiProbe.status, 307, "Next middleware must not redirect API requests");
    assert.notEqual(apiProbe.headers.get("location"), "/login", "API requests must never become frontend login HTML");

    let version;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); break; } catch { await pause(100); }
    }
    assert.ok(version, "Chromium debugging endpoint started");
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    const pending = new Map();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer); pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chromium command timed out: ${method}`)); }, 60000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    await send("Page.enable"); await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installMockApi.toString()})()` });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, label) => {
      for (let attempt = 0; attempt < 240; attempt += 1) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await pause(100);
      }
      throw new Error(`Timed out: ${label}`);
    };
    const setInput = (selector, value) => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const requestCount = (path) => evaluate(`window.__authTest.requests.filter(request=>request.path===${JSON.stringify(path)}).length`);

    await send("Page.navigate", { url: `${base}/login` });
    await waitFor("document.querySelector('#login-email')", "login form");
    await setInput("#login-email", "auth@example.com");
    await setInput("#login-password", "password-123");
    await evaluate("document.querySelector('form').requestSubmit()");
    await waitFor("location.pathname==='/business-sources' && document.querySelector('.business-source-module')", "post-login business sources");
    assert.equal(await requestCount("/api/auth/login/"), 1);
    assert.equal(await requestCount("/api/auth/me/"), 0, "fresh login response initializes auth without /me");

    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Add business source')).click()");
    await waitFor("document.querySelector('#source-dialog-title')", "business source dialog");
    await setInput('[role="dialog"] input[maxlength="255"]', "Unsaved source name");
    await evaluate("window.__authTest.meDelay=150;window.__authTest.meMode='success';window.__authTest.requests=[];window.__clockOffset=400000;window.__realDateNow=window.__realDateNow||Date.now;Date.now=()=>window.__realDateNow()+window.__clockOffset;window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))");
    await pause(30);
    assert.equal(await evaluate("document.querySelector('[role=dialog] input[maxlength=\"255\"]').value"), "Unsaved source name", "background verification preserves unsaved form state");
    await waitFor("window.__authTest.requests.filter(request=>request.path==='/api/auth/me/').length===1", "one deduplicated background verification");
    await pause(200);
    assert.equal(await requestCount("/api/auth/me/"), 1);
    assert.equal(await evaluate("document.querySelector('[role=dialog] input[maxlength=\"255\"]').value"), "Unsaved source name");

    await evaluate("document.querySelector('[role=dialog] [aria-label=Close]').click();window.__authTest.requests=[]");
    await evaluate("document.querySelector('a[href=\"/customers\"]').click()");
    await waitFor("location.pathname==='/customers' && document.querySelector('.page-heading h1')?.textContent==='Customers'", "normal navigation");
    assert.equal(await requestCount("/api/auth/me/"), 0, "normal navigation performs no auth verification");

    await evaluate("window.__authTest.requests=[];window.__authTest.meMode='network';window.__clockOffset+=400000;window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))");
    await waitFor("document.body.textContent.includes('Connection interrupted')", "temporary network warning");
    assert.equal(await evaluate("document.querySelector('.page-heading h1')?.textContent"), "Customers", "temporary outage preserves page content");
    assert.equal(await requestCount("/api/auth/me/"), 2, "one logical safe request has one controlled retry");

    await evaluate("window.__authTest.requests=[];window.__authTest.meMode='expired';window.__clockOffset+=400000;window.dispatchEvent(new Event('focus'))");
    await waitFor("location.pathname==='/login'", "confirmed expiration redirects once");
    assert.equal(await requestCount("/api/auth/me/"), 1);
    assert.equal(await requestCount("/api/auth/token/refresh/"), 1);

    await evaluate("window.__authTest.requests=[];window.__authTest.meMode='success';document.querySelector('a[href=\"/signup\"]').click()");
    await waitFor("location.pathname==='/signup' && document.querySelector('#signup-name')", "signup form");
    await setInput("#signup-name", "Auth tester");
    await setInput("#signup-email", "new-auth@example.com");
    await setInput("#signup-password", "password-123");
    await evaluate("document.querySelector('form').requestSubmit()");
    await waitFor("location.pathname==='/business-sources' && document.querySelector('.business-source-module')", "post-signup business sources");
    assert.equal(await requestCount("/api/auth/register/"), 1);
    assert.equal(await requestCount("/api/auth/me/"), 0, "fresh signup response initializes auth without /me");

    await evaluate("window.__authTest.requests=[]");
    await send("Page.reload");
    await waitFor("location.pathname==='/business-sources' && document.querySelector('.business-source-module')", "cold authenticated load");
    await waitFor("window.__authTest.requests.filter(request=>request.path==='/api/auth/me/').length===1", "one cold-load verification");
    assert.equal(await requestCount("/api/auth/me/"), 1);

    await evaluate("localStorage.removeItem('jms_access');localStorage.removeItem('jms_refresh');window.dispatchEvent(new StorageEvent('storage',{key:'jms_access',oldValue:'access-signup',newValue:null}))");
    await waitFor("location.pathname==='/login'", "cross-tab credential removal");

    await evaluate("window.__authTest.requests=[]");
    await setInput("#login-email", "auth@example.com");
    await setInput("#login-password", "password-123");
    await evaluate("document.querySelector('form').requestSubmit()");
    await waitFor("location.pathname==='/business-sources' && document.querySelector('[aria-label^=\"Account menu for\"]')", "second login");
    await evaluate("document.querySelector('[aria-label^=\"Account menu for\"]').click()");
    await waitFor("[...document.querySelectorAll('button')].some(button=>button.textContent.includes('Sign out'))", "account menu");
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Sign out')).click()");
    await waitFor("location.pathname==='/login'", "explicit logout");
    assert.equal(await requestCount("/api/auth/logout/"), 1);

    console.log("PASS: login/signup request counts, no immediate /me, one cold-load verification, focus/visibility dedupe, unsaved-state preservation, navigation request count, temporary outage behavior, controlled read retry, confirmed expiration, cross-tab removal, explicit logout, and API middleware exclusion.");
    await send("Browser.close").catch(() => {});
  } finally {
    socket?.terminate();
    chrome.kill("SIGTERM");
    next.kill("SIGTERM");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
