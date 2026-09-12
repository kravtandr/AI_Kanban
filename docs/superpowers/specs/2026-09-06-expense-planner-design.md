# Планировщик трат

- **Дата**: 2026-09-06
- **Статус**: design approved (владелец, 2026-09-06); ADR-0009 accepted
- **Затрагивает**: новый раздел 4.7 SPEC.md (FR-8.x); новые таблица `expenses`,
  роутер `/api/v1/expenses`, эндпоинт `/api/v1/ai/draft-expense`, четыре
  MCP-инструмента; новый ADR-0009. Существующие таблицы, эндпоинты и инструменты не
  меняются.

## 1. Задача

Владелец: «добавить в канбан новую вкладку — планировщик-органайзер трат: регулярные
траты, что хочу купить с ценой, что уже куплено. Траты выглядят как карточки и
редактируются. У регулярных трат разные периоды день/месяц/квартал/год плюс конкретная
дата списания».

Решения, принятые в ходе проработки (все — владельцем, 2026-09-06):

1. **Колонки — по типу**: `Регулярные | Хочу купить | Куплено`. Не по горизонту
   времени и не по статусу оплаты.
2. **Итоги считаются**: стоимость регулярных трат в месяц, списания на ближайшие
   7 дней, сумма вишлиста, куплено за текущий месяц.
3. **Журнала платежей нет.** Регулярная карточка показывает только *следующую* дату
   списания, вычисленную из периода и опорной даты. Никаких галочек «оплатил».
4. **LLM-быстрый ввод и MCP-инструменты входят в первую версию.**
5. **Категории — свободные теги**, как у задач. Отдельного справочника нет.
6. **Одна валюта** (рубли), задаётся настройкой сервера. Конвертации нет.
7. **Отменённая регулярная трата ставится на паузу**, а не удаляется: флаг `active`.
   Неактивные не входят в итоги и скрыты по умолчанию.
8. **Перенос в «Куплено» ставит дату покупки автоматически**, цену можно поправить в
   карточке.
9. **Приоритет вишлиста — ручной порядок** перетаскиванием; отдельного поля нет.
10. **Периоды — строго `day | month | quarter | year`.** «Неделя» отвергнута.

## 2. Что установлено проверкой (не предположения)

### 2.1 Новая таблица не требует Alembic

`bootstrap.py:25` применяет схему через `Base.metadata.create_all(get_engine())`.
ADR-0008 уточнил ADR-0002: **добавление новой таблицы, целиком покрываемое
идемпотентным `create_all`, Alembic не вынуждает**; изменение существующей таблицы —
вынуждает безусловно. `create_all` создаёт и новые нативные PG-энумы, привязанные к
новой таблице.

**Следствие:** фича добавляет одну новую таблицу `expenses` и ни одной колонки ни в
одной существующей таблице. `ExpenseStatus` и `ExpensePeriod` — новые энумы новой
таблицы, это допустимо.

### 2.2 `_call_model` жёстко привязан к `TaskDraft`

`services/ai.py:113-181`: `_call_anthropic` передаёт `output_format=TaskDraft`,
`_call_openai` делает `TaskDraft.model_validate(payload)`, `_call_model` — только
диспетчер провайдера. Схемы результата параметром не принимает ни одна из трёх функций.

Тесты мокают именно `ai._call_model` (AGENTS.md: «LLM-вызовы в тестах только мокаются
(`ai._call_model`)»); `test_ai.py`, `test_ai_estimate.py` подменяют его функцией,
возвращающей `(TaskDraft, int, int)`.

**Следствие:** `_call_model`, `_call_anthropic`, `_call_openai` получают
keyword-only параметр `schema: type[BaseModel] = TaskDraft`. Значение по умолчанию
сохраняет сигнатуру для всех существующих вызовов и моков; черновик траты вызывает
`_call_model(system, user, schema=ExpenseDraft)`. Существующие тесты не правятся.

### 2.3 Продовая модель — локальная Qwen без structured outputs

