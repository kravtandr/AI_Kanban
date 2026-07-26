# Ручное переназначение проекта и починка автоиндекса — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователю сменить проект у задачи за одно нажатие и создать проект из UI, а AI — перестать складывать всё в Inbox.

**Architecture:** Бэкенд: три точечные правки в `app/services/ai.py` — Inbox исчезает из индекса проектов, отдаваемого LLM (fallback выражается через `project=null`), правило выбора проекта в системном промпте ужесточается, у self-hosted провайдера фиксируется `temperature=0`. Фронтенд: новое контекстное меню на карточке (`onContextMenu` покрывает правый клик, долгое нажатие и клавиатуру), логика пунктов и разбор 409 вынесены в чистый модуль, мутации живут в `BoardPage` рядом с существующими.

**Tech Stack:** FastAPI + SQLAlchemy + pytest; React 18 + TypeScript + @tanstack/react-query + @dnd-kit/core + Tailwind v4 + vitest.

**Спека:** [docs/superpowers/specs/2026-07-26-task-project-assignment-design.md](../specs/2026-07-26-task-project-assignment-design.md)

## Global Constraints

- Комментарии и сообщения коммитов — по-русски, в тон окружающему коду; комментарий объясняет «почему», а не «что».
- Новых runtime-зависимостей нет. Новые devDependencies добавляются только в Task 5.
- Тесты бэкенда не выходят в сеть: `ai._call_model` и `ai._openai_chat` мокаются (ADR-0005).
- Сессия в тестах бэкенда открывается как `db_module.get_session_factory()()`.
- После правки env-переменных в тесте обязателен `get_settings.cache_clear()` — до и после, как в существующих тестах.
- Секреты (`OPENAI_API_KEY`) не печатать ни в тестах, ни в логах.
- Финальный гейт перед завершением работы — `make verify` (Task 10). Внутри задач гоняются только затронутые тесты.
- Ветка: `feat/task-project-assignment` (уже создана, в ней лежит спека).

---

### Task 1: Inbox исчезает из индекса проектов + правило A2 в промпте

Корневая причина дефекта: `_project_context` отдаёт Inbox как полноправный вариант выбора, и слабая модель выбирает его. Правило промпта переписывается заодно, потому что оно ссылается на состав списка.

**Files:**
- Modify: `backend/app/services/ai.py:40-47` (правило `- Project:` в `SYSTEM_PROMPT`)
- Modify: `backend/app/services/ai.py:190-200` (`_project_context`)
- Test: `backend/tests/test_ai.py`

**Interfaces:**
- Consumes: `list_projects(db) -> list[tuple[Project, int]]`, `_sanitize_description(str | None) -> str` — обе уже есть в модуле.
- Produces: `_project_context(db: Session) -> str` — сигнатура не меняется, меняется содержимое: Inbox отсутствует, при отсутствии других проектов блок равен `"Projects:\n(none yet)"`.

- [ ] **Step 1: Написать падающие тесты**

В конец `backend/tests/test_ai.py`:

```python
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
    auth_client.post(
        "/api/v1/projects", json={"name": "Сварог", "description": "Платформа Сварог"}
    )
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
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd backend && uv run pytest tests/test_ai.py -k "project_context or system_prompt" -v`
Expected: FAIL — `test_project_context_excludes_inbox` падает на `assert "Inbox" not in context`, `test_system_prompt_forbids_catch_all_project_names` — на `assert '"Inbox"' in ai_svc.SYSTEM_PROMPT`.

- [ ] **Step 3: Убрать Inbox из индекса**

Заменить функцию `_project_context` в `backend/app/services/ai.py` целиком:

```python
def _project_context(db: Session) -> str:
    """Индекс проектов для категоризации (FR-2.1, FR-5.4).

    Inbox в список НЕ попадает: он не вариант выбора, а fallback. «Тема не
    распознана» модель выражает через project=null, который resolve_project_id
    и так маппит в Inbox. Пока Inbox был в списке, слабая локальная модель
    выбирала его как единственный знакомый вариант, и доска не наполнялась
    проектами вообще.
    """
    lines = []
    tag_vocab: set[str] = set()
    for project, _count in list_projects(db):
        if project.is_inbox:
            continue
        description = _sanitize_description(project.description)
        desc = f" — {description}" if description else " (no description yet)"
        lines.append(f"- {project.name}{desc}")
    for task in db.query(Task).filter(Task.deleted_at.is_(None)).limit(500):
        tag_vocab.update(task.tags or [])
    tags = ", ".join(sorted(tag_vocab)) or "(none yet)"
    projects_block = "\n".join(lines) if lines else "(none yet)"
    return f"Projects:\n{projects_block}\n\nExisting tags: {tags}"
```

- [ ] **Step 4: Заменить правило Project в системном промпте**

В `backend/app/services/ai.py` заменить блок правила (строки 40–43 исходника):

```
- Project: pick the best match from the provided project list, using each project's
  description to route even vague or badly worded notes. If no existing project fits,
  propose a NEW project: a short name (1-3 words, same language as the user's projects).
  Return null only for one-off tasks that belong to no recognisable theme.
```

на:

```
- Project: route the note to one of the listed projects ONLY IF the note clearly falls
  inside that project's stated scope — a shared technology or a vague topical overlap is
  NOT enough. Reuse a listed project's exact name (copy the name only, never the
  description) when the note refers to the same thing in another language or in
  transliteration (e.g. a note about "Svarog" belongs to an existing "Сварог").
  If no listed project clearly covers the note, you MUST propose a NEW project. Name it
  after the product, system or domain the work belongs to — never after the task itself.
  Use 1-3 words in the language of the note. The list never contains the fallback bucket,
  so never answer "Inbox", "Разное", "Misc" or any similar catch-all name.
  Return null ONLY for a one-off errand that belongs to no ongoing theme at all
  (e.g. "buy milk", "call mum back").
```

- [ ] **Step 5: Убедиться, что тесты проходят и старые не сломались**

Run: `cd backend && uv run pytest tests/test_ai.py tests/test_ai_openai.py -q`
Expected: PASS, все тесты файла.

- [ ] **Step 6: Коммит**

```bash
git add backend/app/services/ai.py backend/tests/test_ai.py
git commit -m "fix(ai): убрать Inbox из индекса проектов, ужесточить правило выбора

Замер на живой модели: «Сделать UI в свароге» уходило в Inbox 5 раз из 5,
потому что _project_context отдавал Inbox как вариант выбора, а других
проектов на доске не было. После правки — Сварог 5/5, а разовое «купить
молоко» даёт null 5/5, то есть проекты из поручений не плодятся."
```

---

