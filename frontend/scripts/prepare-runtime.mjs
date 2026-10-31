// Downloads the in-browser Python runtime (Pyodide plus the PDF libraries) and copies the Python code, so the website can
// read statements on the visitor's own device. Everything is pinned in runtime.lock.json and checked against its SHA-256.
//   node scripts/prepare-runtime.mjs            fetch what is missing (runs before dev and build)
//   node scripts/prepare-runtime.mjs --update   re-resolve versions and rewrite runtime.lock.json
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = join(root, "runtime.lock.json");
const OUT = join(root, "public", "pyodide");
const PY = join(root, "public", "py");
const CORE = resolve(root, "..", "backend", "core");

const PYODIDE_VERSION = "314.0.7";
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const CORE_FILES = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
// What the app needs from Pyodide's own package set (their dependencies are added automatically).
const PYODIDE_PACKAGES = ["micropip", "pillow", "cryptography", "charset-normalizer"];
// Pure-Python wheels from PyPI (pdfplumber's optional image library, pypdfium2, is replaced by a stub: we never render pages).
const PYPI = { "pdfminer.six": "20260107", pdfplumber: "0.11.10", reportlab: "5.1.0" };

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function resolveLock() {
  const files = [];
  for (const name of CORE_FILES) {
    const buf = await get(CDN + name);
    files.push({ name, url: CDN + name, sha256: sha256(buf), size: buf.length });
    if (name === "pyodide-lock.json") var lock = JSON.parse(buf.toString());
  }
  const want = new Set();
  const visit = (p) => {
    if (want.has(p)) return;
    if (!lock.packages[p]) throw new Error(`Pyodide has no package ${p}`);
    want.add(p);
    lock.packages[p].depends.forEach(visit);
  };
  PYODIDE_PACKAGES.forEach(visit);
  for (const p of want) {
    const { file_name, sha256: h } = lock.packages[p];
    files.push({ name: file_name, url: CDN + file_name, sha256: h });
  }
  for (const [pkg, ver] of Object.entries(PYPI)) {
    const meta = JSON.parse((await get(`https://pypi.org/pypi/${pkg}/${ver}/json`)).toString());
    const wheel = meta.urls.find((u) => u.packagetype === "bdist_wheel" && u.filename.endsWith("py3-none-any.whl"));
    if (!wheel) throw new Error(`No pure-Python wheel for ${pkg} ${ver}`);
    files.push({ name: wheel.filename, url: wheel.url, sha256: wheel.digests.sha256 });
  }
  writeFileSync(LOCK, JSON.stringify({ pyodide: PYODIDE_VERSION, files }, null, 2) + "\n");
  console.log(`runtime.lock.json written (${files.length} files)`);
  return files;
}

async function ensureFiles(files) {
  mkdirSync(OUT, { recursive: true });
  for (const f of files) {
    const path = join(OUT, f.name);
    if (existsSync(path) && sha256(readFileSync(path)) === f.sha256) continue;
    process.stdout.write(`fetching ${f.name} … `);
    const buf = await get(f.url);
    if (sha256(buf) !== f.sha256) throw new Error(`${f.name}: checksum mismatch, refusing to use it`);
    writeFileSync(path, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  }
}

function copyPython() {
  rmSync(join(PY, "core"), { recursive: true, force: true });
  mkdirSync(join(PY, "core"), { recursive: true });
  const names = readdirSync(CORE).filter((n) => n.endsWith(".py"));
  names.forEach((n) => copyFileSync(join(CORE, n), join(PY, "core", n)));
  writeFileSync(join(PY, "manifest.json"), JSON.stringify({ core: names }) + "\n");
  console.log(`copied ${names.length} Python files`);
}

const files = process.argv.includes("--update") || !existsSync(LOCK) ? await resolveLock() : JSON.parse(readFileSync(LOCK, "utf8")).files;
await ensureFiles(files);
copyPython();
// "packages" come from Pyodide's own set (loaded by name); "pypi" wheels are installed from this site with micropip.
const runtime = { pyodide: PYODIDE_VERSION, packages: PYODIDE_PACKAGES, pypi: files.filter((f) => !f.url.startsWith(CDN)).map((f) => f.name) };
writeFileSync(join(PY, "runtime.json"), JSON.stringify(runtime) + "\n");
console.log("runtime ready");
