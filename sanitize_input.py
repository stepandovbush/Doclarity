import bleach
from pydantic import BaseModel

class SanitizedText(BaseModel):
    original_text: str
    clean_text: str

def sanitize(text: str) -> SanitizedText:
    """Sanitize input text to prevent XSS and other injection attacks."""
    if not text:
        return SanitizedText(original_text="", clean_text="")
    
    # Use bleach to strip unwanted HTML tags and attributes
    clean_text = bleach.clean(text, tags=[], attributes={}, strip=True)
    
    return SanitizedText(original_text=text, clean_text=clean_text)
