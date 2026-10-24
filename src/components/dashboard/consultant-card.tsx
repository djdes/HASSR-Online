import { Handshake, Mail, Phone, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  phoneHref,
  telegramHref,
  type ConsultantContact,
} from "@/lib/partners/consultant-contact-shared";
import { cn } from "@/lib/utils";

/**
 * Блок «Ваш консультант» — партнёр, который сопровождает организацию.
 * Полный вариант живёт на дашборде, компактный — в меню поддержки.
 * Server-safe: без состояния, ссылки обычные `<a>`.
 */
export function ConsultantCard({
  consultant,
  compact = false,
  className,
}: {
  consultant: ConsultantContact;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("dashboardUi.consultantCard");
  const contacts = [
    consultant.phone
      ? { icon: Phone, label: consultant.phone, href: phoneHref(consultant.phone) }
      : null,
    consultant.telegram
      ? { icon: Send, label: consultant.telegram, href: telegramHref(consultant.telegram), external: true }
      : null,
    consultant.email
      ? { icon: Mail, label: consultant.email, href: `mailto:${consultant.email}` }
      : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <section
      className={cn(
        "rounded-2xl border border-[#ececf4] bg-white",
        compact ? "p-4" : "p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6",
        className,
      )}
      aria-label={t("title")}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#eef1ff] text-[#5566f6]">
          {consultant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={consultant.logoUrl} alt="" className="size-full object-contain p-1" />
          ) : (
            <Handshake className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("title")}
          </div>
          <div className="mt-0.5 truncate text-[15px] font-semibold text-[#0b1024]">
            {consultant.brandName}
          </div>
          {!compact ? (
            <p className="mt-1 text-[13px] leading-[1.55] text-[#6f7282]">
              {t("description")}
            </p>
          ) : null}
        </div>
      </div>
      {contacts.length ? (
        <div className={cn("flex flex-wrap gap-2", compact ? "mt-3" : "mt-4")}>
          {contacts.map((c) => (
            <a
              key={c.href}
              href={c.href}
              target={c.external ? "_blank" : undefined}
              rel={c.external ? "noopener noreferrer" : undefined}
              className="inline-flex h-9 max-w-full items-center gap-2 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <c.icon className="size-4 shrink-0 text-[#5566f6]" />
              <span className="truncate">{c.label}</span>
            </a>
          ))}
        </div>
      ) : (
        <p className={cn("text-[13px] text-[#9b9fb3]", compact ? "mt-2" : "mt-3")}>
          {t("noContacts")}
        </p>
      )}
    </section>
  );
}
