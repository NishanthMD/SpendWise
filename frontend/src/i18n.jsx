import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getLang, readLang, setLangValue, tr, trCat } from "./lang.js";

const Ctx = createContext(null);

/** English / Kannada. Kannada mode also switches the whole site to the red and yellow Rajyotsava theme (data-lang="kn"). */
export function LangProvider({ children }) {
  const [lang, setLangState] = useState(readLang);
  const [sweep, setSweep] = useState(null); // the language a glass panel is currently sweeping towards
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // Switching language: a glass panel slides across the screen, and the words and colours change underneath it.
  const setLang = (next) => {
    if (next === lang || sweep) return;
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLangState(next);
      return;
    }
    setSweep(next);
    timers.current = [
      setTimeout(() => {
        setLangState(next);
      }, 430),
      setTimeout(() => setSweep(null), 1100),
    ];
  };
  // Set before children render, so helpers like rupee() and monthLabel() already see the new language.
  if (getLang() !== lang) setLangValue(lang);
  useEffect(() => {
    setLangValue(lang);
    const el = document.documentElement;
    el.lang = lang;
    el.dataset.lang = lang;
  }, [lang]);
  const value = useMemo(() => ({ lang, shown: sweep || lang, setLang, kn: lang === "kn", t: tr, cat: trCat }), [lang, sweep]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {sweep && <div className={"lang-sweep to-" + sweep} aria-hidden="true" />}
    </Ctx.Provider>
  );
}

export const useLang = () => useContext(Ctx);
