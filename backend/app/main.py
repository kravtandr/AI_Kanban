import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

import anyio
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api import ai, auth, projects, tasks
from app.bootstrap import init_db
from app.config import get_settings
from app.db import get_session_factory
from app.mcp_server import mcp
from app.models import TokenKind
from app.security import tokens_equal
from app.services import tasks as task_service
from app.services.auth import verify_api_token

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

PURGE_INTERVAL_SECONDS = 86400

CSP = (
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class SpaStaticFiles(StaticFiles):
    """Serve the SPA build; unknown paths fall back to index.html so that
    client-side routes (/login, /board) survive a full page load. Unknown
    /api/* paths are an exception: they get a JSON 404, not the SPA shell."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        if path == "api" or path.startswith("api/"):
            return JSONResponse(
                {"error": {"code": "not_found", "message": "Not found"}}, status_code=404
            )
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise
        if response.status_code == 404:
            response = await super().get_response("index.html", scope)
        return response


class McpPathNormalizer:
    """Rewrite /mcp -> /mcp/ so MCP clients are not bounced with a 307 redirect
    (Starlette's Mount only matches the trailing-slash form)."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path") == "/mcp":
            scope = dict(scope, path="/mcp/")
        await self.app(scope, receive, send)


class SecurityHeaders:
    """NFR-3: baseline security headers on every HTTP response. HSTS is added
    only when the deployment actually serves HTTPS (COOKIE_SECURE=true)."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "same-origin"
                headers["Content-Security-Policy"] = CSP
                if get_settings().cookie_secure:
                    headers["Strict-Transport-Security"] = "max-age=31536000"
            await send(message)

        await self.app(scope, receive, send_with_headers)


class CsrfOriginCheck:
    """NFR-3: cross-origin write protection for the cookie-authenticated API.

    For unsafe methods on /api/*: when an Origin header is present, its host
    must match the request Host, otherwise 403. A missing Origin is allowed
    (curl, Bearer-token API clients). /mcp is Bearer-only and is not checked.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope.get("method", "").upper() in UNSAFE_METHODS
            and scope.get("path", "").startswith("/api/")
        ):
            headers = Headers(scope=scope)
            origin = headers.get("origin")
            if origin:
                origin_host = (urlsplit(origin).hostname or "").lower()
                request_host = (headers.get("host") or "").split(":")[0].lower()
                if origin_host != request_host:
                    response = JSONResponse(
                        {"error": {"code": "csrf", "message": "Cross-origin request rejected"}},
                        status_code=403,
                    )
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)


class McpTokenAuth:
    """ASGI wrapper: require a valid Bearer token for everything under /mcp."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        auth_header = headers.get(b"authorization", b"").decode()
        token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
        # The DB lookup is synchronous; keep it off the event loop.
        if not token or not await anyio.to_thread.run_sync(self._token_valid, token):
            response = JSONResponse(
                {"error": {"code": "unauthorized", "message": "Valid MCP token required"}},
                status_code=401,
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)

    @staticmethod
    def _token_valid(token: str) -> bool:
        static_token = get_settings().mcp_token
        if static_token and tokens_equal(token, static_token):
            return True
        with get_session_factory()() as db:
            return verify_api_token(db, token, TokenKind.mcp)


def _purge_deleted_tasks_once() -> None:
    with get_session_factory()() as db:
        purged = task_service.purge_deleted_tasks(db)
    if purged:
        log.info("Purged %d task(s) soft-deleted more than 30 days ago", purged)


async def _purge_loop() -> None:
    """Daily cleanup (NFR-4): hard-delete tasks soft-deleted >30 days ago."""
    while True:
        try:
            await anyio.to_thread.run_sync(_purge_deleted_tasks_once)
        except Exception:
            log.exception("Deleted-task purge failed")
        await asyncio.sleep(PURGE_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    purge_task = asyncio.create_task(_purge_loop())
    try:
        async with mcp.session_manager.run():
            yield
    finally:
        purge_task.cancel()


def create_app() -> FastAPI:
    app = FastAPI(title="TaskTracker", lifespan=lifespan)

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True}

    for router in (auth.router, projects.router, tasks.router, ai.router):
        app.include_router(router, prefix="/api/v1")

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        return JSONResponse(
            {"error": {"code": "internal", "message": "Internal server error"}}, status_code=500
        )

    # MCP: Streamable HTTP endpoint at /mcp, Bearer-token protected.
    mcp.settings.streamable_http_path = "/"
    app.mount("/mcp", McpTokenAuth(mcp.streamable_http_app()))
    app.add_middleware(McpPathNormalizer)
    app.add_middleware(CsrfOriginCheck)
    app.add_middleware(SecurityHeaders)

    # Frontend SPA build (present in the Docker image; absent in pure-API dev runs).
    if STATIC_DIR.is_dir():
        app.mount("/", SpaStaticFiles(directory=STATIC_DIR, html=True), name="static")

    return app


app = create_app()
