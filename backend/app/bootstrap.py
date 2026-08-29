"""Startup initialization: create tables, ensure Inbox project and admin user.

Schema is applied by an idempotent `create_all`, not by Alembic. ADR-0008 narrowed the
promise of ADR-0002: adding a NEW table is fully covered by `create_all` and does not
force Alembic, but the next change that touches an EXISTING table (a column, its type,
a constraint, an enum value) forces Alembic unconditionally, together with a migration
step in DEPLOYMENT.md.
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