### Task 2: temperature=0 у self-hosted провайдера

`_openai_chat` не задаёт `temperature` вообще, из-за чего имя нового проекта было разным в каждом прогоне (3–4 варианта за 5 попыток) и повторный черновик той же заметки плодил дубликаты проектов.

**Files:**
- Modify: `backend/app/services/ai.py:133-145` (тело `_openai_chat`)
- Test: `backend/tests/test_ai_openai.py`

**Interfaces:**
- Produces: `_openai_chat(system: str, user_message: str) -> tuple[str, int, int]` — сигнатура не меняется; в JSON-теле запроса появляется `"temperature": 0`.

- [ ] **Step 1: Написать падающий тест**

В конец `backend/tests/test_ai_openai.py`:

```python
def test_openai_chat_pins_temperature_to_zero(monkeypatch):
    """Без temperature=0 имя нового проекта меняется от прогона к прогону
    и повторный черновик той же заметки создаёт дубликат проекта."""
    _use_openai(monkeypatch)
    captured: dict = {}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "choices": [{"message": {"content": DRAFT_JSON}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 2},
            }

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["json"] = json
        return FakeResponse()

    monkeypatch.setattr("httpx.post", fake_post)
    ai_svc._openai_chat("system", "user")

    from app.config import get_settings

    get_settings.cache_clear()

    assert captured["json"]["temperature"] == 0
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd backend && uv run pytest tests/test_ai_openai.py::test_openai_chat_pins_temperature_to_zero -v`
Expected: FAIL — `KeyError: 'temperature'`.

- [ ] **Step 3: Зафиксировать temperature**

В `backend/app/services/ai.py`, в теле `_openai_chat`, в словарь `json=` добавить поле после `"max_tokens": 4096,`:

```python
            "max_tokens": 4096,
            # Категоризация должна быть детерминированной: без этого одна и та
            # же заметка получала разные имена нового проекта (замер: 3-4
            # варианта за 5 прогонов) и повторный черновик плодил дубликаты.
            "temperature": 0,
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `cd backend && uv run pytest tests/test_ai_openai.py -q`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add backend/app/services/ai.py backend/tests/test_ai_openai.py
git commit -m "fix(ai): temperature=0 у self-hosted провайдера

Параметр не задавался вообще. Замер: имя нового проекта менялось в каждом
прогоне (3-4 варианта за 5), из-за чего повторный черновик той же заметки
создавал второй проект. С temperature=0 имя стабильно 5/5."
```

---

### Task 3: Защита от имени проекта с приклеенным описанием

Наблюдённый дефект: модель 2 раза из 5 возвращала `project` равным строке списка целиком — `"Сварог — Платформа Сварог: бэкенд, UI и деплой."`. Это создало бы проект-мусор с именем до 100 символов. Правило A2 из Task 1 такое поведение убрало, но защита нужна на случай другой модели.

**Files:**
- Modify: `backend/app/services/ai.py:254-283` (`resolve_project_id`)
- Test: `backend/tests/test_ai.py`

**Interfaces:**
- Consumes: `find_project_by_name(db, name) -> Project | None` (регистронезависимый, уже есть).
- Produces: `resolve_project_id(db, project_name: str | None, project_description: str | None = None) -> int` — сигнатура не меняется.

- [ ] **Step 1: Написать падающий тест**

В конец `backend/tests/test_ai.py`:

```python
def test_resolve_strips_description_glued_to_project_name(auth_client):
    """Модель может скопировать строку индекса целиком, вместе с описанием.

    Наблюдалось 2 раза из 5 на локальной модели. Без защиты это создаёт
    проект-мусор с именем до 100 символов вместо попадания в существующий.
    """
    auth_client.post(
        "/api/v1/projects", json={"name": "Сварог", "description": "Платформа Сварог"}
    )
    projects_before = len(auth_client.get("/api/v1/projects").json())

    with db_module.get_session_factory()() as db:
        expected = project_svc.find_project_by_name(db, "Сварог")
        assert expected is not None
        resolved = ai_svc.resolve_project_id(db, "Сварог — Платформа Сварог: бэкенд и деплой.")
        assert resolved == expected.id

    assert len(auth_client.get("/api/v1/projects").json()) == projects_before


def test_resolve_keeps_dash_in_genuinely_new_project_name(auth_client):
    """Тире внутри осмысленного имени не должно ломать создание проекта."""
    with db_module.get_session_factory()() as db:
        project_id = ai_svc.resolve_project_id(db, "Аудио-железо", "Усилители и колонки")
        created = project_svc.find_project_by_name(db, "Аудио-железо")
        assert created is not None
        assert created.id == project_id
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd backend && uv run pytest tests/test_ai.py -k "glued or dash" -v`
Expected: FAIL — `test_resolve_strips_description_glued_to_project_name` создаёт новый проект вместо попадания в «Сварог».

- [ ] **Step 3: Реализовать защиту**

В `backend/app/services/ai.py` добавить функцию непосредственно перед `resolve_project_id`:

```python
def _unglue_project_name(db: Session, name: str) -> str:
    """Отклеить описание, если модель скопировала строку индекса целиком.

    Индекс подаётся как «- Имя — описание», и модель иногда возвращает всю
    строку (наблюдалось 2 раза из 5 на локальной модели). Отрезаем хвост
    только если префикс до « — » совпал с существующим проектом: иначе тире
    внутри осмысленного имени («Аудио-железо») пострадало бы зря.
    """
    prefix = name.split(" — ", 1)[0].strip()
    if prefix != name and prefix and find_project_by_name(db, prefix) is not None:
        return prefix
    return name
```

Затем в `resolve_project_id` заменить строку

```python
    name = (project_name or "").strip()[:100]
```

на

```python
    name = (project_name or "").strip()[:100]
    name = _unglue_project_name(db, name)
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd backend && uv run pytest tests/test_ai.py tests/test_ai_openai.py -q`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add backend/app/services/ai.py backend/tests/test_ai.py
git commit -m "fix(ai): не создавать проект из строки индекса с описанием

Модель 2 раза из 5 возвращала project = «Сварог — Платформа Сварог: ...»,
скопировав строку индекса целиком. Отрезаем хвост после « — » только когда
префикс совпал с существующим проектом, иначе имена с тире пострадали бы."
```

---

### Task 4: Дополнение к ADR-0005

ADR фиксирует «конфигурация владельца: qwen36-35b-a3b-think, таймаут 90 с». Фактически работает `no-think` с таймаутом 15 с, и теперь ещё `temperature=0`. Расхождение с принятым ADR надо узаконить, а не оставлять.

**Files:**
- Modify: `docs/adr/0005-llm.md` (добавить раздел перед `## Альтернативы`)

