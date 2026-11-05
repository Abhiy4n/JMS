import re
import time
import uuid


REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


class RequestTimingMiddleware:
    """Attach a safe correlation ID and total application timing to responses."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        supplied_id = request.headers.get("X-Request-ID", "")
        request_id = supplied_id if REQUEST_ID_PATTERN.fullmatch(supplied_id) else str(uuid.uuid4())
        request.request_id = request_id
        started_at = time.perf_counter()
        response = self.get_response(request)
        duration_ms = (time.perf_counter() - started_at) * 1000
        response["X-Request-ID"] = request_id
        response["Server-Timing"] = f"app;dur={duration_ms:.2f}"
        return response
