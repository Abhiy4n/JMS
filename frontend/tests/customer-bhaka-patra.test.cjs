const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function loadSource(relativePath) {
  const filename = path.resolve(__dirname, "..", relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (name) => {
    if (name.endsWith(".module.css")) return {};
    if (name.startsWith("@/")) {
      const sourcePath = path.resolve(__dirname, "..", name.slice(2));
      const extension = fs.existsSync(`${sourcePath}.ts`) ? ".ts" : ".tsx";
      return loadSource(`${name.slice(2)}${extension}`);
    }
    return require(name);
  };
  new Function("require", "module", "exports", compiled)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}
const { customerBhakaPatras, bhakaPatraSummary, formatBhakaPatraMoney, formatBhakaPatraAmount } = loadSource("lib/customer-bhaka-patra.ts");
const Overview = loadSource("components/CustomerBhakaPatraOverview.tsx").default;
const Document = loadSource("components/BhakaPatraDocument.tsx").default;
const first = { id: 10, customer_id: 4, reference: "FIRST", created_at: "2026-10-01T10:00:00Z", principal_amount: "0.10", interest_amount: "1.01", items: [{ id: 1, name: "Ring", quantity: "1.000", rate: "0.10", amount: "0.10" }] };
const second = { id: 2, customer_id: 4, reference: "SECOND", created_at: "2026-10-02T10:00:00Z", principal_amount: "0.20", interest_amount: "2.02" };
const other = { ...first, id: 30, customer_id: 5, reference: "OTHER", principal_amount: "100.00" };
const render = (props = {}) => renderToStaticMarkup(React.createElement(Overview, { customerId: 4, ...props }));

test("empty folio shows zero KPIs and no artificial actions", () => {
  assert.deepEqual(bhakaPatraSummary([]), { count: 0, principalPaisa: 0n, interestPaisa: 0n });
  const markup = render();
  assert.match(markup, /Total Bhaka Patra/); assert.match(markup, /Total Interest Amount/);
  assert.match(markup, /Rs\. 0\.00/); assert.match(markup, /No Bhaka Patras found for this customer/);
  assert.doesNotMatch(markup, /<button/);
});
test("customer isolation, deduplication, stable order and displayed SN", () => {
  const records = Object.freeze([second, other, first, first]);
  assert.deepEqual(customerBhakaPatras(records, 4), [first, second]);
  assert.equal(records[0], second);
  assert.deepEqual(customerBhakaPatras(records, 4, "recently_added"), [second, first]);
  const newestMarkup = render({ records, ordering: "recently_added" });
  assert.match(newestMarkup, /<td>1<\/td><td>SECOND<\/td>/);
  assert.match(newestMarkup, /<td>2<\/td><td>FIRST<\/td>/);
  assert.match(newestMarkup, /Rs\. 3\.03/);

  const markup = render({ records });
  assert.match(markup, /<td>1<\/td><td>FIRST<\/td>/);
  assert.match(markup, /<td>2<\/td><td>SECOND<\/td>/);
  assert.doesNotMatch(markup, /OTHER/); assert.match(markup, /Rs\. 3\.03/);
  assert.match(markup, /Rakha Patra Number/); assert.match(markup, /Rakha Patra Amount/); assert.match(markup, /Purchased Items/);
  assert.match(markup, /Ring/);
});
test("equal dates retain supplied order and invalid dates do not break rendering", () => {
  const tied = { ...second, created_at: first.created_at };
  assert.deepEqual(customerBhakaPatras([tied, first], 4), [tied, first]);
  assert.doesNotThrow(() => render({ records: [{ ...first, created_at: "invalid" }] }));
});
test("exact decimal totals and deduplication work for large amounts", () => {
  assert.equal(bhakaPatraSummary([first, second]).principalPaisa, 30n);
  const large = { ...first, principal_amount: "999999999999.99", interest_amount: "0.01" };
  assert.equal(bhakaPatraSummary([large, large]).principalPaisa, 99999999999999n);
  assert.equal(formatBhakaPatraMoney(bhakaPatraSummary([first, second, other]).principalPaisa), "Rs. 100.30");
});
test("missing interest is unavailable rather than silently reported as zero", () => {
  assert.equal(bhakaPatraSummary([{ ...first, interest_amount: null }]).interestPaisa, null);
  for (const value of [null, undefined, "invalid", "NaN", "-1", "1.001"]) assert.equal(formatBhakaPatraAmount(value), "Unavailable");
  assert.match(render({ records: [{ ...first, interest_amount: null }] }), /Unavailable/);
});
test("row click and keyboard open only the corresponding record", () => {
  const viewed = [];
  const tree = Overview({ customerId: 4, records: [second, first], actions: { onView: (record) => viewed.push(record) } });
  function visit(element) {
    if (!React.isValidElement(element)) return;
    if (element.type === "tr" && element.props.onClick) {
      element.props.onClick();
      const target = {};
      element.props.onKeyDown({ target, currentTarget: target, key: "Enter", preventDefault() {} });
      element.props.onKeyDown({ target: {}, currentTarget: target, key: "Enter", preventDefault() {} });
    }
    React.Children.forEach(element.props.children, visit);
  }
  visit(tree); assert.deepEqual(viewed, [first, first, second, second]);
  assert.match(render({ records: [first], actions: { onView() {} } }), /tabindex="0"/);
});
test("formal preview uses recorded items and totals without adding interest", () => {
  const customer = { id: 4, name: "Actual Customer", phone: "9800000000", email: "", business_source: null };
  const markup = renderToStaticMarkup(React.createElement(Document, { record: first, customer }));
  assert.match(markup, /BHAKA PATRA/); assert.match(markup, /Actual Customer/); assert.match(markup, /Ring/);
  assert.match(markup, /Total Bhaka Patra Amount<\/dt><dd>Rs\. 0\.10/);
  assert.match(markup, /Interest Amount<\/dt><dd>Rs\. 1\.01/);
  assert.doesNotMatch(markup, /undefined|NaN|Invalid Date/);
  const wrong = renderToStaticMarkup(React.createElement(Document, { record: other, customer }));
  assert.match(wrong, /does not belong/); assert.doesNotMatch(wrong, /Ring/);
});
