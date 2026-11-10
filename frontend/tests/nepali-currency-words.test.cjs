const assert = require("node:assert/strict");
const test = require("node:test");
const { toNepaliCurrencyWords } = require("../lib/nepali-currency-words.js");

test("formats requested rupee amounts in Nepali words", () => {
  const cases = [
    ["0", "शून्य रुपैयाँ मात्र"],
    ["1", "एक रुपैयाँ मात्र"],
    ["21", "एक्काइस रुपैयाँ मात्र"],
    ["99", "उनान्सय रुपैयाँ मात्र"],
    ["100", "एक सय रुपैयाँ मात्र"],
    ["1000", "एक हजार रुपैयाँ मात्र"],
    ["50000", "पचास हजार रुपैयाँ मात्र"],
    ["100000", "एक लाख रुपैयाँ मात्र"],
    ["125000", "एक लाख पच्चीस हजार रुपैयाँ मात्र"],
    ["1000000", "दश लाख रुपैयाँ मात्र"],
    ["10000000", "एक करोड रुपैयाँ मात्र"],
  ];
  for (const [amount, expected] of cases) {
    assert.equal(toNepaliCurrencyWords(amount), expected, amount);
  }
});

test("includes paisa without floating-point conversion", () => {
  assert.equal(toNepaliCurrencyWords("123.45"), "एक सय तेइस रुपैयाँ पैँतालीस पैसा मात्र");
  assert.equal(toNepaliCurrencyWords("0.05"), "शून्य रुपैयाँ पाँच पैसा मात्र");
  assert.equal(toNepaliCurrencyWords("50000.00"), "पचास हजार रुपैयाँ मात्र");
});

test("incomplete or invalid amounts have no generated wording", () => {
  for (const amount of ["", "1.", "-1", "1.001", "abc"]) {
    assert.equal(toNepaliCurrencyWords(amount), "");
  }
});
