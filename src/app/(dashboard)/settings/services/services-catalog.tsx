"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Lock } from "lucide-react";

import { ContactUsButton, ContactUsPanel } from "@/components/contact/contact-us-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PlatformServiceItem, ServiceCategory } from "@/lib/services/constants";

/**
 * Карточки услуг с заявкой в один диалог.
 *
 * Цен нет (владелец, 2026-10-29): на их месте «Свяжитесь с нами» — окно с
 * крупными контактами. Заказ — простая заявка: ничего не оплачивается и не
 * списывается, стоимость называем после разговора. Диалог заявки так и
 * говорит и сразу предлагает позвонить или написать.
 */
const FIELD_CLASS =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

type Group = {
  category: ServiceCategory;
  label: string;
  items: PlatformServiceItem[];
};

export function ServicesCatalog({
  groups,
  canOrder,
  contact,
  telegramUrl,
  initialServiceKey = null,
}: {
  groups: Group[];
  canOrder: boolean;
  contact: { name: string; phone: string; email: string };
  /** Telegram окна «Свяжитесь с нами» — `contactTelegramUrl` с сервера. */
  telegramUrl: string;
  /**
   * `?order=<key>` — пришли из «Производственного контроля» по кнопке
   * «Заказать индивидуально»: сразу открываем диалог этой услуги.
   */
  initialServiceKey?: string | null;
}) {
  const t = useTranslations("settingsUi.servicesCatalog");
  const router = useRouter();
  const [active, setActive] = useState<PlatformServiceItem | null>(null);
  const [form, setForm] = useState(contact);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!initialServiceKey || !canOrder) return;
    const service = groups
      .flatMap((group) => group.items)
      .find((item) => item.key === initialServiceKey);
    if (service) setActive(service);
    // Только при входе на страницу: дальше диалогом управляет человек.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openService(service: PlatformServiceItem) {
    setActive(service);
    setForm(contact);
    setComment("");
  }

  async function submit() {
    if (!active) return;
    if (form.name.trim().length < 2 || form.phone.trim().length < 6) {
      toast.error(t("contactRequired"));
      return;
    }

    setSending(true);
    try {
      // Без `payFromBalance`: заявка, а не покупка — баллы не списываются.
      const response = await fetch("/api/services/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceKey: active.key,
          contactName: form.name.trim(),
          contactPhone: form.phone.trim(),
          contactEmail: form.email.trim() || undefined,
          comment: comment.trim() || undefined,
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? t("sendFailed"));
      }
      toast.success(t("sentSuccess"));
      setActive(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sendFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-7">
      {!canOrder ? (
        <div className="flex gap-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4">
          <Lock className="size-4 shrink-0 text-[#6f7282]" />
          <p className="text-[13px] leading-[1.55] text-[#3c4053]">
            {t("managerOnlyNotice")}
          </p>
        </div>
      ) : null}

      {groups.map((group) => (
        <section key={group.category} className="space-y-3">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {group.label}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {group.items.map((service) => (
              <div
                key={service.key}
                data-service-card={service.key}
                className="flex flex-col rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-shadow duration-150 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]"
              >
                <div className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024]">
                  {service.title}
                </div>
                <p className="mt-1.5 text-[13px] leading-[1.55] text-[#6f7282]">
                  {service.summary}
                </p>
                <p className="mt-3 text-[13px] leading-[1.6] text-[#3c4053]">
                  {service.description}
                </p>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                  {/* Вместо цены — окно с крупными контактами. */}
                  <ContactUsButton
                    service={service.title}
                    telegramUrl={telegramUrl}
                    testId={`service-contact-${service.key}`}
                  />
                  {canOrder ? (
                    <button
                      type="button"
                      onClick={() => openService(service)}
                      data-testid={`service-order-${service.key}`}
                      className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                    >
                      {t("order")}
                    </button>
                  ) : (
                    <span className="text-[12.5px] text-[#9b9fb3]">
                      {t("orderedByManager")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <ConfirmDialog
        open={active !== null}
        onClose={() => setActive(null)}
        onConfirm={submit}
        variant="info"
        title={
          active ? t("orderTitle", { title: active.title }) : t("orderService")
        }
        description={
          <span className="text-[13px] text-[#3c4053]">{t("requestLead")}</span>
        }
        bullets={[
          { label: t("bulletNothingCharged"), tone: "info" },
          { label: t("bulletContactDay") },
        ]}
        confirmLabel={sending ? t("sending") : t("sendRequest")}
        confirmDisabled={sending}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
              {t("nameLabel")}
            </span>
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              className={FIELD_CLASS}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
              {t("phoneLabel")}
            </span>
            <input
              value={form.phone}
              onChange={(event) =>
                setForm((current) => ({ ...current, phone: event.target.value }))
              }
              placeholder="+7 999 123-45-67"
              className={FIELD_CLASS}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
              {t("commentLabel")}
            </span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              placeholder={t("commentPlaceholder")}
              className="w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-2.5 text-[14px] leading-[1.5] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </label>
          {active ? (
            <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3" data-service-order-contacts>
              <div className="mb-2.5 text-[13px] font-medium text-[#3c4053]">{t("contactsTitle")}</div>
              <ContactUsPanel service={active.title} telegramUrl={telegramUrl} onBeforeChat={() => setActive(null)} />
            </div>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
