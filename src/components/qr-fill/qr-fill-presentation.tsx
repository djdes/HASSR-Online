"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTranslator, type TranslationValues } from "use-intl/core";
import type { Locale } from "@/i18n/locales";
import type { MessageContract } from "@/i18n/message-contract";
import { equipmentFillRu } from "@/i18n/equipment-fill-ru.generated";

function makeCopy(locale: Locale, messages: MessageContract["equipmentFill"]) {
  return createTranslator({ locale, messages: { equipmentFill: messages }, namespace: "equipmentFill" });
}
const legacy = { locale: "ru" as Locale, t: makeCopy("ru", equipmentFillRu), scoped: false, authenticated: false };
export type QrFillTranslator = typeof legacy.t;
const Context = createContext(legacy);
export type QrFillMessageKey = Parameters<typeof legacy.t>[0];
export type QrFeedback = { key: QrFillMessageKey; values?: TranslationValues };

/** Only the equipment entry opts in; other shared QR callers retain RU compatibility. */
export function QrFillPresentationProvider({ locale, messages, authenticated = false, children }: { locale: Locale; messages: MessageContract["equipmentFill"]; authenticated?: boolean; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeCopy(locale, messages), scoped: true, authenticated }), [locale, messages, authenticated]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useQrFillCopy() { return useContext(Context); }

export function useQrFeedback() {
  const { locale, t } = useQrFillCopy();
  return (feedback: QrFeedback) => createTranslator({ locale, messages: { message: t.raw(feedback.key) as string } })("message", feedback.values);
}

/** API descriptors contain semantic keys/primitive parameters, never arbitrary server prose. */
export function qrResponseFeedback(data: unknown, fallback: QrFillMessageKey): QrFeedback {
  const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const key = typeof body.errorCode === "string" && body.errorCode.startsWith("equipmentFill.") ? body.errorCode.slice("equipmentFill.".length) : null;
  if (key) {
    let node: unknown = equipmentFillRu;
    for (const part of key.split(".")) node = node && typeof node === "object" && Object.hasOwn(node, part) ? (node as Record<string, unknown>)[part] : undefined;
    if (typeof node === "string") {
      const values = body.errorParams && typeof body.errorParams === "object" ? Object.fromEntries(Object.entries(body.errorParams).filter(([,value]) => typeof value === "string" || typeof value === "number")) as TranslationValues : undefined;
      const argumentsRequired = [...node.matchAll(/\{(\w+)\s*(?:\}|,\s*(number|select|plural)\b)/g)];
      if (argumentsRequired.some(([, name, kind]) => values?.[name] === undefined || ((kind === "number" || kind === "plural") && (typeof values?.[name] !== "number" || !Number.isFinite(values[name]))))) return { key: fallback };
      return { key: key as QrFillMessageKey, values };
    }
  }
  if (body.code === "photo_required") return { key: "photo.requiredError" };
  if (body.code === "photo_disabled") return { key: "photo.disabled" };
  if (body.code === "no-active-document") return { key: "reading.noDocument" };
  return { key: fallback };
}
