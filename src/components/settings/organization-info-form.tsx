"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  Building2,
  CreditCard,
  FileText,
  Globe,
  Hash,
  Image as ImageIcon,
  Loader2,
  Lock,
  MapPin,
  Palette,
  Phone,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ORG_OWNERSHIP,
  ORG_SPHERES,
  normalizeOwnership,
  normalizeSphere,
} from "@/lib/org-profile";
import { planLabel } from "@/lib/plan-limits";
import type { LegalProfile } from "@/lib/org-legal-profile";
import {
  ORG_JOURNAL_NAME_MAX,
  resolveOrgJournalName,
  suggestOrgJournalName,
} from "@/lib/org-journal-name";

type Form = {
  name: string;
  /// Сокращённое название для шапки журналов; null — из ЕГРЮЛ или полное.
  journalShortName: string | null;
  /// Сфера заведения (в БД колонка называется `type`).
  type: string;
  ownershipKind: string;
  inn: string | null;
  address: string | null;
  phone: string | null;
  accountantEmail: string | null;
  locale: string;
  timezone: string;
  brandColor: string | null;
  logoUrl: string | null;
  shiftEndHour: number;
  lockPastDayEdits: boolean;
  requireAdminForJournalEdit: boolean;
};

type Legal = {
  /// Снимок ЕГРЮЛ/ЕГРИП по ИНН (см. org-legal-profile.ts); null — ещё не запрашивали.
  profile: LegalProfile | null;
  updatedAt: string | null;
};

type Meta = {
  /// Сколько точек назвали при регистрации. Только для показа —
  /// отдельных организаций под них пока не создаётся.
  locationsCount?: number;
  subscriptionPlan: string;
  subscriptionEnd: string | null;
  createdAt: string;
};

// Списки живут в src/lib/org-profile.ts — раньше их было четыре штуки
// в разных файлах, и они успели разъехаться между собой.
const TYPE_OPTIONS = ORG_SPHERES;

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