**Interfaces:** нет — документация.

- [ ] **Step 1: Добавить раздел в ADR-0005**

Вставить в `docs/adr/0005-llm.md` перед строкой `## Альтернативы`:

```markdown
## Дополнение 2026-07-26: модель, таймаут и температура self-hosted провайдера

Запись выше про «qwen36-35b-a3b-think, таймаут 90 с» устарела и противоречила
фактической конфигурации. Замер на живом LiteLLM владельца:

- `qwen36-35b-a3b-think` расходует весь бюджет токенов на рассуждения и
  возвращает **пустой** `content` — для structured output не пригоден;
- `qwen36-35b-a3b-no-think` отвечает валидным JSON за ~0.5 с, полный
  round-trip `/ai/draft` — ~1 с.

Поэтому: модель `qwen36-35b-a3b-no-think`, `LLM_TIMEOUT_SECONDS=15` (штатное
значение, поднимать не требуется), `temperature=0` в запросе к провайдеру
`openai`.

Температура зафиксирована не ради экономии, а ради детерминизма
категоризации: без неё одна и та же заметка получала разные имена нового
проекта (3–4 варианта за 5 прогонов), и повторный черновик создавал дубликат
проекта. Для провайдера `anthropic` параметр не задаётся: замеренная
нестабильность относится к self-hosted пути, а менять работающий путь без
данных незачем.
```

- [ ] **Step 2: Проверить, что не осталось противоречий**

Run: `grep -n 'think\|таймаут\|90 с\|temperature' docs/adr/0005-llm.md`
Expected: старая строка про `qwen36-35b-a3b-think` и 90 с остаётся как исторический факт, но ниже стоит дополнение, которое её отменяет; новых противоречий нет.

- [ ] **Step 3: Коммит**

```bash
git add docs/adr/0005-llm.md
git commit -m "docs(adr): дополнить 0005 — no-think, таймаут 15 с, temperature=0

ADR фиксировал think-модель с таймаутом 90 с, что расходилось с фактической
конфигурацией. Основание для no-think — замер: think возвращает пустой
content, израсходовав бюджет токенов на рассуждения."
```

---

### Task 5: Оснастка для компонентных тестов

Сейчас `vitest.config` — `environment: "node"`, `include: ["src/**/*.test.ts"]`, компонентных тестов нет ни одного. Обещанные спекой проверки `aria-checked` и кликов без jsdom не запускаются.

**Files:**
- Modify: `frontend/package.json` (devDependencies)
- Modify: `frontend/vite.config.ts` (блок `test`)
- Create: `frontend/src/test-setup.ts`
- Modify: `docs/superpowers/specs/2026-07-26-task-project-assignment-design.md` (§8.1 — отметить добавление оснастки)
- Test: `frontend/src/test-setup.test.tsx` (дымовой тест, что окружение работает)

**Interfaces:**
- Produces: рабочее jsdom-окружение vitest для файлов `src/**/*.test.tsx`; матчеры `@testing-library/jest-dom` подключены глобально.

- [ ] **Step 1: Установить devDependencies**

```bash
cd frontend && npm i -D --no-audit --no-fund jsdom@^25 @testing-library/react@^16 @testing-library/user-event@^14 @testing-library/jest-dom@^6
```

- [ ] **Step 2: Создать файл настройки**

`frontend/src/test-setup.ts`:

```ts
// Матчеры вида toBeInTheDocument / toHaveAttribute для компонентных тестов.
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Включить jsdom и .tsx в конфиг vitest**

В `frontend/vite.config.ts` заменить блок `test`:

```ts
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
```

на

```ts
  test: {
    // Чистая логика тестируется в node, компоненты — в jsdom. Разделение по
    // расширению: .test.ts — модули, .test.tsx — React.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test-setup.ts"],
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
  },
