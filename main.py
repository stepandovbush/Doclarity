import io
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

# Load .env before any service module imports read os.getenv()
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# Set SSL cert path so easyocr model downloads work on macOS without system certs
try:
    import certifi
    os.environ.setdefault('SSL_CERT_FILE', certifi.where())
    os.environ.setdefault('REQUESTS_CA_BUNDLE', certifi.where())
except ImportError:
    pass

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ── Security layer ─────────────────────────────────────────────────────────
from middleware.rate_limiter import RateLimitMiddleware, rate_limit_dependency
from middleware.sanitize_input import sanitize
from middleware.validation import (
    ChatRequest,
    ChatResponse,
    DocumentAnalysisRequest,
    DocumentAnalysisResponse,
    ErrorResponse,
    FeedbackRequest,
    TranslateRequest,
    TranslateBatchRequest,
    SupportedLanguage,
)
from services.secure_ai import secure_chat_request, secure_document_analysis, prepare_session_context, analyze_file_bytes, openai_ocr, translate_text, translate_batch
from services.session import SessionStore
from utils.config import get_settings
from utils.logger import log_error, log_event, log_request, new_request_id

_settings = get_settings()
_sessions = SessionStore.get()


# ── Startup / shutdown ─────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    log_event("startup", env=_settings.app_env)
    # Warm dataset cache at startup so first request isn't slow
    from services.dataset import DatasetStore
    DatasetStore.get()
    yield
    log_event("shutdown")


# ── App ────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Doclarity AI",
    description="Helps immigrants understand government documents.",
    version="2.0.0",
    docs_url=None if _settings.is_production else "/docs",
    redoc_url=None if _settings.is_production else "/redoc",
    openapi_url=None if _settings.is_production else "/openapi.json",
    lifespan=lifespan,
)


# ── Middleware stack (order matters — outermost first) ─────────────────────

app.add_middleware(RateLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        ["*"] if not _settings.is_production
        else ["https://your-production-domain.com"]  # ← update for production
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Session-Id"],
)


# ── Request timing middleware ──────────────────────────────────────────────

@app.middleware("http")
async def request_logger_middleware(request: Request, call_next):
    request_id = new_request_id()
    request.state.request_id = request_id
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = (time.monotonic() - start) * 1000
    ip = request.client.host if request.client else "unknown"
    log_request(
        request_id=request_id,
        endpoint=request.url.path,
        method=request.method,
        ip=ip,
        status=response.status_code,
        duration_ms=duration_ms,
    )
    response.headers["X-Request-Id"] = request_id
    return response


# ── Global exception handler ───────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", "?")
    log_error(exc, context="unhandled_exception", request_id=request_id)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=ErrorResponse(error="An internal error occurred.").model_dump(),
    )


# ═══════════════════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/", tags=["Health"])
@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "service": "Doclarity AI"}


# ──────────────────────────────────────────────────────────────────────────
# /chat  — main chatbot endpoint
# Accepts: {"message": "...", "language": "Spanish", "session_id": "..."}
# Frontend only sends "message" — language and session_id are optional.
# ──────────────────────────────────────────────────────────────────────────

@app.post(
    "/chat",
    response_model=ChatResponse,
    dependencies=[Depends(rate_limit_dependency)],
    tags=["Chat"],
)
async def chat(
    body: ChatRequest,
    request: Request,
):
    request_id = getattr(request.state, "request_id", new_request_id())

    # Retrieve or create session
    session = _sessions.get_or_create(body.session_id)

    # Client always re-sends the full extracted text with every request (session-loss-proof).
    # Prefer client-provided context — it's the direct source. Fall back to session cache.
    doc_ctx = (body.document_context or "").strip() or (session.document_context or "").strip() or None
    # Keep session in sync so history-based answers also have context
    if doc_ctx:
        session.document_context = doc_ctx

    try:
        result = secure_chat_request(
            request=body,
            conversation_history=session.history.copy(),
            session_id=session.session_id,
            document_context=doc_ctx,
        )
    except Exception as e:
        log_error(e, context="chat_endpoint", request_id=request_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI service temporarily unavailable. Please try again.",
        )

    # Update session history (sanitized content only)
    san_message = sanitize(body.message).clean_text
    session.add_turn("user", san_message)
    session.add_turn("assistant", result.text)
    if result.document_type:
        session.document_type = result.document_type

    return ChatResponse(
        success=True,
        response=result.text,
        session_id=session.session_id,
        language=body.language.value,
    )


# ──────────────────────────────────────────────────────────────────────────
# /analyze  — document analysis
# ──────────────────────────────────────────────────────────────────────────

