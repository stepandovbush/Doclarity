import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_env: str = os.getenv("APP_ENV", "development")
    is_production: bool = app_env == "production"
    
    # AI API Keys
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    
    # Application Config
    max_file_size_mb: int = 10
    allowed_extensions: list = ["txt", "pdf", "docx", "png", "jpg", "jpeg"]
    log_level: str = "INFO"

    class Config:
        env_file = ".env"

def get_settings():
    return Settings()
