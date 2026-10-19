"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Bell, CheckCircle2, CircleDashed, Mail, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { RU_PHONE_PLACEHOLDER, formatRuPhoneInput, phoneInputProps } from "@/lib/phone-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FieldRow,
  ORG_INPUT_CLASS,
  ORG_OUTLINE_BUTTON_CLASS,
  SaveButton,
  StepCard,
  UnsavedBar,
  patchOrganization,
} from "@/components/settings/organization-page-kit";

type Contacts = { phone: string; accountantEmail: string; timezone: string; locale: string };

type ContactsField = keyof Contacts;

/** Ошибка сервера → поле, у которого её показать. */
const FIELD_ERRORS: Partial<Record<string, ContactsField>> = {
  invalidPhone: "phone",
  invalidEmail: "accountantEmail",
  invalidTimezone: "timezone",
  invalidLocale: "locale",
};

const TIMEZONE_OPTIONS = [
  "Europe/Kaliningrad",
  "Europe/Moscow",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Yakutsk",
  "Asia/Vladivostok",
  "Asia/Magadan",
  "Asia/Kamchatka",
];

const LOCALES = ["ru", "en", "uz"] as const;

const SELECT_CLASS =
  "h-11 w-full rounded-2xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[14px] text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 focus-visible:border-[#5566f6] focus-visible:ring-[#5566f6]/15 aria-[invalid=true]:border-[#e2675b]";

/** «Europe/Moscow · GMT+3»: смещение — из Intl, без своей таблицы. */
function timezoneLabel(timezone: string): string {
  const name = timezone.replace(/_/g, " ");
  try {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    return offset ? `${name} · ${offset}` : name;
  } catch {
    return name;
  }
}

export type NotificationsSummary = {
  telegramLinked: boolean;
  email: string;
  emailVerified: boolean;
  staffTotal: number;
  staffTelegram: number;
};

/**
 * «Моя компания → Контакты и уведомления»: ① телефон и почта бухгалтера,
 * ② часовой пояс и язык — бывшие поля формы «Реквизитов», сохраняются тем же
 * PATCH; ③ куда приходят уведомления и ссылка на их настройку.
 */
