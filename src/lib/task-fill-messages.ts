import type { useTranslations } from "next-intl";
import type { MessageContract } from "@/i18n/message-contract";
import type { PhotoFieldCopy } from "@/components/journals/photo-field";

export type TaskFillTranslator = ReturnType<typeof useTranslations<"taskFill">>;
export class TaskFillRequestError extends Error {
  constructor(public readonly response: unknown) { super("Task-fill request failed"); }
}

export function taskFillPhotoCopy(t: TaskFillTranslator): PhotoFieldCopy {
  return {
    rules: t("photo.rules"), invalidType: t("photo.invalidType"), tooLarge: t("photo.tooLarge"),
    uploadError: t("actions.photoError"), networkError: t("photo.networkError"),
    required: t("field.required"), present: t("photo.present"), queued: t("photo.queued"),
    remove: t("photo.remove"), uploading: t("photo.uploading"), more: t("photo.more"), take: t("photo.take"),
    alt: index => t("photo.alt", { index }),
  };
}
type ErrorCode = keyof MessageContract["taskFill"]["errors"];
const ERROR_CODES = new Set<ErrorCode>([
  "badTaskId", "invalidBody", "missingToken", "taskNotFound", "invalidToken",
  "unsupportedJournal", "adminEditOnly", "fieldInvalid", "unknownField", "templateNotFound",
  "noEventsDisabled", "reasonRequired", "reasonNotAllowed", "alreadyClosed", "multipartRequired",
  "photoFieldsMissing", "photoType", "photoSize", "photoSave", "employeeUnknown", "notClosed",
  "invalidDecision", "rejectionReason", "notVerifierTask", "itemNotFound",
]);

/** API legacy text remains available to old clients; this UI uses stable codes. */
export function taskFillErrorMessage(
  response: unknown,
  t: TaskFillTranslator,
  fallback: string,
  fields: readonly { key: string; label: string }[] = [],
): string {
  if (!response || typeof response !== "object") return fallback;
  const data = response as { errorCode?: unknown; errorParams?: { field?: unknown } };
  if (typeof data.errorCode !== "string" || !ERROR_CODES.has(data.errorCode as ErrorCode)) return fallback;
  const code = data.errorCode as ErrorCode;
  if (code === "fieldInvalid") {
    const key = data.errorParams?.field;
    const field = fields.find(item => item.key === key)?.label ?? (typeof key === "string" && key ? key : t("errors.unknownField"));
    return t("errors.fieldInvalid", { field });
  }
  return t(`errors.${code}`);
}
