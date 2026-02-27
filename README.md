# Shop with Seye Backend

Sibling backend repository for Shop with Seye.

## Structure

- `apps/api`: Express TypeScript API (`/api/v1/*`).
- `apps/worker`: BullMQ worker for async jobs.
- `packages/shared-types`: Zod schemas and shared DTO contracts.
- `migrations/`: Mongo migrations for indexes and seed data.

## Scripts

- `npm run dev:api`
- `npm run dev:worker`
- `npm run build`
- `npm run migrate:up`
- `npm run migrate:down`
- `npm run migrate:status`

## Setup

1. Copy `.env.example` to `.env` and fill secrets.
2. Run migrations: `npm run migrate:up`.
3. Start API: `npm run dev:api`.
4. Start worker: `npm run dev:worker`.

## Required Headers

All API routes under `/api/v1/*` require:

- `x-tenant-id: <tenant-slug-or-id>`

Customer routes also require:

- `Authorization: Bearer <access-token>`

Guest cart support requires:

- `x-session-id: <stable-client-session-id>` when no auth token is provided.

## Auth + Commerce Slice Endpoints

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/categories`
- `GET /api/v1/products`
- `GET /api/v1/products/:slug`
- `GET /api/v1/cart`
- `POST /api/v1/cart/items`
- `PATCH /api/v1/cart/items/:id`
- `DELETE /api/v1/cart/items/:id`
- `POST /api/v1/checkout/initialize`
- `POST /api/v1/payments/paystack/webhook`
- `GET /api/v1/payments/paystack/callback?reference=...`
- `GET /api/v1/payments/:ref/status`
- `GET /api/v1/payments/:ref/order`
- `GET /api/v1/orders/me`
- `GET /api/v1/orders/me/:id`

## Notification Jobs

- Queue: `sws-notifications`
- Job: `order-status`
- Triggered when order status moves to `paid`, `shipped`, or `delivered`.
- Produced by API and consumed by `apps/worker`.

## SMTP Email (immersiavr.com)

Configure these in `.env` for the worker:

- `EMAIL_PROVIDER=immersiavr.com`
- `EMAIL_FROM="Shop with Seye <shopws@immersiavr.com>"`
- `SMTP_USER="shopws@immersiavr.com"`
- `SMTP_PASS="<your-password>"`
- `SMTP_HOST="immersiavr.com"`
- `SMTP_PORT=465`
- `SMTP_SECURE=true`

If SMTP is not configured, the worker logs notification payloads instead of sending.
