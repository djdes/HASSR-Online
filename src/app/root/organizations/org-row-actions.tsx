"use client";

import { useRef, useState } from "react";
import type { RootMetricsCopy } from "../metrics-presentation";
import { Loader2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { OrgDeleteButton } from "@/app/root/organizations/org-delete-button";

/**
 * Действия над организацией прямо в списке.
 *
 * Раньше и вход, и удаление жили только на карточке организации: чтобы
 * убрать тестовую компанию, приходилось сначала в неё зайти. Для разбора
 * десятка мусорных регистраций это десяток лишних переходов.
 */
export function OrgRowActions({
  organizationId,
  organizationName,
  usersCount,
  documentsCount,
  copy,
}: {
  organizationId: string;
  organizationName: string;
  /** Показываем в подтверждении, если вызывающий знает цифры. */
  usersCount?: number;
  documentsCount?: number;
  /** Only callers with the ROOT metrics message boundary opt in. */
  copy?: RootMetricsCopy;
}) {
  const currentCopy = useRef(copy);
  currentCopy.current = copy;
  const [busy, setBusy] = useState<"enter" | null>(null);

  async function enter() {
    setBusy("enter");
    try {
      const response = await fetch("/api/root/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось войти в организацию");
      }
      // Hard reload: серверные компоненты должны перечитать свежий cookie.
      window.location.href = "/dashboard";
    } catch (error) {
      toast.error(currentCopy.current ? currentCopy.current("actions.enterFailed") : error instanceof Error ? error.message : "Ошибка");
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => void enter()}
          disabled={busy !== null}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
        >
          {busy === "enter" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <UserCog className="size-3.5 text-[#5566f6]" />
          )}
          {copy ? copy("actions.enter") : "Войти"}
        </button>
        <OrgDeleteButton
          organizationId={organizationId}
          organizationName={organizationName}
          usersCount={usersCount}
          documentsCount={documentsCount}
          disabled={busy !== null}
          copy={copy}
        />
      </div>

    </>
  );
}