@app.post(
    "/analyze",
    response_model=DocumentAnalysisResponse,
    dependencies=[Depends(rate_limit_dependency)],
    tags=["Documents"],
)
async def analyze_document(
    body: DocumentAnalysisRequest,
    request: Request,
):
    request_id = getattr(request.state, "request_id", new_request_id())
    session = _sessions.get_or_create(body.session_id)

    try:
        result = secure_document_analysis(
            request=body,
            session_id=session.session_id,
        )
    except Exception as e:
        log_error(e, context="analyze_endpoint", request_id=request_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Document analysis failed. Please try again.",
        )

    # Store PII-scrubbed document context in session for follow-up questions
    # NOTE: bypass bleach (sanitize) here — it strips angle-bracket content from OCR'd docs.
    # prepare_session_context calls scrub_pii() which is sufficient for in-memory session data.
    scrubbed_ctx = prepare_session_context(body.content)
    session.document_context = scrubbed_ctx
    session.document_type = result.document_type

    return DocumentAnalysisResponse(
        success=True,
        summary=result.summary,
        deadlines=result.deadlines,
        required_actions=result.required_actions,
        document_type=result.document_type,
        confidence=result.confidence,
        pii_detected=result.pii_was_detected,
        language=body.language.value,
        document_context=scrubbed_ctx,   # returned so client can re-inject if session is lost
        timeline=getattr(result, 'timeline', None),
        recommendations=getattr(result, 'recommendations', None),
        potential_benefits=getattr(result, 'potential_benefits', None),
        consequences_if_ignored=getattr(result, 'consequences_if_ignored', None),
        appeal_rights=getattr(result, 'appeal_rights', None),
        what_they_are_asking_you_to_do=getattr(result, 'what_they_are_asking_you_to_do', None),
        what_you_must_provide_or_submit=getattr(result, 'what_you_must_provide_or_submit', None),
        urgency_level=getattr(result, 'urgency_level', 'low'),
        urgency_actions=getattr(result, 'urgency_actions', []),
    )


# ──────────────────────────────────────────────────────────────────────────
# /upload  — multipart file upload → extract text → analyze
# ──────────────────────────────────────────────────────────────────────────

@app.post(
    "/upload",
    response_model=DocumentAnalysisResponse,
    dependencies=[Depends(rate_limit_dependency)],
    tags=["Documents"],
)
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form(default="English"),
    session_id: Optional[str] = Form(default=None),
):
    request_id = getattr(request.state, "request_id", new_request_id())

    filename = file.filename or "unknown"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in _settings.allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f'File type ".{ext}" not allowed. Accepted: {", ".join(_settings.allowed_extensions)}',
        )

    raw_bytes = await file.read()
    max_bytes = _settings.max_file_size_mb * 1024 * 1024
    if len(raw_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {_settings.max_file_size_mb} MB limit.",
        )

    try:
        lang_enum = SupportedLanguage(language)
    except ValueError:
        lang_enum = SupportedLanguage.ENGLISH

    lang_str = lang_enum.value
    session = _sessions.get_or_create(session_id)

    # Step 1 — extract text from the file
    try:
        extracted_text = _extract_text(raw_bytes, ext, filename, lang_str)
    except Exception as e:
        log_error(e, context="text_extraction", request_id=request_id)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not read this file. Please try a clearer scan or a different format.",
        )

    if not extracted_text or len(extracted_text.strip()) < 20:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No readable text found in this file. For images, ensure the document is clear and well-lit.",
        )

    # Store PII-scrubbed extracted text in session immediately.
    # Every follow-up chat request re-sends this so context survives server restarts.
    scrubbed = prepare_session_context(extracted_text)
    session.document_context = scrubbed
    # Seed conversation history so the AI already "knows" the document from turn 1
    session.history = [
        {"role": "user",      "content": f"[Document uploaded: {filename}]\n\n{scrubbed}"},
        {"role": "assistant", "content": "I have received and read your document in full. Ask me anything about it."},
    ]

    # Step 2 — send extracted text to Groq for structured analysis
    doc_request = DocumentAnalysisRequest(
        filename=filename,
        content=extracted_text,
        language=lang_enum,
        session_id=session.session_id,
    )
    return await analyze_document(body=doc_request, request=request)


# EasyOCR reader cached at module level — initialization takes 30-60s and must only happen once
_easyocr_reader = None

def _get_easyocr_reader():
    global _easyocr_reader
    if _easyocr_reader is None:
        try:
            import certifi, os as _os
            _os.environ.setdefault("SSL_CERT_FILE", certifi.where())
            import easyocr
            _easyocr_reader = easyocr.Reader(['en'], gpu=False, verbose=False)
        except Exception:
            pass
    return _easyocr_reader


