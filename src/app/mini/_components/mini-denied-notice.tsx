"use client";

import { useTranslations } from "next-intl";
import { useDeniedNotice } from "@/components/layout/denied-notice";

/**
 * Та же одноразовая плашка «Раздел «…» закрыт для вашей роли» (2026-10-29)
 * на «Сегодня» приложения: сюда proxy и «Журналы» уводят линейного
 * сотрудника из закрытого раздела (П-3 — объяснение такое же, как на сайте).
 */
export function MiniDeniedNotice() {
  const t = useTranslations("navigation.shell.access");
  const notice = useDeniedNotice();
  if (!notice) return null;
  return (
    <section className="mini-card mb-3 p-4" role="status" data-denied-notice={notice.from}>
      <p className="text-[15px] font-semibold leading-snug" style={{ color: "var(--mini-text)" }}>
        {notice.text}
      </p>
      <p className="mt-1 text-[14px] leading-snug" style={{ color: "var(--mini-text-muted)" }}>
        {t("hintMini")}
      </p>
      <button
        type="button"
        onClick={notice.dismiss}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-[14px] border px-4 text-[15px] font-semibold"
        style={{ borderColor: "var(--mini-divider-strong)", color: "var(--mini-accent-ink)" }}
        data-denied-notice-dismiss
      >
        {t("dismiss")}
      </button>
    </section>
  );
}
