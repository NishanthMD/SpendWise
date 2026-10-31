/* Runs the very same Python as the server (backend/core/) inside the browser, in a background thread, so a statement is read
 * on the visitor's own device and never uploaded anywhere. Pyodide (Python compiled to WebAssembly) and the PDF libraries
 * are files served by this site (see scripts/prepare-runtime.mjs); nothing is fetched from a third party. */
let py = null;
let booting = null;

// pdfplumber can draw page images with pypdfium2, a native library that cannot run here. SpendWise only reads text,
// so a stand-in module satisfies the import.
const STUB = `
import sys, types
m = types.ModuleType("pypdfium2")
class PdfiumError(Exception): pass
class PdfDocument:
    def __init__(self, *a, **k): raise PdfiumError("page images are not available in the browser")
m.PdfDocument = PdfDocument
m.PdfiumError = PdfiumError
m.__version__ = "0"
sys.modules["pypdfium2"] = m
`;

const GLUE = `
import json
from core import api

def parse_op(path, password, bank, account_type, overrides_json, saved_json):
    try:
        data = api.parse_pdf(path, password or None, bank or None, account_type or None, json.loads(overrides_json), json.loads(saved_json))
        return json.dumps({"ok": True, "result": data})
    except api.ApiError as e:
        return json.dumps({"ok": False, "status": e.status, "message": e.message})
    except Exception:
        return json.dumps({"ok": False, "status": 422, "message": "That statement could not be read. Is it a bank statement PDF with selectable text?"})

def report_op(payload_json):
    try:
        return {"ok": True, "pdf": api.report(json.loads(payload_json))}
    except api.ApiError as e:
        return {"ok": False, "status": e.status, "message": e.message}
`;

const say = (phase, detail) => self.postMessage({ type: "status", phase, detail });

async function boot() {
  say("loading", "Downloading the reader");
  const base = new URL("/pyodide/", self.location.origin).href;
  const runtime = await (await fetch("/py/runtime.json")).json();
  const { loadPyodide } = await import(/* @vite-ignore */ base + "pyodide.mjs");
  py = await loadPyodide({ indexURL: base });
  say("loading", "Starting Python");
  await py.loadPackage(runtime.packages);
  py.runPython(STUB);
  say("loading", "Installing the PDF tools");
  const micropip = py.pyimport("micropip");
  for (const wheel of runtime.pypi) await micropip.install.callKwargs(new URL(wheel, base).href, { deps: false }); // our wheels are pinned: no dependency lookups on the internet
  say("loading", "Loading the statement reader");
  const manifest = await (await fetch("/py/manifest.json")).json();
  py.FS.mkdirTree("/app/core");
  await Promise.all(
    manifest.core.map(async (name) => py.FS.writeFile(`/app/core/${name}`, new Uint8Array(await (await fetch(`/py/core/${name}`)).arrayBuffer())))
  );
  py.runPython("import sys; sys.path.insert(0, '/app')");
  py.runPython(GLUE);
  say("ready");
}

const fail = (status, message) => Object.assign(new Error(message), { status });

async function handle(op, payload, file) {
  const g = py.globals;
  if (op === "parse") {
    const path = "/tmp/statement.pdf";
    py.FS.writeFile(path, new Uint8Array(file));
    try {
      const out = JSON.parse(g.get("parse_op")(path, payload.password || "", payload.bank || "", payload.account_type || "", payload.overrides || "{}", payload.saved_merchants || "[]"));
      if (!out.ok) throw fail(out.status, out.message);
      return out.result;
    } finally {
      try {
        py.FS.unlink(path); // the statement exists only in this tab's memory, and only while it is being read
      } catch {
        /* already gone */
      }
    }
  }
  if (op === "report") {
    const proxy = g.get("report_op")(JSON.stringify(payload));
    const out = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy();
    if (!out.ok) throw fail(out.status, out.message);
    return out.pdf;
  }
  const api = py.pyimport("core.api");
  const out = JSON.parse(api.call(op, JSON.stringify(payload || {})));
  api.destroy();
  if (!out.ok) throw fail(out.status, out.message);
  return out.result;
}

self.onmessage = async ({ data }) => {
  const { id, op, payload, file } = data;
  try {
    booting ||= boot().catch((e) => {
      booting = null;
      console.error("SpendWise reader failed to start:", e);
      say("error", String(e && e.message ? e.message : e));
      throw fail(500, "The statement reader could not start in this browser. Try reloading the page.");
    });
    await booting;
    if (op === "warm") return self.postMessage({ id, ok: true, result: true });
    const result = await handle(op, payload, file);
    self.postMessage({ id, ok: true, result }, result instanceof Uint8Array ? [result.buffer] : []);
  } catch (e) {
    self.postMessage({ id, ok: false, status: e.status || 500, message: e.message || "Something went wrong." });
  }
};
