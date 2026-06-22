from enum import Enum
from typing import List, Optional
from pydantic import BaseModel


class SupportedLanguage(str, Enum):
    ENGLISH    = "English"
    SPANISH    = "Spanish"
    FRENCH     = "French"
    CHINESE    = "Chinese"
    ARABIC     = "Arabic"
    GERMAN     = "German"
    ITALIAN    = "Italian"
    JAPANESE   = "Japanese"
    HINDI      = "Hindi"


class ChatRequest(BaseModel):
    message: str
    language: SupportedLanguage = SupportedLanguage.ENGLISH
    session_id: Optional[str] = None
    # Optional: client re-sends PII-scrubbed doc context so chat works even if server session is lost
    document_context: Optional[str] = None


class ChatResponse(BaseModel):
    success: bool
    response: str
    session_id: str
    language: str


class DocumentAnalysisRequest(BaseModel):
    filename: str
    content: str
    language: SupportedLanguage = SupportedLanguage.ENGLISH
    session_id: Optional[str] = None


class DocumentAnalysisResponse(BaseModel):
    success: bool
    summary: str
    deadlines: List[str]
    required_actions: List[str]
    document_type: str
    confidence: float
    pii_detected: bool
    language: str
    # PII-scrubbed extracted text returned to client so it can re-inject on chat requests
    document_context: Optional[str] = None
    # Rich optional fields
    timeline: Optional[str] = None
    recommendations: Optional[List[str]] = None
    potential_benefits: Optional[List[str]] = None
    consequences_if_ignored: Optional[str] = None
    appeal_rights: Optional[str] = None
    what_they_are_asking_you_to_do: Optional[List[str]] = None
    what_you_must_provide_or_submit: Optional[List[str]] = None
    urgency_level: Optional[str] = None          # "critical" | "high" | "medium" | "low"
    urgency_actions: Optional[List[str]] = None  # immediate steps if urgent


class ErrorResponse(BaseModel):
    error: str


class FeedbackRequest(BaseModel):
    session_id: str
    rating: int
    comment: Optional[str] = None


class TranslateRequest(BaseModel):
    text: str
    language: str  # plain string so any target language works


class TranslateBatchRequest(BaseModel):
    texts: List[str]
    language: str
