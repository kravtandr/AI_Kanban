# Canonical quality-gate commands (referenced by AGENTS.md, pre-commit and CI).
# Requirements: uv (backend), Node.js 20+ (frontend), docker compose (build gate).

.PHONY: setup lint lint-backend lint-frontend test-fast test test-backend test-frontend build verify dev

setup:
	cd backend && uv sync
	cd frontend && npm ci --no-audit --no-fund

lint-backend:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app

lint-frontend:
	cd frontend && npm run lint

lint: lint-backend lint-frontend

test-fast:
	cd backend && uv run pytest -q -m "not slow"

test-backend:
	cd backend && uv run pytest -q

test-frontend:
	cd frontend && npm run test

test: test-backend test-frontend

build:
	docker compose build

verify: lint test build

dev:
	cd backend && uv run uvicorn app.main:app --reload --port 8000
