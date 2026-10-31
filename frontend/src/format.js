import { isKn, tr } from "./lang.js";

// Dates follow the language (Kannada month names); digits stay Latin so amounts and dates read the same in both.
const loc = () => (isKn() ? "kn-IN-u-nu-latn" : "en-IN");

export const rupee = (n, digits = 0) =>
  (Number(n) < 0 ? "−₹" : "₹") +
  Math.abs(Number(n || 0)).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const shortDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString(loc(), { day: "numeric", month: "short" });

export const longDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString(loc(), { day: "numeric", month: "short", year: "numeric" });

export const weekdayDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString(loc(), { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** 02-08-2026, the way a passbook writes it. */
export const dmy = (iso) => iso.split("-").reverse().join("-");

export const monthLabel = (ym) =>
  new Date(ym + "-01T00:00:00").toLocaleDateString(loc(), { month: "long", year: "numeric" });

export const monthShort = (ym) =>
  new Date(ym + "-01T00:00:00").toLocaleDateString(loc(), { month: "short", year: "2-digit" });

export const plural = (n, one, many = one + "s") => (isKn() ? `${n} ${tr(n === 1 ? one : many)}` : `${n} ${n === 1 ? one : many}`);

export function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const pad = (n) => String(n).padStart(2, "0");
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}` };
}

export const todayISO = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// One stable colour per category, used by the strip, charts and tags.
// Chosen to stay distinguishable for common colour-vision deficiencies.
export const CATEGORY_COLORS = {
  Food: "#E07A1F",
  Entertainment: "#7B4FD1",
  "Local Shops": "#1B8A6B",
  Person: "#2563C9",
  Transport: "#0E9CB5",
  Shopping: "#C23B73",
  "Bills & Utilities": "#6B7A8C",
  Health: "#C8362E",
  Subscriptions: "#9A6B12",
  Cash: "#4B5563",
  Other: "#A3AEBB",
  Income: "#2F855A",
  Groceries: "#8AA61F",
  Education: "#5B5BD6",
  Savings: "#0F8F5A",
  "Bank Charges": "#8B6B5A",
  Reversed: "#B8C2CC",
};
// In Kannada mode every colour turns to the red-and-yellow family of the Karnataka flag.
const WARM_CATEGORY_COLORS = {
  Food: "#E8590C", Entertainment: "#9C1B3A", "Local Shops": "#B5651D", Person: "#C8102E", Transport: "#F2A900",
  Shopping: "#A61E4D", "Bills & Utilities": "#8A6A00", Health: "#E03131", Subscriptions: "#8A4B08", Cash: "#5C3317",
  Other: "#C9A66B", Income: "#E5A100", Groceries: "#D9A400", Education: "#B71C1C", Savings: "#FFB300",
  "Bank Charges": "#6D4C41", Reversed: "#D8C9A8",
};
const WARM_TONES = {
  "#2a5fd0": "#c8102e", "#16398a": "#7a0a1c", "#e07a1f": "#f2a900", "#8f4300": "#8a5a00",
  "#1b8a6b": "#b5651d", "#0b5a44": "#6e3a0e", "#0e9cb5": "#e8590c", "#0f8f5a": "#d4a017",
};
export const colorFor = (c) => (isKn() ? WARM_CATEGORY_COLORS[c] : CATEGORY_COLORS[c]) || (isKn() ? "#C9A66B" : "#A3AEBB");
/** A fixed accent colour (ring, chart), swapped for its red or yellow partner in Kannada mode. */
export const tone = (hex) => (isKn() && WARM_TONES[hex.toLowerCase()]) || hex;

/** Categories a budget makes sense for. */
export const BUDGET_CATEGORIES = [
  "Food", "Groceries", "Entertainment", "Local Shops", "Person", "Transport", "Shopping",
  "Bills & Utilities", "Health", "Subscriptions", "Education", "Bank Charges", "Cash", "Other",
];

/** A darker shade of a #rrggbb colour, used for the second lap of a ring. */
export function darken(hex, k = 0.38) {
  const n = parseInt(hex.slice(1), 16);
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => Math.round(v * (1 - k)).toString(16).padStart(2, "0"))
      .join("")
  );
}
