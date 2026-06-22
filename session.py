from typing import Dict, List, Optional
import uuid

class Session:
    def __init__(self, session_id: Optional[str] = None):
        self.session_id = session_id if session_id else str(uuid.uuid4())
        self.history: List[Dict[str, str]] = []
        self.document_context: Optional[str] = None
        self.document_type: Optional[str] = None

    def add_turn(self, role: str, message: str):
        self.history.append({"role": role, "content": message})

class SessionStore:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SessionStore, cls).__new__(cls)
            cls._instance._sessions: Dict[str, Session] = {}
        return cls._instance

    @classmethod
    def get(cls):
        return cls._instance or cls.__new__(cls)

    def get_session(self, session_id: str) -> Optional[Session]:
        return self._sessions.get(session_id)

    def get_or_create(self, session_id: Optional[str]) -> Session:
        if session_id and session_id in self._sessions:
            return self._sessions[session_id]
        new_session = Session(session_id)
        self._sessions[new_session.session_id] = new_session
        return new_session
