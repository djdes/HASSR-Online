import type { OrgSphere } from "@/lib/org-profile";

/**
 * Коммерческое предложение (КП) — входные данные. Интерфейс заморожен
 * спекой задачи proposal-kp (2026-09-29): им пользуются рассылка
 * (`src/lib/mailing`) и ROOT-генератор `/root/proposals`.
 *
 * Модуль без базы и без сервера: типы читает и клиентский компонент ROOT.
 */

/** Промокод, который КП показывает и зашивает в QR. */
export type ProposalPromo = {
  code: string;
  kind: "percent" | "fixed";
  /** Процент (1–100) или рубли. */
  value: number;
  /** «Скидка навсегда» — привязывается к аккаунту при первой оплате. */
  lifetime: boolean;
  /** До какого момента код действует; null — без срока. */
  endsAt: Date | null;
};

export type ProposalSender = {
  name: string;
  phone?: string | null;
  email?: string | null;
  /** «@username», «username» или ссылка t.me. */
  telegram?: string | null;
};

export type ProposalVars = {
  /** Значение из ORG_SPHERES (src/lib/org-profile.ts). */
  sphere: OrgSphere;
  /** «Кафе «Ромашка»». */
  companyName?: string | null;
  /** «Анна Сергеевна». */
  recipientName?: string | null;
  /** Нет — предложение без скидки. */
  promo?: ProposalPromo | null;
  /** Нет — по умолчанию (`proposalCtaUrl`). */
  ctaUrl?: string | null;
  /** Нет — отправитель по умолчанию из настройки ROOT (`PlatformSetting` `proposal.sender`). */
  sender?: ProposalSender | null;
};

export type ProposalEmailOptions = {
  /** Ссылка «Открыть в браузере». Не передан — своя подписанная ссылка; null — без ссылки. */
  webUrl?: string | null;
  /** Ссылка отписки (рассылка). Не оборачивается `trackUrl`. */
  unsubscribeUrl?: string | null;
  /** Обёртка ссылок для учёта кликов — ко всем ссылкам письма, кроме отписки. */
  trackUrl?: (url: string) => string;
};

export type RenderedProposalEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};
