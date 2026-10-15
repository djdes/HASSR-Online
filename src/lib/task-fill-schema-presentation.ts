import { createTranslator } from "use-intl/core";

import type { Locale } from "@/i18n/locales";
import ruMessages from "@/i18n/messages/ru.json";
import type { MessageContract } from "@/i18n/message-contract";
import { TEMPLATE_SCOPE_DEFAULTS } from "@/lib/journal-task-scope";
import type { TaskFormField, TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";

type SchemaFieldMessages = {
  label?: string;
  placeholder?: string;
  options?: Record<string, string>;
};

type MessageTree = { [key: string]: string | MessageTree };

export type TaskFillSchemaCatalog = {
  forms?: Record<string, { intro?: string; notice?: string; submitLabel?: string }>;
  fields?: Record<string, Record<string, SchemaFieldMessages>>;
  systemFields?: Record<string, SchemaFieldMessages>;
  dynamic?: MessageTree;
  steps?: Record<string, Record<string, { title?: string; detail?: string; hint?: string }>>;
  options?: MessageTree;
  noEventsReasons?: Record<string, string>;
};

export type SchemaPresentationMessages = Pick<MessageContract, "journalFields"> & {
  taskFillSchema: TaskFillSchemaCatalog;
};

function translateDynamic(
  value: string,
  key: string | undefined,
  values: Record<string, string | number | Date> | undefined,
  locale: Locale,
  catalog: TaskFillSchemaCatalog,
): string {
  const messagePath = key && stringAtPath(catalog, key)
    ? key
    : key?.startsWith("dynamic.")
      ? key
      : key
        ? `dynamic.${key}`
        : undefined;
  const message = messagePath ? stringAtPath(catalog, messagePath) : undefined;
  if (!message) return value;
  const t = createTranslator({
    locale,
    timeZone: "UTC",
    messages: { message },
    onError: (error) => { throw error; },
  });
  return t("message", values);
}

function stringAtPath(source: unknown, path: string | undefined): string | undefined {
  if (!path) return undefined;
  let value = source;
  for (const segment of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, segment)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === "string" ? value : undefined;
}

function fieldMessage(
  catalog: TaskFillSchemaCatalog,
  code: string,
  field: TaskFormField,
): SchemaFieldMessages | undefined {
  const byCode = catalog.fields?.[code];
  return byCode?.[field.key];
}

function optionMessageKey(value: string): string {
  return value === "" ? "__empty" : value;
}

function canonicalRussianField(
  catalog: TaskFillSchemaCatalog,
  code: string,
  field: TaskFormField,
): SchemaFieldMessages | undefined {
  const own = catalog.fields?.[code]?.[field.key];
  if (own?.label) return own;
  const journal = ruMessages.journalFields[code as keyof typeof ruMessages.journalFields] as Record<string, unknown> | undefined;
  const journalField = journal?.[field.key];
  if (journalField && typeof journalField === "object") return journalField as SchemaFieldMessages;
  return ruMessages.taskFillSchema.systemFields[field.key as keyof typeof ruMessages.taskFillSchema.systemFields] as SchemaFieldMessages | undefined;
}

function existingJournalField(
  messages: SchemaPresentationMessages,
  code: string,
  field: TaskFormField,
): SchemaFieldMessages | undefined {
  const byCode = messages.journalFields[code as keyof MessageContract["journalFields"]];
  if (!byCode || !Object.hasOwn(byCode, field.key)) return undefined;
  const item = byCode[field.key as keyof typeof byCode];
  if (!item || typeof item !== "object") return undefined;
  return item as SchemaFieldMessages;
}

/** Present one schema field by stable journal/field/option identifiers. */
export function presentTaskFillField(
  field: TaskFormField,
  code: string,
  locale: Locale,
  messages: SchemaPresentationMessages,
): TaskFormField {
  const sourceLabel = field.sourceLabel ?? field.label;
  const isTemplateField = "presentationSource" in field && field.presentationSource === "template";
  const local = fieldMessage(messages.taskFillSchema, code, field);
  const journal = existingJournalField(messages, code, field);
  const system = messages.taskFillSchema.systemFields?.[field.key];
  const canonical = canonicalRussianField(ruMessages.taskFillSchema as TaskFillSchemaCatalog, code, field);
  const sourceMatchesCatalog = Boolean(canonical?.label && sourceLabel === canonical.label);
  const canPresentBySchema = !isTemplateField || sourceMatchesCatalog;
  const sourcePlaceholder = "placeholder" in field ? field.placeholder : undefined;
  const canPresentPlaceholder = !isTemplateField || Boolean(
    sourceMatchesCatalog && sourcePlaceholder !== undefined && sourcePlaceholder === canonical?.placeholder,
  );
  const mappedLabel = canPresentBySchema ? local?.label ?? journal?.label ?? system?.label : undefined;
  const label = translateDynamic(
    mappedLabel ?? sourceLabel,
    !isTemplateField && "presentationKey" in field ? field.presentationKey : undefined,
    !isTemplateField && "presentationValues" in field ? field.presentationValues : undefined,
    locale,
    messages.taskFillSchema,
  );
  const placeholderSource = (canPresentPlaceholder ? local?.placeholder ?? journal?.placeholder : undefined) ?? sourcePlaceholder;
  const placeholderKey = !isTemplateField && "placeholderPresentationKey" in field ? field.placeholderPresentationKey : undefined;
  const placeholder = placeholderSource === undefined && !placeholderKey
    ? undefined
    : translateDynamic(placeholderSource ?? "", placeholderKey, undefined, locale, messages.taskFillSchema);

  if (field.type !== "select") {
    return { ...field, sourceLabel, label, ...("placeholder" in field && placeholder !== undefined ? { placeholder } : {}) } as TaskFormField;
  }

  return {
    ...field,
    sourceLabel,
    label,
    options: field.options.map((option) => {
      const keyed = canPresentBySchema && !isTemplateField
        ? stringAtPath(messages.taskFillSchema, option.presentationKey)
        : undefined;
      const key = optionMessageKey(option.value);
      const canonicalOption = canonical?.options?.[key];
      const optionMatchesCatalog = !isTemplateField || option.label === canonicalOption;
      const byValue = optionMatchesCatalog
        ? local?.options?.[key] ?? journal?.options?.[key] ?? system?.options?.[key]
        : undefined;
      return { ...option, label: keyed ?? byValue ?? option.label };
    }),
    ...(placeholder !== undefined ? { placeholder } : {}),
  };
}

/** Return a display label while preserving the stored no-events reason value. */
export function presentNoEventsReason(
  reason: string,
  code: string,
  locale: Locale,
  messages: SchemaPresentationMessages,
): { value: string; label: string } {
  const allowedReasons = TEMPLATE_SCOPE_DEFAULTS[code]?.noEventsReasons;
  const reasonKey = allowedReasons?.includes(reason) ? noEventsReasonKey(reason) : undefined;
  const translated = reasonKey ? messages.taskFillSchema.noEventsReasons?.[reasonKey] : undefined;
  if (!translated) return { value: reason, label: reason };
  const t = createTranslator({
    locale,
    timeZone: "UTC",
    messages: { message: translated },
    onError: (error) => { throw error; },
  });
  return { value: reason, label: t("message") };
}

/** Map only recognized built-in reason strings; custom saved reasons stay verbatim. */
export function noEventsReasonKey(reason: string): string | undefined {
  const known: Record<string, string> = {
    "Заведение закрыто": "establishmentClosed",
    "Выходной/праздничный день": "dayOff",
    "Производства не было": "noProduction",
    "Не было блюд для интенсивного охлаждения": "noDishesForCooling",
    "Фритюр не использовался": "fryerNotUsed",
    "Металлических примесей не выявлено": "noMetalImpurities",
    "Несчастных случаев не было": "noAccidents",
    "Жалоб не поступало": "noComplaints",
    "Поломок не было": "noBreakdowns",
    "Обучения не проводилось": "noTraining",
    "СИЗ не выдавались": "noPpeIssued",
    "Поверки не было": "noCalibration",
    "Обслуживания не было": "noMaintenance",
    "Поставок нет": "noDeliveries",
    "Поставщик не приехал": "supplierDidNotArrive",
    "Кондиционер выключен": "airConditionerOff",
    "Помещение временно не используется": "roomUnused",
  };
  return known[reason];
}

/** Clone and present the complete adapter schema; stable payload metadata stays intact. */
export function presentTaskFillSchema(
  schema: TaskFormSchema,
  code: string,
  locale: Locale,
  messages: SchemaPresentationMessages,
): TaskFormSchema {
  const form = messages.taskFillSchema.forms?.[code];
  const sourceForm = (ruMessages.taskFillSchema as TaskFillSchemaCatalog).forms?.[code];
  return {
    ...schema,
    intro: schema.introPresentationKey
      ? translateDynamic(schema.intro ?? "", schema.introPresentationKey, schema.introPresentationValues, locale, messages.taskFillSchema)
      : sourceForm?.intro === schema.intro ? form?.intro ?? schema.intro : schema.intro,
    submitLabel: schema.submitPresentationKey
      ? translateDynamic(schema.submitLabel ?? "", schema.submitPresentationKey, undefined, locale, messages.taskFillSchema)
      : sourceForm?.submitLabel === schema.submitLabel ? form?.submitLabel ?? schema.submitLabel : schema.submitLabel,
    notice: schema.noticePresentationKey
      ? translateDynamic(schema.notice ?? "", schema.noticePresentationKey, schema.noticePresentationValues, locale, messages.taskFillSchema)
      : schema.notice,
    fields: schema.fields.map((field) => presentTaskFillField(field, code, locale, messages)),
    ...(schema.pipeline
      ? {
          pipeline: schema.pipeline.map((step) => ({
            ...step,
            sourceTitle: step.sourceTitle ?? step.title,
            title: translateDynamic(step.title, step.titlePresentationKey, step.titlePresentationValues, locale, messages.taskFillSchema),
            detail: translateDynamic(step.detail, step.detailPresentationKey, step.detailPresentationValues, locale, messages.taskFillSchema),
            hint: step.hint === undefined ? undefined : translateDynamic(step.hint, step.hintPresentationKey, undefined, locale, messages.taskFillSchema),
            ...(step.field ? { field: presentTaskFillField(step.field, code, locale, messages) } : {}),
          })),
        }
      : {}),
  };
}
