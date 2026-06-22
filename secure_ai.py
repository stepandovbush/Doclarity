"""
Doclarity AI — Groq integration
Government document expert system with PII protection
"""
import base64
import json
import os
import re
import time
from typing import Optional

from groq import Groq

# ── Client ──────────────────────────────────────────────────────────────────

_client = Groq(api_key=os.getenv("GROQ_API_KEY", ""))

CHAT_MODEL    = "llama-3.1-8b-instant"
ANALYZE_MODEL = "llama-3.1-8b-instant"
VISION_MODEL  = "meta-llama/llama-4-scout-17b-16e-instruct"


def _groq_call(messages: list, max_tokens: int = 2048, temperature: float = 0.2,
               model: str = CHAT_MODEL) -> str:
    """Call Groq with automatic retry on rate limits."""
    last_exc = None
    for attempt in range(4):
        try:
            resp = _client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            last_exc = e
            msg = str(e)
            if "429" in msg or "rate_limit" in msg.lower():
                time.sleep((attempt + 1) * 3)
                continue
            raise
    raise last_exc


# ── PII scrubbing ─────────────────────────────────────────────────────────────

_PII_PATTERNS = [
    (re.compile(r'\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b'), '[SSN REDACTED]'),
    (re.compile(r'\b\d{2}-\d{7}\b'), '[EIN REDACTED]'),
    (re.compile(r'\b(?:\d[ -]?){13,16}\b'), '[CARD REDACTED]'),
    (re.compile(r'\b[A-Z]{1,2}\d{6,9}\b'), '[PASSPORT REDACTED]'),
    (re.compile(r'\bA[-\s]?\d{8,9}\b', re.IGNORECASE), '[A-NUMBER REDACTED]'),
    (re.compile(r'\b\d{8,17}\b'), '[ACCT REDACTED]'),
    (re.compile(r'\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b'), '[PHONE REDACTED]'),
    (re.compile(r'\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b'), '[EMAIL REDACTED]'),
    (re.compile(r'(?:date of birth|dob|born)[:\s]+\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}', re.IGNORECASE), '[DOB REDACTED]'),
]

def scrub_pii(text: str) -> str:
    for pattern, replacement in _PII_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


# ── System prompts (two modes) ────────────────────────────────────────────────

# Used when NO document is in session — general-purpose helpful chatbot
_SYSTEM_NO_DOC = """You are Doclarity AI — a knowledgeable AI assistant specializing in immigration, tax, and government benefits. Answer any question the user asks.

- Be direct, clear, and helpful.
- Draw on deep expertise: USCIS forms, IRS notices, SSA/Medicaid/SNAP eligibility, housing rights, FAFSA/PSLF.
- NEVER say "no document is provided" or ask the user to upload anything.
- NEVER repeat SSNs, A-numbers, or full account numbers.

End responses involving legal rights or deadlines with:
"⚠️ This is guidance, not legal advice. For your specific situation, consult a qualified immigration attorney, DOJ-accredited representative, or certified tax professional."
"""

# Used when a document IS available — document text is embedded directly below the system prompt
_SYSTEM_WITH_DOC = """You are Doclarity AI — a government document expert. The user has uploaded a document. Its full text is provided below between the markers ===DOCUMENT START=== and ===DOCUMENT END===.

YOUR JOB:
- Read every word of the document text below.
- Answer ALL questions using ONLY the facts in that document.
- If the user says "summarize", give a complete summary of what the document says.
- If the user asks about a deadline, find and state the exact date and consequence.
- If the user asks what they need to do, list every required action from the document.
- NEVER say there is no document. There IS a document — it is right below.
- NEVER invent information not in the document.
- NEVER repeat full SSNs, A-numbers, passport numbers, or account numbers.

End responses involving legal rights or deadlines with:
"⚠️ This is guidance, not legal advice. For your specific situation, consult a qualified immigration attorney, DOJ-accredited representative, or certified tax professional."
"""


# ── Return types ─────────────────────────────────────────────────────────────

class SecureChatResult:
    def __init__(self, text: str, document_type: Optional[str] = None):
        self.text = text
        self.document_type = document_type


class SecureDocumentAnalysisResult:
    def __init__(self, summary, deadlines, required_actions, document_type,
                 confidence, pii_was_detected, timeline=None, recommendations=None,
                 potential_benefits=None, what_they_are_asking_you_to_do=None,
                 what_you_must_provide_or_submit=None,
                 urgency_level=None, urgency_actions=None):
        self.summary = summary
        self.deadlines = deadlines
        self.required_actions = required_actions
        self.document_type = document_type
        self.confidence = confidence
        self.pii_was_detected = pii_was_detected
        self.timeline = timeline or ""
        self.recommendations = recommendations or []
        self.potential_benefits = potential_benefits or []
        self.what_they_are_asking_you_to_do = what_they_are_asking_you_to_do or []
        self.what_you_must_provide_or_submit = what_you_must_provide_or_submit or []
        self.urgency_level = urgency_level or "low"
        self.urgency_actions = urgency_actions or []


