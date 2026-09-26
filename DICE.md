# Серверный Nebi Dice

Реализован серверный DEMO-режим. PostgreSQL хранит поле, раунды, команды, кошелёк и журнал. Клиент получает только открытые им клетки. Реальные деньги, пополнение, вывод и общий джекпот не подключены.

## Запуск

В backend: npm install, npm run db:migrate, npm run build, npm run start:prod.
DATABASE_URL обязателен; PostgreSQL должен быть доступен. Миграции выполняются отдельно до запуска.

На frontend: npm install, npm run build. NUXT_BACKEND_BASE указывает на Nest /api.
NUXT_PUBLIC_DICE_SOCKET_BASE — origin Nest (локально http://127.0.0.1:3001, для E2E http://127.0.0.1:3004).
В production задайте HTTPS-origin сокета и DICE_WS_ORIGINS как точный список HTTPS-origin сайта.
При same-origin reverse proxy задайте публичный origin сайта и проксируйте /socket.io в Nest с Upgrade.
Не выставляйте внутренний http://127.0.0.1:3001 в конфигурации публичного сайта.

## Авторизация

POST /api/auth/ws-ticket через Nuxt BFF: HttpOnly cookie остаётся на Nuxt, существующий bearer передаётся только между серверами.
Клиент получает отдельный случайный билет на 30 секунд, однократный после успешного подключения; в БД хранится его SHA-256.
Socket.IO namespace /dice, transport websocket, auth: { ticket }. Билет не передавать через URL и не сохранять в localStorage.

Это осознанное уточнение исходной схемы cookie через same-origin WS proxy: одноразовый билет поддерживает отдельный домен Nest и существующий BFF. При reconnect нужен новый билет.
Origin проверяется до Upgrade и при входе в namespace. Каждая команда проверяет исходную сессию в PostgreSQL; logout запрещает последующие команды. Активный раунд остаётся в БД.

## Протокол

Канонические типы: src/dice/contracts.ts, доступны Nuxt через shared/types/dice.ts.
Все запросы содержат requestId UUIDv4.

- dice.start: stakeMinor (строка в сотых фишки), mines (1–10).
- dice.reveal: roundId, expectedVersion, cellIndex (0–24).
- dice.cashout: roundId, expectedVersion.
- dice.sync: необязательный roundId; без него активный или последний раунд.
- dice.commandStatus: operationId — requestId прежней мутации.

ACK — ok/requestId/data либо ok:false/requestId/error{code,message,retryable}.
data мутаций/sync содержит balanceMinor, walletVersion, round, history (последние 8 завершённых раундов).
При reveal round.openedCells содержит только выбранную клетку. Sync восстанавливает уже открытые клетки.
Ни один ответ, включая историю завершённого раунда, не содержит private mask или неоткрытые мины.
При start openedCells пуст. На проигрыше декоративное раскрытие остальных мин удалено.

Один активный раунд на аккаунт. Статусы ACTIVE, LOST, WON (все безопасные клетки), CASHED_OUT.
Числа денег — строки BIGINT; множитель — целые сотые. DTO не преобразует строку индекса в число.
Экономика dice-1: 0,97 / вероятность, множитель вниз до 2 знаков, выплата вниз до целой фишки, точная BigInt арифметика.
Первый доступ выдаёт один грант 10000 DEMO-фишек; грант уникален, публичного сброса нет.

## Транзакции и повтор

На аккаунт берётся PostgreSQL advisory transaction lock; затем кошелёк/раунд блокируются для записи.
Сессия заблокирована FOR SHARE до commit: logout и команда получают определённый порядок.
Все денежные изменения, ход, статус и сохранённый ответ успешной команды фиксируются атомарно. ACK только после commit.
Одинаковый userId/requestId и payload возвращают прежний ответ; другой payload — IDEMPOTENCY_CONFLICT.
Ошибки до commit не сохраняются как успешная команда и не меняют деньги; отказавшую временно операцию можно явно повторить с тем же ID.
Защита действует между вкладками и процессами Nest, не зависит от памяти конкретного gateway.

При неизвестном исходе клиент сохраняет ID/payload в sessionStorage без авторизационных данных, блокирует новые ходы и запрашивает commandStatus + sync.
Повтор мутации — только по явной кнопке с прежним ID. Автоматического повторения ставок нет.
Старые ответы не откатывают walletVersion/version. Disconnect не завершает раунд. Срок истечения активного раунда не введён.

## Ограничения и эксплуатация

- До 4 соединений на аккаунт, leases в БД на 90 секунд, обновление каждые 30 секунд.
- 30 подключений/IP/мин по умолчанию; DICE_WS_HANDSHAKES_PER_MIN настраивает admission limit (1–10000).
- 15 команд/сек на аккаунт; дополнительно локальная защита от flood и одна исполняемая команда на соединение.
- Frame до 4 KiB, неизвестные события разрывают соединение, websocket compression отключена.
- lock timeout 3 секунды, statement timeout 5 секунд, клиентский ACK timeout 8 секунд.
- IP берётся из сокета, X-Forwarded-For не доверяется. За reverse proxy нужен внешний admission limit по реальному IP; лимит Nest будет общим для IP прокси.
- При недоступной БД нет локального игрового fallback.
- Кошелёк и проводки используют Sequelize-модели; специализированные блокировки, идемпотентность и private игровые выборки — параметризованные запросы через Sequelize transaction.
- История ограничена последними 8 раундами; общий архив с cursor-pagination не входит в текущий UI.
- Между вкладками нет push-broadcast: устаревшая команда получает VERSION_CONFLICT и sync. Это сохраняет корректность, даже без Redis adapter.
- Таймер обслуживает leases/сессии; при аварийном завершении процесса lease освобождается по TTL.
- Скрытый CSPRNG не называется provably fair. Отдельный проверяемый commit/reveal протокол не реализован.

## Проверки

npm run check в backend: lint, typecheck, unit, PostgreSQL/WS integration, build.
Frontend: npm run lint, npm run typecheck, npm run build, затем Playwright.
Для тестов требуется отдельная TEST_DATABASE_URL; migrations выполняет backend/scripts/e2e-server.mjs.
Прямой запуск backend integration предполагает предварительную миграцию тестовой БД.

Dice integration проверяет повтор команды, одновременные старты, гонку mine/cashout, потерю ACK, IDOR, DTO, отзыв сессии, Origin,
одноразовые билеты, лимит соединений, oversized frame, rate limit, rollback при ошибке журнала, auto-win и рестарт backend.
Playwright использует настоящие Nest/PG и WS, без подмены результатов игры. Проверяет обе возможные ветки случайного хода.
В integration детерминированный RNG заменяется только DI-provider тестового приложения, production-параметра seed нет.

npm audit backend показывает существующую транзитивную advisory uuid через Sequelize (v3/v5/v6 с пользовательским buffer).
Игровые UUID создаются node:crypto.randomUUID; этот уязвимый интерфейс игра не использует. Автоматического совместимого исправления в текущем дереве npm не предлагает; major override не применялся.

## Результат локального нагрузочного прогона

18.09.2026: 100 подключений, 300 команд, 50 команд/сек, пул PostgreSQL 10. p50=19 мс, p95=24 мс, p99=35 мс, ошибок 0, расхождений ledger 0. Это короткий локальный smoke нагрузки, не оценка production-мощности. Admission limit для подготовки 100 соединений временно повышается только в отдельном процессе benchmark.
Повтор: npm run build и node scripts/dice-load.mjs из backend. Скрипт требует отдельную TEST_DATABASE_URL, создаёт тестовые аккаунты, сохраняет dice-load-result.json.
