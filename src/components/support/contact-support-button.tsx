"use client";

import type { ReactNode } from "react";

import { contactSupport } from "@/lib/support-chat-bus";

/**
 * «Связаться» — чат поддержки на этой странице, а без виджета — письмо с
 * темой (`contactSupport`). Для мест «больше по согласованию» у
 * «Премиума»: в карточке тарифа, в «Тарифе и оплате», на `/order`.
 */
export function ContactSupportButton({
  subject,
  className,
  testId,
  children,
}: {
  /** Тема письма, если чата на странице нет. */
  subject: string;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" data-testid={testId} onClick={() => contactSupport(subject)} className={className}>
      {children}
    </button>
  );
}