export function OrganizationInfoForm({
  initial,
  meta,
  legal: legalInitial = { profile: null, updatedAt: null },
}: {
  initial: Form;
  meta: Meta;
  legal?: Legal;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const [innLookup, setInnLookup] = useState(false);
  const [legal, setLegal] = useState<Legal>(legalInitial);
  const [legalLoading, setLegalLoading] = useState(false);
  /** Предложение заменить введённое название на найденное в ЕГРЮЛ. */
  const [nameReplace, setNameReplace] = useState<{
    current: string;
    suggested: string;
  } | null>(null);

  /** Снимок ЕГРЮЛ в организацию: кнопка «Обновить из ЕГРЮЛ» и после «Найти». */
  async function refreshLegal(inn: string, quiet = false) {
    setLegalLoading(true);
    try {
      const res = await fetch("/api/settings/organization/legal-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inn }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        if (!quiet) toast.error(data?.error ?? "Не удалось получить данные из ЕГРЮЛ");
        return;
      }
      setLegal({ profile: data.profile as LegalProfile, updatedAt: new Date().toISOString() });
      if (!quiet) toast.success("Данные из ЕГРЮЛ обновлены");
    } catch (err) {
      if (!quiet) toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setLegalLoading(false);
    }
  }

  const dirty =
    form.name !== initial.name ||
    form.journalShortName !== initial.journalShortName ||
    form.type !== initial.type ||
    form.inn !== initial.inn ||
    form.address !== initial.address ||
    form.phone !== initial.phone ||
    form.accountantEmail !== initial.accountantEmail ||
    form.locale !== initial.locale ||
    form.timezone !== initial.timezone ||
    form.brandColor !== initial.brandColor ||
    form.logoUrl !== initial.logoUrl ||
    form.shiftEndHour !== initial.shiftEndHour ||
    form.lockPastDayEdits !== initial.lockPastDayEdits ||
    form.requireAdminForJournalEdit !== initial.requireAdminForJournalEdit;

  // Что увидит шапка журналов при текущем вводе — те же правила, что у
  // страницы документа и PDF.
  const legalShortName = suggestOrgJournalName(legal.profile);
  const journalNamePreview = resolveOrgJournalName({
    name: form.name,
    journalShortName: form.journalShortName,
    legalProfileJson: legal.profile,
  });

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      // Шлём только изменённые поля — иначе legacy-значения
      // (например, brandColor='#aabbccdd' с alpha) каждый раз попадают
      // в валидатор и блокируют сохранение остальных полей.
      const payload: Record<string, unknown> = {};
      if (form.name !== initial.name) payload.name = form.name;
      if (form.journalShortName !== initial.journalShortName)
        payload.journalShortName = form.journalShortName ?? "";
      if (form.type !== initial.type) payload.type = form.type;
      if (form.inn !== initial.inn) payload.inn = form.inn ?? "";
      if (form.address !== initial.address)
        payload.address = form.address ?? "";
      if (form.phone !== initial.phone) payload.phone = form.phone ?? "";
      if (form.accountantEmail !== initial.accountantEmail)
        payload.accountantEmail = form.accountantEmail ?? "";
      if (form.locale !== initial.locale) payload.locale = form.locale;
      if (form.timezone !== initial.timezone) payload.timezone = form.timezone;
      if (form.brandColor !== initial.brandColor)
        payload.brandColor = form.brandColor ?? "";
      if (form.logoUrl !== initial.logoUrl)
        payload.logoUrl = form.logoUrl ?? "";
      if (form.shiftEndHour !== initial.shiftEndHour)
        payload.shiftEndHour = form.shiftEndHour;
      if (form.lockPastDayEdits !== initial.lockPastDayEdits)
        payload.lockPastDayEdits = form.lockPastDayEdits;
      if (form.requireAdminForJournalEdit !== initial.requireAdminForJournalEdit)
        payload.requireAdminForJournalEdit = form.requireAdminForJournalEdit;

      const res = await fetch("/api/settings/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Ошибка сохранения");
        return;
      }
      toast.success("Сохранено");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setForm(initial);
  }

  async function lookupByInn() {
    const inn = (form.inn ?? "").replace(/\D/g, "");
    if (inn.length !== 10 && inn.length !== 12) {
      toast.error("Введите ИНН (10 или 12 цифр)");
      return;
    }
    setInnLookup(true);
    try {
      const res = await fetch(`/api/public/inn-lookup?inn=${inn}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Не нашли организацию");
        return;
      }
      // Защита: если человек уже ввёл своё название и оно отличается от
      // найденного в ЕГРЮЛ — спрашиваем, прежде чем затирать ввод.
      // Спрашиваем своим окном: нативный confirm() в приложении
      // Telegram может не показаться вовсе (CLAUDE.md §6).
      const needsNameConfirm =
        Boolean(form.name) &&
        Boolean(data.name) &&
        form.name.trim().toLowerCase() !==
          (data.name as string).trim().toLowerCase();

      setForm((prev) => ({
        ...prev,
        name: needsNameConfirm ? prev.name : data.name || prev.name,
        address: data.address || prev.address,
      }));
      if (needsNameConfirm) {
        setNameReplace({ current: form.name, suggested: data.name as string });
      }
      toast.success(`Найдено: ${data.name}`);
      void refreshLegal(inn, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setInnLookup(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Sticky save bar */}
      {dirty ? (
        <div className="sticky top-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] px-4 py-3 shadow-[0_10px_24px_-12px_rgba(161,58,50,0.18)]">
          <span className="text-[13px] text-[#7a4a00]">
            Есть несохранённые изменения
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="inline-flex h-9 items-center rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#3c4053] hover:bg-[#fafbff] disabled:opacity-60"
            >
              Сбросить
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Сохранить
            </button>
          </div>
        </div>
      ) : null}

      {/* === ОСНОВНОЕ === */}
      <FormSection
        title="Основные реквизиты"
        subtitle="Идут в шапку каждого printable-журнала и в договоры с поставщиками"
        icon={<Building2 className="size-4" />}
      >
        <FormRow label="Название организации" hint="Юридическое или коммерческое">
          <input
            type="text"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className="form-input"
            placeholder='ООО "Пекарня"'
            maxLength={200}
          />
        </FormRow>
        <FormRow
          label="Сокращённое название для журналов"
          hint="Печатается в шапке каждого журнала и в PDF; в меню и списках остаётся «Название организации». Пусто — краткое название из ЕГРЮЛ или полное"
          icon={<FileText className="size-4" />}
        >
          <div className="space-y-2">
            <input
              type="text"
              value={form.journalShortName ?? ""}
              onChange={(e) => set("journalShortName", e.target.value || null)}
              className="form-input"
              placeholder={legalShortName ?? (form.name || "Кафе «Ромашка»")}
              maxLength={ORG_JOURNAL_NAME_MAX}
            />
            <div className="flex flex-wrap items-center gap-2 text-[12px] leading-snug text-[#6f7282]">
              <span>
                В шапке журналов:{" "}
                <b className="font-semibold text-[#0b1024]">«{journalNamePreview}»</b>
              </span>
              {legalShortName && legalShortName !== (form.journalShortName ?? "").trim() ? (
                <button
                  type="button"
                  onClick={() => set("journalShortName", legalShortName)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[12.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  <ShieldCheck className="size-3.5 text-[#5566f6]" />
                  Взять из ЕГРЮЛ: {legalShortName}
                </button>
              ) : null}
            </div>
          </div>
        </FormRow>
        <FormRow label="Сфера" hint="Влияет на пресеты журналов и pipelines">
          <select
            value={normalizeSphere(form.type)}
            onChange={(e) => set("type", e.target.value)}
            className="form-input"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Тип" hint="Частное, сетевое или государственное заведение">
          <select
            value={normalizeOwnership(form.ownershipKind)}
            onChange={(e) => set("ownershipKind", e.target.value)}
            className="form-input"
          >
            {ORG_OWNERSHIP.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FormRow>
        {/* Точек — только чтение: значение приходит из анкеты
            регистрации. Менять его здесь нечему: отдельных организаций
            под точки пока не создаётся. */}
        <FormRow label="Точек" hint="Указано при регистрации">
          <span className="inline-flex h-11 items-center rounded-2xl bg-[#f5f6ff] px-4 text-[15px] font-medium tabular-nums text-[#3848c7]">
            {meta.locationsCount ?? 1}
          </span>
        </FormRow>
        <FormRow
          label="ИНН"
          hint="10 цифр для юр.лица или 12 для ИП. По нему авто-заполняется название и адрес из ЕГРЮЛ"
          icon={<Hash className="size-4" />}
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={form.inn ?? ""}
              onChange={(e) => set("inn", e.target.value || null)}
              className="form-input flex-1"
              placeholder="7700123456"
              inputMode="numeric"
              maxLength={12}
            />
            <button
              type="button"
              onClick={lookupByInn}
              disabled={innLookup || !form.inn}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#5566f6] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50"
              title="Найти название и адрес по ИНН (DaData / ЕГРЮЛ)"
            >
              {innLookup ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Search className="size-3.5" />
              )}
              Найти
            </button>
          </div>
        </FormRow>
        <FormRow
          label="Адрес"
          hint="Полный фактический адрес производства"
          icon={<MapPin className="size-4" />}
        >
          <textarea
            value={form.address ?? ""}
            onChange={(e) => set("address", e.target.value || null)}
            className="form-input min-h-[68px]"
            placeholder="г. Москва, ул. Пятницкая, д. 12, стр. 1"
            maxLength={500}
          />
        </FormRow>
        <FormRow
          label="Телефон"
          hint="Контактный для инспекторов и поставщиков"
          icon={<Phone className="size-4" />}
        >
          <input
            type="tel"
            {...phoneInputProps(form.phone ?? "", (value) => set("phone", value || null))}
            className="form-input"
            placeholder={RU_PHONE_PLACEHOLDER}
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Данные из ЕГРЮЛ"
        subtitle="Реквизиты, руководитель, ОКВЭД и статистика по ИНН. Только для справки — в журналы идут поля выше."
        icon={<FileText className="size-4" />}
      >
        <LegalProfileView
          legal={legal}
          loading={legalLoading}
          canRefresh={Boolean((form.inn ?? "").replace(/\D/g, ""))}
          onRefresh={() => void refreshLegal((form.inn ?? "").replace(/\D/g, ""))}
        />
      </FormSection>

      {/* === КОНТАКТЫ === */}
      <FormSection
        title="Контакты"
        subtitle="Email бухгалтерии для еженедельных отчётов"
        icon={<AtSign className="size-4" />}
      >
        <FormRow
          label="Email бухгалтера"
          hint="Куда уходит еженедельная выгрузка списаний для 1С"
        >
          <input
            type="email"
            value={form.accountantEmail ?? ""}
            onChange={(e) => set("accountantEmail", e.target.value || null)}
            className="form-input"
            placeholder="accountant@company.ru"
          />
        </FormRow>
      </FormSection>

      {/* === РЕГИОН === */}
      <FormSection
        title="Регион и язык"
        subtitle="Часовой пояс используется для расчёта смен и crontab задач"
        icon={<Globe className="size-4" />}
      >
        <FormRow label="Часовой пояс">
          <select
            value={form.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            className="form-input"
          >
            {/* Fallback option: если текущий timezone из БД не входит
                в наш короткий список (Asia/Tashkent, Europe/Riga и
                т.д.) — добавляем его как отдельную опцию, чтобы
                <select> не «прыгнул» на первый вариант и тихо не
                перезаписал данные. */}
            {!TIMEZONE_OPTIONS.includes(form.timezone) && form.timezone ? (
              <option value={form.timezone}>
                {form.timezone.replace("_", " ")} (текущий)
              </option>
            ) : null}
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace("_", " ")}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Язык интерфейса" hint="Влияет на дашборд + Mini App + email">
          <select
            value={form.locale}
            onChange={(e) => set("locale", e.target.value)}
            className="form-input"
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </FormRow>
      </FormSection>

      {/* === БРЕНДИНГ === */}
      <FormSection
        title="Брендинг"
        subtitle="White-label: ваш цвет и логотип на дашборде, печатных журналах, портале инспектора"
        icon={<Palette className="size-4" />}
      >
        <FormRow
          label="Брендовый цвет"
          hint="HEX вида #5566f6 — заменяет основной indigo во всём интерфейсе"
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.brandColor ?? "#5566f6"}
              onChange={(e) => set("brandColor", e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-xl border border-[#dcdfed] bg-white"
            />
            <input
              type="text"
              value={form.brandColor ?? ""}
              onChange={(e) => set("brandColor", e.target.value || null)}
              className="form-input flex-1"
              placeholder="#5566f6"
              maxLength={7}
            />
            {form.brandColor ? (
              <button
                type="button"
                onClick={() => set("brandColor", null)}
                className="text-[12px] text-[#6f7282] hover:text-[#5566f6]"
              >
                Сбросить
              </button>
            ) : null}
          </div>
        </FormRow>
        <FormRow
          label="URL логотипа"
          hint="Публичный https-URL изображения. Показывается в шапке"
          icon={<ImageIcon className="size-4" />}
        >
          <input
            type="url"
            value={form.logoUrl ?? ""}
            onChange={(e) => set("logoUrl", e.target.value || null)}
            className="form-input"
            placeholder="https://example.com/logo.png"
          />
          {form.logoUrl ? (
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-[#ececf4] bg-[#fafbff] p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={form.logoUrl}
                alt="Превью"
                className="size-12 rounded-lg object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <span className="text-[12px] text-[#6f7282]">
                Превью текущего логотипа
              </span>
            </div>
          ) : null}
        </FormRow>
      </FormSection>

      {/* === СМЕНЫ И КОМПЛАЕНС === */}
      <FormSection
        title="Смены и compliance"
        subtitle="Когда журнал «закрывается» и кто может править прошлые записи"
        icon={<ShieldCheck className="size-4" />}
      >
        <FormRow
          label="Час окончания смены"
          hint="После этого часа день считается «прошлым» (для compliance-блокировок). 0–23"
        >
          <input
            type="number"
            min={0}
            max={23}
            value={form.shiftEndHour}
            onChange={(e) =>
              set("shiftEndHour", Number(e.target.value) || 0)
            }
            className="form-input w-32"
          />
        </FormRow>
        <ToggleRow
          label="Запретить править записи прошлых дней"
          hint="Когда включено — править вчерашние записи может только admin. По СанПиН рекомендуется."
          checked={form.lockPastDayEdits}
          onChange={(v) => set("lockPastDayEdits", v)}
        />
        <ToggleRow
          label="Только admin может править завершённые задачи"
          hint="Сотрудник заполнил, но потом нашёл ошибку — нужно одобрение admin'а"
          checked={form.requireAdminForJournalEdit}
          onChange={(v) => set("requireAdminForJournalEdit", v)}
        />
      </FormSection>

      {/* === Подписка (read-only) === */}
      <FormSection
        title="Подписка"
        subtitle="Только просмотр. Управление — на странице «Подписка»"
        icon={<CreditCard className="size-4" />}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <ReadOnlyCard
            label="Тариф"
            value={planLabel(meta.subscriptionPlan)}
          />
          <ReadOnlyCard
            label="Действует до"
            value={
              meta.subscriptionEnd
                ? new Date(meta.subscriptionEnd).toLocaleDateString("ru-RU")
                : "—"
            }
          />
          <ReadOnlyCard
            label="Создана"
            value={new Date(meta.createdAt).toLocaleDateString("ru-RU")}
          />
        </div>
        <div className="mt-3">
          <a
            href="/settings/subscription"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#5566f6]/[0.04] px-3 text-[14px] font-semibold text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
          >
            Управление подпиской →
          </a>
        </div>
      </FormSection>

      {/* Bottom save button */}
      <div className="flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-[#ececf4] bg-white p-4">
        {dirty ? (
          <button
            type="button"
            onClick={discard}
            disabled={saving}
            className="inline-flex h-10 items-center rounded-xl border border-[#dcdfed] bg-white px-4 text-[13px] text-[#3c4053] hover:bg-[#fafbff] disabled:opacity-60"
          >
            Сбросить
          </button>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c8cbe0] disabled:shadow-none"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {saving ? "Сохраняем…" : "Сохранить изменения"}
        </button>
      </div>

      {/* Form input styles */}
      <style jsx>{`
        :global(.form-input) {
          width: 100%;
          height: 2.75rem;
          border-radius: 1rem;
          border: 1px solid #dcdfed;
          background: #fafbff;
          padding: 0 0.875rem;
          font-size: 14px;
          color: #0b1024;
          line-height: 1.5;
          font-family: inherit;
        }
        :global(textarea.form-input) {
          height: auto;
          padding: 0.625rem 0.875rem;
          resize: vertical;
        }
        :global(.form-input:focus) {
          outline: none;
          border-color: #5566f6;
          box-shadow: 0 0 0 4px rgba(85, 102, 246, 0.15);
        }
        :global(.form-input::placeholder) {
          color: #9b9fb3;
        }
      `}</style>

      <ConfirmDialog
        open={nameReplace !== null}
        onClose={() => setNameReplace(null)}
        onConfirm={() => {
          const suggested = nameReplace?.suggested;
          setNameReplace(null);
          if (suggested) setForm((prev) => ({ ...prev, name: suggested }));
        }}
        title="Заменить название на данные из ЕГРЮЛ?"
        description={
          nameReplace
            ? `Сейчас введено «${nameReplace.current}». В ЕГРЮЛ по этому ИНН записано «${nameReplace.suggested}».`
            : undefined
        }
        bullets={[
          {
            label:
              "Официальное название попадёт в договоры и печатные формы журналов",
            tone: "info",
          },
          { label: "Если откажетесь — останется то, что вы ввели", tone: "default" },
        ]}
        confirmLabel="Заменить"
        cancelLabel="Оставить своё"
        variant="info"
      />
    </div>
  );
}

const LEGAL_STATUS: Record<string, string> = {
  ACTIVE: "Действует",
  LIQUIDATING: "Ликвидируется",
  LIQUIDATED: "Ликвидирована",
  BANKRUPT: "Банкротство",
  REORGANIZING: "Реорганизация",
};

const rub = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const formatRub = (value: number | null | undefined) =>
  typeof value === "number" ? `${rub.format(value)} \u20bd` : null;
const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("ru-RU") : null;

/**
 * Снимок ЕГРЮЛ читаемыми строками. Пустые поля не показываем: у ИП нет
 * КПП и капитала, у большинства — финансов в открытых данных.
 */
function LegalProfileView({
  legal,
  loading,
  canRefresh,
  onRefresh,
}: {
  legal: Legal;
  loading: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
}) {
  const p = legal.profile;
  const rows: Array<[string, string | null]> = p
    ? [
        ["Полное название", p.nameFull],
        ["Форма", p.opfFull ?? p.opfShort],
        ["ОГРН", p.ogrn ? `${p.ogrn}${p.ogrnDate ? ` от ${formatDate(p.ogrnDate)}` : ""}` : null],
        ["КПП", p.kpp],
        ["Юридический адрес", p.address],
        [
          p.type === "INDIVIDUAL" ? "Предприниматель" : "Руководитель",
          p.management
            ? `${p.management.name}${p.management.post ? `, ${p.management.post.toLowerCase()}` : ""}`
            : null,
        ],
        [
          "Основной ОКВЭД",
          p.okvedMain ? `${p.okvedMain.code}${p.okvedMain.name ? ` — ${p.okvedMain.name}` : ""}` : null,
        ],
        [
          "Дополнительные ОКВЭД",
          p.okvedsExtra.length
            ? `${p.okvedsExtra.length}: ${p.okvedsExtra.slice(0, 4).map((o) => o.code).join(", ")}${p.okvedsExtra.length > 4 ? "…" : ""}`
            : null,
        ],
        [
          "Статус",
          p.status
            ? `${LEGAL_STATUS[p.status] ?? p.status}${p.registrationDate ? `, зарегистрирована ${formatDate(p.registrationDate)}` : ""}`
            : null,
        ],
        ["Сотрудников (по данным ФНС)", typeof p.employeeCount === "number" ? rub.format(p.employeeCount) : null],
        ["Уставный капитал", p.capital ? formatRub(p.capital.value) : null],
        ["Филиалов", typeof p.branchCount === "number" && p.branchCount > 0 ? String(p.branchCount) : null],
        ["Налоговый режим", p.finance?.taxSystem ?? null],
        [
          p.finance?.year ? `Финансы за ${p.finance.year}` : "Финансы",
          p.finance && (p.finance.revenue ?? p.finance.income ?? p.finance.expense) !== null
            ? [
                p.finance.revenue !== null ? `выручка ${formatRub(p.finance.revenue)}` : null,
                p.finance.income !== null ? `доход ${formatRub(p.finance.income)}` : null,
                p.finance.expense !== null ? `расход ${formatRub(p.finance.expense)}` : null,
              ]
                .filter(Boolean)
                .join(", ")
            : null,
        ],
        [
          "Учредители",
          p.founders.length
            ? p.founders
                .slice(0, 5)
                .map((f) => `${f.name}${f.share !== null ? ` (${f.share}%)` : ""}`)
                .join("; ")
            : null,
        ],
        ["Телефон из реестра", p.phones[0] ?? null],
        ["Почта из реестра", p.emails[0] ?? null],
      ]
    : [];
  const visible = rows.filter(([, value]) => value);

  return (
    <div className="space-y-3">
      {visible.length ? (
        <dl className="divide-y divide-[#f0f1f7] rounded-2xl border border-[#ececf4] bg-[#fafbff]">
          {visible.map(([label, value]) => (
            <div key={label} className="grid gap-0.5 px-4 py-2.5 md:grid-cols-[220px_1fr] md:gap-4">
              <dt className="text-[12px] font-medium text-[#6f7282]">{label}</dt>
              <dd className="text-[13px] leading-snug text-[#0b1024]">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[13px] leading-snug text-[#6f7282]">
          Введите ИНН и нажмите «Найти» — подтянем реквизиты, руководителя, ОКВЭД и статистику из ЕГРЮЛ.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || !canRefresh}
          className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:text-[#9b9fb3]"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Обновить из ЕГРЮЛ
        </button>
        {legal.updatedAt ? (
          <span className="text-[12px] text-[#9b9fb3]">
            Обновлено {new Date(legal.updatedAt).toLocaleDateString("ru-RU")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FormSection({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 md:p-7">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
          {icon}
        </span>
        <div>
          <h2 className="text-[16px] font-semibold leading-tight text-[#0b1024]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-[12px] leading-snug text-[#6f7282]">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FormRow({
  label,
  hint,
  icon,
  children,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-[200px_1fr] md:items-start md:gap-5">
      <div className="md:pt-2.5">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#0b1024]">
          {icon ? <span className="text-[#9b9fb3]">{icon}</span> : null}
          {label}
        </div>
        {hint ? (
          <div className="mt-0.5 text-[11px] leading-snug text-[#9b9fb3]">
            {hint}
          </div>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-[#5566f6]" : "bg-[#dcdfed]"
        }`}
      >
        <span
          className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onChange(!checked)}>
        <div className="text-[13px] font-medium text-[#0b1024]">{label}</div>
        {hint ? (
          <div className="mt-0.5 text-[11px] leading-snug text-[#6f7282]">
            {hint}
          </div>
        ) : null}
      </div>
      <Lock className="mt-0.5 size-3.5 shrink-0 text-[#9b9fb3]" />
    </div>
  );
}

function ReadOnlyCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#ececf4] bg-[#fafbff] p-3">
      <div className="text-[11px] uppercase tracking-wider text-[#9b9fb3]">
        {label}
      </div>
      <div className="mt-1 text-[14px] font-medium text-[#0b1024]">
        {value}
      </div>
    </div>
  );
}
