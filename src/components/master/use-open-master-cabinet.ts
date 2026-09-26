"use client";

import { useState } from "react";
import { toast } from "sonner";

import { MASTER_CABINET_HREF } from "@/lib/cabinet-menu";
import { switchOrganizationAndOpen } from "@/lib/switch-organization";

/**
 * Строка мастер-кабинета в разделе «Кабинет» (меню профиля сайта, лист
 * на телефоне, мини-приложение): переключиться на кабинет и открыть
 * `/master`. `openingId` — для значка ожидания на нажатой строке.
 */
export function useOpenMasterCabinet() {
  const [openingId, setOpeningId] = useState<string | null>(null);

  async function open(cabinet: { id: string }) {
    if (openingId) return;
    setOpeningId(cabinet.id);
    try {
      await switchOrganizationAndOpen(cabinet.id, MASTER_CABINET_HREF);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось открыть мастер-кабинет");
      setOpeningId(null);
    }
  }

  return { openingId, open };
}
