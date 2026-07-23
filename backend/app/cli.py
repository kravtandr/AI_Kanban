"""Admin CLI: create users and API/MCP tokens.

Usage:
    python -m app.cli create-user <username>            # prompts for password
    python -m app.cli create-token <name> --kind mcp    # prints token once
"""

import argparse
import getpass
import sys

from app.bootstrap import init_db
from app.db import get_session_factory
from app.models import TokenKind
from app.services.auth import AuthError, create_api_token, create_user


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tasktracker")
    sub = parser.add_subparsers(dest="command", required=True)

    p_user = sub.add_parser("create-user")
    p_user.add_argument("username")

    p_token = sub.add_parser("create-token")
    p_token.add_argument("name")
    p_token.add_argument("--kind", choices=["mcp", "api"], default="mcp")

    args = parser.parse_args(argv)
    init_db()

    with get_session_factory()() as db:
        if args.command == "create-user":
            password = getpass.getpass("Password: ")
            if len(password) < 8:
                print("Password must be at least 8 characters", file=sys.stderr)
                return 1
            try:
                create_user(db, args.username, password)
            except AuthError as exc:
                print(str(exc), file=sys.stderr)
                return 1
            print(f"User '{args.username}' created")
        elif args.command == "create-token":
            token = create_api_token(db, args.name, TokenKind(args.kind))
            print(f"Token '{args.name}' ({args.kind}) created. Save it now — it is shown once:")
            print(token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
