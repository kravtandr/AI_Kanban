import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

# Make sure a developer's real keys/endpoints never leak into tests.
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["LLM_PROVIDER"] = "anthropic"
os.environ["OPENAI_BASE_URL"] = ""
os.environ["OPENAI_API_KEY"] = ""
os.environ["OPENAI_MODEL"] = ""
os.environ["MCP_TOKEN"] = ""
os.environ["ADMIN_USERNAME"] = ""
os.environ["ADMIN_PASSWORD"] = ""
os.environ["WHISPER_BASE_URL"] = ""

from app import db as db_module  # noqa: E402
from app.bootstrap import init_db  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.models import Base, Task  # noqa: E402
from app.services import analytics  # noqa: E402
from app.services.auth import create_user, reset_rate_limiter  # noqa: E402
from app.services.projects import get_inbox  # noqa: E402

USERNAME = "andrew"
PASSWORD = "correct-horse-battery"


def _install_unicode_lower(engine) -> None:
    """Научить SQLite приводить регистр не только в ASCII.

    Встроенный `lower()` в SQLite работает только с ASCII: `lower('Сварог')`
    возвращает 'Сварог' как есть. Регистронезависимый поиск проектов
    (find_project_by_name, проверка уникальности в create_project) сравнивает
    SQL-овский lower() с приведённой в Python строкой, поэтому на SQLite он
    не находил НИ ОДНО кириллическое имя — даже при точном совпадении.
    В проде на PostgreSQL lower() знает про UTF-8 и всё работает, то есть
    расходились не продукт с ожиданием, а тесты с продом: ветка «нашёл
    существующий проект» проверялась только на латинице.
    """

    @event.listens_for(engine, "connect")
    def _register(dbapi_connection, _record):  # pragma: no cover - обвязка соединения
        dbapi_connection.create_function(
            "lower", 1, lambda value: value.lower() if isinstance(value, str) else value
        )


def _enforce_foreign_keys(engine) -> None:
    """SQLite по умолчанию НЕ проверяет внешние ключи. Без этого ни один
    ON DELETE CASCADE в репозитории не проверяется тестами: сломанный каскад даёт
    зелёный CI, а потом молча и навсегда убивает ежедневную чистку. Тот же класс
    расхождения теста с продом, который уже закрывает _install_unicode_lower."""

    @event.listens_for(engine, "connect")
    def _register(dbapi_connection, _record):  # pragma: no cover - обвязка соединения
        dbapi_connection.execute("PRAGMA foreign_keys=ON")


# --- Сторож непрослеженных записей состояния (§5.4 п.3) ---------------------
# Только в тестах: никакого action-at-a-distance в рантайме.

_PENDING: dict[Session, list[Task]] = {}
_untracked_writes_allowed = False


@event.listens_for(Session, "before_flush")
def _collect_touched_tasks(session, _flush_context, _instances):
    """Чистый СБОРЩИК: ничего не сверяет и никогда не падает.

    session.new обязателен наравне с session.dirty: только что созданная задача
    в dirty не появляется НИКОГДА, а именно рождение — первая точка входа (§2.4).
    У неё id ещё None, поэтому она запоминается по идентичности объекта, а id
    резолвится уже на разборе, после коммита.
    """
    touched = _PENDING.setdefault(session, [])
    for obj in (*session.dirty, *session.new):
        if isinstance(obj, Task) and not any(obj is seen for seen in touched):
            touched.append(obj)


@event.listens_for(Session, "after_rollback")
def _forget_touched_tasks(session):
    """Откат отменяет и накопленное.

    Без этого объекты не дошедшей до БД транзакции дожили бы до следующего
    коммита той же сессии и были бы проверены против состояния, которого нет.
    """
    _PENDING.pop(session, None)


@event.listens_for(Session, "after_commit")
def _assert_journal_agrees(session):
    """Проверка ИНВАРИАНТА после коммита, в ОТДЕЛЬНОЙ сессии.

    Своя сессия обязательна: state_matches эмитит SELECT, а на коммитящей сессии
    это запрещено (InvalidRequestError на ПЕРВОМ же коммите). before_flush тоже
    не годится — autoflush срабатывает раньше, чем событие записано, так что
    проверка там падала бы на 100% рождений, включая образцовые (§5.4 п.3).
    """
    pending = _PENDING.pop(session, [])
    if not pending or _untracked_writes_allowed:
        return
    ids = [task.id for task in pending if task.id is not None]
    with Session(bind=session.get_bind()) as probe:
        for task_id in ids:
            task = probe.get(Task, task_id)
            assert task is None or analytics.state_matches(probe, task), (
                f"untracked write: task {task_id}"
            )


@pytest.fixture()
def untracked_writes_allowed():
    """Снимает сторожа на время блока.

    Единственный способ выключить проверку. Под ней идут тесты, портящие
    состояние НАМЕРЕННО: самозалечивание (§13.3) и сверка (§13.4). Без явного
    исключения сторож запрещал бы ровно те сценарии, ради которых существуют
    п. 1 и 2 §5.4.
    """
    global _untracked_writes_allowed
    _untracked_writes_allowed = True
    try:
        yield
    finally:
        _untracked_writes_allowed = False


@pytest.fixture()
def client() -> TestClient:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    _install_unicode_lower(engine)
    _enforce_foreign_keys(engine)
    Base.metadata.create_all(engine)
    db_module.set_engine_for_tests(engine)
    get_settings.cache_clear()
    reset_rate_limiter()
    # lifespan в тестах не запускается (§13.1), поэтому боевая инициализация
    # вызывается напрямую. Идёт после cache_clear(): init_db() читает настройки.
    init_db()

    with db_module.get_session_factory()() as db:
        create_user(db, USERNAME, PASSWORD)
        get_inbox(db)

    from app.main import create_app

    return TestClient(create_app())


@pytest.fixture()
def auth_client(client: TestClient) -> TestClient:
    response = client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return client