Память проекта и ADR-0008: прод работает через `llm_provider=openai` на локальном
LiteLLM, модель `qwen36-35b-a3b-no-think`; JSON достаётся из текста через
`_extract_json` (`ai.py:100-109`), `temperature=0`. Схема черновика траты обязана быть
плоской и маленькой: шесть полей, никаких вложенных объектов.

### 2.4 Каркас страницы доски переиспользуем, но не разделяем

`BoardPage.tsx` (≈560 строк) содержит DnD через `@dnd-kit/core`, мобильные табы с
drop-зонами, URL-синхронизацию фильтров и открытой карточки, шапку с `QuickAdd`,
кнопками «время», «фильтры», «выйти». Всё это завязано на `Task`, `Status`,
`STATUSES` и аналитику (живые таймеры). Извлечение обобщённого «канбан-каркаса» —
рефакторинг, не нужный для задачи и рискованный для доски задач (Preservation в
AGENTS.md).

**Следствие:** `ExpensesPage.tsx` пишется как отдельная страница по образцу
`BoardPage`, без общих абстракций с ней. Общий только новый компонент `NavTabs`
(переключатель «задачи | траты»), который вставляется в шапку обеих страниц, и
существующий `Modal.tsx`.

### 2.5 Чистка мягко удалённых — один цикл на задачи

`main.py:162-176`: `_purge_loop` раз в сутки вызывает `purge_deleted_tasks`, глотает и
логирует исключения. Расширяется одним вызовом `purge_deleted_expenses` в той же
функции `_purge_deleted_tasks_once`; у трат нет дочерних таблиц, каскадов не нужно.

### 2.6 Инвалидация запросов — точечная

`lib/invalidateBoard.ts` инвалидирует `tasks / projects / analytics`. Траты живут в
своих ключах `["expenses"]` и `["expenses-summary"]`; мутации трат не трогают доску
задач и наоборот. Отдельный хелпер `invalidateExpenses(queryClient)`.

## 3. Три несущих решения

1. **Отдельная сущность `Expense`, а не подвид `Task`.** Переиспользование `tasks` с
   полем `kind` отвергнуто: события учёта времени начали бы писаться на траты, колонки
   `TaskStatus` не совпадают с колонками трат, фильтры доски пришлось бы учить прятать
   траты, промпт задач раздулся бы. Две таблицы (регулярные и покупки отдельно)
   отвергнуты: два CRUD, две формы, восемь MCP-инструментов ради одной вкладки.
2. **Сумма — целое число копеек.** `amount: Integer`, не `Numeric` и не `Float`.
   Итоги складываются точно; в API и UI сумма показывается как рубли с двумя знаками.
   Приведение к месяцу (§6) — единственное место с дробями, и оно округляется один раз в
   самом конце.
3. **Следующее списание считается на бэкенде и отдаётся полем.** Календарная
   арифметика (прижатие 31-го к концу короткого месяца, 29 февраля) живёт в одной
   чистой функции `next_charge` и покрыта тестами; фронт её не дублирует.

## 4. Модель данных

```python
class ExpenseStatus(StrEnum):
    recurring = "recurring"   # колонка «Регулярные»
    wanted = "wanted"         # колонка «Хочу купить»
    bought = "bought"         # колонка «Куплено»


class ExpensePeriod(StrEnum):
    day = "day"
    month = "month"
    quarter = "quarter"
    year = "year"


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    note: Mapped[str] = mapped_column(Text, default="")            # Markdown
    amount: Mapped[int] = mapped_column()                           # копейки, ≥ 0
    status: Mapped[ExpenseStatus] = mapped_column(Enum(ExpenseStatus), index=True)
    period: Mapped[ExpensePeriod | None] = mapped_column(Enum(ExpensePeriod), nullable=True)
    anchor_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(default=True)
    purchased_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    sort_order: Mapped[int] = mapped_column(default=0)
    source: Mapped[TaskSource] = mapped_column(Enum(TaskSource), default=TaskSource.manual)
    ai_meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

`source` переиспользует существующий энум `TaskSource` (`manual | ai | mcp`): тот же
PG-тип `tasksource`, новых значений не нужно, семантика та же — «кто создал».

**Инварианты** (проверяются в сервисе; нарушение — `ExpenseError` → HTTP 400):

| Статус | `period` | `anchor_date` | `purchased_at` | `active` |
|---|---|---|---|---|
| `recurring` | обязателен | обязателен | `null` | любой |
| `wanted` | `null` | `null` | `null` | всегда `true` |
| `bought` | `null` | `null` | обязателен | всегда `true` |

Дополнительно: `amount ≥ 0`; `title` непустой после `strip`, обрезается до 200;
`tags` — список строк, нормализуются как у задач (нижний регистр, без дублей).

`anchor_date` — «конкретная дата списания» из формулировки владельца. Это не «дата
первого платежа», а любая дата из ряда списаний; ряд определяется как
`anchor_date + k·period`, `k ∈ ℤ`. Для `day` дата не влияет на ряд, но хранится
обязательной ради единообразия инварианта и формы.

## 5. Следующее списание

Чистая функция в `services/expenses.py`, без БД и без часов в сигнатуре:

```python
def next_charge(period: ExpensePeriod, anchor: date, today: date) -> date:
    """Наименьшая дата ≥ today в ряду anchor + k·period."""
