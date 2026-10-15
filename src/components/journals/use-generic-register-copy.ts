"use client";
import { useEffect, useRef } from "react";
import { useLocale, useMessages, useTranslations } from "next-intl";
import type { RegisterPresentationMessages } from "./generic-register-presentation";

export function useGenericRegisterCopy() {
  const t = useTranslations("genericRegister");
  const locale = useLocale();
  const messages = useMessages() as unknown as RegisterPresentationMessages;
  const latest = useRef({ t, locale, messages });
  useEffect(() => { latest.current = { t, locale, messages }; }, [t, locale, messages]);
  return { t, locale, messages, latest };
}
