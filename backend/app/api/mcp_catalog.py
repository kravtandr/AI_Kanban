from fastapi import APIRouter, Depends
from mcp.types import Tool

from app.api.deps import get_current_user
from app.mcp_server import mcp

router = APIRouter(prefix="/mcp", tags=["mcp"], dependencies=[Depends(get_current_user)])


@router.get("/tools", response_model_exclude_none=True)
async def list_tools() -> list[Tool]:
    return await mcp.list_tools()
