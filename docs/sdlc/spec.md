# Stage 03 — Спецификация продукта и архитектуры (spec.md)

**ID инициативы:** `TGN-001`
**Основано на:** `docs/sdlc/intent.md`, `docs/decisions/001-architecture.md`, `docs/sdlc/source-of-truth.md`
**Визуальные референсы в Git:** `docs/design/ref-01-flow-and-usecases.jpg`, `docs/design/ref-02-monitor-and-results.jpg`
**Дата:** 2026-11-20
**Статус:** Обновлено после независимого Blind Builder Check — готово к утверждению владельцем продукта

---

## 1. Обзор системы и модель исполнения

**TG Naydi** — веб-платформа на **Next.js (App Router, TypeScript, Tailwind CSS)** для пакетного обогащения пользовательских CSV-баз телефонных номеров данными о Telegram-аккаунтах (`username` и тип аккаунта) с поддержкой паузы, продолжения после перезагрузки страницы (`F5`), маскировки номеров и выгрузки `result.csv`.

### Чёткое разделение режимов исполнения (CTO-решение по итогам Builder Check)
- **Режим `SANDBOX` (`PROVIDER_MODE=SANDBOX`, по умолчанию для пилота и CI):**
  - Браузер вызывает `POST /api/jobs/[id]/step` с интервалом `pauseMs`. Каждый шаг атомарно обрабатывает 1 пачку через `SandboxLookupProvider` под per-job lease-блокировкой (15s TTL).
  - Внешний воркер не нужен; GramJS **не попадает** в клиентский или Vercel serverless бандл.
- **Режим `LIVE_MTPROTO` (`PROVIDER_MODE=LIVE_MTPROTO`):**
  - Исполнение происходит **исключительно** в отдельном процессе `worker/mtproto.ts` (VPS / Railway / Fly.io / локально), подключённом к тому же `JobStore` (Upstash Redis или FileStore).
  - `worker/mtproto.ts` читает глобальную FIFO-очередь активных задач (`listActiveJobs()`), держит глобальный мьютекс Telegram-сессии (`lock:mtproto:session`, 60s TTL с продлением на каждом батче — одновременно обрабатывается строго 1 живая задача, остальные ждут в статусе `queued`) и обновляет ключ пульса `worker:heartbeat` каждые 15 секунд.
  - В режиме `LIVE_MTPROTO` браузер опрашивает `GET /api/jobs/[id]` (а `POST /api/jobs/[id]/step` возвращает `202 { delegatedToWorker: true }`).
  - Создание/запуск задач в `LIVE_MTPROTO` защищены ключом оператора (`OPERATOR_ACCESS_KEY` → `HttpOnly` cookie через `POST /api/auth/operator`), а на сервере принудительно действуют минимумы безопасности: `pauseMs >= 15000` и `batchSize <= 15`.

### Архитектурная схема

```text
[Browser UI (Next.js)]
   |-- 1. Client-side CSV parse (papaparse) + Windows-1251/UTF-8 decode + libphonenumber-js E.164 normalize
   |-- 2. Chunked upload (<= 500 phones/req, ~25 KB << 4.5 MB Vercel limit)
   v
[Vercel Next.js API Routes]  <-- (GramJS NOT bundled here)
   |-- POST /api/auth/operator            (LIVE_MTPROTO only: validate OPERATOR_ACCESS_KEY -> HttpOnly cookie)
   |-- POST /api/jobs                     (create draft job, mint secret jobToken -> HttpOnly cookie; 503 if Vercel storage unconfigured)
   |-- POST /api/jobs/[id]/chunks         (append normalized unique phones, enforce max 10,000)
   |-- POST /api/jobs/[id]/start          (draft -> running in SANDBOX, or queued/running in LIVE_MTPROTO)
   |-- POST /api/jobs/[id]/step           (SANDBOX: process 1 batch under 15s lease; LIVE_MTPROTO: 202 delegatedToWorker)
   |-- POST /api/jobs/[id]/pause          (running/queued -> paused)
   |-- POST /api/jobs/[id]/resume         (paused/rate_limited -> running/queued)
   |-- GET  /api/jobs/[id]                (job state, counters, masked items page)
   |-- GET  /api/jobs/[id]/export         (download UTF-8 BOM result.csv with mode stamp)
   |-- DELETE /api/jobs/[id]              (immediate PII deletion)
   |-- GET  /api/health                   (liveness, storageMode, providerMode, workerOnline, commitSha, job summary counters)
   v
[JobStore Interface]                     [Execution Providers]
   |-- UpstashRedisJobStore (Vercel)        |-- SandboxLookupProvider (inside Next.js /step, deterministic, zero-ban)
   |-- FileJobStore (Local / CI)            |-- worker/mtproto.ts + MtprotoLookupProvider (GramJS standalone daemon)
```

