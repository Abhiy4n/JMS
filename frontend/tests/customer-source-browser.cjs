// Real Chromium UI smoke test; all business API requests are mocked in memory.
// No customer/source/document records are written to the project database.
// Start Next on port 3100, then: node tests/customer-source-browser.cjs
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("next/dist/compiled/ws");
const base = process.env.JMS_TEST_URL || "http://localhost:3100";
const chromePath = process.env.CHROME_PATH || (
  process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "chromium"
);
const port = 9228;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function installMockApi() {
  localStorage.setItem("jms_access", "browser-test-token");
  localStorage.setItem("jms_user", JSON.stringify({ id: 1, name: "Browser tester", email: "browser@example.com", role: "ADMIN" }));
  const source = { id: 1, name: "Browser Source", source_type: "INDIVIDUAL", phone: "9800000000", pan_vat_number: "", market_segment: "Retail", email: "", address: "Kathmandu", interest_type: null, interest_percentage: null, interest_amount: null, days: null, monthly_interest_amount: null, interest_credit_basis: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
  const contact = { id: 1, name: "Browser Customer", phone: "9800000000", email: "browser@example.com", customer_type: "INDIVIDUAL", business_source: 1, source_entry: 1, source_name: source.name, is_active: true, monthly_interest_amount: null, interest_credit_basis: null, created_at: "2026-10-01T00:00:00Z" };
  const state = window.__jmsTest = { customers: [contact, { ...contact, id: 2, name: "Unlinked Customer", business_source: null, source_entry: null, source_name: "" }], sources: [source], requests: [], failCustomers: false, failDocuments: false, records: [{id: 7, customer_id: 1, reference: "BP-actual-7", created_at: "2026-10-01T00:00:00Z", principal_amount: "100.30", interest_amount: "0.20", items: [{id: 1, name: "Ring", quantity: "1.000", rate: "100.30", amount: "100.30"}]}] };
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return fetchOriginal(input, options);
    const route = url.pathname, method = options.method || "GET";
    state.requests.push({ route, method });
    const respond = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const payload = options.body ? JSON.parse(options.body) : {};
    if (route === "/api/customers/summary/") return respond({total_rakha_patra: state.records.length, total_amount: state.records.reduce((sum, r) => sum + Number(r.principal_amount), 0).toFixed(2)});
    if (route === "/api/business-sources/summary/") return respond({ total_sources: state.sources.length, total_linked_customers: state.customers.filter((c) => c.business_source).length });
    if (route === "/api/business-sources/") {
      if (method === "POST") {
        if (state.sources.some((s) => s.name.toLowerCase() === payload.name.toLowerCase())) return respond({ name: ["A business source with this name already exists."] }, 400);
        const created = { ...payload, id: 10 + state.sources.length, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; state.sources.push(created); state.customers.push({...contact, id: created.id, name: created.name, business_source: created.id, source_entry: created.id}); return respond({ ...created, customer_count: 1 }, 201);
      }
      const search = (url.searchParams.get("search") || "").trim().toLowerCase();
      const sourceType = url.searchParams.get("source_type") || "";
      const ordering = url.searchParams.get("ordering") || "first_added";
      const sources = state.sources.filter((s) => s.name.toLowerCase().includes(search) && (!sourceType || s.source_type === sourceType));
      sources.sort((a, b) => {
        if (ordering === "name_asc" || ordering === "name_desc") {
          const result = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          return (ordering === "name_desc" ? -result : result) || a.id - b.id;
        }
        const result = Date.parse(a.created_at) - Date.parse(b.created_at);
        return (ordering === "recently_added" ? -result : result) || (ordering === "recently_added" ? b.id - a.id : a.id - b.id);
      });
      return respond(sources.map((s) => ({ ...s, customer_count: state.customers.filter((c) => c.business_source === s.id).length })));
    }
    const sourceMatch = route.match(/^\/api\/business-sources\/(\d+)\/$/);
    if (sourceMatch) {
      const item = state.sources.find((s) => s.id === Number(sourceMatch[1]));
      if (method === "DELETE") {
        if (state.customers.some((c) => c.business_source === item.id)) return respond({ detail: "This business source is assigned to customers." }, 409);
        state.sources = state.sources.filter((s) => s !== item); return respond(null, 204);
      }
      Object.assign(item, payload); for (const c of state.customers) if (method !== "GET" && c.source_entry === item.id) Object.assign(c, {name: item.name, phone: item.phone, email: item.email}); return respond({ ...item, customer_count: state.customers.filter((c) => c.business_source === item.id).length });
    }
    if (route === "/api/customers/") {
      if (state.failCustomers && method === "GET") return respond({ detail: "Customer service unavailable." }, 503);
      if (method === "POST") { const created = { ...contact, ...payload, id: 20 + state.customers.length }; state.customers.push(created); return respond(created, 201); }
      const customers = state.customers.filter((c) => (!url.searchParams.has("business_source") || c.business_source === Number(url.searchParams.get("business_source"))) && c.name.toLowerCase().includes((url.searchParams.get("search") || "").toLowerCase()));
      const order = url.searchParams.get("ordering") || "name_asc";
      customers.sort((a,b) => {
        if (order.startsWith("name_")) return (order === "name_desc" ? -1 : 1) * a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id-b.id;
        return (order === "recently_added" ? -1 : 1) * (Date.parse(a.created_at)-Date.parse(b.created_at) || a.id-b.id);
      });
      return respond(customers);
    }
    const docMatch = route.match(/^\/api\/customers\/(\d+)\/bhaka-patras\/(?:(\d+)\/)?$/);
    if (docMatch) {
      if (state.failDocuments) return respond({detail: "Document service unavailable."}, 503);
      const records = state.records.filter(r => r.customer_id === Number(docMatch[1]));
      if (docMatch[2]) { const record = records.find(r => r.id === Number(docMatch[2])); return record ? respond(record) : respond({detail: "Not found."}, 404); }
      return respond(records);
    }
    const customerMatch = route.match(/^\/api\/customers\/(\d+)\/$/);
    if (customerMatch) {
      const customer = state.customers.find((c) => c.id === Number(customerMatch[1]));
      if (method === "DELETE") { state.customers = state.customers.filter((c) => c !== customer); return respond(null, 204); }
      Object.assign(customer, payload); return respond(customer);
    }
    if (/\/account\/$/.test(route)) return respond({ summary: Object.fromEntries(["total_bought", "total_sold", "remaining_balance", "credit_principal_due", "interest_due"].map((name) => [name, "0.00"])), bills: [] });
    return respond({ detail: "Unexpected test API request: " + route }, 500);
  };
}

async function main() {
  const keepAlive = setInterval(() => {}, 1000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "jms-ui-"));
  const browser = spawn(chromePath, ["--headless=new", "--disable-gpu", "--in-process-gpu", "--no-sandbox", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let browserLog = "";
  browser.stderr.on("data", (data) => { browserLog = (browserLog + data).slice(-3000); });
  let socket;
  try {
    let version;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await pause(250); }
    }
    assert.ok(version, "Chromium debugging endpoint started");
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0, lastMethod, dialogOpen = false;
    const pending = new Map(), exceptions = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Page.javascriptDialogOpening") dialogOpen = true;
      if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
      if (pending.has(message.id)) { const { resolve, reject, timer } = pending.get(message.id); clearTimeout(timer); pending.delete(message.id); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); }
    };
    socket.onclose = (event) => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`Chromium connection closed during ${lastMethod}: ${event.code} ${event.reason}`)); } pending.clear(); };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      lastMethod = method;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Chromium command timed out: " + method)); }, 60000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    await send("Page.enable"); await send("Runtime.enable");
    await send("Network.setCookie", { name: "jms_authenticated", value: "1", url: base });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installMockApi.toString()})()` });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, label = expression) => {
      for (let attempt = 0; attempt < 240; attempt++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(250); }
      throw new Error("Timed out: " + label);
    };
    const clickText = (text, within = "document") => evaluate(`(()=>{const item=[...${within}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}||b.textContent.replace(/^\\+\\s*/,'').trim()===${JSON.stringify(text)}); if(!item)throw Error('Missing button: '+${JSON.stringify(text)});item.click()})()`);
    const setInput = (selector, value) => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing input');const prototype=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const key = async (key, code, modifiers = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode: key === "Tab" ? 9 : 27 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers }); };
    const confirmAction = async (expression, accept) => {
      dialogOpen = false;
      await evaluate(`setTimeout(()=>{${expression}},0)`);
      for (let attempt = 0; attempt < 100 && !dialogOpen; attempt++) await pause(50);
      assert.ok(dialogOpen, "Deletion confirmation opened");
      await send("Page.handleJavaScriptDialog", { accept });
    };
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: base + "/customers" });
    await waitFor("document.querySelector('.customer-folio-link')", "customer directory");
    assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b=>/New Customer|Add Customer/.test(b.textContent))"), false);
    assert.equal(await evaluate("document.querySelector('thead th').textContent"), "SN");
    const customerHeadingStyle = await evaluate("(()=>{const s=getComputedStyle(document.querySelector('.page-heading h1'));return {color:s.color,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight}})()");

    assert.equal(await evaluate("document.querySelectorAll('.table-filters select').length"), 2);
    assert.equal(await evaluate("document.querySelector('.customer-overall-kpis').textContent"), "Total Rakha Patra1Total AmountRs. 100.30");
    assert.equal(await evaluate("/Business source|Status/.test(document.querySelector('.customer-directory-table thead').textContent)"), false);
    assert.equal(await evaluate("[...document.querySelectorAll('.customer-actions button')].some(b=>/Deactivate|Activate/.test(b.textContent))"), false);
    await evaluate("(()=>{const s=document.querySelector('[aria-label=\"Sort customers\"]');s.value='recently_added';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await waitFor("document.querySelector('.customer-folio-link')?.textContent==='Unlinked Customer'", "newest first");
    await evaluate("(()=>{const s=document.querySelector('[aria-label=\"Sort customers\"]');s.value='name_asc';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await waitFor("document.querySelector('.customer-folio-link')?.textContent==='Browser Customer'", "alphabetical sort");
    await evaluate("document.querySelector('.customer-folio-link').click()");
    await waitFor("document.querySelector('#customer-folio-title')?.textContent==='Customer Folio' && document.querySelector('.bhaka-patra-row')", "folio and saved document");
    assert.equal(await evaluate("document.querySelector('.customer-folio-content .customer-bhaka-patra-kpis').textContent"), "Total Bhaka Patra1Total Interest AmountRs. 0.20");
    await evaluate("window.__jmsTest.records.push({...window.__jmsTest.records[0],id:8,reference:'BP-newer',created_at:'2026-10-02T00:00:00Z'});window.dispatchEvent(new Event('focus'))");
    await waitFor("document.querySelectorAll('.bhaka-patra-row').length===2", "folio sort fixtures loaded");
    await evaluate("(()=>{const s=document.querySelector('[aria-label=\"Sort folio records\"]');s.value='recently_added';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await waitFor("document.querySelector('.bhaka-patra-table tbody tr td:nth-child(2)')?.textContent==='BP-newer'", "folio newest first");
    assert.equal(await evaluate("document.querySelector('.bhaka-patra-table tbody tr td').textContent"), "1");
    await evaluate("(()=>{const s=document.querySelector('[aria-label=\"Sort folio records\"]');s.value='first_added';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await waitFor("document.querySelector('.bhaka-patra-table tbody tr td:nth-child(2)')?.textContent==='BP-actual-7'", "folio oldest first");
    await evaluate("window.__jmsTest.records.pop();window.dispatchEvent(new Event('focus'))");
    await waitFor("document.querySelectorAll('.bhaka-patra-row').length===1", "restore document fixture");

    assert.equal(await evaluate("Math.round(document.querySelector('.customer-folio-window').getBoundingClientRect().width)"), 1080);
    assert.equal(await evaluate("Math.round(document.querySelector('.customer-folio-window').getBoundingClientRect().height)"), 675);
    assert.equal(await evaluate("location.pathname"), "/customers");
    assert.equal(await evaluate("Boolean(document.querySelector('.folio-contact-panel').compareDocumentPosition(document.querySelector('.customer-folio-content .customer-bhaka-patra-kpis')) & Node.DOCUMENT_POSITION_FOLLOWING)"), true);
    assert.equal(await evaluate("/Business source|Status|View bills|Deactivate/.test(document.querySelector('.folio-contact-panel').textContent)"), false);
    writeFileSync(path.resolve(__dirname, "../../.runtime/customer-folio-window.png"), Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64"));

    await evaluate("document.querySelector('.bhaka-patra-row').focus()");
    await send("Input.dispatchKeyEvent", {type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r"});
    await send("Input.dispatchKeyEvent", {type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13});
    await waitFor("document.querySelector('.bhaka-document')", "keyboard document preview");
    assert.equal(await evaluate("document.querySelector('.bhaka-document').textContent.includes('BP-actual-7') && document.querySelector('.bhaka-document').textContent.includes('Ring')"), true);
    assert.equal(await evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)"), true);
    writeFileSync(path.resolve(__dirname, "../../.runtime/folio-preview-desktop.png"), Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64"));
    await key("Tab", "Tab", 8);
    assert.equal(await evaluate("document.activeElement.textContent"), "Back to folio");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate("(()=>{const r=document.querySelector('[role=dialog]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()"), true);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.customer-folio-content .customer-bhaka-patra-kpis')).gridTemplateColumns.split(' ').length"), 1);
    writeFileSync(path.resolve(__dirname, "../../.runtime/folio-preview-mobile.png"), Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64"));
    await key("Escape", "Escape"); await waitFor("!document.querySelector('.bhaka-preview-panel') && document.querySelector('.customer-folio-window')", "Escape closes preview only");
    await evaluate("window.__jmsTest.records[0].interest_amount='0.45'; window.dispatchEvent(new Event('focus'))");
    await waitFor("document.querySelector('.customer-folio-content .customer-bhaka-patra-kpis')?.textContent.includes('Rs. 0.45')", "KPI refetch");
    await evaluate("window.__jmsTest.failDocuments=true; window.dispatchEvent(new Event('focus'))");
    await waitFor("document.querySelector('[role=alert]')?.textContent.includes('Document service unavailable')", "error state");
    await evaluate("window.__jmsTest.failDocuments=false"); await clickText("Retry loading Bhaka Patras");
    await waitFor("document.querySelector('.bhaka-patra-row')", "document retry");
    await evaluate("document.querySelector('[aria-label=\"Close customer folio\"]').click()");
    await waitFor("!document.querySelector('.customer-folio-window')", "folio closed");
    await waitFor("document.querySelector('.customer-folio-link')", "return to directory");
    await clickText("Edit");
    await waitFor("document.querySelector('#source-dialog-title')?.textContent==='Edit business source'", "source-backed editor");
    await setInput('[role=dialog] input[maxlength="255"]', 'Updated Browser Source'); await clickText("Save changes");
    await waitFor("!document.querySelector('[role=dialog]') && document.querySelector('tbody').textContent.includes('Updated Browser Source')", "shared edit");
    assert.equal(await evaluate("window.__jmsTest.customers.length"), 2);
    await confirmAction("[...document.querySelectorAll('.customer-directory-table tbody tr')].find(r=>r.textContent.includes('Updated Browser Source')).querySelector('.button-danger-outline').click()", false);
    assert.equal(await evaluate("window.__jmsTest.customers[0].is_active"), true);
    await confirmAction("[...document.querySelectorAll('.customer-directory-table tbody tr')].find(r=>r.textContent.includes('Updated Browser Source')).querySelector('.button-danger-outline').click()", true);
    await waitFor("window.__jmsTest.customers[0].is_active===false && document.querySelector('[role=status]')", "source customer deactivated");
    assert.equal(await evaluate("window.__jmsTest.sources.length"), 1);
    await evaluate("[...document.querySelectorAll('.customer-folio-link')].find(a=>a.textContent==='Unlinked Customer').click()");
    await waitFor("document.querySelector('.bhaka-patra-table tbody')?.textContent.includes('No Bhaka Patras found for this customer')", "isolated empty folio");
    assert.equal(await evaluate("document.querySelector('.customer-folio-content .customer-bhaka-patra-kpis').textContent"), "Total Bhaka Patra0Total Interest AmountRs. 0.00");
    await send("Page.navigate", {url: base + "/business-sources"});
    await waitFor("document.querySelector('tbody')?.textContent.includes('Browser Source')", "business sources");

    await send("Emulation.setDeviceMetricsOverride", {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
    assert.equal(await evaluate("document.querySelector('.business-source-module .eyebrow').textContent"), "BUSINESS SOURCES");
    assert.deepEqual(await evaluate("(()=>{const s=getComputedStyle(document.querySelector('.page-heading h1'));return {color:s.color,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight}})()"), customerHeadingStyle);
    assert.equal(await evaluate("[...document.querySelectorAll('.business-source-table .bill-row-actions button')].some(b=>b.textContent==='View')"), false);
    assert.equal(await evaluate("[...document.querySelectorAll('.business-source-table .bill-row-actions button')].map(b=>b.textContent).join(',')"), "Edit,Delete");
    await send("Emulation.setDeviceMetricsOverride", {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
    writeFileSync(path.resolve(__dirname, "../../.runtime/business-source-directory.png"), Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64"));
    await evaluate("document.querySelector('.business-source-name-button').focus()");
    await send("Input.dispatchKeyEvent", {type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r"});
    await send("Input.dispatchKeyEvent", {type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13});
    await waitFor("document.querySelector('.business-source-details-window .source-customer-row')", "source details from keyboard name selection");
    assert.equal(await evaluate("document.querySelector('#source-customers-title').textContent"), "Browser Source");
    assert.equal(await evaluate("document.querySelector('.source-detail-grid').textContent.includes('Kathmandu')"), true);
    assert.equal(await evaluate("Math.round(document.querySelector('.business-source-details-window').getBoundingClientRect().width)"), 1080);
    assert.equal(await evaluate("Math.round(document.querySelector('.business-source-details-window').getBoundingClientRect().height)"), 675);
    assert.equal(await evaluate("document.querySelector('.source-customer-list').textContent.includes('Unlinked Customer')"), false);
    writeFileSync(path.resolve(__dirname, "../../.runtime/business-source-window.png"), Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64"));
    await send("Emulation.setDeviceMetricsOverride", {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
    assert.equal(await evaluate("(()=>{const r=document.querySelector('.business-source-details-window').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()"), true);
    await key("Escape", "Escape"); await waitFor("!document.querySelector('.business-source-details-window')", "close source details");
    assert.equal(await evaluate("document.activeElement.classList.contains('business-source-name-button')"), true);
    await evaluate("document.querySelector('.business-source-name-button').click()");
    await waitFor("document.querySelector('.business-source-details-window')", "source details from name click");
    await evaluate("document.querySelector('.business-source-details-window [aria-label=Close]').click()");
    await waitFor("!document.querySelector('.business-source-details-window')", "source details close button");
    await clickText("Create Source"); await waitFor("document.querySelector('#source-dialog-title')");
    await setInput('[role=dialog] input[maxlength="255"]', 'New Source');
    await setInput('[role=dialog] input[type="tel"]', '9811111111');
    await setInput('[role=dialog] textarea', 'Kathmandu');
    await clickText("Create Source", "document.querySelector('[role=dialog]')");
    await waitFor("!document.querySelector('[role=dialog]') && window.__jmsTest.customers.length===3", "automatic customer entry");
    await evaluate("document.querySelector('a[href=\"/customers\"]').click()");
    await waitFor("document.querySelector('.customer-directory-table tbody')?.textContent.includes('New Source')", "source in Customers");
    assert.deepEqual(exceptions, []);
    console.log("PASS: matching heading typography, folio oldest/newest sorting, business-source name click/keyboard, 75% source details, mobile fit, Edit/Delete only, overall KPIs, sorting, removed titles/actions, 75% folio window, details order, nested Escape, actual document preview, keyboard/focus/Escape, mobile sizing, exact KPIs/refetch, error/retry, source editing, delete confirmation/deactivation, customer isolation and automatic source entries (mocked API).");
    await send("Browser.close").catch(() => {});
  } catch (error) {
    console.error(browserLog); throw error;
  } finally {
    clearInterval(keepAlive);
    socket?.terminate(); browser.kill(); browser.stderr.destroy(); browser.unref();
  }
}
main().catch((failure) => { console.error(failure); process.exitCode = 1; });
