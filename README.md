# TaskTracker

AI-native персональный таск-трекер: общая канбан-доска, проекты, LLM-оформление задач
(Claude API) и собственный MCP-сервер для AI-агентов. Деплой — docker compose на
домашнем сервере, только локальная сеть.

- Требования и функционал: [SPEC.md](SPEC.md)
- Правила для AI-агентов и quality gates: [AGENTS.md](AGENTS.md)
- Архитектурные решения: [docs/adr/](docs/adr/)
- Деплой: [DEPLOYMENT.md](DEPLOYMENT.md)

## Разработка

Требуются `uv` и Node.js 20+ (для прод-сборки — docker compose).

```bash
make setup        # зависимости backend + frontend
make dev          # backend на :8000 (uv run uvicorn --reload)
cd frontend && npm run dev   # SPA на :5173 c proxy /api -> :8000
```

Первый пользователь: `cd backend && uv run python -m app.cli create-user <name>`
(или переменные `ADMIN_USERNAME`/`ADMIN_PASSWORD` при первом старте).

## Quality gates

```bash
make verify       # lint → test → build (обязателен перед merge/deploy)
```

Подробности и статусы гейтов — в [AGENTS.md](AGENTS.md).

## Прод

См. [DEPLOYMENT.md](DEPLOYMENT.md): `cp .env.example .env` → заполнить →
`docker compose up -d --build` → `http://<server>/`.

MCP для агентов: `http://<server>/mcp` (streamable HTTP) с Bearer-токеном,
созданным через `python -m app.cli create-token <name> --kind mcp`.