---

## 2. Разрешённые противоречия и риски (обязательный реестр Stage 03)

| # | Противоречие / риск | Техническое разрешение | Владелец правила | Статус |
| :--- | :--- | :--- | :--- | :--- |
| C1 | **Лимит тела запроса Vercel 4.5 MB** против больших CSV | Парсинг CSV и нормализация идут в браузере; на сервер отправляются только очищенные чанки `<= 500` номеров (~25 KB JSON). Лимит задачи MVP: `10 000` уникальных номеров. | Инженер (Vercel Docs) | Разрешено |
| C2 | **Vercel без локального диска** и что делать, если `UPSTASH_REDIS_REST_URL` не задан | На Vercel **Upstash Redis Free** обязателен для продакшн-работы (`storageMode: 'upstash'`, TTL 24ч). Если на Vercel (`VERCEL=1`) переменные Upstash не настроены, сервис ведёт себя **fail-closed** (никакого обманчивого `/tmp`): `/api/health` отдаёт `storageMode: 'unconfigured'`, `POST /api/jobs` возвращает `503 STORAGE_NOT_CONFIGURED`, а UI показывает понятную карточку подключения Upstash в 1 шаг. Локально и в CI используется `FileJobStore` (`.data/jobs/`). | Инженер | Разрешено |
| C3 | **Telegram Bot API не ищет по номеру** + разделение Vercel и MTProto + защита операторского аккаунта | `SANDBOX` работает через `/step` с неубираемым бейджем `ДЕМО-РЕЖИМ (SANDBOX)` и колонкой `mode=SANDBOX`. `LIVE_MTPROTO` работает **только** через отдельный воркер `worker/mtproto.ts` (GramJS: `importContacts` → `getFullUser` → `deleteContacts`), защищён `OPERATOR_ACCESS_KEY`, глобальным session-мьютексом (FIFO по 1 задаче) и серверным минимумом `pauseMs >= 15000`, `batchSize <= 15`. | Владелец продукта + Инженер | Разрешено (на утверждение) |
| C4 | **Честная классификация `человек` / `канал` / `не найден или скрыт` + сходимость счётчиков** | (1) Telegram **не различает** незарегистрированный номер и закрытую приватность — поэтому используется единый честный статус `not_found_or_hidden` (`не найден / скрыт`) в обоих провайдерах. (2) Канал определяется строго по `userFull.personal_channel_id` (без парсинга bio). (3) Иерархия классификации: `user.bot` → `bot`; иначе если `personal_channel_id` даёт публичный `@channel` → `channel` (`username = '@<channel>'`, личный ник сохраняется в `personal_username`); иначе если есть `user.username` → `person`; иначе `found_no_username`. (4) Инвариант счётчиков: `foundWithUsername === personWithUsername + channelWithUsername + botWithUsername` (если `botWithUsername > 0`, в UI появляется 4-я метка `бот`, поэтому итог всегда сходится на 100%). | Владелец продукта + Инженер | Разрешено (на утверждение) |
| C5 | **Персональные данные (PII) и безопасность** | (1) UUIDv4 `jobId` + 256-битный `accessToken` (SHA-256 хеш в `JobStore`, `HttpOnly; SameSite=Lax; Path=/` cookie; без токена — `401`). (2) В UI и `GET /api/jobs/[id]` номера всегда маскированы (`+7 905 •••-45-67`). (3) Полные номера выдаются только в `GET /api/jobs/[id]/export`. (4) Автоудаление через 24 часа + кнопка «Удалить базу сейчас». (5) Логгер вырезает телефоны и секреты. | Инженер (Security) | Разрешено |
| C6 | **Windows + WSL1 без `bubblewrap` / Docker** | Честно фиксируем отсутствие OS-песочницы на Windows: локально барьеры держат `.claude/settings.json` (`permissions.deny`) и `PreToolUse`-хуки (`exit 2`, с fail-closed проверкой `TGNAYDI_REQUIRE_SANDBOX=1`); обязательная Linux-проверка + `gitleaks` вынесены в GitHub Actions (`ubuntu-latest`). | Инженер (DevEx) | Разрешено |
| C7 | **Защита теста при багфиксе vs карантин flaky-теста** | При наличии `.claude/state/protected-tests.json` `PreToolUse`-хук блокирует (`exit 2`) правки перечисленных тестов. Карантин flaky-теста допускается только отдельной задачей с PR, отметкой в `REVIEW.md` и одобрением владельца кода. | Инженер (SDLC) | Разрешено |

