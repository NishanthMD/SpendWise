/* The statement reader and the sums behind the charts. By default they run in the browser (py.worker.js); set
 * VITE_API_BASE to use a SpendWise server instead (see api.js). */
let worker = null;
const pending = new Map();
let nextId = 1;
let status = { phase: "idle", detail: "" };
const listeners = new Set();

const setStatus = (s) => {
  status = s;
  listeners.forEach((fn) => fn(status));
};
export const getStatus = () => status;
export const onStatus = (fn) => (listeners.add(fn), () => listeners.delete(fn));

function start() {
  if (worker) return worker;
  worker = new Worker(new URL("./py.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "status") return setStatus({ phase: data.phase, detail: data.detail || "" });
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.ok) p.resolve(data.result);
    else p.reject(Object.assign(new Error(data.message), { status: data.status }));
  };
  worker.onerror = () => {
    setStatus({ phase: "error", detail: "" });
    pending.forEach((p) => p.reject(new Error("The statement reader stopped unexpectedly. Reload the page and try again.")));
    pending.clear();
    worker = null;
  };
  return worker;
}

/** Run one operation in the worker. `file` (an ArrayBuffer) is moved, not copied. */
export function run(op, payload, file) {
  const w = start();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, op, payload, file }, file ? [file] : []);
  });
}

/** Start loading Python in the background, so it is ready by the time it is needed. */
export function prewarm() {
  if (status.phase === "idle") run("warm").catch(() => {});
}
