# Nebuli Backend

Самостоятельный API на NestJS, TypeScript и PostgreSQL. Фронтенд находится в отдельном репозитории: https://github.com/javascriptninjazxc/nebu-front.

## Запуск

Требуются Node.js 22.23.2+ (или совместимая версия из engines) и npm 11+. В npm 10.9.2 обнаружена ошибка разрешения зависимостей edgesOut; используйте npm 11.

Из корня этого репозитория:

```sh
npm ci
cp .env.example .env
# Настройте DATABASE_URL и AUTH_PROXY_SECRET в .env
npm run db:migrate
npm run start:dev
```

По умолчанию http://127.0.0.1:3001. Фронтенд продолжает работать на порту 3000. При необходимости скопируйте .env.example в .env; переменные процесса имеют приоритет над .env.

Запуск production: npm run build, затем npm run start:prod. Перед первым запуском подготовьте PostgreSQL и примените миграции командой npm run db:migrate.

## Конфигурация

- PORT: 3001, допустимы целые 1–65535.
- HOST: 127.0.0.1; для контейнера/внешнего интерфейса задайте 0.0.0.0 явно.
- CORS_ORIGINS: список точных origins через запятую, по умолчанию localhost:3000 и 127.0.0.1:3000. Cookie credentials пока выключены; CORS не заменяет авторизацию.
- Все endpoints имеют префикс /api.

## API

- GET /api/health — liveness приложения, не проверка готовности БД.
- GET /api/jackpots/config — публичные настройки Mini (1% ставки, каждый час) и Mega (1%, ежедневно в 00:00 Europe/Moscow). enabled=true, валюта DEMO; взносы из «Тайников Неби».

Серверные DEMO-раунды, общий кошелёк, периодические розыгрыши и получение приза реализованы и подключены к Nuxt. Протокол и запуск: [ORIGINALS.md](ORIGINALS.md). Настройки API берутся из runtimeConfig, секреты остаются в закрытом окружении.

## Проверки

npm run check выполняет lint (Oxlint из актуального Nest starter), typecheck, unit-тесты, HTTP E2E и сборку. npm run format форматирует исходники. Тестам нужны локальный PostgreSQL и отдельная TEST_DATABASE_URL; внешние API не используются.

## Базовая HTTP-настройка

- NODE_ENV: development (по умолчанию), test или production. Некорректные значения окружения останавливают запуск.
- SWAGGER_ENABLED: true/false; без явного значения документация включена только в development. Swagger: /api/docs, OpenAPI JSON: /api/docs-json.
- Глобальный ValidationPipe: DTO-классы с class-validator, transform, whitelist и forbidNonWhitelisted. Лишние поля отклоняются, строки не превращаются автоматически в числа. Для новых endpoints используйте классы DTO, а не интерфейсы.
- JSON-тело ограничено 100 КБ. Helmet задаёт защитные заголовки; HSTS и upgrade-insecure-requests включены в production.
- CORS разрешает чтение x-request-id. Входящий ID принимается только из 1–64 латинских букв, цифр, дефиса или подчёркивания; иначе создаётся UUID. ID служит для диагностики, не для авторизации или идемпотентности.
- JSON-логи содержат ID, метод, статус и длительность запроса. Тела, cookie, Authorization, query string и сообщения внутренних исключений не логируются.
- Ошибки API: { statusCode, message, requestId, timestamp }. message — строка либо массив ошибок DTO. Внутренние ошибки возвращают только Internal server error. Маршруты вне /api могут возвращать стандартный 404 Express.
- Graceful shutdown включён. PostgreSQL/Sequelize и авторизация подключены.

## Authentication

PostgreSQL + Sequelize authentication and setup: [AUTH.md](AUTH.md).

## Серверный Dice

WebSocket-игра, кошелёк DEMO, миграции и протокол: [DICE.md](DICE.md).