---

## 3. Функциональные требования

### 3.1. Загрузка и нормализация CSV (`src/lib/csv-parser.ts`, `src/lib/phone-normalizer.ts`)
- **Принимаемые файлы:** `.csv`, `.txt` до 20 MB на клиенте (разбор в браузере, отправка чанками `<= 500` номеров).
- **Кодировки:** автоопределение UTF-8 (с BOM и без) и fallback на `windows-1251` при невалидных UTF-8 байтах (критично для русского Excel).
- **Разделители:** автоопределение `,`, `;`, `\t` через `papaparse` (для `.txt` — построчный режим).
- **Автопоиск колонки телефонов:**
  1. Заголовок совпадает с `/phone|телефон|номер|тел|mobile|tel|contact|контакт/i`.
  2. Иначе — первая колонка, где ≥ 50% первых 20 непустых строк распознаются `libphonenumber-js`.
  3. При неоднозначности UI показывает селектор колонки до старта.
- **Нормализация (`libphonenumber-js`):**
  - Регионы по умолчанию в UI: `RU` (по умолчанию), `UZ`, `KZ`, `UA`, `BY`, `US`; международные номера с `+` распознаются независимо от выбранного региона.
  - Для `RU` 11-значная строка на `8` (`8 (905) 123-45-67`) нормализуется в `+79051234567`.
  - Дедупликация по каноническому E.164 с сохранением исходного порядка.
  - Сводка до старта: `всего строк`, `уникальных валидных`, `удалено дублей`, `некорректных строк`.
- **Кнопка «Загрузить пример (Контакты Казани.csv)»:** загружает встроенный тестовый CSV (25 строк: разные форматы телефонов, 2 дубля, 1 битая строка → 22 валидных уникальных номера, включая `@beze_cakes_kzn` `человек`, `@speakup_kids_kzn` `канал`, `@mimi_nails_kzn` `человек`, чтобы за 1 клик проверить весь путь).

### 3.2. Машина состояний, хранилище и пакетная обработка (`src/lib/job-store/`, `src/lib/job-engine.ts`)
- **Состояния задачи (`JobStatus`):**
  - `draft` → (`start`) → `running` (в `SANDBOX`) или `queued` (в `LIVE_MTPROTO`, пока воркер не возьмёт задачу в `running`)
  - `running` / `queued` → (`pause`) → `paused`
  - `running` → (`FLOOD_WAIT`) → `rate_limited` (`retryAfterAt` ISO timestamp + обратный отсчёт)
  - `paused` / `rate_limited` → (`resume`) → `running` (или `queued` в `LIVE_MTPROTO`)
  - `running` → (`pending === 0`) → `completed`
  - Невосстановимая ошибка → `failed` (уже найденные результаты сохраняются и доступны для скачивания).
- **Интерфейс `JobStore`:**
  - `createJob(job, tokenHash)`, `getJob(id)`, `verifyToken(id, rawToken)`, `appendItems(id, items)`, `saveJob(job)`, `deleteJob(id)`.
  - `acquireJobLease(id, ttlMs)` / `releaseJobLease(id, leaseId)` (защита от двойной обработки шага).
  - `listActiveLiveJobs()`, `acquireGlobalSessionLock(ttlMs)` / `releaseGlobalSessionLock(lockId)`, `setWorkerHeartbeat(ts)` / `getWorkerHeartbeat()` (для `worker/mtproto.ts` и `/api/health`).
  - `recordJobOutcome('completed' | 'failed' | 'rate_limited')` + `getRecentMetrics()` (лёгкие счётчики уровня задач для `/api/health`, без записи на каждый HTTP-запрос).
- **Восстановление после `F5`:**
  - При создании задачи URL обновляется на `/?job=<jobId>` (плюс в `localStorage` сохраняется **только** ID последней задачи `tgnaydi:lastJobId`, никогда не сами номера или результаты).
  - При загрузке страницы клиент запрашивает `GET /api/jobs/[id]` с сервера (cookie с токеном отправляется автоматически) и полностью восстанавливает статус (`paused`, `running`, `rate_limited`, `completed`), счётчики и маскированный список.

