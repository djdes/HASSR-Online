"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Phone } from "lucide-react";

import { ContactUsDialog } from "@/components/contact/contact-us-dialog";
import { useFabAction, useHasFabDock } from "@/components/layout/fab-dock";

/**
 * «Контакты» в доке плавающих кнопок кабинета и Mini App (07.11.2026):
 * рядом с поддержкой — телефон, Telegram, MAX и почта в любой момент.
 * На компьютере — кнопка в ряду справа внизу, на телефоне — строка в листе
 * «Помощь», в Mini App — там же, в кнопке шапки (П-3). Окно — то же
 * «Свяжитесь с нами», что на сайте.
 */
export function ContactsFabAction({ telegramUrl }: { telegramUrl: string | null }) {
  const t = useTranslations("layoutUi.fabDock");
  const [open, setOpen] = useState(false);
  const docked = useHasFabDock();
  useFabAction(
    {
      id: "contacts",
      order: 30,
      label: t("contacts"),
      hint: t("contactsHint"),
      icon: Phone,
      onSelect: () => setOpen(true),
    },
    docked && !open,
  );
  return <ContactUsDialog open={open} onOpenChange={setOpen} telegramUrl={telegramUrl} general />;
}
