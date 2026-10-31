/* Runs before the first paint so the page opens in the right theme and language (no flash). Kept as a file, not inline,
 * so the site can use a strict Content-Security-Policy. */
(function () {
  try {
    var p = localStorage.getItem("sw-theme");
    var dark = p === "dark" || (p !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {}
  try {
    var kn = localStorage.getItem("sw-lang") === "kn";
    document.documentElement.dataset.lang = kn ? "kn" : "en";
    document.documentElement.lang = kn ? "kn" : "en";
  } catch (e) {}
})();