```

Правила:

- `day`: возвращает `today`.
- `month` / `quarter` / `year`: шаг в месяцах 1 / 3 / 12. Кандидат — `anchor`,
  сдвинутый на `n` шагов, где `n = ceil(months_between(anchor, today) / step)`,
  затем корректируется ±1 шаг, пока не станет наименьшим ≥ `today`. День месяца
  прижимается к последнему дню целевого месяца: `31 янв → 28/29 фев`, `29 фев (год) →
  28 фев` в невисокосный. Прижатие не «липнет»: следующее списание после `28 фев` для
  `anchor = 31 янв` — `31 мар`, а не `28 мар`.
- `anchor > today`: возвращает `anchor` (первое списание ещё впереди).
- `anchor == today`: возвращает `today` (списание сегодня).

`today` берётся из `task_service.local_today()` (`tasks.py:222`) — тот же хелпер
границ суток, что и у аналитики, чтобы «сегодня» на доске и в тратах совпадало.

`ExpenseOut.next_charge: date | None` заполняется только для активных `recurring`;
у неактивных и у `wanted`/`bought` — `null`.

## 6. Итоги

`GET /api/v1/expenses/summary` → `ExpenseSummaryOut`, считается SQL + Python без LLM:

```python
class UpcomingCharge(BaseModel):
    expense_id: int
    title: str
    amount: int
    date: date


class ExpenseSummaryOut(BaseModel):
    monthly_recurring: int      # копейки, активные recurring, приведённые к месяцу
    upcoming: list[UpcomingCharge]   # активные recurring с next_charge ≤ today+7, по дате
    upcoming_total: int
    wanted_total: int           # сумма wanted
    bought_this_month: int      # сумма bought с purchased_at в текущем локальном месяце
    currency: str               # из настроек, по умолчанию "RUB"
