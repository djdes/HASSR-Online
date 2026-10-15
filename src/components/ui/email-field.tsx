"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { checkEmail, replaceDomain, type EmailCheck, type EmailValidationIssueCode } from "@/lib/email-validation";

const EMAIL_ERROR_MESSAGE_KEYS = {
  required: "errors.required",
  tooLong: "errors.tooLong",
  whitespace: "errors.whitespace",
  missingAt: "errors.missingAt",
  multipleAt: "errors.multipleAt",
  missingLocalPart: "errors.missingLocalPart",
  missingDomain: "errors.missingDomain",
  missingDomainDot: "errors.missingDomainDot",
  malformedDomain: "errors.malformedDomain",
  invalidDomainCharacters: "errors.invalidDomainCharacters",
  invalidTld: "errors.invalidTld",
} as const satisfies Record<EmailValidationIssueCode, string>;

/**
 * Поле почты, которое не даёт отправить заведомо мёртвый адрес.
 *
 * Три уровня проверки, от дешёвого к дорогому:
 *   1. структура (нет собаки, пусто до собаки, домен без точки…) —
 *      сразу, локально;
 *   2. известные опечатки популярных доменов (`gmail.ru` →
 *      `gmail.com`) — тоже локально, с кнопкой «Исправить»;
 *   3. существование домена по MX-записям — запросом на сервер, с
 *      задержкой после окончания ввода.
 *
 * Кнопка отправки блокируется, пока адрес не пройдёт все три. Это
 * важнее обычного, потому что при мгновенной регистрации пароль уходит
 * письмом: ошиблись в домене — аккаунт мёртв, и восстановить его нечем.
 */

export type EmailFieldState = {
  value: string;
  valid: boolean;
  /// Проверка домена ещё идёт — кнопку стоит держать в ожидании.
  checking: boolean;
};

type DomainState = "idle" | "checking" | "ok" | "missing";

export function useEmailField(initial = "") {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [domainState, setDomainState] = useState<DomainState>("idle");
  const requestId = useRef(0);

  const local = checkEmail(value);

  useEffect(() => {
    // Домен спрашиваем, только когда структура уже верная — иначе
    // дёргали бы DNS на каждый промежуточный символ. Сбрасывать
    // состояние здесь не нужно: ниже оно выводится из local.status,
    // поэтому «протухший» ответ на неполный адрес всё равно не покажется.
    if (local.status !== "ok") return;

    const domain = value.trim().toLowerCase().split("@")[1];
    if (!domain) return;

    const id = ++requestId.current;

    const timer = setTimeout(async () => {
      // Состояние ставим здесь, а не в теле эффекта: пока человек
      // печатает, дёргать ререндер на каждый символ незачем.
      setDomainState("checking");
      try {
        const res = await fetch(
          `/api/public/email-domain-check?domain=${encodeURIComponent(domain)}`,
        );
        const data = await res.json().catch(() => ({ ok: true }));
        if (requestId.current !== id) return;
        setDomainState(data.ok ? "ok" : "missing");
      } catch {
        // Сеть недоступна — не мешаем регистрироваться: финальную
        // проверку всё равно делает сервер при создании аккаунта.
        if (requestId.current === id) setDomainState("ok");
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [value, local.status]);

  // Пока структура адреса не в порядке, результат проверки домена
  // относится к прошлому вводу — не показываем его.
  const effectiveDomainState: DomainState =
    local.status === "ok" ? domainState : "idle";
  const valid = local.status === "ok" && effectiveDomainState !== "missing";

  return {
    value,
    setValue: (v: string) => {
      setValue(v);
      setTouched(true);
    },
    touched,
    setTouched,
    check: local,
    domainState: effectiveDomainState,
    valid,
    checking: effectiveDomainState === "checking",
    applySuggestion: (suggestion: string) =>
      setValue(replaceDomain(value, suggestion)),
  };
}

/**
 * Подсказка под полем. Показывается только после того, как человек
 * что-то ввёл, — иначе пустая форма встречала бы его ошибкой.
 */
export function EmailHint({
  check,
  touched,
  domainState,
  onApply,
  tone = "light",
}: {
  check: EmailCheck;
  touched: boolean;
  domainState: DomainState;
  onApply: (suggestion: string) => void;
  tone?: "light" | "dark";
}) {
  const t = useTranslations("auth.emailField");
  const dark = tone === "dark";
  const errorColor = dark ? "text-[#ffb4ab]" : "text-[#a13a32]";
  const mutedColor = dark ? "text-white/60" : "text-[#6f7282]";

  if (!touched) return null;

  if (check.status === "typo") {
    return (
      <p className={"mt-2.5 text-[13px] leading-[1.5] " + errorColor}>
        {check.code === "knownTypo"
          ? t("knownTypo", { domain: check.domain, suggestion: check.suggestion })
          : t("suggestedTypo", { suggestion: check.suggestion })}{" "}
        <button
          type="button"
          onClick={() => onApply(check.suggestion)}
          className={
            "font-semibold underline underline-offset-2 " +
            (dark ? "text-white" : "text-[#3848c7]")
          }
        >
          {t("applySuggestion", { suggestion: check.suggestion })}
        </button>
      </p>
    );
  }

  if (check.status === "invalid") {
    return (
      <p className={"mt-2.5 text-[13px] leading-[1.5] " + errorColor}>
        {t(EMAIL_ERROR_MESSAGE_KEYS[check.code])}
      </p>
    );
  }

  if (check.status === "ok" && domainState === "missing") {
    return (
      <p className={"mt-2.5 text-[13px] leading-[1.5] " + errorColor}>
        {t("domainMissing")}
      </p>
    );
  }

  if (check.status === "ok" && domainState === "checking") {
    return (
      <p className={"mt-2.5 text-[13px] leading-[1.5] " + mutedColor}>
        {t("domainChecking")}
      </p>
    );
  }

  return null;
}
