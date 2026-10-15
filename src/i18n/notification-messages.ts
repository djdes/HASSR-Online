import type { Locale } from "./locales";
import { translatorFor } from "./translator";
import { IDEA_STATUSES, IDEA_STATUS_LABEL, describeIdeaStatusChange, isIdeaStatus } from "@/lib/ideas/rules";

const MESSAGE_KEYS = ["staffJournal", "trainingPlan", "openJournal", "openTrainingPlan", "feedbackReply", "pinRequests", "reviewPinRequests", "pinRequestItem", "fromQrPage", "hygieneAdmission", "hygieneSigned", "hygieneComplaints", "ideaStatus", "ideaStatusLabel", "openIdeas", "open"] as const;
export type NotificationMessageKey = typeof MESSAGE_KEYS[number];
export type NotificationMessageParams = Record<string, string | number>;

export type NotificationMessageMetadata = {
  messageKey?: NotificationMessageKey;
  messageParams?: NotificationMessageParams;
  linkLabelKey?: NotificationMessageKey;
};

export function isNotificationMessageKey(key: unknown): key is NotificationMessageKey {
  return typeof key === "string" && (MESSAGE_KEYS as readonly string[]).includes(key);
}

export function asNotificationMessageParams(value: unknown): NotificationMessageParams | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every(([, v]) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)))) return undefined;
  return Object.fromEntries(entries);
}

type Item = {
  label: string;
  hint?: string;
  labelKey?: unknown;
  labelParams?: unknown;
  hintKey?: unknown;
  hintParams?: unknown;
};

type Row = {
  kind: string;
  title: string;
  linkLabel?: string | null;
  linkHref?: string | null;
  messageKey?: unknown;
  messageParams?: unknown;
  linkLabelKey?: unknown;
  items: Item[];
};

/** Known historical product messages only; never interpret customer prose as keys. */
function legacyKeys(row: Row): NotificationMessageMetadata {
  if (row.kind === "staff.added.journal" && row.title === "Список фамилий, которые нужно внести в") {
    return { messageKey: "staffJournal" };
  }
  if (row.kind === "position.missing.trainingPlan" && row.title === "Список должностей, которые нужно внести в") {
    return { messageKey: "trainingPlan" };
  }
  if (row.kind === "feedback.reply" && row.title === "Получен ответ на ваше обращение") return { messageKey: "feedbackReply" };
  if (row.kind === "qr_pin_request" && row.title === "Запросы PIN от сотрудников") {
    return { messageKey: "pinRequests", ...(row.linkLabel === "Рассмотреть" ? { linkLabelKey: "reviewPinRequests" as const } : {}) };
  }
  if (row.kind === "hygiene-admission" && row.title === "Гигиенический журнал: сотрудники ждут допуска") {
    return { messageKey: "hygieneAdmission", ...(row.linkLabel === "Открыть журнал" ? { linkLabelKey: "openJournal" as const } : {}) };
  }
  if (row.kind === "mailing" && row.linkLabel === "Открыть") return { linkLabelKey: "open" };
  if (row.kind === "idea.status" && row.items.length === 1) {
    const item = row.items[0];
    const status = IDEA_STATUSES.find((status) => IDEA_STATUS_LABEL[status] === item.hint);
    if (status && row.title === describeIdeaStatusChange(item.label, status)) {
      return { messageKey: "ideaStatus", messageParams: { status, title: shortIdeaTitle(item.label) }, ...(row.linkLabel === "Открыть идеи" ? { linkLabelKey: "openIdeas" as const } : {}) };
    }
  }
  return {};
}

export function shortIdeaTitle(title: string): string {
  return title.length > 60 ? `${title.slice(0, 57)}…` : title;
}

