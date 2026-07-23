from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api import ai, auth, projects, tasks
from app.bootstrap import init_db
from app.config import get_settings
from app.db import get_session_factory
from app.mcp_server import mcp
from app.models import TokenKind
from app.security import tokens_equal
from app.services.auth import verify_api_token

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


class McpPathNormalizer:
    """Rewrite /mcp -> /mcp/ so MCP clients are not bounced with a 307 redirect
    (Starlette's Mount only matches the trailing-slash form)."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path") == "/mcp":
            scope = dict(scope, path="/mcp/")
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
        if not token or not self._token_valid(token):
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    async with mcp.session_manager.run():
        yield


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

    # Frontend SPA build (present in the Docker image; absent in pure-API dev runs).
    if STATIC_DIR.is_dir():
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

    return app


app = create_app()