### 3.3. Контракт провайдеров (`src/lib/providers/`)
```ts
export type AccountType = 'person' | 'channel' | 'bot';

export type LookupOutcome =
  | {
      status: 'found';
      username: string;
      accountType: AccountType;
      personalUsername?: string;
      linkedChannel?: string;
    }
  | { status: 'found_no_username'; accountType: 'person' }
  | { status: 'not_found_or_hidden' }
  | { status: 'error'; errorCode: string };

export interface BatchLookupResult {
  items: Record<string, LookupOutcome>;
  floodWaitSeconds?: number;
}

export interface TelegramLookupProvider {
  readonly mode: 'SANDBOX' | 'LIVE_MTPROTO';
  lookupBatch(phones: string[]): Promise<BatchLookupResult>;
}
```
- **`SandboxLookupProvider` (`src/lib/providers/sandbox.ts`):**
  - Детерминированный результат по хешу E.164 + явная карта фикстурных номеров для примера «Контакты Казани» (19 найденных username = 14 человек + 5 каналов, плюс 3 `not_found_or_hidden`).
  - Специальный тестовый номер `+79990000429` однократно триггерит `floodWaitSeconds: 3` (на первом проходе, помечаясь в метаданных задачи как отработанный, чтобы после паузы проверка успешно завершилась — проверяется автотестом!).
- **`MtprotoLookupProvider` (`src/lib/providers/mtproto.ts`) + `worker/mtproto.ts`:**
  - Зависимость `telegram` (GramJS) используется **только** в воркере и контрактных тестах (не импортируется в Next.js `src/app/`).
  - Выполняет `contacts.importContacts` → для каждого найденного пользователя `users.getFullUser` (проверяя `personalChannelId` и разрешая `@username` через `channels.getChannels`) → `contacts.deleteContacts` в `finally`-блоке.
  - Перехватывает `FloodWaitError` (`err.seconds`), прерывает батч и переводит задачу в `rate_limited` без попыток обхода.
  - Контрактные unit-тесты с моком GramJS покрывают: `person`, `channel` (`personalChannelId`), `bot`, `found_no_username`, `not_found_or_hidden`, `FloodWaitError` и гарантированный вызов `contacts.deleteContacts`.

### 3.4. Экспорт `result.csv` (`src/lib/csv-exporter.ts`)
- Кодировка: **UTF-8 с BOM (`\uFEFF`)**.
- Разделитель: `;` по умолчанию (для русского Excel на Windows), опциональный query-параметр `?delimiter=comma` для стандартного `,`.
- Защита от CSV Formula Injection: экранирование `'` для опасных формульных значений (`=`, `\t`, `\r`, формул с `(`/`!`), сохраняя чистыми валидные E.164 (`^\+\d{7,15}$`) и Telegram-юзернеймы (`^@[a-zA-Z0-9_]{3,32}$`).
- Колонки: `phone`, `username`, `type`, `type_label`, `status`, `personal_username`, `linked_channel`, `mode`, `checked_at`.
- Поддержка `?onlyFound=1` («Только с username») и скачивания частичных результатов на паузе.

### 3.5. Визуальная спецификация и точные тексты (самодостаточно в Git для Blind Handoff)

Визуальные ориентиры зафиксированы в `docs/design/ref-01-flow-and-usecases.jpg` и `docs/design/ref-02-monitor-and-results.jpg`.

- **Палитра и стиль:**
  - Светлая база страницы `#F5F7FA`, карточки `#FFFFFF` (`border #E5E7EB`, `rounded-2xl`, мягкая тень), контрастная тёмная карточка живого монитора `#111318` (внутренние строки `#1A1D24`, бордер `#262A34`, текст `#F8FAFC`, вторичный `#94A3B8`).
  - Акценты: синий `#2563EB` / `#3B82F6` (иконка файла, пульсирующая точка, прогресс), зелёный `#16A34A` / `#DCFCE7` («готово», «человек, пиши», бейдж `человек`), янтарный `#D97706` / `#FEF3C7` («канал», бейдж `канал`).
  - Шрифты: `Inter` (основной) + `JetBrains Mono` (маскированные номера и `@username`).
- **Верхняя полоса режима:**
  - Логотип `TG Naydi` + бейдж режима (`ДЕМО-РЕЖИМ (SANDBOX)` янтарный или `LIVE MTProto` зелёный с индикатором `Воркер онлайн/офлайн`) + ссылка статуса `/api/health`.
