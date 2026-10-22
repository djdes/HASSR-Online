import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { formatAssistantDate } from "./assistant-presentation";
import {
  Bot,
  Building2,
  CircleAlert,
  CircleCheck,
  Clock,
  Timer,
  User,
} from "lucide-react";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { readAssistantSettings } from "@/lib/assistant/config";
import { cn } from "@/lib/utils";
import { AssistantIntegrationForm } from "./integration-form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("rootAssistant");
  return { title: t("title") };
}

/**
 * Панель управления запросами к ассистенту.
 *
 * Здесь видно ровно то, чего не видно в ProjectsFlow: кто спросил, что
 * спросил, что ответил ассистент и сколько это заняло. Задачи в проекте
 * мы намеренно не заводим — очередь заданий невидима и чистится сама, а
 * история живёт тут.
 */

const PAGE_SIZE = 60;

function statusMeta(status: string) {
  if (status === "done") {
    return { label: "statusAnswered" as const, icon: CircleCheck, color: "#116b2a", bg: "#ecfdf5" };
  }
  if (status === "error") {
    return { label: "statusError" as const, icon: CircleAlert, color: "#a13a32", bg: "#fff4f2" };
  }
  return { label: "statusPending" as const, icon: Clock, color: "#3848c7", bg: "#eef1ff" };
}

export default async function RootAssistantPage() {
  await requireRoot();
  const t = await getTranslations("rootAssistant");
  const locale = await getSiteLocale();

  const [turns, settings, counts] = await Promise.all([
    db.assistantMessage.findMany({
      where: { role: "assistant" },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        content: true,
        status: true,
        error: true,
        createdAt: true,
        fetchedAt: true,
        pfJobId: true,
        conversation: {
          select: { id: true, userId: true, organizationId: true },
        },
      },
    }),
    readAssistantSettings(),
    db.assistantMessage.groupBy({
      by: ["status"],
      where: { role: "assistant" },
      _count: { _all: true },
    }),
  ]);

  // Вопрос лежит отдельной строкой перед ответом — достаём одним
  // запросом на всю страницу, а не по одному на строку.
  const conversationIds = [...new Set(turns.map((t) => t.conversation.id))];
  const questions = await db.assistantMessage.findMany({
    where: { conversationId: { in: conversationIds }, role: "user" },
    orderBy: { createdAt: "asc" },
    select: { id: true, conversationId: true, content: true, createdAt: true },
  });

  const userIds = [...new Set(turns.map((t) => t.conversation.userId))];
  const orgIds = [...new Set(turns.map((t) => t.conversation.organizationId))];
  const [users, organizations] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, role: true },
    }),
    db.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true },
    }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const orgById = new Map(organizations.map((o) => [o.id, o]));

  /** Ближайший предыдущий вопрос в том же диалоге. */
  function questionFor(conversationId: string, answeredAt: Date) {
    const list = questions.filter(
      (q) => q.conversationId === conversationId && q.createdAt <= answeredAt
    );
    return list.length > 0 ? list[list.length - 1] : null;
  }

  const countBy = new Map(counts.map((c) => [c.status, c._count._all]));
  const configured = Boolean(settings.token && settings.projectId);

  return (
    <DomainMessagesBoundary namespaces={["rootAssistant"]}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {t("title")}
          </h1>
          <p className="mt-1 text-[14px] text-[#6f7282]">
            {t("description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["done", "pending", "error"] as const).map((status) => {
            const meta = statusMeta(status);
            return (
              <span
                key={status}
                className="rounded-full px-3 py-1 text-[12.5px] font-medium tabular-nums"
                style={{ background: meta.bg, color: meta.color }}
              >
                {t(status === "done" ? "countAnswered" : status === "error" ? "countError" : "countPending", { count: countBy.get(status) ?? 0 })}
              </span>
            );
          })}
        </div>
      </div>

      <AssistantIntegrationForm
        initial={{
          hasToken: Boolean(settings.token),
          projectId: settings.projectId ?? "",
          apiUrl: settings.apiUrl ?? "",
          baseUrl: settings.baseUrl ?? "",
          enabled: settings.enabled !== "off",
        }}
      />

      {!configured ? (
        <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] px-5 py-4 text-[13.5px] leading-[1.55] text-[#a13a32]">
          {t("warning")}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white">
        {turns.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Bot className="mx-auto size-8 text-[#dcdfed]" />
            <p className="mt-3 text-[15px] font-medium text-[#0b1024]">
              {t("emptyTitle")}
            </p>
            <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] text-[#6f7282]">
              {t("emptyHelp")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#f1f2f8]">
            {turns.map((turn) => {
              const meta = statusMeta(turn.status);
              const Icon = meta.icon;
              const question = questionFor(
                turn.conversation.id,
                turn.createdAt
              );
              const user = userById.get(turn.conversation.userId);
              const organization = orgById.get(
                turn.conversation.organizationId
              );
              const waitedMs = turn.fetchedAt
                ? turn.fetchedAt.getTime() - turn.createdAt.getTime()
                : null;

              return (
                <li key={turn.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#9b9fb3]">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium"
                      style={{ background: meta.bg, color: meta.color }}
                    >
                      <Icon className="size-3.5" />
                      {t(meta.label)}
                    </span>
                    <span className="tabular-nums">
                      {formatAssistantDate(turn.createdAt, locale)}
                    </span>
                    {organization ? (
                      <Link
                        href={`/root/organizations/${organization.id}`}
                        className="inline-flex items-center gap-1 hover:text-[#3848c7]"
                      >
                        <Building2 className="size-3.5" />
                        {organization.name}
                      </Link>
                    ) : null}
                    {user ? (
                      <span className="inline-flex items-center gap-1">
                        <User className="size-3.5" />
                        {user.name || user.email} · {user.role}
                      </span>
                    ) : null}
                    {waitedMs !== null ? (
                      <span
                        className="inline-flex items-center gap-1 tabular-nums"
                        title={t("waitTooltip")}
                      >
                        <Timer className="size-3.5" />
                        {t("waited", { seconds: String(Math.round(waitedMs / 1000)) })}
                      </span>
                    ) : turn.status === "pending" ? (
                      <span className="text-[#a13a32]">{t("notPickedUp")}</span>
                    ) : null}
                  </div>

                  {question ? (
                    <p className="mt-2.5 whitespace-pre-wrap break-words text-[14px] leading-[1.55] text-[#0b1024]">
                      {question.content}
                    </p>
                  ) : null}

                  <div
                    className={cn(
                      "mt-2 whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-[1.55]",
                      turn.status === "error"
                        ? "bg-[#fff4f2] text-[#a13a32]"
                        : "bg-[#f5f6ff] text-[#3c4053]"
                    )}
                  >
                    {turn.status === "error"
                      ? turn.error || t("errorMissing")
                      : turn.content || "…"}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
    </DomainMessagesBoundary>
  );
}