/** Exact legacy producer formats only; names and authored complaint text remain verbatim. */
function legacyItem(item: Item, legacy: NotificationMessageMetadata): Item {
  if (legacy.messageKey === "pinRequests") {
    for (const [kind, suffix] of [["change", " — смена pin"], ["issue", " — новый pin"]] as const) {
      if (item.label.endsWith(suffix)) return { ...item, labelKey: item.labelKey ?? "pinRequestItem", labelParams: item.labelParams ?? { kind, name: item.label.slice(0, -suffix.length) }, ...(item.hint === "с QR-страницы" ? { hintKey: item.hintKey ?? "fromQrPage" } : {}) };
    }
  }
  if (legacy.messageKey === "hygieneAdmission") {
    const suffix = " — подписал, ждёт допуска";
    if (item.label.endsWith(suffix)) return { ...item, labelKey: item.labelKey ?? "hygieneSigned", labelParams: item.labelParams ?? { name: item.label.slice(0, -suffix.length) } };
    // Complaint labels cannot be split unambiguously from arbitrary employee names.
  }
  if (legacy.messageKey === "ideaStatus") return { ...item, hintKey: item.hintKey ?? "ideaStatusLabel", hintParams: item.hintParams ?? { status: legacy.messageParams!.status } };
  return item;
}

export async function notificationPresenter(locale: Locale) {
  const t = await translatorFor(locale);
  const text = (key: unknown, fallback: string, rawParams?: unknown): string => {
    if (!isNotificationMessageKey(key)) return fallback;
    const params = asNotificationMessageParams(rawParams);
    switch (key) {
      case "pinRequestItem":
        return typeof params?.name === "string" && (params.kind === "issue" || params.kind === "change")
          ? t("notifications.messages.pinRequestItem", { name: params.name, kind: params.kind }) : fallback;
      case "hygieneSigned":
        return typeof params?.name === "string" ? t("notifications.messages.hygieneSigned", { name: params.name }) : fallback;
      case "hygieneComplaints":
        return typeof params?.name === "string" && typeof params.complaints === "string"
          ? t("notifications.messages.hygieneComplaints", { name: params.name, complaints: params.complaints }) : fallback;
      case "ideaStatus":
        return isIdeaStatus(params?.status) && typeof params?.title === "string"
          ? t("notifications.messages.ideaStatus", { status: params.status, title: params.title }) : fallback;
      case "ideaStatusLabel":
        return isIdeaStatus(params?.status) ? t("notifications.messages.ideaStatusLabel", { status: params.status }) : fallback;
      default:
        return t(`notifications.messages.${key}`);
    }
  };
  const presentItem = (item: Item) => ({ ...item, label: text(item.labelKey, item.label, item.labelParams), hint: item.hint === undefined ? undefined : text(item.hintKey, item.hint, item.hintParams) });
  return {
    row<T extends Row>(row: T): T {
      const legacy = legacyKeys(row);
      const linkLabelKey = row.linkLabelKey ?? legacy.linkLabelKey ?? (
        legacy.messageKey === "staffJournal" && ["гигиенический журнал", "журнал здоровья", "журнал регистрации инструктажей", "журнал"].includes(row.linkLabel ?? "")
          ? "openJournal"
          : legacy.messageKey === "trainingPlan" && row.linkLabel === "план обучения" ? "openTrainingPlan" : undefined
      );
      return {
        ...row,
        title: text(row.messageKey ?? legacy.messageKey, row.title, row.messageParams ?? legacy.messageParams),
        linkLabel: row.linkLabel == null ? row.linkLabel : text(linkLabelKey, row.linkLabel),
        items: row.items.map((item) => {
          const presented = presentItem(legacyItem(item, legacy));
          return { ...item, label: presented.label, hint: presented.hint };
        }),
      };
    },
    pushBody(items: readonly Item[]): string {
      if (items.length === 0) return t("notifications.messages.pushOpen");
      const first = presentItem(items[0]).label;
      return items.length === 1 ? first : t("notifications.messages.pushMore", { first, count: items.length - 1 });
    },
  };
}