def _ocr_image_bytes(raw: bytes, mime_type: str, lang_str: str) -> str:
    """
    Extract text from image bytes using a three-tier OCR pipeline:
      1. EasyOCR  — pure-Python, no system binary required (reader cached globally)
      2. Pytesseract — if tesseract binary is installed
      3. Groq Vision  — cloud OCR fallback (always available)
    Returns the best non-empty result.
    """
    import io as _io
    from PIL import Image

    img = Image.open(_io.BytesIO(raw)).convert("RGB")

    # Tier 1 — EasyOCR (reader is cached; no re-initialization cost after first use)
    try:
        import numpy as _np
        reader = _get_easyocr_reader()
        if reader is not None:
            results = reader.readtext(_np.array(img), detail=0, paragraph=True)
            text = "\n".join(results).strip()
            if len(text) >= 30:
                return text
    except Exception:
        pass

    # Tier 2 — Pytesseract (requires tesseract binary)
    try:
        import pytesseract
        text = pytesseract.image_to_string(img).strip()
        if len(text) >= 30:
            return text
    except Exception:
        pass

    # Tier 3 — Groq Vision OCR (cloud, always available)
    return openai_ocr(raw, mime_type, lang_str)


def _extract_text(raw: bytes, ext: str, filename: str, lang_str: str = "English") -> str:
    """
    Extract plain text from any supported file type.
      txt / docx  → direct decode
      pdf         → pdfplumber text layer → per-page image OCR for scanned pages
      image       → EasyOCR → pytesseract → Groq Vision
    """
    import io as _io

    # ── Plain text ─────────────────────────────────────────────────────────────
    if ext == "txt":
        return raw.decode("utf-8", errors="replace")

    # ── Word document ──────────────────────────────────────────────────────────
    if ext in ("doc", "docx"):
        try:
            import docx2txt, tempfile, os as _os
            with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
                tmp.write(raw)
                tmp_path = tmp.name
            try:
                return docx2txt.process(tmp_path) or ""
            finally:
                _os.unlink(tmp_path)
        except Exception:
            return raw.decode("utf-8", errors="replace")

    # ── PDF ────────────────────────────────────────────────────────────────────
    if ext == "pdf":
        pages_text: list[str] = []
        try:
            import pdfplumber
            with pdfplumber.open(_io.BytesIO(raw)) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text() or ""
                    if len(page_text.strip()) >= 20:
                        pages_text.append(page_text.strip())
                    else:
                        # Scanned page — render to image and OCR it
                        try:
                            img = page.to_image(resolution=200).original
                            img_bytes = _io.BytesIO()
                            img.save(img_bytes, format="PNG")
                            ocr_text = _ocr_image_bytes(img_bytes.getvalue(), "image/png", lang_str)
                            if ocr_text.strip():
                                pages_text.append(ocr_text.strip())
                        except Exception:
                            pass
        except Exception:
            pass

        combined = "\n\n".join(pages_text).strip()
        if len(combined) >= 20:
            return combined

        # Last resort — send entire PDF bytes to Groq Vision
        return openai_ocr(raw, "application/pdf", lang_str)

    # ── Images ─────────────────────────────────────────────────────────────────
    if ext in ("png", "jpg", "jpeg", "webp"):
        mime = {
            "png": "image/png", "jpg": "image/jpeg",
            "jpeg": "image/jpeg", "webp": "image/webp",
        }.get(ext, "image/jpeg")
        return _ocr_image_bytes(raw, mime, lang_str)

    # Fallback for unknown types
    return raw.decode("utf-8", errors="replace")



# ──────────────────────────────────────────────────────────────────────────
# /feedback  — user rates a response
# ──────────────────────────────────────────────────────────────────────────

@app.post("/feedback", tags=["Feedback"])
async def submit_feedback(body: FeedbackRequest, request: Request):
    request_id = getattr(request.state, "request_id", new_request_id())
    # Log rating only — never log the comment content (may contain PII)
    log_event(
        "user_feedback",
        session_id=body.session_id,
        rating=str(body.rating),
        has_comment=str(body.comment is not None),
        request_id=request_id,
    )
    return {"success": True, "message": "Thank you for your feedback."}


# ──────────────────────────────────────────────────────────────────────────
# /session/clear  — clear session history
# ──────────────────────────────────────────────────────────────────────────

@app.post("/translate", tags=["Translate"])
async def translate(body: TranslateRequest):
    # Stateless: translate already-displayed text into the target language.
    # No document content is stored or logged.
    return {"text": translate_text(body.text, body.language)}


@app.post("/translate_batch", tags=["Translate"])
async def translate_batch_endpoint(body: TranslateBatchRequest):
    # Translate many displayed snippets in a single call for speed.
    return {"texts": translate_batch(body.texts, body.language)}


@app.post("/session/clear", tags=["Session"])
async def clear_session(session_id: str):
    session = _sessions.get_session(session_id)
    if session:
        session.history.clear()
        session.document_context = None
    return {"success": True}


# ── Dev entrypoint ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=not _settings.is_production,
        log_level=_settings.log_level.lower(),
    )
