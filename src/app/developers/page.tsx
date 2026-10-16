import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, Braces, KeyRound, Radio, Send, Webhook } from "lucide-react";

import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";

const TITLE = "API WeSetup для разработчиков";
const DESCRIPTION = "Открытый API электронных журналов ХАССП: MCP для ChatGPT и Claude, REST API v1 с описанием OpenAPI, записи в журналы, показания датчиков, сводка за день, вебхуки.";

// Те же шесть операций — у MCP-инструментов и REST API v1 (src/lib/public-api/tools).
const V1_METHODS = [
  { method: "GET", path: "/api/v1/me", tool: "get_context", text: "Организация, сегодняшняя дата в её часовом поясе, права ключа." },
  { method: "GET", path: "/api/v1/journals?date=", tool: "list_journals", text: "Журналы на дату: что заполнено, что нет, активные документы со ссылками." },
  { method: "GET", path: "/api/v1/documents/{id}?from=&to=", tool: "get_journal_document", text: "Записи документа за период до 31 дня." },
  { method: "POST", path: "/api/v1/documents/{id}/cells", tool: "fill_journal_cells", text: "Заполнить ячейки журнала-сетки (сотрудники × даты) по правилам интерфейса." },
  { method: "GET", path: "/api/v1/employees?query=", tool: "list_employees", text: "Сотрудники с должностями и телефонами, список должностей." },
  { method: "POST", path: "/api/v1/employees", tool: "add_employee", text: "Добавить сотрудника с учётом тарифа." },
];

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://wesetup.ru/developers" },
  openGraph: { type: "website", locale: "ru_RU", siteName: "WeSetup", url: "https://wesetup.ru/developers", title: TITLE, description: DESCRIPTION, images: ogImages({ title: TITLE, subtitle: DESCRIPTION, kind: "feature" }) },
  twitter: { card: DEFAULT_TWITTER_CARD, title: TITLE, description: DESCRIPTION, images: twitterImages({ title: TITLE, kind: "feature" }) },
};

const CODE = "block overflow-x-auto rounded-2xl bg-[#0b1024] px-5 py-4 font-mono text-[12.5px] leading-[1.6] text-[#e6e8f5]";

const ENDPOINTS = [
  {
    method: "POST",
    path: "/api/external/entries",
    title: "Запись в журнал",
    text: "Создаёт запись в полевом журнале организации. Повтор с тем же Idempotency-Key возвращает прежний ответ без дубля.",
    sample: `curl -X POST https://wesetup.ru/api/external/entries \\
  -H "Authorization: Bearer <ключ организации>" \\
  -H "Idempotency-Key: 6f1c…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "journalCode": "hygiene",
    "date": "2026-09-10",
    "data": { "status": "healthy", "temperatureAbove37": false }
  }'`,
  },
  {
    method: "POST",
    path: "/api/external/sensors",
    title: "Показание датчика",
    text: "Один вызов — один замер температуры или влажности по оборудованию; отклонения от нормы сразу уходят в уведомления.",
    sample: `curl -X POST https://wesetup.ru/api/external/sensors \\
  -H "Authorization: Bearer <ключ организации>" \\
  -H "Content-Type: application/json" \\
  -d '{ "equipmentId": "clx…", "type": "temperature", "value": 3.8, "timestamp": "2026-09-10T08:00:00+03:00" }'`,
  },
  {
    method: "GET",
    path: "/api/external/summary?date=2026-09-10",
    title: "Сводка за день",
    text: "Какие журналы заполнены, какие нет, отклонения и задачи — для панелей и интеграций с учётом.",
    sample: `curl https://wesetup.ru/api/external/summary?date=2026-09-10 \\
  -H "Authorization: Bearer <ключ организации>"`,
  },
  {
    method: "GET",
    path: "/api/external/healthz",
    title: "Проверка доступности",
    text: "Без ключа. Отвечает 200, если API живо; для мониторинга интеграции.",
    sample: `curl https://wesetup.ru/api/external/healthz`,
  },
];

