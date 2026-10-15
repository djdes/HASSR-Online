import { escapeHtml } from "@/lib/html-escape";
import { buildMiniObligationEntryUrl } from "@/lib/journal-obligation-links";
import type { OpenJournalObligation } from "@/lib/journal-obligations";

type DigestCtaKind = "obligation" | "mini-app" | "cabinet";

export type TelegramObligationDigestCta = {
  kind: DigestCtaKind;
  label: string;
  url: string;
};

export type StaffObligationDigest = {
  kind: "staff";
  body: string;
  dedupeKey: string;
  openCount: number;
  nextObligationId: string | null;
  primaryCta: TelegramObligationDigestCta | null;
};

export type ManagerObligationSummary = {
  total: number;
  pending: number;
  done: number;
  employeesWithPending: number;
};

export type ManagerObligationDigest = {
  kind: "manager";
  body: string;
  dedupeKey: string;
  summary: ManagerObligationSummary;
  primaryCta: TelegramObligationDigestCta | null;
};

function dayStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

function escapeTelegramText(value: string | null | undefined): string {
  return escapeHtml(value ?? "");
}

export type StaffObligationDigestPresentation = {
  openCount: (count: number) => string;
  nextAction: (title: string) => string;
  noNextAction: string;
  todayHeading: string;
  obligationLine: (values: { title: string; location: string; description: string }) => string;
  locationSuffix: (building: string) => string;
  descriptionSuffix: (description: string) => string;
  moreCount: (count: number) => string;
  openTask: string;
  openJournals: string;
};

function formatObligationList(
  openObligations: OpenJournalObligation[],
  presentation?: StaffObligationDigestPresentation
): string[] {
  const preview = openObligations.slice(0, 5).map((obligation) => {
    if (presentation) {
      return presentation.obligationLine({
        title: escapeTelegramText(obligation.template.name),
        location: obligation.buildingName
          ? presentation.locationSuffix(escapeTelegramText(obligation.buildingName))
          : "",
        description: obligation.template.description
          ? presentation.descriptionSuffix(escapeTelegramText(obligation.template.description))
          : "",
      });
    }
    const suffix = obligation.template.description
      ? ` (${escapeTelegramText(obligation.template.description)})`
      : "";
    const location = obligation.buildingName
      ? ` · ${escapeTelegramText(obligation.buildingName)}`
      : "";
    return `• ${escapeTelegramText(obligation.template.name)}${location}${suffix}`;
  });

  if (openObligations.length > preview.length) {
    const remaining = openObligations.length - preview.length;
    preview.push(presentation ? presentation.moreCount(remaining) : `…и ещё ${remaining}`);
  }

  return preview;
}

export function buildStaffObligationDigest(args: {
  userId: string;
  /**
   * Имя сотрудника передаётся для обратной совместимости. В новом
   * шаблоне используется placeholder `{name}` — реальное имя
   * подставляется в `notifyEmployee.personalizeMessage()`. Аргумент
   * игнорируется при формировании body, но оставлен на случай если
   * caller захочет переключиться на explicit-имя в будущем.
   */
  staffName?: string;
  openObligations: OpenJournalObligation[];
  miniAppBaseUrl: string | null;
  now?: Date;
  presentation?: StaffObligationDigestPresentation;
}): StaffObligationDigest | null {
  if (args.openObligations.length === 0) {
    return null;
  }

  const now = args.now ?? new Date();
  const nextObligation = args.openObligations[0] ?? null;
  const miniAppBaseUrl = normalizeUrl(args.miniAppBaseUrl);
  const primaryCta =
    miniAppBaseUrl && nextObligation
      ? {
          kind: "obligation" as const,
          label: args.presentation?.openTask ?? "Открыть задачу",
          url: buildMiniObligationEntryUrl(miniAppBaseUrl, nextObligation.id),
        }
      : miniAppBaseUrl
        ? {
            kind: "mini-app" as const,
            label: args.presentation?.openJournals ?? "Открыть журналы",
            url: miniAppBaseUrl,
          }
        : null;

  // {greeting} и {name} разворачивает personalizeMessage в notifyEmployee:
  // приветствие по времени дня + имя получателя из User.name. Если по
  // какой-то причине caller шлёт без personalize (raw sendTelegramMessage)
  // — placeholder'ы останутся в тексте, но это безопасный fallback, а не
  // утечка PII.
  const body = [
    `{greeting}, {name}!`,
    "",
    args.presentation?.openCount(args.openObligations.length) ?? `Открыто задач: ${args.openObligations.length}`,
    nextObligation
      ? args.presentation?.nextAction(escapeTelegramText(nextObligation.template.name)) ?? `Следующее действие: ${escapeTelegramText(nextObligation.template.name)}`
      : args.presentation?.noNextAction ?? "Следующее действие пока не найдено.",
    "",
    args.presentation?.todayHeading ?? "На сегодня:",
    ...formatObligationList(args.openObligations, args.presentation),
  ].join("\n");

  return {
    kind: "staff",
    body,
    dedupeKey: `telegram-digest:staff:${dayStamp(now)}:${args.userId}`,
    openCount: args.openObligations.length,
    nextObligationId: nextObligation?.id ?? null,
    primaryCta,
  };
}

export function buildManagerObligationDigest(args: {
  organizationId: string;
  organizationName: string;
  summary: ManagerObligationSummary;
  cabinetUrl: string | null;
  now?: Date;
}): ManagerObligationDigest {
  const now = args.now ?? new Date();
  const cabinetUrl = normalizeUrl(args.cabinetUrl);

  // {greeting}, {name} раскрываются в notifyEmployee — менеджер увидит
  // своё имя и приветствие по времени дня. organizationName идёт в
  // подзаголовок как контекст: один менеджер может управлять несколькими
  // организациями (например, ROOT в impersonation).
  return {
    kind: "manager",
    body: [
      `{greeting}, {name}!`,
      "",
      `<b>${escapeTelegramText(args.organizationName)}</b>`,
      `Открыто: ${args.summary.pending} · Выполнено: ${args.summary.done}`,
      `Всего обязательств: ${args.summary.total}`,
      `Сотрудников с открытыми задачами: ${args.summary.employeesWithPending}`,
    ].join("\n"),
    dedupeKey: `telegram-digest:manager:${dayStamp(now)}:${args.organizationId}`,
    summary: args.summary,
    primaryCta: cabinetUrl
      ? {
          kind: "cabinet",
          label: "Открыть кабинет",
          url: cabinetUrl,
        }
      : null,
  };
}