```

- [ ] **Step 4: Написать дымовой тест окружения**

`frontend/src/test-setup.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("окружение компонентных тестов", () => {
  it("рендерит React в jsdom и матчеры jest-dom работают", () => {
    render(<button aria-checked="true">Готово</button>);
    const button = screen.getByRole("button", { name: "Готово" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-checked", "true");
  });
});
```

- [ ] **Step 5: Запустить тесты**

Run: `cd frontend && npm run test`
Expected: PASS — и существующий `dates.test.ts`, и новый `test-setup.test.tsx`.

- [ ] **Step 6: Проверить, что typecheck проходит**

Run: `cd frontend && npm run lint`
Expected: без ошибок.

- [ ] **Step 7: Отметить оснастку в спеке**

В `docs/superpowers/specs/2026-07-26-task-project-assignment-design.md`, в конце подраздела «Фронтенд (vitest)» §8.1, добавить абзац:

```markdown
Оснастка под эти тесты добавляется в рамках работы: до неё `vitest` был настроен
только на `environment: "node"` и `src/**/*.test.ts`, компонентных тестов в
проекте не было. Добавляются devDependencies `jsdom`, `@testing-library/react`,
`@testing-library/user-event`, `@testing-library/jest-dom` и разделение по
расширению: `.test.ts` — node, `.test.tsx` — jsdom.
```

- [ ] **Step 8: Коммит**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts \
        frontend/src/test-setup.ts frontend/src/test-setup.test.tsx \
        docs/superpowers/specs/2026-07-26-task-project-assignment-design.md
git commit -m "test(frontend): jsdom + testing-library для компонентных тестов

Спека обещала проверки aria-атрибутов и кликов, но vitest был настроен только
на node и .test.ts — запускать их было негде. Разделение по расширению:
.test.ts остаётся в node, .test.tsx идёт в jsdom."
```

---

### Task 6: Чистая логика меню и разбора конфликта имён

Логика, которую незачем тащить в DOM-тесты: состав пунктов меню и разрешение 409 от `POST /projects`.

**Files:**
- Create: `frontend/src/lib/projectMenu.ts`
- Test: `frontend/src/lib/projectMenu.test.ts`

**Interfaces:**
- Consumes: `Project` из `frontend/src/types.ts`.
- Produces:
  - `interface ProjectMenuItem { id: number; name: string; color: string; current: boolean }`
  - `projectMenuItems(projects: Project[], currentProjectId: number): ProjectMenuItem[]`
  - `findProjectByName(projects: Project[], name: string): Project | undefined`

- [ ] **Step 1: Написать падающие тесты**

`frontend/src/lib/projectMenu.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { findProjectByName, projectMenuItems } from "./projectMenu";

function project(id: number, name: string, isInbox = false): Project {
  return {
    id,
    name,
    color: "#888888",
    description: "",
    is_inbox: isInbox,
    archived_at: null,
    active_tasks: 0,
  };
}

const PROJECTS = [
  project(1, "Inbox", true),
  project(2, "Сварог"),
  project(3, "Аудио"),
];

describe("projectMenuItems", () => {
  it("сортирует проекты по алфавиту, Inbox — последним", () => {
    expect(projectMenuItems(PROJECTS, 2).map((i) => i.name)).toEqual([
      "Аудио",
      "Сварог",
      "Inbox",
    ]);
  });

  it("Inbox остаётся в меню: вернуть задачу в Inbox вручную — законное действие", () => {
    expect(projectMenuItems(PROJECTS, 2).some((i) => i.name === "Inbox")).toBe(true);
  });

  it("помечает текущий проект", () => {
    const items = projectMenuItems(PROJECTS, 2);
    expect(items.filter((i) => i.current).map((i) => i.id)).toEqual([2]);
  });

  it("не падает на пустом списке", () => {
    expect(projectMenuItems([], 1)).toEqual([]);
  });
});

describe("findProjectByName", () => {
  it("находит без учёта регистра — этим разрешается 409 от POST /projects", () => {
    expect(findProjectByName(PROJECTS, "сВаРоГ")?.id).toBe(2);
  });

  it("игнорирует окружающие пробелы", () => {
    expect(findProjectByName(PROJECTS, "  Аудио  ")?.id).toBe(3);
  });

  it("возвращает undefined, если имени нет — значит проект в архиве", () => {
    expect(findProjectByName(PROJECTS, "Архивный")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd frontend && npx vitest run src/lib/projectMenu.test.ts`
Expected: FAIL — `Failed to resolve import "./projectMenu"`.

- [ ] **Step 3: Реализовать модуль**

`frontend/src/lib/projectMenu.ts`:

```ts
import type { Project } from "../types";

export interface ProjectMenuItem {
  id: number;
  name: string;
  color: string;
  current: boolean;
}

/** Пункты меню смены проекта.
 *
 * В отличие от индекса, который уходит в LLM, Inbox здесь ЕСТЬ: вернуть
 * задачу в Inbox вручную — законное действие. Он идёт последним, остальные
 * по алфавиту — список проектов растёт, и стабильный порядок важнее свежести.
 */
export function projectMenuItems(
  projects: Project[],
  currentProjectId: number,
): ProjectMenuItem[] {
  return [...projects]
    .sort((a, b) => {
      if (a.is_inbox !== b.is_inbox) return a.is_inbox ? 1 : -1;
      return a.name.localeCompare(b.name, "ru");
    })
    .map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      current: p.id === currentProjectId,
    }));
}

/** Проект с таким именем без учёта регистра.
 *
 * Этим разрешается 409 от POST /projects: бэкенд считает имена
 * регистронезависимо, и пользователь, набравший существующее имя, хотел
 * попасть в этот проект, а не увидеть ошибку.
 */
export function findProjectByName(projects: Project[], name: string): Project | undefined {
  const needle = name.trim().toLowerCase();
  return projects.find((p) => p.name.toLowerCase() === needle);
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd frontend && npx vitest run src/lib/projectMenu.test.ts`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/lib/projectMenu.ts frontend/src/lib/projectMenu.test.ts
git commit -m "feat(ui): чистая логика пунктов меню проекта и поиска по имени

Состав пунктов и регистронезависимый поиск вынесены из компонента: их можно
проверить без DOM. Поиск по имени — то, чем разрешается 409 от POST /projects."
```

---

### Task 7: Компонент контекстного меню

**Files:**
- Create: `frontend/src/components/TaskContextMenu.tsx`
- Test: `frontend/src/components/TaskContextMenu.test.tsx`

**Interfaces:**
- Consumes: `projectMenuItems` из `../lib/projectMenu` (Task 6).
- Produces:
  ```ts
  interface Props {
    projects: Project[];
    currentProjectId: number;
    at: { x: number; y: number };
    onPick: (projectId: number) => void;
    onCreateNew: () => void;
    onClose: () => void;
  }
  export default function TaskContextMenu(props: Props): JSX.Element
  ```

- [ ] **Step 1: Написать падающие тесты**

`frontend/src/components/TaskContextMenu.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types";
import TaskContextMenu from "./TaskContextMenu";

function project(id: number, name: string, isInbox = false): Project {
  return {
    id,
    name,
    color: "#888888",
    description: "",
    is_inbox: isInbox,
    archived_at: null,
    active_tasks: 0,
  };
}

const PROJECTS = [project(1, "Inbox", true), project(2, "Сварог")];

function setup(overrides: Partial<Parameters<typeof TaskContextMenu>[0]> = {}) {
  const props = {
    projects: PROJECTS,
    currentProjectId: 1,
    at: { x: 10, y: 10 },
    onPick: vi.fn(),
    onCreateNew: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<TaskContextMenu {...props} />);
  return props;
}

describe("TaskContextMenu", () => {
  it("рендерит проекты как radio-пункты меню", () => {
    setup();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitemradio").map((n) => n.textContent)).toEqual([
      "Сварог",
      "Inbox",
    ]);
  });

  it("отмечает текущий проект через aria-checked", () => {
    setup({ currentProjectId: 2 });
    expect(screen.getByRole("menuitemradio", { name: "Сварог" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Inbox" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("по выбору проекта отдаёт его id и закрывается", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Сварог" }));
    expect(props.onPick).toHaveBeenCalledWith(2);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("не дёргает onPick по текущему проекту — менять нечего", async () => {
    const props = setup({ currentProjectId: 2 });
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Сварог" }));
    expect(props.onPick).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("предлагает создать новый проект отдельным пунктом", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("menuitem", { name: /новый проект/i }));
    expect(props.onCreateNew).toHaveBeenCalled();
  });

  it("Escape закрывает меню", async () => {
    const props = setup();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("стрелка вниз переводит фокус на следующий пункт", async () => {
    setup();
    const items = screen.getAllByRole("menuitemradio");
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
  });

  it("Tab не уводит фокус из меню", async () => {
    setup();
    const items = screen.getAllByRole("menuitemradio");
    await userEvent.tab();
    // Ловушка: фокус остался внутри меню, а не ушёл на доску под ним.
    expect(items[1]).toHaveFocus();
  });

  it("возвращает фокус на элемент, из которого меню вызвали", async () => {
    const opener = document.createElement("button");
    opener.textContent = "карточка";
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(
      <TaskContextMenu
        projects={PROJECTS}
        currentProjectId={1}
        at={{ x: 0, y: 0 }}
        onPick={vi.fn()}
        onCreateNew={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    unmount();

    expect(opener).toHaveFocus();
    opener.remove();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd frontend && npx vitest run src/components/TaskContextMenu.test.tsx`
Expected: FAIL — `Failed to resolve import "./TaskContextMenu"`.

- [ ] **Step 3: Реализовать компонент**

`frontend/src/components/TaskContextMenu.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { projectMenuItems } from "../lib/projectMenu";
import type { Project } from "../types";

interface Props {
  projects: Project[];
  currentProjectId: number;
  /** Точка вызова: курсор на десктопе. На мобильном не используется — там лоток. */
  at: { x: number; y: number };
  onPick: (projectId: number) => void;
  onCreateNew: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 240;
const MENU_MAX_HEIGHT = 320;

/** Меню смены проекта у задачи.
 *
 * Через portal под body: у шапки доски backdrop-filter, который создаёт
 * containing block для fixed-элементов и обрезал бы меню (та же причина,
 * что у Modal).
 *
 * На десктопе — поповер у курсора, на мобильном — лоток снизу: привязка к
 * «курсору» на экране 390 px бессмысленна.
 */
export default function TaskContextMenu({
  projects,
  currentProjectId,
  at,
  onPick,
  onCreateNew,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const items = projectMenuItems(projects, currentProjectId);

  useEffect(() => {
    // Фокус вернём туда, откуда меню вызвали: иначе после закрытия он падает
    // на body и клавиатурный пользователь теряет место на доске.
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const nodesNow = () =>
      Array.from(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      const nodes = nodesNow();
      if (nodes.length === 0) return;
      const index = nodes.indexOf(document.activeElement as HTMLElement);

      // Ловушка Tab: aria-modal-подобное меню без неё — обещание без покрытия,
      // Tab уводил бы фокус на доску под открытым меню.
      if (event.key === "Tab") {
        event.preventDefault();
        const delta = event.shiftKey ? -1 : 1;
        nodes[(index + delta + nodes.length) % nodes.length]?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      // Фокус кольцом: с последнего вниз — на первый.
      nodes[(index + delta + nodes.length) % nodes.length]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Зажим по вьюпорту: у нижнего или правого края меню иначе уезжает за экран.
  const left = Math.min(at.x, Math.max(0, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.min(at.y, Math.max(0, window.innerHeight - MENU_MAX_HEIGHT - 8));

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="menu"
        aria-label="Проект задачи"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-xl border border-edge bg-card p-1.5 shadow-2xl sm:inset-x-auto sm:bottom-auto sm:w-60 sm:rounded-lg"
        style={
            typeof window !== "undefined" && window.innerWidth >= 640
              ? { left, top, maxHeight: MENU_MAX_HEIGHT }
              : undefined
        }
      >
        <p className="eyebrow px-2 py-1.5">Проект</p>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitemradio"
            aria-checked={item.current}
            onClick={() => {
              // Выбор текущего проекта — не изменение: не шлём лишний PATCH.
              if (!item.current) onPick(item.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-edge/40"
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="truncate">{item.name}</span>
            {item.current && (
              <span aria-hidden="true" className="ml-auto font-mono text-xs text-amber">
                ✓
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          onClick={onCreateNew}
          className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-edge/60 px-2 py-2 text-left text-sm text-dim hover:bg-edge/40 hover:text-ink"
        >
          <span aria-hidden="true" className="font-mono">
            +
          </span>
          Новый проект…
        </button>
      </div>
    </>,
    document.body,
  );
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd frontend && npx vitest run src/components/TaskContextMenu.test.tsx`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Проверить typecheck**

Run: `cd frontend && npm run lint`
Expected: без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/components/TaskContextMenu.tsx frontend/src/components/TaskContextMenu.test.tsx
git commit -m "feat(ui): контекстное меню смены проекта у задачи

Поповер у курсора на десктопе, лоток снизу на мобильном. Пункты —
menuitemradio с aria-checked на текущем, Escape закрывает, стрелки
навигируют кольцом. Выбор текущего проекта не шлёт PATCH."
```

---

### Task 8: Модалка создания проекта

Спрашивает только имя: описание допишет AI при первой смаршрутизированной задаче (ветка backfill в `resolve_project_id`).

**Files:**
- Create: `frontend/src/components/NewProjectModal.tsx`
- Test: `frontend/src/components/NewProjectModal.test.tsx`

**Interfaces:**
- Consumes: `Modal` из `./Modal` (props: `onClose`, `onSubmit?`, `title`, `children`).
- Produces:
  ```ts
  interface Props {
    onCreate: (name: string) => Promise<void>;
    onClose: () => void;
  }
  export default function NewProjectModal(props: Props): JSX.Element
  ```

- [ ] **Step 1: Написать падающие тесты**

`frontend/src/components/NewProjectModal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NewProjectModal from "./NewProjectModal";

describe("NewProjectModal", () => {
  it("создаёт проект по введённому имени", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<NewProjectModal onCreate={onCreate} onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/название/i), "Сварог");
    await userEvent.click(screen.getByRole("button", { name: /создать/i }));

    expect(onCreate).toHaveBeenCalledWith("Сварог");
  });

  it("объясняет ошибку у поля вместо молчаливого disabled", async () => {
    render(<NewProjectModal onCreate={vi.fn()} onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /создать/i }));

    const input = screen.getByLabelText(/название/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/введите название/i)).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("показывает ошибку от сервера, не закрываясь", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("проект в архиве"));
    render(<NewProjectModal onCreate={onCreate} onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/название/i), "Архивный");
    await userEvent.click(screen.getByRole("button", { name: /создать/i }));

    expect(await screen.findByText(/проект в архиве/i)).toBeInTheDocument();
  });

  it("обрезает пробелы вокруг имени", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<NewProjectModal onCreate={onCreate} onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/название/i), "  Аудио  ");
    await userEvent.click(screen.getByRole("button", { name: /создать/i }));

    expect(onCreate).toHaveBeenCalledWith("Аудио");
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd frontend && npx vitest run src/components/NewProjectModal.test.tsx`
Expected: FAIL — `Failed to resolve import "./NewProjectModal"`.

- [ ] **Step 3: Реализовать компонент**

`frontend/src/components/NewProjectModal.tsx`:

```tsx
import { useId, useRef, useState } from "react";
import Modal from "./Modal";

interface Props {
  /** Бросает — сообщение показывается у поля, модалка остаётся открытой. */
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}

/** Создание проекта на ходу: спрашиваем только имя.
 *
 * Описание остаётся пустым осознанно — его допишет AI при первой задаче,
 * которую в этот проект смаршрутизирует (ветка backfill в resolve_project_id).
 * Два поля вместо одного удлинили бы путь «быстро завести проект».
 */
export default function NewProjectModal({ onCreate, onClose }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const submit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    // Кнопка остаётся активной: молчаливый disabled не объясняет, что не так.
    if (!trimmed) {
      setError("Введите название проекта");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать проект");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Новый проект" onClose={onClose} onSubmit={submit}>
      <div className="space-y-4">
        <label className="block">
          <span className="eyebrow">Название</span>
          <input
            ref={inputRef}
            name="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="input"
          />
          {error && (
            <span id={errorId} className="mt-1 block text-xs text-danger">
              {error}
            </span>
          )}
        </label>
        <p className="text-xs text-dim">
          Описание допишет AI, когда в проект попадёт первая задача.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button type="button" onClick={submit} className="btn-primary">
            {busy ? "Создаём…" : "Создать"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd frontend && npx vitest run src/components/NewProjectModal.test.tsx`
Expected: PASS, 4 теста.

Если падает на классах `btn-ghost`/`btn-primary`/`input`/`eyebrow` — это утилиты из `frontend/src/styles.css`; проверить фактические имена командой `grep -n 'btn-ghost\|btn-primary\|eyebrow' frontend/src/styles.css` и подставить существующие.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/components/NewProjectModal.tsx frontend/src/components/NewProjectModal.test.tsx
git commit -m "feat(ui): модалка создания проекта — только имя

Описание не спрашиваем: его допишет AI при первой смаршрутизированной
задаче. Ошибка объясняется у поля с aria-invalid и уводом фокуса, кнопка
сабмита не выключается молча."
```

---

### Task 9: Подключение меню к доске

**Files:**
- Modify: `frontend/src/components/TaskCard.tsx:61-97` (проп `onContextMenu`, подавление нативной выноски)
- Modify: `frontend/src/components/Column.tsx:6-16,55-63` (проброс пропа)
- Modify: `frontend/src/pages/BoardPage.tsx` (состояние меню, мутации, рендер)
- Test: `frontend/src/components/TaskCard.test.tsx`

**Interfaces:**
- Consumes: `TaskContextMenu` (Task 7), `NewProjectModal` (Task 8), `findProjectByName` (Task 6), `api.patchTask`, `api.createProject`, `api.projects` — уже есть в `frontend/src/api.ts`.
- Produces:
  - `TaskCard` получает проп `onContextMenu: (task: Task, at: { x: number; y: number }) => void`.
  - `Column` получает и пробрасывает тот же проп.

- [ ] **Step 1: Написать падающий тест на карточку**

`frontend/src/components/TaskCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../types";
import TaskCard from "./TaskCard";

const TASK: Task = {
  id: 7,
  project_id: 2,
  title: "Сделать UI",
  description: "",
  status: "todo",
  priority: "medium",
  tags: [],
  due_date: null,
  sort_order: 1,
  source: "manual",
  created_at: "2026-07-26T00:00:00",
  updated_at: "2026-07-26T00:00:00",
  completed_at: null,
};

const PROJECT: Project = {
  id: 2,
  name: "Сварог",
  color: "#38bdf8",
  description: "",
  is_inbox: false,
  archived_at: null,
  active_tasks: 1,
};

function Harness({
  onOpen,
  onContextMenu,
}: {
  onOpen: (task: Task) => void;
  onContextMenu: (task: Task, at: { x: number; y: number }) => void;
}) {
  const guard = useRef(false);
  return (
    <TaskCard
      task={TASK}
      project={PROJECT}
      onOpen={onOpen}
      onContextMenu={onContextMenu}
      clickGuard={guard}
    />
  );
}

describe("TaskCard", () => {
  it("по contextmenu отдаёт задачу и координаты, не открывая модалку", async () => {
    const onOpen = vi.fn();
    const onContextMenu = vi.fn();
    render(<Harness onOpen={onOpen} onContextMenu={onContextMenu} />);

    // Один обработчик contextmenu покрывает правый клик, долгое нажатие на
    // мобильном и клавиши Menu / Shift+F10.
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("Сделать UI"),
    });

    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0].id).toBe(7);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("обычный клик по-прежнему открывает задачу", async () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} onContextMenu={vi.fn()} />);
    await userEvent.click(screen.getByText("Сделать UI"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run src/components/TaskCard.test.tsx`
Expected: FAIL — TypeScript/рантайм: у `TaskCard` нет пропа `onContextMenu`, `onContextMenu` не вызывается.

- [ ] **Step 3: Добавить проп в TaskCard**

В `frontend/src/components/TaskCard.tsx` заменить `interface Props` и функцию `TaskCard`:

```tsx
interface Props {
  task: Task;
  project: Project | undefined;
  onOpen: (task: Task) => void;
  /** Вызов контекстного меню: правый клик, долгое нажатие или клавиша Menu. */
  onContextMenu: (task: Task, at: { x: number; y: number }) => void;
  /** Пока true — игнорируем click: после drag браузер шлёт «сквозной»
   * click по исходной карточке, он не должен открывать модалку. */
  clickGuard: MutableRefObject<boolean>;
}

export default function TaskCard({ task, project, onOpen, onContextMenu, clickGuard }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { task },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => {
        if (clickGuard.current) return;
        onOpen(task);
      }}
      onContextMenu={(e) => {
        // Один обработчик на три жеста: правый клик, долгое нажатие на
        // мобильном (Chromium и Safari шлют contextmenu) и клавиши
        // Menu / Shift+F10 — клавиатурная доступность достаётся бесплатно.
        e.preventDefault();
        onContextMenu(task, { x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        // dnd-kit даёт карточке role=button и tabIndex, но Enter сам не обработает
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task);
        }
      }}
      // -webkit-touch-callout: иначе долгое нажатие в Safari поднимает
      // нативную выноску поверх нашего меню. select-none уже есть.
      className={`cursor-grab touch-manipulation select-none [-webkit-touch-callout:none] ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <TaskCardView task={task} project={project} />
    </div>
  );
}
```

- [ ] **Step 4: Пробросить проп через Column**

В `frontend/src/components/Column.tsx` в `interface Props` добавить рядом с `onOpen`:

```tsx
  onContextMenu: (task: Task, at: { x: number; y: number }) => void;
```

В список деструктурированных пропов добавить `onContextMenu,` рядом с `onOpen,`, а в рендер `<TaskCard ... />` добавить строку рядом с `onOpen={onOpen}`:

```tsx
            onContextMenu={onContextMenu}
```

- [ ] **Step 5: Убедиться, что тест карточки проходит**

Run: `cd frontend && npx vitest run src/components/TaskCard.test.tsx`
Expected: PASS, 2 теста.

- [ ] **Step 6: Подключить состояние и мутации в BoardPage**

В `frontend/src/pages/BoardPage.tsx` добавить импорты рядом с существующими:

```tsx
import NewProjectModal from "../components/NewProjectModal";
import TaskContextMenu from "../components/TaskContextMenu";
import { findProjectByName } from "../lib/projectMenu";
```

Рядом с `const [activeTask, setActiveTask] = useState<Task | null>(null);` добавить состояние:

```tsx
  // Контекстное меню и создание проекта — транзиентный UI, в URL не живут.
  const [menuFor, setMenuFor] = useState<{ task: Task; at: { x: number; y: number } } | null>(null);
  const [creatingProjectFor, setCreatingProjectFor] = useState<Task | null>(null);
```

После `moveMutation` добавить мутацию смены проекта:

```tsx
  const setProjectMutation = useMutation({
    mutationFn: ({ id, projectId }: { id: number; projectId: number }) =>
      api.patchTask(id, { project_id: projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  /** Создать проект и сразу перенести в него задачу.
   *
   * 409 не показываем как ошибку: бэкенд сравнивает имена без учёта
   * регистра, и пользователь, набравший существующее имя, хотел попасть в
   * этот проект. Если после перезапроса имени в списке нет — проект в
   * архиве, и вот об этом сказать надо. */
  const createProjectAndMove = async (task: Task, name: string) => {
    try {
      const created = await api.createProject({ name });
      await setProjectMutation.mutateAsync({ id: task.id, projectId: created.id });
    } catch (err) {
      const fresh = await queryClient.fetchQuery({
        queryKey: ["projects"],
        queryFn: api.projects,
      });
      const existing = findProjectByName(fresh, name);
      if (!existing) {
        throw new Error(`Проект «${name}» есть в архиве — переименуйте или разархивируйте его`);
      }
      await setProjectMutation.mutateAsync({ id: task.id, projectId: existing.id });
    }
    setCreatingProjectFor(null);
  };
```

- [ ] **Step 7: Прокинуть проп и отрендерить меню**

В `frontend/src/pages/BoardPage.tsx` в `<Column ... />` добавить рядом с `onOpen={openTaskById}`:

```tsx
                  onContextMenu={(task, at) => setMenuFor({ task, at })}
```

Перед закрывающим фрагментом (рядом с рендером `<TaskModal ... />` и `<NewTaskModal ... />`) добавить:

```tsx
      {menuFor && (
        <TaskContextMenu
          projects={projects}
          currentProjectId={menuFor.task.project_id}
          at={menuFor.at}
          onPick={(projectId) =>
            setProjectMutation.mutate({ id: menuFor.task.id, projectId })
          }
          onCreateNew={() => {
            setCreatingProjectFor(menuFor.task);
            setMenuFor(null);
          }}
          onClose={() => setMenuFor(null)}
        />
      )}
      {creatingProjectFor && (
        <NewProjectModal
          onCreate={(name) => createProjectAndMove(creatingProjectFor, name)}
          onClose={() => setCreatingProjectFor(null)}
        />
      )}
```

- [ ] **Step 8: Показать ошибку смены проекта**

Тостов в проекте нет — ошибки живут в постоянно смонтированных `aria-live`
контейнерах (содержимое, появляющееся вместе с самим `aria-live` элементом,
скринридером не зачитывается). Добавить блок внутрь существующего
`<div aria-live="polite">` в `BoardPage` (строка ~300), сразу после блока
`projectsQuery.isError`:

```tsx
          {setProjectMutation.isError && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              <span>
                Не удалось сменить проект
                {setProjectMutation.error instanceof Error
                  ? `: ${setProjectMutation.error.message}`
                  : ""}
              </span>
              <button
                onClick={() => setProjectMutation.reset()}
                className="rounded-md border border-danger/50 px-2.5 py-1 font-mono text-xs transition hover:bg-danger/15 active:bg-danger/25"
              >
                Понятно
              </button>
            </div>
          )}
```

Состояние доски при ошибке не трогаем: оптимистичного обновления у этой
мутации нет, поэтому откатывать нечего — список просто остаётся прежним.

- [ ] **Step 9: Прогнать все тесты и typecheck**

Run: `cd frontend && npm run lint && npm run test`
Expected: typecheck без ошибок; все тесты PASS.

- [ ] **Step 10: Коммит**

```bash
git add frontend/src/components/TaskCard.tsx frontend/src/components/TaskCard.test.tsx \
        frontend/src/components/Column.tsx frontend/src/pages/BoardPage.tsx
git commit -m "feat(ui): смена проекта у задачи из контекстного меню

Проп onContextMenu идёт тем же путём, что onOpen: BoardPage → Column →
TaskCard. Конфликта с drag-n-drop нет — PointerSensor активируется по
расстоянию (distance: 8), а не по удержанию. 409 при создании проекта
разрешается выбором существующего, про архивный говорим явно."
```

---

### Task 10: Приёмочная проверка в реальном браузере и полный гейт

Компонентные тесты не покрывают главный риск: что долгое нажатие на тач-устройстве откроет меню, а не начнёт перетаскивание.

**Files:**
- Create: `docs/superpowers/plans/2026-07-26-acceptance-notes.md` (отчёт с наблюдениями)

**Interfaces:** нет — проверка.

- [ ] **Step 1: Собрать и поднять стек с изменениями**

```bash
cd ~/proj/AI_Kanban && docker compose up -d --build && curl -fsS http://127.0.0.1:8081/healthz
```
Expected: `{"ok":true}`.

- [ ] **Step 2: Проверить, что AI теперь создаёт проекты**

```bash
PW=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2); J=$(mktemp)
curl -sS -c "$J" -o /dev/null -X POST http://127.0.0.1:8081/api/v1/auth/login \
  -H 'Content-Type: application/json' -d "{\"username\":\"andrew\",\"password\":\"$PW\"}"
curl -sS -b "$J" -X POST http://127.0.0.1:8081/api/v1/ai/draft \
  -H 'Content-Type: application/json' -d '{"text":"Сделать UI в свароге"}'
curl -sS -b "$J" -X POST http://127.0.0.1:8081/api/v1/ai/draft \
  -H 'Content-Type: application/json' -d '{"text":"купить молоко"}'
rm -f "$J"
```
Expected: у первой заметки `"project":"Сварог"` (не `Inbox`); у второй `"project":null`.

- [ ] **Step 3: Написать драйвер приёмки**

`puppeteer-core` уже установлен в рабочем каталоге сессии; если его нет —
`npm i puppeteer-core` в отдельном каталоге, системный Chrome
переиспользуется, второй копии браузера не тянется.

Создать `acceptance.mjs` (вне репозитория, в рабочем каталоге):

```js
// Приёмка контекстного меню: правый клик на десктопе и два взаимоисключающих
// жеста в тач-эмуляции. Usage: node acceptance.mjs <baseUrl> <user> <pass> <outDir>
import puppeteer from "puppeteer-core";

const [base, user, pass, outDir] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: "/opt/google/chrome/chrome",
  headless: true,
  args: ["--disable-gpu", "--no-first-run", "--hide-scrollbars"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});

async function login(page) {
  await page.goto(base, { waitUntil: "networkidle2" });
  await page.type('input[name="username"]', user);
  await page.type('input[name="password"]', pass);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[aria-label="Быстрое добавление задачи"]', { timeout: 20000 });
}

async function ensureTask(page, title) {
  await page.type('[aria-label="Быстрое добавление задачи"]', title);
  await page.click('[aria-label="Добавить задачу"]');
  await page.waitForSelector('[aria-label="Создать задачу"]', { timeout: 25000 });
  await page.click('[aria-label="Создать задачу"]');
  await page.waitForFunction(
    (t) => [...document.querySelectorAll("p")].some((n) => n.textContent?.trim() === t),
    { timeout: 20000 },
    title,
  );
}

const TITLE = "Приёмка контекстного меню";

// --- десктоп: правый клик ---
const page = await browser.newPage();
await login(page);
await ensureTask(page, TITLE);

const card = await page.evaluateHandle(
  (t) => [...document.querySelectorAll("p")].find((n) => n.textContent?.trim() === t),
  TITLE,
);
const box = await card.asElement().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
await page.waitForSelector('[role="menu"]', { timeout: 5000 });
await page.screenshot({ path: `${outDir}/acc-01-desktop-menu.png` });

const before = await page.$$eval('[role="menuitemradio"]', (ns) =>
  ns.map((n) => `${n.textContent.trim()}:${n.getAttribute("aria-checked")}`),
);
console.log("пункты меню:", before);

const other = await page.$$('[role="menuitemradio"][aria-checked="false"]');
if (other.length === 0) throw new Error("нет второго проекта — создайте его до приёмки");
await other[0].click();
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${outDir}/acc-02-desktop-after-pick.png` });
console.log("меню закрылось:", (await page.$('[role="menu"]')) === null);

// --- тач: удержание против сдвига ---
const m = await browser.newPage();
await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await m.setCookie(...(await page.cookies()));
await m.goto(base, { waitUntil: "networkidle2" });
await m.waitForSelector('[aria-label="Быстрое добавление задачи"]', { timeout: 20000 });

const mCard = await m.evaluateHandle(
  (t) => [...document.querySelectorAll("p")].find((n) => n.textContent?.trim() === t),
  TITLE,
);
const mBox = await mCard.asElement().boundingBox();
const cx = mBox.x + mBox.width / 2;
const cy = mBox.y + mBox.height / 2;

// 1) удержание без движения: должно открыть меню и НЕ начать перетаскивание
await m.mouse.move(cx, cy);
await m.mouse.down();
await new Promise((r) => setTimeout(r, 700));
const draggingWhileHeld = await m.evaluate(
  () => document.querySelector(".opacity-30") !== null,
);
await m.mouse.up();
await m.evaluate((x, y) => {
  document
    .elementFromPoint(x, y)
    ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: x, clientY: y }));
}, cx, cy);
await new Promise((r) => setTimeout(r, 600));
const menuAfterHold = (await m.$('[role="menu"]')) !== null;
await m.screenshot({ path: `${outDir}/acc-03-mobile-hold.png` });
if (menuAfterHold) await m.keyboard.press("Escape");

// 2) сдвиг на 20 px: должно начать перетаскивание и НЕ открыть меню
await new Promise((r) => setTimeout(r, 400));
await m.mouse.move(cx, cy);
await m.mouse.down();
await m.mouse.move(cx, cy + 20, { steps: 5 });
const draggingAfterMove = await m.evaluate(
  () => document.querySelector(".opacity-30") !== null,
);
const menuAfterMove = (await m.$('[role="menu"]')) !== null;
await m.screenshot({ path: `${outDir}/acc-04-mobile-drag.png` });
await m.mouse.up();

console.log(JSON.stringify(
  { draggingWhileHeld, menuAfterHold, draggingAfterMove, menuAfterMove },
  null,
  2,
));

await browser.close();
```

- [ ] **Step 4: Прогнать драйвер и посмотреть на скриншоты**

```bash
PW=$(grep '^ADMIN_PASSWORD=' ~/proj/AI_Kanban/.env | cut -d= -f2)
node acceptance.mjs http://server-1.lan:27182/ andrew "$PW" .
```

Expected:
- `пункты меню` содержит проекты, ровно у одного `aria-checked=true`;
- `меню закрылось: true`;
- `draggingWhileHeld: false` и `menuAfterHold: true` — удержание открывает меню, не начиная перетаскивание;
- `draggingAfterMove: true` и `menuAfterMove: false` — сдвиг тащит карточку, меню не появляется.

Затем **открыть все четыре скриншота и посмотреть на них**: пустой кадр означает, что страница не отрисовалась, и «тест прошёл» ничего не значит. На `acc-02` бейдж проекта на карточке должен отличаться от `acc-01`.

Если `menuAfterHold: false` — этот браузер не шлёт `contextmenu` по удержанию;
добавить fallback-таймер из §6.1 спеки: 500 мс на `pointerdown`, отмена по
`pointermove` за пределы 8 px и по `pointerup`.

- [ ] **Step 5: Записать наблюдения**

Создать `docs/superpowers/plans/2026-07-26-acceptance-notes.md` с фактическими результатами шагов 2–4: что проверено, что увидено на скриншотах, какие браузеры/вьюпорты. Если долгое нажатие где-то не дало `contextmenu` — зафиксировать это и добавить fallback-таймер, как описано в §6.1 спеки.

- [ ] **Step 6: Полный гейт**

Run: `make verify`
Expected: PASS — ruff, ruff format, mypy, pytest, vitest, `docker compose build`.

- [ ] **Step 7: Коммит**

```bash
git add docs/superpowers/plans/2026-07-26-acceptance-notes.md
git commit -m "docs: приёмочная проверка меню проекта и маршрутизации AI

Что проверено в реальном Chrome: правый клик на десктопе, долгое нажатие и
сдвиг в тач-эмуляции (взаимоисключающие жесты), смена бейджа проекта на
карточке. Плюс живой прогон /ai/draft: заметка про сварог создаёт проект,
разовое поручение остаётся в Inbox."
```
