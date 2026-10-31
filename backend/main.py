"""SpendWise API (optional). Run:  uvicorn main:app --reload --port 8000

The website does NOT need this: by default it runs the very same code (core/api.py) inside the browser. This FastAPI
wrapper exists for local development and for anyone who prefers to host the reader on a server. It is STATELESS: no
database, no accounts; every request carries the data it needs, and nothing is written to disk or shared between people.
"""
from __future__ import annotations

import json
import os
import tempfile
from typing import Optional

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from core import api

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_BODY_BYTES = 30 * 1024 * 1024

app = FastAPI(title="SpendWise", docs_url=None, redoc_url=None, openapi_url=None)
# Where the website is served from. Set SPENDWISE_ORIGINS="https://your-site.pages.dev,https://your.domain" in production.
_origins = [o.strip() for o in os.getenv("SPENDWISE_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["GET", "POST"], allow_headers=["*"])


@app.middleware("http")
async def limits_and_headers(request: Request, call_next):
    size = request.headers.get("content-length")
    if size and size.isdigit() and int(size) > MAX_BODY_BYTES:
        return JSONResponse({"detail": "That request is too large."}, status_code=413)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else response.headers.get("Cache-Control", "")
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def _run(fn, *args):
    try:
        return fn(*args)
    except api.ApiError as e:
        raise HTTPException(e.status, e.message)


@app.post("/api/parse")
async def parse(file: UploadFile = File(...), password: Optional[str] = Form(None), bank: Optional[str] = Form(None),
                account_type: Optional[str] = Form(None), overrides: Optional[str] = Form(None),
                saved_merchants: Optional[str] = Form(None)):
    """Read a statement PDF from a temporary file that is deleted at once; nothing is stored."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Please upload a PDF bank statement.")
    try:
        ov = json.loads(overrides) if overrides else {}
        saved = json.loads(saved_merchants) if saved_merchants else []
    except ValueError:
        raise HTTPException(400, "Could not read the remembered choices sent with the statement.")
    size = 0
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        path = tmp.name
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                tmp.close()
                os.unlink(path)
                raise HTTPException(413, "That PDF is larger than 20 MB. Download a shorter date range from your bank.")
            tmp.write(chunk)
    try:
        return _run(api.parse_pdf, path, password, bank, account_type, ov, saved)
    finally:
        os.unlink(path)


@app.get("/api/banks")
def bank_list():
    return api.bank_list()


@app.get("/api/categories")
def categories():
    return api.category_list()


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/passbook")
def passbook(body: dict = Body(...)):
    return _run(api.passbook, body)


@app.post("/api/summary")
def summary(body: dict = Body(...)):
    return _run(api.summary, body)


@app.post("/api/average-daily")
def average_daily(body: dict = Body(...)):
    return _run(api.average_daily, body)


@app.post("/api/report")
def report(body: dict = Body(...)):
    pdf = _run(api.report, body)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="spending-report.pdf"'})


# After `npm run build`, this server also serves the built website, so one process is enough for local use.
_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")