# ── Chat ──────────────────────────────────────────────────────────────────────

def secure_chat_request(request, conversation_history: list, session_id: str,
                        document_context: Optional[str] = None) -> SecureChatResult:

    has_doc = bool(document_context and document_context.strip())

    if has_doc:
        system = (
            _SYSTEM_WITH_DOC
            + f"\n\n===DOCUMENT START===\n{document_context[:8000]}\n===DOCUMENT END==="
        )
    else:
        system = _SYSTEM_NO_DOC

    messages = [{"role": "system", "content": system}]
    for turn in conversation_history[-20:]:
        role = "assistant" if turn.get("role") in ("assistant", "bot") else "user"
        content = turn.get("content", "")
        if content:
            messages.append({"role": role, "content": content})

    lang = getattr(request, 'language', None)
    lang_str = lang.value if hasattr(lang, 'value') else str(lang) if lang else "English"
    messages.append({"role": "user", "content": f"{request.message}\n\n[Respond in: {lang_str}]"})

    text = _groq_call(messages, max_tokens=2500, temperature=0.2)
    return SecureChatResult(text=text)


# ── Document analysis ─────────────────────────────────────────────────────────

def secure_document_analysis(request, session_id: str) -> SecureDocumentAnalysisResult:

    lang = getattr(request, 'language', None)
    lang_str = lang.value if hasattr(lang, 'value') else str(lang) if lang else "English"

    raw_content = (request.content or "").strip()
    if not raw_content or len(raw_content) < 20:
        raise ValueError(
            f"Document text is empty or too short ({len(raw_content)} chars). "
            "Extraction must be fixed before analysis can proceed."
        )

    scrubbed_content = scrub_pii(raw_content[:8000])
    pii_found = scrubbed_content != raw_content[:8000]

    analysis_prompt = f"""You are a senior government document specialist. A real document has been uploaded and its full text is provided below. Read every single word carefully and return a JSON analysis based ONLY on what is actually written in the document.

DOCUMENT:
{scrubbed_content}
END OF DOCUMENT

Return a JSON object with EXACTLY this structure. Use only facts from the text — do not invent anything.

{{
  "document_type": "Exact document name/number and full issuing agency name",
  "summary": "2-3 plain-language sentences: who sent this, what it asks the recipient to do, and the consequence if they do not act.",
  "what_they_are_asking_you_to_do": ["Every specific action the document requires — exact language, form numbers, dates"],
  "what_you_must_provide_or_submit": ["Every specific form, document, or item that must be filed or submitted"],
  "deadlines": ["DEADLINE: [exact date] — [what must be done] — [exact consequence if missed]"],
  "required_actions": ["Step 1 (most urgent): [specific action with exact form numbers, address, phone]", "Step 2: ..."],
  "timeline": "Exact timeline from the document",
  "recommendations": ["Specific recommendation", "Free resource with contact info"],
  "potential_benefits": ["Any benefit or right the recipient may qualify for"],
  "consequences_if_ignored": "Exact consequence stated in the document",
  "appeal_rights": "Exact appeal process, deadline, and where to send",
  "urgency_level": "one of: critical (deadline within 7 days or risk of deportation/arrest/eviction), high (deadline within 30 days or major financial penalty), medium (deadline 30-90 days), low (no immediate deadline)",
  "urgency_actions": ["If urgency_level is critical or high: list 2-4 immediate concrete steps the person must take RIGHT NOW, with specific phone numbers or addresses where possible. If medium or low: leave this as an empty array []"],
  "confidence": 0.95,
  "pii_detected": {str(pii_found).lower()}
}}

Write all text fields in {lang_str}.
Return ONLY valid JSON. No markdown fences. No explanation outside the JSON."""

    messages = [
        {"role": "system", "content": _SYSTEM_WITH_DOC},
        {"role": "user", "content": analysis_prompt},
    ]
    raw = _groq_call(messages, max_tokens=3500, temperature=0.1, model=ANALYZE_MODEL)

    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.rsplit("```", 1)[0].strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        data = {}
        if match:
            try:
                data = json.loads(match.group())
            except Exception:
                pass

    return SecureDocumentAnalysisResult(
        summary=data.get("summary", "This document requires your attention. Please review it carefully."),
        deadlines=data.get("deadlines", []),
        required_actions=data.get("required_actions", ["Read the document carefully", "Note any deadlines", "Respond before the deadline"]),
        document_type=data.get("document_type", "Government Document"),
        confidence=float(data.get("confidence", 0.8)),
        pii_was_detected=bool(data.get("pii_detected", pii_found)),
        timeline=data.get("timeline", ""),
        recommendations=data.get("recommendations", []),
        potential_benefits=data.get("potential_benefits", []),
        what_they_are_asking_you_to_do=data.get("what_they_are_asking_you_to_do", []),
        what_you_must_provide_or_submit=data.get("what_you_must_provide_or_submit", []),
        urgency_level=data.get("urgency_level", "low"),
        urgency_actions=data.get("urgency_actions", []),
    )


