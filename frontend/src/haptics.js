/* A light tap when you switch options. Android and other browsers with the Vibration API get a short buzz; iPhones
 * (iOS 17.4+) give a tap when a hidden "switch" checkbox is toggled by a click. Desktop browsers simply do nothing. */
let label;
export function haptic() {
  try {
    if (navigator.vibrate && navigator.vibrate(8)) return;
    if (!label) {
      label = document.createElement("label");
      label.setAttribute("aria-hidden", "true");
      label.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.setAttribute("switch", "");
      label.appendChild(box);
      document.body.appendChild(label);
    }
    label.click();
  } catch {
    /* haptics are a nicety; never let them break a click */
  }
}