- **Секция 1 — Hero и рабочее пространство (2-колоночный layout на desktop `lg:grid-cols-12`, вертикальный стек на mobile):**
  - Заголовок (точный текст со Скриншота 2): **«Подготовь базу к рассылке в Telegram»**
  - Подзаголовок (точный текст со Скриншота 2): *«Загружаешь свою базу с номерами, получаешь тот же файл с username и типом аккаунта. Дальше писать можно по username, а не по номерам: меньше ошибок и ниже риск ограничений.»*
  - **Левая/верхняя колонка — Загрузка и управление:**
    - Dropzone для `.csv`/`.txt` + кнопка **«Загрузить пример (Контакты Казани.csv)»**.
    - Компактные настройки: страна (`RU +7`, `UZ +998`, ...), пачка (`5`), пауза (`0.8 с` в Sandbox / `≥ 15 с` в Live), выбор колонки при неоднозначности.
    - Предпросмотр валидации (`всего / уникальных / дублей / битых`) + кнопка **«Запустить проверку»**.
  - **Правая/основная колонка — Тёмный монитор проверки (по Скриншоту 2):**
    - Заголовок: синяя иконка файла + имя файла (`база.csv`) + статус (`• проверяем` / `• на паузе` / `• готово` / `• пауза FLOOD_WAIT: Nс`).
    - Кнопки: **Пауза** / **Продолжить** / **Удалить базу**.
    - Таблица с колонками `Телефон | Telegram | Тип`: маскированные номера (`+7 905 •••-45-67`), спиннер на активной строке, найденный `@username` и цветная плашка (`человек` / `канал` / `не найден / скрыт`).
- **Секция 2 — Карточка прогресса и итогов (по Скриншотам 1 и 2):**
  - Верхняя полоса: `<файл>.csv (N номеров)` `────►` `result.csv (username и тип)` + статус `Готово` / `В процессе` + счётчик `X из Y` + зелёно-синий прогресс-бар.
  - Три (или четыре, если найдены боты) плитки-счётчика в карточке результата:
    - **`N`** — `найден username`
    - **`M`** (зелёный) — `человек, пиши`
    - **`K`** (янтарный) — `канал`
  - Фильтры (`Все` / `Человек` / `Канал`) + список тегов `@beze_cakes_kzn [человек]`, `@speakup_kids_kzn [канал]` + кнопки **«Скачать result.csv (Excel)»** и **«Только с username»**.
- **Секция 3 — «Как это работает» (точные 3 шага со Скриншота 1):**
  1. **Загружаешь файл с телефонами** — *Из своей CRM, заявок или базы, которую собрал сам. Формат номеров любой.*
  2. **Запускаешь проверку** — *Номера идут пачками с паузами на отдельном аккаунте. Прогон можно остановить и продолжить.*
  3. **Получаешь файл с username и типом** — *И дальше пишешь по username.*
- **Секция 4 — «Где это пригодится» (точные 4 карточки со Скриншота 1):**
  - Подзаголовок: *Подходит для своей базы: клиенты, заявки, партнёры.*
  - **Telegram-рассылки** — *Чистая база для предложений и уведомлений*
  - **Лидогенерация** — *Проверка контактов перед работой*
  - **Продажи и аутрич** — *Больше точных контактов, меньше потерь*
  - **Агентства** — *Подготовка баз для клиентов*
- **Футер:** предупреждение о работе только со своей базой контактов, автоудалении через 24 часа и ссылка на инструкцию владельца (`docs/owner-guide.md`).

---

## 4. Требования AI-native SDLC, безопасности, Evals и мониторинга

1. **Единая команда проверки:** `pnpm run check` запускает `tsc --noEmit` → `eslint` → `vitest run` (ненулевой exit code при сбое). E2E: `pnpm run test:e2e` (Playwright).
2. **Контекст и навыки агента:**
   - `CLAUDE.md` — краткий, проверенный командами.
   - `.claude/skills/csv-pii-safety/SKILL.md` — правила кодировок CSV, формульной защиты, маскирования и запрета логирования PII.
   - `.claude/skills/bugfix-protected-test/SKILL.md` — процедура «падающий тест → блокировка в `.claude/state/protected-tests.json` → фикс → снятие блокировки».
   - `REVIEW.md` — проходы по багам, безопасности, соответствию `spec.md`/`plan.md`, не более 5 мелких замечаний.
