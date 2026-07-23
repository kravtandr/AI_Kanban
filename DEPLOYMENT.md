# DEPLOYMENT.md — runbook деплоя TaskTracker

**Статус: BLOCKED** — недостающие факты владельца:
1. адрес/имя домашнего сервера и способ доступа к нему (ssh);
2. заполненный `.env` (секреты: `POSTGRES_PASSWORD`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`);
3. решение HTTP vs `tls internal` в LAN (см. ADR-0004).

После выполнения пунктов и первого успешного прогона по этому ранбуку статус меняется
на READY. Деплой выполняется только вручную владельцем или по его явному запросу;
setup и CI никогда не деплоят. Пред-условие любого деплоя: `make verify` (PASS) на
точной деплоящейся ревизии.

## Требования к серверу

- Docker + docker compose plugin, git.
- Открытые внутрь LAN порты 80 (и 443, если включён TLS). Наружу — ничего (ADR-0004).

## Первый деплой

```bash
git clone <repo-url> tasktracker && cd tasktracker
cp .env.example .env
# заполнить .env (секреты!), при желании поменять ANTHROPIC_MODEL
docker compose up -d --build
```

Проверка:

```bash
curl -fsS http://localhost/healthz          # {"ok":true}
docker compose ps                            # все сервисы healthy/running
docker compose logs app | tail -20           # "Created initial admin user" при первом старте
```

Открыть `http://<server>/` с любого устройства в LAN → страница входа → доска.

## MCP-токен для агентов

```bash
docker compose exec app python -m app.cli create-token claude-code --kind mcp
# токен печатается один раз — сохранить
```

Конфигурация клиента (Claude Code): endpoint `http://<server>/mcp`,
transport streamable-http, header `Authorization: Bearer <token>`.

## Обновление

```bash
git pull
make verify        # обязательный гейт перед деплоем
docker compose up -d --build
curl -fsS http://localhost/healthz
```

## Откат

```bash
git checkout <предыдущий-известный-хороший-тег-или-SHA>
docker compose up -d --build
```

Схема БД создаётся идемпотентно (`create_all`, без деструктивных изменений) — откат
кода безопасен для данных. При будущем переходе на Alembic сюда добавляется
`alembic downgrade`.

## Бэкапы

- Сервис `backup` делает ежедневный `pg_dump | gzip` в `./backups/`, ротация 14 дней.
- Проверка: `ls -lh backups/` — свежий файл датой не старше суток.

Восстановление:

```bash
docker compose stop app
gunzip -c backups/tasktracker-YYYY-MM-DD.sql.gz | \
  docker compose exec -T postgres psql -U tasktracker -d tasktracker
docker compose start app
```

## Диагностика

| Симптом | Действие |
|---|---|
| 502 от Caddy | `docker compose logs app` — приложение не поднялось |
| Логин не работает | проверить `ADMIN_USERNAME/ADMIN_PASSWORD` в `.env`; лог первого старта |
| AI-функции «недоступны» | `ANTHROPIC_API_KEY` в `.env`; это штатная деградация, CRUD работает |
| MCP 401 | токен отозван/не создан — создать новый через CLI |