export default function DevelopersPage() {
  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader />
      <div className="mx-auto max-w-[960px] px-4 py-8 sm:px-6 sm:py-12">
        <PublicBreadcrumbs items={[{ name: "Разработчикам" }]} tone="light" />
        <h1 className="mt-6 text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-[44px]">{TITLE}</h1>
        <p className="mt-3 max-w-[760px] text-[16px] leading-[1.7] text-[#3c4053]">{DESCRIPTION}</p>

        <section className="mt-10 rounded-3xl border border-[#dfe3ff] bg-[linear-gradient(135deg,#f5f6ff_0%,#ffffff_60%,#f0edff_100%)] p-6 md:p-7">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <Bot className="size-4 text-[#5566f6]" />
            ИИ-ассистенты (MCP)
          </div>
          <p className="mt-2 text-[14px] leading-[1.65] text-[#3c4053]">
            WeSetup — MCP-сервер: ChatGPT, Claude, Cursor и другие ассистенты сами узнают статус журналов, отмечают ячейки и добавляют сотрудников по просьбе пользователя. Ключ действует с правами его владельца и только в его организации; каждая запись видна в журнале действий. Поддерживаются спецификации MCP 2026-07-28 и 2025-03-26…2025-11-25 (Streamable HTTP).
          </p>
          <pre className={`mt-3 ${CODE}`}>{`# ключ в заголовке — Claude Code, Cursor, свой клиент
POST https://wesetup.ru/api/mcp
Authorization: Bearer wsk_…

# ключ в ссылке — коннекторы claude.ai и ChatGPT
POST https://wesetup.ru/api/mcp/wsk_…`}</pre>
          <ul className="mt-3 grid gap-1.5 text-[13.5px] text-[#3c4053] sm:grid-cols-2">
            {V1_METHODS.map((m) => (
              <li key={m.tool}>
                <code className="rounded bg-white px-1.5 py-0.5 text-[12.5px] text-[#3848c7]">{m.tool}</code> — {m.text}
              </li>
            ))}
          </ul>
          <Link href="/settings/api" className="mt-4 inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]">
            Получить ключ
            <ArrowRight className="size-4" />
          </Link>
        </section>

        <section className="mt-5 rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <Braces className="size-4 text-[#5566f6]" />
            REST API v1
          </div>
          <p className="mt-2 text-[14px] leading-[1.65] text-[#3c4053]">
            Те же операции обычными HTTP-запросами с персональным ключом. Ответ — <code className="rounded bg-[#f5f6ff] px-1.5 py-0.5 text-[12.5px]">{"{ ok, data }"}</code> или <code className="rounded bg-[#f5f6ff] px-1.5 py-0.5 text-[12.5px]">{"{ ok: false, error }"}</code>; повтор <code className="rounded bg-[#f5f6ff] px-1.5 py-0.5 text-[12.5px]">POST</code> с тем же <code className="rounded bg-[#f5f6ff] px-1.5 py-0.5 text-[12.5px]">Idempotency-Key</code> возвращает прежний ответ. Полное описание — <a href="/api/v1/openapi.json" className="text-[#3848c7] underline-offset-2 hover:underline">openapi.json</a>.
          </p>
          <div className="mt-3 divide-y divide-[#ececf4]">
            {V1_METHODS.map((m) => (
              <div key={m.path} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                <span className={`w-fit rounded-full px-2.5 py-0.5 font-mono text-[12px] font-semibold ${m.method === "GET" ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#eef1ff] text-[#3848c7]"}`}>{m.method}</span>
                <code className="text-[13px] font-semibold">{m.path}</code>
                <span className="text-[13px] text-[#6f7282] sm:ml-auto sm:text-right">{m.text}</span>
              </div>
            ))}
          </div>
          <pre className={`mt-3 ${CODE}`}>{`curl https://wesetup.ru/api/v1/journals \\
  -H "Authorization: Bearer wsk_…"`}</pre>
        </section>

        <section className="mt-10 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 md:p-7">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <KeyRound className="size-4 text-[#5566f6]" />
            Авторизация
          </div>
          <p className="mt-2 text-[14px] leading-[1.65] text-[#3c4053]">
            Персональный ключ для MCP и REST API v1 выпускает руководитель в кабинете: «Остальное → ИИ-ассистенты и API». Общий ключ организации для методов <code className="rounded bg-white px-1.5 py-0.5 text-[12.5px]">/api/external/*</code> ниже — там же, в блоке «Ключ для датчиков и старых интеграций». Передавайте ключ в заголовке <code className="rounded bg-white px-1.5 py-0.5 text-[12.5px]">Authorization: Bearer &lt;ключ&gt;</code>. Все запросы с ключом пишутся в организацию ключа — <code className="rounded bg-white px-1.5 py-0.5 text-[12.5px]">organizationId</code> указывать не нужно. Утёк — отзовите ключ, он перестанет работать сразу.
          </p>
        </section>

        <h2 className="mt-10 text-[24px] font-semibold tracking-[-0.02em]">Интеграции и датчики</h2>
        <div className="mt-4 space-y-5">
          {ENDPOINTS.map((e) => (
            <section key={e.path} className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 font-mono text-[12px] font-semibold ${e.method === "GET" ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#eef1ff] text-[#3848c7]"}`}>{e.method}</span>
                <code className="text-[14px] font-semibold">{e.path}</code>
              </div>
              <div className="mt-2 text-[15px] font-semibold">{e.title}</div>
              <p className="mt-1 text-[14px] leading-[1.65] text-[#3c4053]">{e.text}</p>
              <pre className={`mt-3 ${CODE}`}>{e.sample}</pre>
            </section>
          ))}
        </div>

        <section className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <Send className="size-4 text-[#5566f6]" />
              Идемпотентность и ошибки
            </div>
            <ul className="mt-3 space-y-2 text-[14px] leading-[1.65] text-[#3c4053]">
              <li>• <code className="rounded bg-[#f5f6ff] px-1.5 py-0.5 text-[12.5px]">Idempotency-Key</code> — любой уникальный ключ до 128 символов; повтор в течение 48 часов возвращает тот же ответ.</li>
              <li>• 401 — нет или неверный ключ; 400 — тело не прошло проверку, в ответе поле <code className="rounded bg-[#f5f6ff] px-1.5 py-0.5 text-[12.5px]">error</code>; 429 — превышен лимит, подождите минуту.</li>
              <li>• Даты — ISO 8601, время организации задаётся её часовым поясом.</li>
            </ul>
          </div>
          <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <Webhook className="size-4 text-[#5566f6]" />
              Вебхуки
            </div>
            <p className="mt-2 text-[14px] leading-[1.65] text-[#3c4053]">
              WeSetup может сам присылать события на ваш адрес: запись в журнале, отклонение, задача CAPA, оплата, статус идеи. Подписки настраиваются в «Настройки → Вебхуки»; каждый вызов подписан <code className="rounded bg-[#f5f6ff] px-1.5 py-0.5 text-[12.5px]">X-WeSetup-Signature</code> (HMAC-SHA256 тела вашим секретом), неудачные доставки повторяются.
            </p>
          </div>
        </section>

        <section className="mt-10 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 md:p-7">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <Radio className="size-4 text-[#5566f6]" />
            Статус и изменения API
          </div>
          <p className="mt-2 text-[14px] leading-[1.65] text-[#3c4053]">
            Работает ли сервис — на <Link href="/status" className="text-[#3848c7] underline-offset-2 hover:underline">странице статуса</Link>. Изменения API попадают в <Link href="/whats-new" className="text-[#3848c7] underline-offset-2 hover:underline">«Что нового»</Link> и RSS. Вопросы — support@wesetup.ru.
          </p>
          <Link href="/register" className="mt-4 inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]">
            Получить ключ
            <ArrowRight className="size-4" />
          </Link>
        </section>
      </div>
      <PublicFooter />
    </div>
  );
}
