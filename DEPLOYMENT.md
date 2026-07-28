# DEPLOYMENT.md — runbook деплоя TaskTracker

**Статус: BLOCKED** — недостающие факты владельца:
1. адрес/имя домашнего сервера и способ доступа к нему (ssh);
2. заполненный `.env` (секреты: `POSTGRES_PASSWORD`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`);
3. ~~решение HTTP vs `tls internal` в LAN~~ — принято, см. ADR-0006 и раздел
   «HTTPS в LAN» ниже.

После выполнения пунктов и первого успешного прогона по этому ранбуку статус меняется
на READY. Деплой выполняется только вручную владельцем или по его явному запросу;
setup и CI никогда не деплоят. Пред-условие любого деплоя: `make verify` (PASS) на
точной деплоящейся ревизии.

## Требования к серверу

- Docker + docker compose plugin, git.
- Открытые внутрь LAN порты 80 и порт HTTPS-сайта из `TT_HTTPS_ADDR` (например 27183).
  Наружу — ничего (ADR-0004).

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

## HTTPS в LAN (обязателен для диктовки)

Голосовой ввод требует secure context: на странице, открытой по HTTP, браузер не даёт
доступ к микрофону. Настройка разовая (ADR-0006).

1. Задать адрес и включить Secure-куку в `.env`:

```
TT_HTTPS_ADDR=https://<ip-сервера>:27183
COOKIE_SECURE=true
APP_ENV=prod
```

2. Опубликовать порт у сервиса `caddy` (в host-специфичном
   `docker-compose.override.yml`, если он используется):

```yaml
services:
  caddy:
    ports:
      - "27183:27183"
```

3. Открыть порт в межсетевом экране, иначе сайт будет доступен только с самого
   сервера:

```bash
sudo ufw allow 27183/tcp
```

4. Поднять стек и забрать корневой сертификат внутреннего CA:

```bash
docker compose up -d
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
```

5. Установить `caddy-root.crt` на каждое устройство, с которого открывается трекер.
   На iOS: передать файл на устройство → Settings → Profile Downloaded → Install →
   затем **обязательно** Settings → General → About → Certificate Trust Settings →
   включить полное доверие. Без второго шага сертификат установлен, но не доверен.
   На Android: Settings → Security → Encryption & credentials → Install a certificate →
   CA certificate. На macOS: Keychain Access → System → импортировать → Always Trust.

Проверка:

```bash
curl -fsS --cacert caddy-root.crt https://<ip-сервера>:27183/healthz   # {"ok":true}
```

С устройства: открыть `https://<ip-сервера>:27183/` — замок без предупреждений, вход
работает, кнопка микрофона диктует.

HTTP-вход на :27182 остаётся рабочим для MCP-агентов: они авторизуются Bearer-токеном,
которому флаг Secure не мешает. UI по HTTP после `COOKIE_SECURE=true` не залогинится —
это ожидаемо.

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
| Кнопка микрофона говорит «требует HTTPS» | страница открыта по HTTP — зайти по адресу из `TT_HTTPS_ADDR` |
| Браузер ругается на сертификат | корневой сертификат CA не установлен или не доверен (на iOS — второй шаг в Certificate Trust Settings) |
| «Сервис распознавания недоступен» | `WHISPER_BASE_URL` в `.env`; проверить `curl -fsS $WHISPER_BASE_URL/health` из контейнера `app` |
