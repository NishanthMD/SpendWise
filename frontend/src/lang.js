import { KN, KN_CATEGORIES } from "./kn.js";

/* The current language lives here, outside React, so plain helpers such as rupee(), monthLabel() and plural() can
 * follow it. i18n.jsx wraps this in a provider so the screen re-renders when it changes. English is the default
 * and the key: a string with no Kannada entry simply shows in English. */
const KEY = "sw-lang";
let current = "en";

export const readLang = () => {
  try {
    return localStorage.getItem(KEY) === "kn" ? "kn" : "en";
  } catch {
    return "en";
  }
};
current = readLang();

export const getLang = () => current;
export const isKn = () => current === "kn";
export const setLangValue = (lang) => {
  current = lang === "kn" ? "kn" : "en";
  try {
    localStorage.setItem(KEY, current);
  } catch {
    /* storage can be blocked; the choice then lasts for this visit only */
  }
};

/** Translate an English string. {name} placeholders are filled from vars. */
export function tr(text, vars) {
  let out = current === "kn" && KN[text] != null ? KN[text] : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return out;
}

export const trCat = (name) => (current === "kn" && KN_CATEGORIES[name]) || name;