3. **Технические барьеры (`.claude/settings.json` + `scripts/hooks/pre_tool_guard.py` + `scripts/verify_guards.py`):**
   - `permissions.deny`: `.env`, `.env.*`, `*.session`, `secrets/**`.
   - `PreToolUse` хук (`exit 2` + `stderr` + аудит в `.data/hook-audit.jsonl`):
     1. Блокирует чтение/печать `.env` и `*.session` через `Read`/`Bash`/`PowerShell`.
     2. Блокирует изменение файлов из `.claude/state/protected-tests.json`.
     3. Блокирует прямой `git push` в `main` и `--force`.
     4. В режиме `TGNAYDI_REQUIRE_SANDBOX=1` на Windows без WSL2/Docker падает **fail-closed** с `exit 2`.
4. **Двухуровневый Eval-контур (`evals/`):**
   - **Уровень 1 — Детерминированный доменный eval (`evals/domain-eval.test.ts`, 15 реальных кейсов):** запускается в `pnpm run eval:domain` и CI (Windows-1251, `;`, дедупликация, `8 905...`, пауза+F5, `FLOOD_WAIT`, `personal_channel_id`, инвариант счётчиков, CSV formula injection, PII log redaction, `not_found_or_hidden`, частичный экспорт, lease mutex, `PreToolUse` `exit 2`, детектор аномалий `3σ → intent.md`).
   - **Уровень 2 — A/B Eval конфигурации агента и триггера навыков (`evals/agent-ab/`):**
     - **Вариант A (Control):** чистая изолированная сессия агента **без** `CLAUDE.md` и `.claude/skills/*`.
     - **Вариант B (Treatment):** чистая изолированная сессия агента **с** `CLAUDE.md`, `.claude/skills/*` и `REVIEW.md` на тех же задачах и том же SHA коммита.
     - **Проверка навыков:** 4 разных перефразировки задач для проверки срабатывания `csv-pii-safety` и `bugfix-protected-test`.
     - **Исполнение:** в репозитории лежит скрипт `scripts/evals/run_claude_ab.mjs` для `claude -p --output-format json` (готов к запуску при `claude auth login`); для текущего пилота (где `claude` CLI не авторизован и бюджет \$0) A/B-сравнение реально выполняется изолированными субагентами на одном и том же SHA с оценкой детерминированным грейдером и сохранением сырого отчёта в `evals/reports/ab-eval-report.md` (с честным указанием использованного раннера).
5. **Мониторинг и замкнутый цикл (`scripts/monitoring/anomaly_detector.mjs` + `.github/workflows/monitoring.yml`):**
   - `/api/health` отдаёт `status`, `version`, `commitSha`, `providerMode`, `storageMode`, `workerOnline`, `metrics` (счётчики уровня задач из `JobStore`).
   - `anomaly_detector.mjs` хранит скользящую историю проб, вычисляет `1σ` (лог), `2σ` (read-only диагностика), `3σ` или `errorRate > 5%` / `status !== 'ok'` → автоматически генерирует `docs/sdlc/incidents/intent-INC-<timestamp>.md`.
   - Запускается локально (покрыто `vitest`) и по расписанию в `.github/workflows/monitoring.yml`, открывая PR при инциденте 3-го уровня (прямой push в `main` запрещён).

---

## 5. Проверяемые критерии приёмки (Definition of Done)

- [ ] `pnpm run check` + `pnpm run eval:domain` (включая контрактные тесты GramJS и unit-тесты детектора аномалий) завершаются с кодом `0`.
- [ ] `pnpm run test:e2e` (Playwright) проходит сквозной сценарий: загрузка грязного CSV (Windows-1251, `;`, дубли, разные форматы) → Старт → Пауза → перезагрузка (`F5`) → Продолжить → проверка сохранения прогресса → скачивание `result.csv` с UTF-8 BOM и сходящимися счётчиками → удаление базы.
- [ ] Провокационный тест барьеров (`python scripts/verify_guards.py`) фиксирует `exit 2` на всех 4 запрещённых действиях (включая `fail-closed` при `TGNAYDI_REQUIRE_SANDBOX=1`) и пропуск разрешённых операций.
- [ ] Слепая передача (Blind Handoff): чистый субагент без истории чата восстанавливает смысл, ADR и проверяет PR по `REVIEW.md` только по файлам в Git (включая референсные скриншоты в `docs/design/`).
- [ ] A/B eval выполнен с воспроизводимым отчётом в `evals/reports/ab-eval-report.md` и проверкой навыков на 4 перефразировках.
- [ ] Приложение задеплоено на публичный URL `*.vercel.app` (с подключённым Upstash Redis), выполнена реальная репетиция отката (`vercel rollback`) с логом `/api/health` до и после отката, а GitHub Actions CI + `gitleaks` зелёные.
