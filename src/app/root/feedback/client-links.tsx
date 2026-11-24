"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Mail, Phone, UserCog, UserRound } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * Быстрый переход от обращения или чата к клиенту (владелец, 2026-11-23:
 * «переход из обращения в клиента — и из чатов, и из обращений, максимально
 * удобно для быстрой помощи»): карточка клиента, вход в его кабинет, звонок,
 * письмо. Подписи приходят готовыми — ссылки живут в двух разных словарях.
 */

const CHIP =
  "inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--app-veil)] px-3 text-[12.5px] font-medium text-[#3848c7] transition-colors hover:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";

export type ClientLinkLabels = {
  clientCard: string;
  enterCabinet: string;
  enterCabinetFailed: string;
  call: string;
  writeEmail: string;
};

export function ClientLinks({
  clientHref,
  cabinetOrganizationId,
  phone,
  email,
  labels,
  className,
}: {
  clientHref: string | null;
  /** Организация клиента, в кабинет которой можно войти; null — кнопки нет. */
  cabinetOrganizationId: string | null;
  phone: string | null;
  email: string | null;
  labels: ClientLinkLabels;
  className?: string;
}) {
  const [entering, setEntering] = useState(false);
  const tel = phone ? phone.replace(/[^+\d]/g, "") : "";
  if (!clientHref && !cabinetOrganizationId && !tel && !email) return null;

  async function enter() {
    if (!cabinetOrganizationId) return;
    setEntering(true);
    try {
      const response = await fetch("/api/root/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: cabinetOrganizationId }),
      });
      if (!response.ok) throw new Error();
      // Полная перезагрузка: кабинет читает новый токен на сервере.
      window.location.href = "/dashboard";
    } catch {
      toast.error(labels.enterCabinetFailed);
      setEntering(false);
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} data-client-links>
      {clientHref ? (
        <Link href={clientHref} className={CHIP} data-client-card>
          <UserRound className="size-3.5" />
          {labels.clientCard}
        </Link>
      ) : null}
      {cabinetOrganizationId ? (
        <button type="button" onClick={() => void enter()} disabled={entering} className={CHIP} data-enter-cabinet>
          {entering ? <Loader2 className="size-3.5 animate-spin" /> : <UserCog className="size-3.5" />}
          {labels.enterCabinet}
        </button>
      ) : null}
      {tel ? (
        <a href={`tel:${tel}`} className={CHIP} data-client-call>
          <Phone className="size-3.5" />
          {labels.call}
        </a>
      ) : null}
      {email ? (
        <a href={`mailto:${email}`} className={CHIP} data-client-email>
          <Mail className="size-3.5" />
          {labels.writeEmail}
        </a>
      ) : null}
    </div>
  );
}

/**
 * Переход по ссылке «Открыть» из всплывашки или колокольчика
 * (`/root/feedback#report-…` / `#chat-…`): ветку чата раскрываем, к
 * обращению прокручиваем, оба на пару секунд подсвечиваем.
 */
export function FeedbackHashFocus() {
  useEffect(() => {
    function focusHash() {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (!/^(report|chat)-/.test(hash)) return;
      const target = document.getElementById(hash);
      if (!target) return;
      if (target instanceof HTMLDetailsElement) target.open = true;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.setAttribute("data-flash", "");
      window.setTimeout(() => target.removeAttribute("data-flash"), 2400);
    }
    focusHash();
    window.addEventListener("hashchange", focusHash);
    return () => window.removeEventListener("hashchange", focusHash);
  }, []);
  return null;
}