export function OrganizationContactsForm({
  initial,
  notifications,
}: {
  initial: { phone: string | null; accountantEmail: string | null; timezone: string; locale: string };
  notifications: NotificationsSummary;
}) {
  const t = useTranslations("settingsManagement.organizationProfile");
  const router = useRouter();
  // Телефон в базе — «+79991234567», в поле — «+7 999 123-45-67» (как было на «Реквизитах»).
  const start: Contacts = {
    phone: initial.phone ? formatRuPhoneInput(initial.phone) : "",
    accountantEmail: initial.accountantEmail ?? "",
    timezone: initial.timezone,
    locale: initial.locale,
  };
  const [saved, setSaved] = useState<Contacts>(start);
  const [draft, setDraft] = useState<Contacts>(start);
  const [errors, setErrors] = useState<Partial<Record<ContactsField, string>>>({});
  const [saving, setSaving] = useState(false);

  const changed = (Object.keys(draft) as ContactsField[]).filter((key) => draft[key].trim() !== saved[key].trim());
  const dirty = changed.length > 0;

  function set(key: ContactsField, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function discard() {
    setDraft(saved);
    setErrors({});
  }

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const result = await patchOrganization(Object.fromEntries(changed.map((key) => [key, draft[key].trim()])));
      if (!result.ok) {
        if (result.network) {
          toast.error(t("form.networkError"));
          return;
        }
        const fieldErrors: Partial<Record<ContactsField, string>> = {};
        for (const key of result.keys ?? []) {
          const field = FIELD_ERRORS[key];
          if (field) fieldErrors[field] = t(`form.apiErrors.${key}`);
        }
        setErrors(fieldErrors);
        toast.error(result.keys ? result.keys.map((key) => t(`form.apiErrors.${key}`)).join("; ") : t("form.saveError"));
        return;
      }
      setSaved(draft);
      toast.success(t("form.saved"));
      // Язык организации меняет язык кабинета — перерисовываем страницу.
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const timezones = TIMEZONE_OPTIONS.includes(draft.timezone) || !draft.timezone ? TIMEZONE_OPTIONS : [draft.timezone, ...TIMEZONE_OPTIONS];

  return (
    <div className="space-y-5">
      {dirty ? <UnsavedBar saving={saving} onSave={save} onDiscard={discard} /> : null}

      {/* ① Контакты */}
      <StepCard n={1} id="contacts" title={t("contactsPage.contactsTitle")} lead={t("contactsPage.contactsLead")}>
        <FieldRow label={t("form.phone")} hint={t("contactsPage.phoneHint")} error={errors.phone} htmlFor="contacts-phone">
          <input
            id="contacts-phone"
            type="tel"
            {...phoneInputProps(draft.phone, (value) => set("phone", value))}
            className={ORG_INPUT_CLASS}
            placeholder={RU_PHONE_PLACEHOLDER}
            aria-invalid={errors.phone ? true : undefined}
          />
        </FieldRow>
        <FieldRow label={t("form.accountantEmail")} hint={t("form.accountantEmailHint")} error={errors.accountantEmail} htmlFor="contacts-accountant">
          <input
            id="contacts-accountant"
            type="email"
            value={draft.accountantEmail}
            onChange={(event) => set("accountantEmail", event.target.value)}
            className={ORG_INPUT_CLASS}
            placeholder="accountant@company.ru"
            aria-invalid={errors.accountantEmail ? true : undefined}
          />
        </FieldRow>
      </StepCard>

      {/* ② Часовой пояс и язык */}
      <StepCard n={2} id="region" title={t("form.regionTitle")} lead={t("contactsPage.regionLead")}>
        <FieldRow label={t("form.timezone")} hint={t("contactsPage.timezoneHint")} error={errors.timezone}>
          <Select value={draft.timezone} onValueChange={(value) => set("timezone", value)}>
            <SelectTrigger className={SELECT_CLASS} aria-label={t("form.timezone")} aria-invalid={errors.timezone ? true : undefined} data-field="timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timezones.map((timezone) => (
                <SelectItem key={timezone} value={timezone}>
                  {TIMEZONE_OPTIONS.includes(timezone)
                    ? timezoneLabel(timezone)
                    : t("form.currentTimezone", { timezone: timezoneLabel(timezone) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label={t("form.interfaceLanguage")} hint={t("form.interfaceLanguageHint")} error={errors.locale}>
          <Select value={draft.locale} onValueChange={(value) => set("locale", value)}>
            <SelectTrigger className={SELECT_CLASS} aria-label={t("form.interfaceLanguage")} aria-invalid={errors.locale ? true : undefined} data-field="locale">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {locale === "ru" ? t("form.languageRu") : locale === "en" ? t("form.languageEn") : t("form.languageUz")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
      </StepCard>

      <SaveButton dirty={dirty} saving={saving} onSave={save} />

      {/* ③ Уведомления */}
      <StepCard n={3} id="notifications" title={t("contactsPage.notifyTitle")} lead={t("contactsPage.notifyLead")}>
        <ul className="grid gap-3 md:grid-cols-3" data-notifications>
          <NotifyTile
            icon={<Send className="size-4" aria-hidden />}
            title={t("contactsPage.telegramTitle")}
            ok={notifications.telegramLinked}
            status={notifications.telegramLinked ? t("contactsPage.telegramLinked") : t("contactsPage.telegramNotLinked")}
            body={notifications.telegramLinked ? t("contactsPage.telegramLinkedBody") : t("contactsPage.telegramNotLinkedBody")}
          />
          <NotifyTile
            icon={<Mail className="size-4" aria-hidden />}
            title={t("contactsPage.emailTitle")}
            ok={notifications.emailVerified}
            status={notifications.emailVerified ? t("contactsPage.emailVerified") : t("contactsPage.emailNotVerified")}
            body={notifications.email}
          />
          <NotifyTile
            icon={<Users className="size-4" aria-hidden />}
            title={t("contactsPage.staffTitle")}
            ok={notifications.staffTotal > 0 && notifications.staffTelegram === notifications.staffTotal}
            status={t("contactsPage.staffTelegram", {
              linked: String(notifications.staffTelegram),
              total: String(notifications.staffTotal),
            })}
            body={t("contactsPage.staffBody")}
          />
        </ul>
        <div className="flex flex-wrap gap-2">
          <Link href="/settings/notifications" className={ORG_OUTLINE_BUTTON_CLASS}>
            <Bell className="size-4 text-[#5566f6]" aria-hidden />
            {t("contactsPage.openNotifications")}
            <ArrowRight className="size-4 text-[#5566f6]" aria-hidden />
          </Link>
        </div>
      </StepCard>
    </div>
  );
}

function NotifyTile({
  icon,
  title,
  ok,
  status,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  ok: boolean;
  status: string;
  body: string;
}) {
  return (
    <li className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4" data-ok={ok ? "true" : "false"}>
      <div className="flex items-center gap-2 text-[13.5px] font-semibold text-[#0b1024]">
        <span className="flex size-7 items-center justify-center rounded-lg bg-[#eef1ff] text-[#5566f6]">{icon}</span>
        {title}
      </div>
      <div className={`mt-2.5 flex items-center gap-1.5 text-[13px] font-medium ${ok ? "text-[#116b2a]" : "text-[#b45309]"}`}>
        {ok ? <CheckCircle2 className="size-3.5 shrink-0" aria-hidden /> : <CircleDashed className="size-3.5 shrink-0" aria-hidden />}
        {status}
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-[#6f7282] [overflow-wrap:anywhere]">{body}</p>
    </li>
  );
}
