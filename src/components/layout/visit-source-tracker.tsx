"use client";

import { useEffect } from "react";

import { rememberSignupSource } from "@/lib/signup-source";

/**
 * Запоминает первое касание посетителя (поиск, реклама, соцсети, ИИ) на
 * любой странице сайта — не только там, где есть форма регистрации
 * (спека visit-source-2026-11). Ничего не рисует.
 */
export function VisitSourceTracker() {
  useEffect(() => {
    rememberSignupSource();
  }, []);
  return null;
}
