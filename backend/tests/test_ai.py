from datetime import date

from sqlalchemy.exc import IntegrityError

from app import db as db_module
from app.schemas import TaskDraft
from app.services import ai as ai_svc
from app.services import projects as project_svc


def test_draft_degrades_without_llm(auth_client):
    """FR-5.5: with no API key the draft falls back to the raw text."""
    response = auth_client.post("/api/v1/ai/draft", json={"text": "починить бэкап на NAS"})
    assert response.status_code == 200
    body = response.json()
    assert body["ai_ok"] is False
    assert body["draft"]["title"] == "починить бэкап на NAS"
    inbox = next(p for p in auth_client.get("/api/v1/projects").json() if p["is_inbox"])
    assert body["project_id"] == inbox["id"]


def test_draft_with_mocked_llm(auth_client, monkeypatch):
    auth_client.post("/api/v1/projects", json={"name": "Homelab"})
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    def fake_call(system: str, user_message: str):
        assert "Homelab" in user_message  # project list is provided to the model
        draft = TaskDraft(
            title="Починить бэкап на NAS",
            description="- [ ] проверить cron\n- [ ] запустить вручную",
            project="Homelab",
            priority="high",
            tags=["homelab"],
            due_date=date(2026, 7, 24),
        )
        return draft, 100, 50

    monkeypatch.setattr(ai_svc, "_call_model", fake_call)

    body = auth_client.post(
        "/api/v1/ai/draft", json={"text": "починить бэкап на NAS до пятницы"}
    ).json()
    assert body["ai_ok"] is True
    assert body["draft"]["project"] == "Homelab"
    projects = {p["name"]: p["id"] for p in auth_client.get("/api/v1/projects").json()}
    assert body["project_id"] == projects["Homelab"]

    get_settings.cache_clear()


