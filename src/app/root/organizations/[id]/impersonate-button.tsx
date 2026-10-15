"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { organizationError } from "./organization-presentation";
import { UserCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = { organizationId: string; organizationName: string };

/**
 * Starts a "view as" session. /api/root/impersonate сам перевыпускает
 * NextAuth session-token cookie с новым actingAsOrganizationId — нам
 * не нужен useSession().update() (он ненадёжен в Next.js 16 + NextAuth
 * v4: cookie иногда не записывается до hard navigation). После успеха
 * делаем full reload на /dashboard — layout видит обновлённый JWT и
 * рендерится в контексте выбранной организации.
 */
export function ImpersonateButton({ organizationId, organizationName }: Props) {
  const t = useTranslations("rootOrganizationManagement");
  const currentCopy = useRef(t);
  useLayoutEffect(() => { currentCopy.current = t; }, [t]);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const res = await fetch("/api/root/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(organizationError(body, currentCopy.current, "impersonate.failed"));
        setBusy(false);
        return;
      }
      toast.success(currentCopy.current("impersonate.success", { name: organizationName }));
      // Hard reload гарантирует что server-side getServerSession()
      // перечитает свежий cookie на /dashboard.
      window.location.href = "/dashboard";
    } catch {
      toast.error(currentCopy.current("impersonate.failed"));
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      onClick={start}
      disabled={busy}
      className="h-11 rounded-2xl bg-[#5566f6] px-4 text-[15px] text-white hover:bg-[#4959eb]"
    >
      <UserCog className="size-5" />
      {t("impersonate.enter", { name: organizationName })}
    </Button>
  );
}
