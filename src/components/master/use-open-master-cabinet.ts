"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { MASTER_CABINET_HREF } from "@/lib/cabinet-menu";
import { switchOrganizationAndOpen } from "@/lib/switch-organization";
import { masterCabinetOpenErrorKey } from "./master-cabinet-ui-presentation";

/**
 * Строка мастер-кабинета в разделе «Кабинет» (меню профиля сайта, лист
 * на телефоне, мини-приложение): переключиться на кабинет и открыть
 * `/master`. `openingId` — для значка ожидания на нажатой строке.
 */
export function useOpenMasterCabinet() {
  const locale = useLocale();
  const t = useTranslations("masterCabinetUi");
  const currentT = useRef(t);
  useEffect(() => {
    currentT.current = t;
  }, [locale, t]);
  const [openingId, setOpeningId] = useState<string | null>(null);

  async function open(cabinet: { id: string }) {
    if (openingId) return;
    setOpeningId(cabinet.id);
    try {
      await switchOrganizationAndOpen(cabinet.id, MASTER_CABINET_HREF);
    } catch {
      toast.error(currentT.current(masterCabinetOpenErrorKey()));
      setOpeningId(null);
    }
  }

  return { openingId, open };
}
