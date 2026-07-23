<!--
Provenance (vibe-coding-guidelines adoption):
  source_locator: https://github.com/kravtandr/vibe-coding-guidelines
  source_revision: 2ff8d73878e839a5eafe65369cf8f29fd326a204
  reference_release: v0.1.0
  templates_used: templates/AGENTS.md, AGENTS-GUIDE.md, DEPLOYMENT.md, templates/adr/0000-template.md
  setup_date: 2026-07-22
-->

# AGENTS.md — правила для AI-агентов в проекте TaskTracker

Единственный источник правил для всех кодинг-агентов (Claude Code и др.).
Не дублировать в других файлах. Требования и контекст продукта — в [SPEC.md](SPEC.md).

## Проект

AI-native канбан таск-трекер: FastAPI + PostgreSQL (backend/), React + TypeScript (frontend/),
собственный MCP-сервер на `/mcp`, LLM-пайплайн на Claude API. Один пользователь, деплой
docker compose на домашнем сервере только в локальной сети.

## Команды и quality gates

Требования окружения: `uv`, Node.js 20+, docker compose. Установка: `make setup`.

| Gate | Статус | Команда | Примечание |
|---|---|---|---|
| Setup | REQUIRED | `make setup` | uv sync + npm ci |
| Lint / static analysis | REQUIRED | `make lint` | ruff check + ruff format --check + mypy; tsc --noEmit |
| Fast tests | REQUIRED | `make test-fast` | pytest -m "not slow" |
| Full tests | REQUIRED | `make test` | pytest + vitest |
| Build | REQUIRED | `make build` | docker compose build |
| Verify | REQUIRED | `make verify` | lint → test → build, в этом порядке |
| Pre-commit | REQUIRED | `uv run pre-commit install` (из backend/) | конфиг: .pre-commit-config.yaml |
| CI | REQUIRED | .github/workflows/ci.yml | те же команды, frozen lockfiles |
| Merge protection | BLOCKED | — | требуется действие владельца: включить required check "verify" в настройках GitHub после публикации репозитория |

Команды точные и неинтерактивные; ненулевой код выхода = провал гейта.
Перед завершением работы агент обязан выполнить затронутые REQUIRED-гейты и
отчитаться точными командами, кодами выхода и релевантным выводом.

## Правила поведения

- **Preservation**: не перезаписывать и не откатывать несвязанные изменения пользователя;
  не заменять существующий механизм только потому, что параллельный проще создать.
- **Тесты обязательны** для нового/изменённого поведения. Багфиксы — с регрессионным
  тестом, падающим без фикса. LLM-вызовы в тестах только мокаются (`ai._call_model`);
  MCP-инструменты тестируются через `*_impl`-функции.
- Не ослаблять падающие гейты ради зелёного статуса; не использовать `--no-verify`.
- Секреты (`.env`, ключи API, токены) не попадают в git, логи и отчёты.
- Статусы в отчётах: COMPLETE / PARTIAL — external actions pending / PARTIAL — work
  blocked / BLOCKED / NO-OP; для гейтов PASS / FAIL / NOT_RUN. Не называть работу
  «done» при PARTIAL/BLOCKED.
- Не заявлять «CI зелёный» без наблюдения фактического прогона.

## ADR

Каталог: `docs/adr/`, шаблон `docs/adr/0000-template.md`, нумерация сквозная.
ADR обязателен ДО реализации при: новой зависимости, задающей политику; выборе/смене
фреймворка, БД, протокола; смене CI-провайдера; ломающих изменениях интерфейсов
(REST API v1, набор MCP-инструментов, схема БД).

Принятые: 0001 adoption, 0002 стек, 0003 авторизация, 0004 сетевая модель, 0005 LLM.

## Деплой

Только по runbook [DEPLOYMENT.md](DEPLOYMENT.md) и только при его статусе READY,
после прохождения `make verify` на точной ревизии. Прод-деплой — только по явному
запросу владельца. Setup и CI никогда не деплоят.
