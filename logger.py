import uuid
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("DoclarityAI")

def new_request_id() -> str:
    return str(uuid.uuid4())

def log_event(event_type: str, **kwargs):
    logger.info(f"Event: {event_type} | Data: {kwargs}")

def log_request(request_id: str, endpoint: str, method: str, ip: str, status: int, duration_ms: float):
    logger.info(f"Request: {request_id} | {method} {endpoint} | IP: {ip} | Status: {status} | Duration: {duration_ms:.2f}ms")

def log_error(exc: Exception, context: str, request_id: str):
    logger.error(f"Error: {request_id} | Context: {context} | Exception: {str(exc)}")
