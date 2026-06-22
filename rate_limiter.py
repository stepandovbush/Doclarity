from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
import time

class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        # In a real app, use Redis or a similar store for distributed rate limiting
        self.request_counts = {}

    async def dispatch(self, request: Request, call_next):
        # Simple per-IP rate limiting
        client_ip = request.client.host if request.client else "unknown"
        current_time = time.time()
        
        # Cleanup old entries (simplistic)
        self.request_counts = {ip: count for ip, count in self.request_counts.items() if current_time - count['last_request'] < 60}
        
        if client_ip not in self.request_counts:
            self.request_counts[client_ip] = {'count': 1, 'last_request': current_time}
        else:
            self.request_counts[client_ip]['count'] += 1
            self.request_counts[client_ip]['last_request'] = current_time
            
            if self.request_counts[client_ip]['count'] > 100: # 100 requests per minute
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
        
        response = await call_next(request)
        return response

async def rate_limit_dependency(request: Request):
    # This can be used for more granular rate limiting on specific routes
    pass