# ── Session context ───────────────────────────────────────────────────────────

def prepare_session_context(raw_content: str) -> str:
    return scrub_pii(raw_content[:7000])


# ── Translation (translate already-displayed text in place) ──────────────────

def translate_text(text: str, target_language: str) -> str:
    """Translate text into the target language, preserving any HTML tags,
    numbers, phone numbers, and dates exactly. Returns the original on failure."""
    if not text or not text.strip():
        return text
    if (target_language or "").strip().lower() in ("english", "en", ""):
        return text
    messages = [
        {"role": "system", "content": (
            f"You are a professional translator. Translate the user's text into {target_language}. "
            "Keep the meaning and tone. Preserve ALL HTML tags, line breaks, numbers, dollar amounts, "
            "phone numbers, dates, URLs, and email addresses exactly as they appear. "
            "Do not add explanations. Output ONLY the translated text."
        )},
        {"role": "user", "content": text},
    ]
    try:
        return _groq_call(messages, max_tokens=2000, temperature=0.1) or text
    except Exception:
        return text


def translate_batch(texts: list, target_language: str) -> list:
    """Translate many strings in ONE model call for speed. Returns a list the
    same length/order as the input; falls back to per-item on any failure."""
    if not texts:
        return list(texts)
    if (target_language or "").strip().lower() in ("english", "en", ""):
        return list(texts)
    payload = json.dumps(list(texts), ensure_ascii=False)
    messages = [
        {"role": "system", "content": (
            f"You are a professional translator. You receive a JSON array of strings. "
            f"Translate EACH string into {target_language}. Return ONLY a JSON array of the "
            "same length and order, where each element is the translated string. Preserve all "
            "HTML tags, numbers, dollar amounts, dates, phone numbers, URLs, and email addresses "
            "exactly. No commentary, no code fences."
        )},
        {"role": "user", "content": payload},
    ]
    try:
        raw = (_groq_call(messages, max_tokens=4096, temperature=0.1) or "").strip()
        start, end = raw.find("["), raw.rfind("]")
        if start != -1 and end != -1:
            arr = json.loads(raw[start:end + 1])
            if isinstance(arr, list) and len(arr) == len(texts):
                return [str(x) for x in arr]
    except Exception:
        pass
    # Reliable fallback — translate each item individually
    return [translate_text(t, target_language) for t in texts]


# ── Vision OCR (Groq vision for scanned PDFs/images) ─────────────────────────

def openai_ocr(raw_bytes: bytes, mime_type: str, lang_str: str) -> str:
    """Use Groq vision to extract all text from a scanned PDF or image."""
    b64 = base64.b64encode(raw_bytes).decode("utf-8")
    prompt = (
        "You are an OCR engine. Read every word, number, date, name, address, phone number, "
        "form number, and instruction visible in this document. Transcribe ALL text exactly as "
        "it appears, preserving structure. Do not summarize. Output only the transcribed text."
    )
    last_exc = None
    for attempt in range(3):
        try:
            resp = _client.chat.completions.create(
                model=VISION_MODEL,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
                        {"type": "text", "text": prompt},
                    ],
                }],
                max_tokens=4000,
                temperature=0.0,
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            last_exc = e
            msg = str(e)
            if "429" in msg or "rate_limit" in msg.lower():
                time.sleep((attempt + 1) * 3)
                continue
            raise
    raise last_exc


# ── analyze_file_bytes (kept for compatibility) ───────────────────────────────

def analyze_file_bytes(raw_bytes: bytes, ext: str, lang_str: str) -> SecureDocumentAnalysisResult:
    """Extract text via vision then analyze."""
    mime_map = {"pdf": "application/pdf", "png": "image/png",
                "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}
    mime_type = mime_map.get(ext.lower(), "image/jpeg")
    extracted = openai_ocr(raw_bytes, mime_type, lang_str)

    from middleware.validation import SupportedLanguage
    try:
        lang_enum = SupportedLanguage(lang_str)
    except ValueError:
        lang_enum = SupportedLanguage.ENGLISH

    class _Req:
        content = extracted
        language = lang_enum

    return secure_document_analysis(_Req(), session_id="")
