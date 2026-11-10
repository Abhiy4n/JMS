const SMALL_NUMBER_WORDS = [
  "शून्य", "एक", "दुई", "तीन", "चार", "पाँच", "छ", "सात", "आठ", "नौ",
  "दश", "एघार", "बाह्र", "तेह्र", "चौध", "पन्ध्र", "सोह्र", "सत्र", "अठार", "उन्नाइस",
  "बीस", "एक्काइस", "बाइस", "तेइस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताइस", "अठ्ठाइस", "उनन्तीस",
  "तीस", "एकतीस", "बत्तीस", "तेत्तीस", "चौँतीस", "पैँतीस", "छत्तीस", "सैँतीस", "अठतीस", "उनन्चालीस",
  "चालीस", "एकचालीस", "बयालीस", "त्रिचालीस", "चवालीस", "पैँतालीस", "छयालीस", "सतचालीस", "अठचालीस", "उनन्चास",
  "पचास", "एकाउन्न", "बाउन्न", "त्रिपन्न", "चौवन्न", "पचपन्न", "छपन्न", "सन्ताउन्न", "अन्ठाउन्न", "उनन्साठी",
  "साठी", "एकसट्ठी", "बयसट्ठी", "त्रिसट्ठी", "चौँसट्ठी", "पैँसट्ठी", "छयसट्ठी", "सतसट्ठी", "अठसट्ठी", "उनन्सत्तरी",
  "सत्तरी", "एकहत्तर", "बहत्तर", "त्रिहत्तर", "चौहत्तर", "पचहत्तर", "छयहत्तर", "सतहत्तर", "अठहत्तर", "उनासी",
  "असी", "एकासी", "बयासी", "त्रियासी", "चौरासी", "पचासी", "छयासी", "सतासी", "अठासी", "उनान्नब्बे",
  "नब्बे", "एकान्नब्बे", "बयानब्बे", "त्रियान्नब्बे", "चौरान्नब्बे", "पन्चान्नब्बे", "छयान्नब्बे", "सन्तान्नब्बे", "अन्ठान्नब्बे", "उनान्सय",
];

const GROUPS = [
  [100000000000n, "खर्ब"],
  [1000000000n, "अर्ब"],
  [10000000n, "करोड"],
  [100000n, "लाख"],
  [1000n, "हजार"],
];

function underThousand(value) {
  const words = [];
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  if (hundreds) words.push(`${SMALL_NUMBER_WORDS[hundreds]} सय`);
  if (remainder) words.push(SMALL_NUMBER_WORDS[remainder]);
  return words.join(" ");
}

function numberToWords(value) {
  if (value === 0n) return SMALL_NUMBER_WORDS[0];
  const words = [];
  let remainder = value;
  for (const [size, label] of GROUPS) {
    const count = remainder / size;
    if (count) {
      words.push(`${numberToWords(count)} ${label}`);
      remainder %= size;
    }
  }
  if (remainder) words.push(underThousand(Number(remainder)));
  return words.join(" ");
}

function toNepaliCurrencyWords(amount) {
  const value = typeof amount === "number" ? String(amount) : String(amount ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return "";
  const [whole, fraction = ""] = value.split(".");
  const paisa = BigInt(fraction.padEnd(2, "0"));
  const parts = [`${numberToWords(BigInt(whole))} रुपैयाँ`];
  if (paisa) parts.push(`${numberToWords(paisa)} पैसा`);
  return `${parts.join(" ")} मात्र`;
}

module.exports = { toNepaliCurrencyWords };
