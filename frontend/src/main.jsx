import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { LangProvider } from "./i18n.jsx";
import { prewarm } from "./engine.js";
import { _getState, initStore } from "./store.js";
import "./fonts.css";
import "./styles.css";

initStore().then(() => {
  // If there is already data here, the charts need Python: start loading it while the page draws.
  if (!import.meta.env.VITE_API_BASE && _getState().transactions.length) prewarm();
  return createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </React.StrictMode>
  );
});
