"""Startup initialization: create tables, ensure Inbox project and admin user.

MVP uses idempotent `create_all` instead of Alembic migrations; Alembic will be
introduced with the first schema change (recorded in ADR-0002).
"""

import logging

from sqlalchemy import select

from app.config import get_settings
from app.db import get_engine, get_session_factory
from app.models import Base, User
from app.services.auth import create_user
from app.services.projects import ensure_unique_project_colors, get_inbox

log = logging.getLogger(__name__)


def init_db() -> None:
    Base.metadata.create_all(get_engine())
    settings = get_settings()
    with get_session_factory()() as db:
        get_inbox(db)
        ensure_unique_project_colors(db)
        if db.scalar(select(User).limit(1)) is None:
            if settings.admin_username and settings.admin_password:
                create_user(db, settings.admin_username, settings.admin_password)
                log.info("Created initial admin user '%s'", settings.admin_username)
            else:
                log.warning(
                    "No users exist and ADMIN_USERNAME/ADMIN_PASSWORD are not set; "
                    "create a user via `python -m app.cli create-user <name>`"
                )