```

Приведение к месяцу — коэффициенты среднего календарного месяца, округление один раз
после суммирования по всем картам:

| Период | Множитель |
|---|---|
| `day` | × 365 / 12 |
| `month` | × 1 |
| `quarter` | ÷ 3 |
| `year` | ÷ 12 |

`monthly_recurring = round(Σ amount_i · k_i)`. Тест фиксирует: три карточки по 100 ₽
день/квартал/год дают `3041.67 + 33.33 + 8.33 = 3083.33 → 308333` копеек.

`upcoming` берёт `next_charge` каждой активной регулярной карточки; попадает, если
`today ≤ next_charge ≤ today + 7`. Для `day` это всегда сегодня: ежедневная трата в
списке ближайших присутствует один раз с датой `today`, не семь раз.

Настройка валюты: `EXPENSE_CURRENCY: str = "RUB"` в `config.py`, отдаётся в
`summary.currency`; фронт форматирует суммы через `Intl.NumberFormat("ru-RU",
{style: "currency", currency})`.

## 7. Сервис и REST

### 7.1 Сервис `services/expenses.py`

Зеркало `services/tasks.py`, без аналитики:

```
list_expenses(db, *, status?, tag?, query?, include_inactive=False) -> list[Expense]
get_expense(db, id) -> Expense                       # 404 если нет/удалена
create_expense(db, *, title, amount, status, period?, anchor_date?, note, tags, source, ai_meta) -> Expense
update_expense(db, id, **fields) -> Expense           # проверяет инварианты после применения
move_expense(db, id, status, sort_order?) -> Expense  # только wanted ↔ bought
delete_expense(db, id) -> None                        # deleted_at = utcnow()
purge_deleted_expenses(db) -> int                     # > 30 дней, физически
summary(db) -> ExpenseSummaryOut
next_charge(period, anchor, today) -> date            # чистая, §5
```

Правила `move_expense`:

- `wanted → bought`: `purchased_at = local_today()`, `sort_order` в начало колонки
  (свежая покупка сверху).
- `bought → wanted`: `purchased_at = None`.
- Любой переход с участием `recurring` — `ExpenseError("Recurring expenses cannot be
  moved")`. Смена типа карточки делается через PATCH с полным набором полей нового
  статуса (например, `wanted` → `recurring` с `period` и `anchor_date`), а не
  перетаскиванием. Это сознательно: DnD не может спросить период.
- Перенос внутри той же колонки с `sort_order` — ручной порядок, как у задач.

`update_expense` принимает `status` в составе полей и проверяет полный инвариант
результата: `PATCH {status: "recurring"}` без `period` → 400.

Сумма в `create`/`update` принимается уже в копейках (`amount: int`); перевод рублей в
копейки — обязанность клиента (форма и черновик LLM), чтобы сервер не гадал про
разделители.

### 7.2 Схемы

```python
class ExpenseIn(BaseModel):
    title: str
    amount: int = Field(ge=0)
    status: ExpenseStatus = ExpenseStatus.wanted
    period: ExpensePeriod | None = None
    anchor_date: date | None = None
    note: str = ""
    tags: list[str] = []
    ai_meta: dict | None = None


class ExpensePatch(BaseModel):          # все поля необязательные
    title, amount, status, period, anchor_date, note, tags, active, purchased_at, sort_order
    clear_period: bool = False          # снять period/anchor_date явно, как clear_estimate


class ExpenseMoveIn(BaseModel):
    status: ExpenseStatus
    sort_order: int | None = None


class ExpenseOut(BaseModel):
    id, title, note, amount, status, period, anchor_date, active, purchased_at,
    tags, sort_order, source, created_at, updated_at
    next_charge: date | None
```

`clear_period` нужен по той же причине, что `clear_estimate` у задач: в PATCH
`null` неотличим от «поле не передано».

### 7.3 Роутер `api/expenses.py`

Префикс `/api/v1/expenses`, `dependencies=[Depends(get_current_user)]`:

```
GET    /expenses?status=&tag=&q=&include_inactive=   → list[ExpenseOut]
POST   /expenses                                     → ExpenseOut, 201
GET    /expenses/summary                             → ExpenseSummaryOut
GET    /expenses/{id}                                → ExpenseOut
PATCH  /expenses/{id}                                → ExpenseOut
POST   /expenses/{id}/move   {status, sort_order?}   → ExpenseOut
DELETE /expenses/{id}                                → 204
```

`/expenses/summary` объявляется **до** `/expenses/{id}`, иначе FastAPI попытается
разобрать `summary` как `int`. Ошибки `ExpenseError` → 400, отсутствие → 404, в
едином формате `{error: {code, message}}`.

Фильтр `q` — `ILIKE` по `title` и `note`; `tag` — точное вхождение в JSON-список, тем
же приёмом, что у `list_tasks`.

## 8. Быстрый ввод через LLM

### 8.1 Схема черновика

```python
class ExpenseDraft(BaseModel):
    title: str = Field(description="Short expense name, max 200 chars")
    amount_rub: float | None = Field(default=None, description="Price in rubles, or null if not stated")
    status: Literal["recurring", "wanted"] = Field(description="recurring for repeating payments, wanted for one-off purchases")
    period: ExpensePeriod | None = Field(default=None, description="Only for recurring")
    anchor_date: date | None = Field(default=None, description="ISO date of a charge, only for recurring")
    tags: list[str] = Field(default_factory=list, description="0-3 short lowercase tags")
```

`amount_rub` — рубли, дробные допускаются: модели проще написать `899.5`, чем считать
копейки. Сервер переводит `round(amount_rub * 100)`; `null` → `0` и черновик подсвечивает
пустую цену. `bought` из черновика не создаётся: покупки заводятся через `wanted` и
перетаскивание, либо PATCH.

### 8.2 Промпт и разбор дат

Отдельный `EXPENSE_SYSTEM_PROMPT` в `services/ai.py`, короче задачного: описание трёх
типов, четырёх периодов, правило «число без месяца — ближайшее такое число, не в
прошлом», правило «"каждый месяц", "подписка", "в год" → recurring; иначе wanted».
В user-сообщение подаются сегодняшняя дата (для «15 числа») и список существующих тегов
трат (для повторного использования). Список проектов и шкала оценок **не подаются**.

Функция:

```python
def draft_expense(db: Session, text: str) -> ExpenseDraftResult:
    # DraftResult-аналог: draft, degraded: bool, ai_meta
    draft, tin, tout = _call_model(EXPENSE_SYSTEM_PROMPT, user_message, schema=ExpenseDraft)
```

Результат постобрабатывается детерминированно: если `status == "recurring"` и
`period is None` → `period = month`; если `anchor_date is None` → `local_today()`.
Если `status == "wanted"` → `period` и `anchor_date` принудительно `None`. Так
инвариант §4 выполняется всегда, независимо от дисциплины модели.

### 8.3 Деградация

Полностью по FR-5.5: недоступность LLM, таймаут, невалидный JSON, ошибка валидации →
`degraded=True`, черновик `{title: text[:200], amount_rub: null, status: "wanted"}`.
Эндпоинт не падает, UI показывает ненавязчивое предупреждение и открытую форму.
`_log_usage` пишет `operation="draft_expense"`.

### 8.4 Эндпоинт

`POST /api/v1/ai/draft-expense {text}` → `{draft: ExpenseDraft, degraded: bool,
ai_meta: dict}`. В существующем роутере `api/ai.py`, рядом с `/ai/draft`. Черновик
только показывается; создание — отдельный `POST /expenses` с `source="ai"` и
`ai_meta` из ответа, ровно как у задач.

## 9. MCP

Четыре инструмента, каждый через `*_impl` для тестов, все — через `expense_svc`:

| Инструмент | Параметры | Описание для агента |
|---|---|---|
| `list_expenses` | `status?`, `tag?`, `query?`, `include_inactive?` | «Spending planner. Call before answering questions about subscriptions, recurring costs or the wishlist, and before creating an expense to avoid duplicates. status: recurring\|wanted\|bought.» |
| `create_expense` | `title`, `amount_rub`, `status?`, `period?`, `anchor_date?`, `note?`, `tags?` | «Record a recurring payment (status=recurring, needs period and anchor_date) or a wanted purchase.» |
| `update_expense` | `expense_id` + изменяемые поля, `active?`, `clear_period?` | «Edit an expense; set active=false to pause a cancelled subscription; status=bought marks a purchase.» |
| `expenses_summary` | — | «Monthly cost of active recurring expenses, charges due in the next 7 days, wishlist total and this month's purchases. Call this for any budget question.» |

Суммы на входе инструментов — в рублях (`amount_rub: float`), как в черновике: агент
мыслит рублями. На выходе `_expense_dict` отдаёт и `amount` (копейки), и
`amount_rub`. `source` ставится сервером жёстко `"mcp"`, параметром не принимается.
`update_expense` со `status="bought"` без `purchased_at` ставит `local_today()`.
Инструмента удаления нет: агенту достаточно паузы, удаление — действие владельца в UI.

`instructions` FastMCP дополняются одной фразой про планировщик трат.

## 10. Фронтенд

### 10.1 Навигация

Маршрут `/expenses` в `main.tsx`. Новый компонент `NavTabs` — два моно-линка «задачи |
траты» рядом с заголовком `tasktracker`; активный подчёркнут `amber`, как остальные
акценты. Вставляется в шапку `BoardPage` (единственная правка этого файла) и
`ExpensesPage`. Логин-редирект `?next=` уже работает для любого пути.

### 10.2 Страница `ExpensesPage`

По образцу `BoardPage`, без аналитики и проектов:

- три колонки `EXPENSE_COLUMNS = [recurring, wanted, bought]` из `types.ts`;
- `useQuery(["expenses", params])` и `useQuery(["expenses-summary"])`, `staleTime`
  как у доски;
- DnD (`@dnd-kit/core`): внутри любой колонки — порядок; между колонками — только
  `wanted ↔ bought`. `Регулярные` не даёт `useDraggable` перетащить карточку за
  пределы своей колонки: drop-зоны других колонок отвечают `isOver=false` через
  проверку статуса активной карточки в `onDragOver`. Оптимистичное обновление,
  откат при 400/сети;
- мобильный режим `< 768px`: табы колонок, `MobileDropZone` только для `wanted` и
  `bought`, смена статуса через контекстное меню карточки «куплено» / «вернуть в
  хочу»;
- URL: `?tag=`, `?q=`, `?inactive=1`, `?expense=<id>` (открытая карточка),
  `?col=` (мобильная колонка) — те же соглашения, что у `BoardPage`;
- шапка: `NavTabs`, `ExpenseQuickAdd`, кнопка фильтров, «выйти».

### 10.3 Полоса итогов

Под шапкой, над колонками: четыре моно-значения в одну строку (на мобильном — сетка
2×2): `в месяц 12 340 ₽ · ближайшие 7 дней 2 300 ₽ (3) · хочу 45 000 ₽ · куплено в сен
8 900 ₽`. Клик по «ближайшие» раскрывает список `upcoming` с датами. Данные из
`expenses-summary`; при ошибке запроса полоса скрывается, колонки работают.

### 10.4 Карточка `ExpenseCard`

Общий стиль с `TaskCard` (та же плотность, моно-цифры):

- строка 1: название; справа сумма `899 ₽`;
- строка 2 (только `recurring`): `месяц · след. 15 сен`. Подсветка `amber`, если
  `next_charge` сегодня или завтра. Для `day` строка `каждый день`;
- строка 2 (только `bought`): `куплено 3 сен`;
- теги как у задач; бейдж `AI` / `MCP` по `source`;
- неактивная регулярная карточка: `opacity-50`, подпись `пауза` вместо даты; в
  выдаче только при `?inactive=1`.

### 10.5 Модалка `ExpenseModal` и форма `ExpenseForm`

Одна форма на создание и редактирование, поля: название, сумма (рубли, `inputmode=
decimal`, в PATCH уходит `Math.round(x*100)`), тип (сегмент «регулярная | хочу |
куплено»), период и дата списания (видны только для регулярной; дата обязательна),
дата покупки (только для «куплено»), заметка (Markdown, как описание задачи), теги,
переключатель «активна» (только регулярная). Кнопки: «сохранить», «удалить» с
подтверждением, для «хочу» — «куплено» (то же, что перетаскивание). Смена типа в форме
— единственный способ превратить `wanted` в `recurring` и обратно (§7.1).

### 10.6 Быстрый ввод `ExpenseQuickAdd`

Копия `QuickAdd` с другим эндпоинтом и другим черновиком: поле, Enter → `POST
/ai/draft-expense` → `ExpenseForm` предзаполнена черновиком, кнопки «создать» /
«создать без правок». `MicButton`/`useDictation` переиспользуются как есть. Хоткей `n`
на этой странице открывает ввод траты, а не задачи: хоткей вешается страницей, не
глобально.

### 10.7 Типы и клиент

`types.ts`: `ExpenseStatus`, `ExpensePeriod`, `EXPENSE_COLUMNS`, `PERIODS` (id, title,
short), `Expense`, `ExpenseDraft`, `ExpenseSummary`. `api.ts`: `expenses`,
`createExpense`, `patchExpense`, `moveExpense`, `deleteExpense`, `expenseSummary`,
`draftExpense`. `lib/money.ts`: `formatRub(kopecks)`, `parseRub(str) → kopecks | null`
с тестами на «1 234,50», «899», «12.5», мусор.

## 11. Тестирование

Бэкенд (`pytest -m "not slow"`), новые файлы:

- `test_expense_next_charge.py` — чистая `next_charge`, без БД: 31 янв → 28 фев → 31
  мар; 29 фев → 28 фев следующего года и 29 фев через четыре; квартал с 30 ноя → 28/29
  фев; `anchor` в будущем; `anchor == today`; `day` → today.
- `test_expenses.py` — REST: инварианты статусов (400), `move` `wanted → bought`
  ставит дату и обратно снимает, `move` регулярной → 400, `clear_period`, фильтры
  `tag/q/include_inactive`, мягкое удаление и `purge_deleted_expenses`, `summary`
  с фиксированной датой (`monkeypatch` `local_today`): коэффициенты §6, `upcoming`
  окно 7 дней, ежедневная трата один раз, неактивные не в итогах, `bought_this_month`
  по локальному месяцу.
- `test_ai_expense.py` — мок `ai._call_model`: `schema=ExpenseDraft` доходит до мока;
  постобработка §8.2 (recurring без периода → month + today; wanted обнуляет период);
  `amount_rub → amount`; деградация при исключении и при невалидном JSON;
  `operation="draft_expense"` в `llm_usage`. Плюс регрессия: существующий
  `draft_task` продолжает вызывать `_call_model` без `schema` (совместимость моков).
- `test_mcp_expenses.py` — четыре `*_impl`: `source="mcp"`, рубли → копейки, пауза,
  `status="bought"` ставит дату, `expenses_summary` совпадает с REST.

Фронтенд (`vitest`):

- `money.test.ts` — формат и разбор;
- `ExpenseCard.test.tsx` — три статуса, подсветка «сегодня/завтра», пауза;
- `ExpenseForm.test.tsx` — условные поля по типу, обязательная дата у регулярной,
  рубли → копейки в отправке;
- `ExpensesPage.test.tsx` — колонки, полоса итогов, DnD `wanted → bought` вызывает
  `moveExpense`, регулярная не переносится, `?inactive=1` показывает паузу;
- `NavTabs.test.tsx` — активная вкладка по маршруту.

Гейты перед завершением: `make lint`, `make test`, `make build`.

## 12. ADR-0009

Фиксирует: отдельная сущность вместо подвида задач; копейки как `Integer`; одна
валюта настройкой; отсутствие журнала платежей и вычисляемое `next_charge`; новая
таблица без Alembic по правилу ADR-0008; параметр `schema` у `_call_model` как
единственная правка LLM-слоя; аддитивное расширение REST v1 и набора MCP-инструментов
четырьмя новыми. Статус `proposed` до утверждения владельцем, затем `accepted`.

## 13. Что мы сознательно НЕ строим

- Историю фактических платежей и галочки «оплачено» (решение 3): ближайшее списание
  вычисляется, а не подтверждается.
- Несколько валют и курсы (решение 6).
- Справочник категорий с цветами (решение 5): теги.
- Напоминания и уведомления о списаниях: вне рамок SPEC.md §13.
- Графики и аналитику трат по месяцам: без журнала платежей им не на чем стоять.
- Обобщённый канбан-каркас, общий для задач и трат (§2.4).
- MCP-инструмент удаления трат (§9).
- Период «неделя» (решение 10) и произвольные интервалы «каждые N дней».

## 14. Границы работы

- Ни одна существующая таблица, колонка, эндпоинт и MCP-инструмент не меняется.
  Единственные правки существующего кода: параметр `schema` в трёх функциях `ai.py`,
  вызов `purge_deleted_expenses` в `main.py`, `NavTabs` в шапке `BoardPage`, маршрут в
  `main.tsx`, регистрация роутера и инструментов.
- Деплой — по DEPLOYMENT.md, без шага миграции: `create_all` создаст `expenses` и её
  энумы при старте. Прод-деплой только по явному запросу владельца.