def test_draft_auto_creates_project(auth_client, monkeypatch):
    """FR-5.4: a project proposed by the LLM is created with its description."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    def fake_call(system: str, user_message: str):
        draft = TaskDraft(
            title="Записаться к стоматологу",
            project="Здоровье",
            project_description="Врачи, анализы, спорт и всё про самочувствие",
            priority="medium",
        )
        return draft, 100, 50

    monkeypatch.setattr(ai_svc, "_call_model", fake_call)

    body = auth_client.post("/api/v1/ai/draft", json={"text": "зуб болит надо к врачу"}).json()
    assert body["ai_ok"] is True
    projects = {p["name"]: p for p in auth_client.get("/api/v1/projects").json()}
    assert "Здоровье" in projects
    assert body["project_id"] == projects["Здоровье"]["id"]
    assert projects["Здоровье"]["description"] == "Врачи, анализы, спорт и всё про самочувствие"

    get_settings.cache_clear()


def test_draft_backfills_empty_description(auth_client, monkeypatch):
    """FR-5.4: LLM fills in a missing description but never rewrites an existing one."""
    auth_client.post("/api/v1/projects", json={"name": "Homelab"})
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    def fake_call(system: str, user_message: str):
        draft = TaskDraft(
            title="Починить бэкап",
            project="Homelab",
            project_description="Домашний сервер, NAS, сеть и self-hosted сервисы",
        )
        return draft, 100, 50

    monkeypatch.setattr(ai_svc, "_call_model", fake_call)

    auth_client.post("/api/v1/ai/draft", json={"text": "бэкап на NAS сломался"})
    projects = {p["name"]: p for p in auth_client.get("/api/v1/projects").json()}
    assert projects["Homelab"]["description"] == "Домашний сервер, NAS, сеть и self-hosted сервисы"

    # a user-written description stays untouched
    auth_client.patch(
        f"/api/v1/projects/{projects['Homelab']['id']}", json={"description": "моё описание"}
    )
    auth_client.post("/api/v1/ai/draft", json={"text": "ещё одна задача про NAS"})
    projects = {p["name"]: p for p in auth_client.get("/api/v1/projects").json()}
    assert projects["Homelab"]["description"] == "моё описание"

    get_settings.cache_clear()


def test_llm_error_degrades(auth_client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    def broken_call(system: str, user_message: str):
        raise RuntimeError("api down")

    monkeypatch.setattr(ai_svc, "_call_model", broken_call)

    body = auth_client.post("/api/v1/ai/draft", json={"text": "buy milk"}).json()
    assert body["ai_ok"] is False
    assert body["draft"]["title"] == "buy milk"

    get_settings.cache_clear()


def test_enhance_not_found(auth_client):
    assert auth_client.post("/api/v1/ai/enhance/9999").status_code == 404


def test_resolve_whitespace_project_name_falls_back_to_inbox(client):
    """A blank/whitespace LLM project name maps to Inbox and creates nothing."""
    with db_module.get_session_factory()() as db:
        inbox_id = project_svc.get_inbox(db).id
        before = len(project_svc.list_projects(db, include_archived=True))
        assert ai_svc.resolve_project_id(db, "   ") == inbox_id
        assert ai_svc.resolve_project_id(db, None) == inbox_id
        assert len(project_svc.list_projects(db, include_archived=True)) == before


def test_resolve_create_race_returns_existing_project(client, monkeypatch):
    """If create_project loses a race, the concurrently created project wins, not Inbox."""
    with db_module.get_session_factory()() as db:
        inbox_id = project_svc.get_inbox(db).id

    real_create = project_svc.create_project

    def racy_create(db, name, color="#6b7280", description=""):
        # Simulate a concurrent insert winning just before our INSERT lands.
        real_create(db, name=name, color=color, description=description)
        raise IntegrityError("INSERT INTO projects", {}, Exception("duplicate key"))

    monkeypatch.setattr(ai_svc, "create_project", racy_create)

    with db_module.get_session_factory()() as db:
        project_id = ai_svc.resolve_project_id(db, "Homelab", "NAS и self-hosted")
        assert project_id != inbox_id
        found = project_svc.find_project_by_name(db, "Homelab")
        assert found is not None
        assert found.id == project_id


def test_enhance_does_not_create_projects_or_touch_descriptions(auth_client, monkeypatch):
    """FR-5.3: enhance is a preview — no project creation, no description backfill."""
    auth_client.post("/api/v1/projects", json={"name": "Homelab"})  # empty description
    task = auth_client.post("/api/v1/tasks", json={"title": "fix nas"}).json()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    def suggest_new_project(system: str, user_message: str):
        draft = TaskDraft(
            title="Fix NAS backup", project="Новый проект", project_description="что-то"
        )
        return draft, 10, 5

    monkeypatch.setattr(ai_svc, "_call_model", suggest_new_project)
    body = auth_client.post(f"/api/v1/ai/enhance/{task['id']}").json()
    assert body["ai_ok"] is True
    # Unknown project suggestion: keep the task's current project, create nothing.
    assert body["project_id"] == task["project_id"]
    names = [p["name"] for p in auth_client.get("/api/v1/projects").json()]
    assert "Новый проект" not in names

    def suggest_existing_project(system: str, user_message: str):
        draft = TaskDraft(
            title="Fix NAS backup", project="Homelab", project_description="backfill attempt"
        )
        return draft, 10, 5

    monkeypatch.setattr(ai_svc, "_call_model", suggest_existing_project)
    body = auth_client.post(f"/api/v1/ai/enhance/{task['id']}").json()
    projects = {p["name"]: p for p in auth_client.get("/api/v1/projects").json()}
    # Existing project maps to its id, but its empty description is untouched.
    assert body["project_id"] == projects["Homelab"]["id"]
    assert projects["Homelab"]["description"] == ""

    get_settings.cache_clear()


def test_backfill_never_touches_inbox(auth_client, monkeypatch):
    """The system Inbox never gets an LLM-written description."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    def fake_call(system: str, user_message: str):
        draft = TaskDraft(
            title="Разобрать входящие", project="Inbox", project_description="LLM description"
        )
        return draft, 10, 5

    monkeypatch.setattr(ai_svc, "_call_model", fake_call)

    body = auth_client.post("/api/v1/ai/draft", json={"text": "разобрать входящие"}).json()
    inbox = next(p for p in auth_client.get("/api/v1/projects").json() if p["is_inbox"])
    assert body["project_id"] == inbox["id"]
    assert inbox["description"] == ""

    get_settings.cache_clear()


def test_project_context_excludes_inbox(client):
    """Inbox — fallback, а не вариант выбора: в индексе для LLM его быть не должно.

    Пока он там был, слабая локальная модель выбирала его как единственный
    знакомый вариант, и все задачи оседали в Inbox (см. спеку, раздел 3).
    """
    with db_module.get_session_factory()() as db:
        context = ai_svc._project_context(db)
    assert "Inbox" not in context
    assert "Projects:\n(none yet)" in context


def test_project_context_lists_real_projects_without_inbox(auth_client):
    auth_client.post("/api/v1/projects", json={"name": "Сварог", "description": "Платформа Сварог"})
    with db_module.get_session_factory()() as db:
        context = ai_svc._project_context(db)
    assert "- Сварог — Платформа Сварог" in context
    assert "Inbox" not in context


def test_project_context_marks_project_without_description(auth_client):
    auth_client.post("/api/v1/projects", json={"name": "Дом"})
    with db_module.get_session_factory()() as db:
        context = ai_svc._project_context(db)
    assert "- Дом (no description yet)" in context


def test_system_prompt_forbids_catch_all_project_names():
    """Правило A2: модель не должна отвечать именем fallback-корзины."""
    assert "never" in ai_svc.SYSTEM_PROMPT
    assert '"Inbox"' in ai_svc.SYSTEM_PROMPT
    assert "transliteration" in ai_svc.SYSTEM_PROMPT
