"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { CHALLENGE_MAX_AGE_MS, CHALLENGE_MIN_AGE_MS } from "@/lib/registration-challenge-timing";

/**
 * Невидимая проверка от ботов (спека invisible-antibot-2026-11): форма тихо
 * берёт у сервера подписанную отметку времени и прячет поле-ловушка
 * `website`. Человек ничего не отмечает и не ждёт: к моменту отправки 1,5 с
 * уже прошли, а если нет — `getToken()` сам дождётся остатка.
 */
type Stamp = { token: string; receivedAt: number };

const ENDPOINT = "/api/auth/registration-challenge";
// Обновляем отметку заранее, чтобы сервер не отклонил её как устаревшую.
const REFRESH_AFTER_MS = CHALLENGE_MAX_AGE_MS / 2;
// Небольшой запас поверх минимума: сервер считает возраст от момента выдачи.
const MIN_WAIT_MS = CHALLENGE_MIN_AGE_MS + 150;

async function fetchStamp(): Promise<Stamp> {
  const response = await fetch(ENDPOINT, { cache: "no-store" });
  if (!response.ok) throw new Error("Challenge unavailable");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("token" in data) ||
      typeof data.token !== "string" || !data.token) {
    throw new Error("Invalid challenge");
  }
  return { token: data.token, receivedAt: Date.now() };
}

export function useRegistrationChallenge() {
  const t = useTranslations("auth.challenge");
  const [website, setWebsite] = useState("");
  const id = useId();
  const pending = useRef<Promise<Stamp> | null>(null);

  const load = useCallback(() => {
    const promise = fetchStamp();
    pending.current = promise;
    promise.catch(() => {
      if (pending.current === promise) pending.current = null;
    });
    return promise;
  }, []);

  useEffect(() => {
    if (!pending.current) load().catch(() => { /* retried on submit */ });
  }, [load]);

  /** Токен для отправки; бросает ошибку, только если сервер недоступен. */
  const getToken = useCallback(async () => {
    let stamp: Stamp;
    try {
      stamp = await (pending.current ?? load());
    } catch {
      stamp = await load();
    }
    if (Date.now() - stamp.receivedAt > REFRESH_AFTER_MS) stamp = await load();
    const wait = stamp.receivedAt + MIN_WAIT_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return stamp.token;
  }, [load]);

  return {
    website,
    getToken,
    element: (
      <div aria-hidden="true" className="hidden">
        <label htmlFor={id}>{t("websiteLabel")}</label>
        <input id={id} name="website" type="text" autoComplete="off" tabIndex={-1}
          value={website} onChange={(event) => setWebsite(event.target.value)} />
      </div>
    ),
  };
}
