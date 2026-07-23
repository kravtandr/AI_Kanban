# ADR-0002: Технологический стек

- **Статус**: accepted (утверждено владельцем 2026-07-22)
- **Дата**: 2026-07-22

## Контекст

Нужен стек для персонального AI-native трекера: REST API, канбан-SPA, LLM-пайплайн,
MCP-сервер, деплой одним compose на домашнем сервере.

## Решение

- **Backend**: Python 3.12, FastAPI, SQLAlchemy 2 (sync), Pydantic v2, uv.
- **Frontend**: React 18 + TypeScript, Vite, TanStack Query, dnd-kit, Tailwind CSS v4.
- **БД**: PostgreSQL 16 (prod), SQLite (dev/тесты — модели совместимы).
- **MCP**: официальный python SDK (`mcp`, FastMCP), Streamable HTTP, смонтирован в то же
  FastAPI-приложение → один сервисный слой для REST и MCP.
- **LLM**: официальный SDK `anthropic`, structured outputs (`messages.parse` + Pydantic).
- **Деплой**: Docker Compose (postgres, app, caddy, backup), multi-stage Dockerfile.

## Альтернативы

- Next.js full-stack — отклонено владельцем: Python-бэкенд единый с LLM/MCP-экосистемой.
- Async SQLAlchemy — отложено: sync проще, нагрузка одного пользователя не требует async БД.

## Последствия

- Миграции: MVP использует идемпотентный `create_all` на старте; **Alembic вводится при
  первом изменении схемы** (это осознанное упрощение MVP).
- Поиск: LIKE-поиск (совместим с SQLite); полнотекстовый tsvector — при необходимости позже.
- Теги хранятся JSON-колонкой вместо отдельной таблицы `task_tags` из SPEC §7 — упрощение,
  достаточное для объёмов одного пользователя.
