"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, btnOutline, btnPrimary, inputClass, readError } from "@/components/partner/ui";
import { phoneInputProps } from "@/lib/phone-input";
import { cn } from "@/lib/utils";

/**
 * Правка карточки партнёра администратором платформы.
 *
 * Анкету партнёр заполняет один раз и после подачи уже не меняет, а
 * опечатка в названии, ИНН или почте всплывает месяцы спустя. Раньше
 * помочь было нечем: в админке всё было только для чтения.
 *
 * Подписи и списки продублированы здесь намеренно: `partners/service.ts`
 * тянет `@/lib/db`, и импорт из него в клиентском компоненте роняет
 * сборку на «Can't resolve tls».
 */

const PARTNER_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "consultant", label: "Консультант по СанПиН / ХАССП" },
  { value: "integrator", label: "Интегратор" },
  { value: "equipment_service", label: "Сервис оборудования" },
  { value: "other", label: "Другое" },
];

const PAYOUT_TYPE_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "ip", label: "ИП", hint: "ИНН 12 цифр" },
  { value: "self_employed", label: "Самозанятый", hint: "ИНН 12 цифр" },
  { value: "company", label: "Юрлицо", hint: "ИНН 10 цифр + КПП" },
];

async function patchPartner(partnerId: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`/api/root/partners/${partnerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    toast.error(await readError(res, "Не удалось сохранить"));
    return false;
  }
  return true;
}

/**
 * «Переименовать» из шапки карточки: вывеска (её видят клиенты) и
 * название компании (договор, выплаты). Раньше переименовать можно было
 * только внутри «Контакты и доступы → Изменить» — ниже баланса, не найти.
 */
export function PartnerRenameDialog({
  partnerId,
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  partnerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { companyName: string; brandName: string };
  onSaved: () => void;
}) {
  const [companyName, setCompanyName] = useState(initial.companyName);
  const [brandName, setBrandName] = useState(initial.brandName);
  const [busy, setBusy] = useState(false);

  const trimmedCompany = companyName.trim();
  const trimmedBrand = brandName.trim();
  const dirty = trimmedCompany !== initial.companyName || trimmedBrand !== initial.brandName;

  async function save() {
    if (trimmedBrand.length < 2) {
      toast.error("Укажите вывеску — её видят клиенты");
      return;
    }
    if (trimmedCompany.length < 2) {
      toast.error("Укажите название компании");
      return;
    }
    const body: Record<string, unknown> = {};
    if (trimmedCompany !== initial.companyName) body.companyName = trimmedCompany;
    if (trimmedBrand !== initial.brandName) body.brandName = trimmedBrand;
    setBusy(true);
    try {
      if (await patchPartner(partnerId, body)) {
        toast.success("Партнёр переименован");
        onOpenChange(false);
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setCompanyName(initial.companyName);
          setBrandName(initial.brandName);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-[480px] rounded-3xl border-[#ececf4] p-0">
        <DialogHeader className="border-b border-[#ececf4] px-6 pb-4 pt-6">
          <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">Переименовать партнёра</DialogTitle>
          <DialogDescription className="text-[13px] leading-[1.5] text-[#6f7282]">
            Вывеску видят клиенты партнёра и он сам в кабинете. Название компании — для договора и выплат.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4 px-6 pb-6 pt-4"
        >
          <Field label="Вывеска для клиентов" hint="До 40 символов — так партнёра видят клиенты" required>
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className={inputClass}
              maxLength={40}
              autoFocus
            />
          </Field>
          <Field label="Название компании" required>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className={inputClass}
              maxLength={120}
            />
          </Field>
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button type="button" className={btnOutline} onClick={() => onOpenChange(false)}>
              Отмена
            </button>
            <SaveButton busy={busy} dirty={dirty} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Кнопка-переключатель «Изменить» / «Отмена» в шапке карточки. */
export function EditToggle({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className={btnOutline}>
      {editing ? "Отмена" : "Изменить"}
    </button>
  );
}

function SaveButton({ busy, dirty }: { busy: boolean; dirty: boolean }) {
  return (
    <button type="submit" disabled={busy || !dirty} className={cn(btnPrimary, "disabled:opacity-50")}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {dirty ? "Сохранить" : "Сохранено"}
    </button>
  );
}

export type ProfileInitial = {
  companyName: string;
  brandName: string;
  type: string;
  inn: string;
  city: string;
  phone: string;
  telegram: string;
  contactEmail: string;
  venuesCount: number;
  slug: string;
};

/** Анкета: всё, что партнёр указал при подаче заявки, плюс вывеска. */
export function PartnerProfileForm({
  partnerId,
  initial,
  onSaved,
  onCancel,
}: {
  partnerId: string;
  initial: ProfileInitial;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ProfileInitial>(initial);
  const [busy, setBusy] = useState(false);
  const [slugConfirm, setSlugConfirm] = useState(false);

  const dirty = (Object.keys(initial) as Array<keyof ProfileInitial>).some(
    (key) => form[key] !== initial[key],
  );
  const slugChanged = form.slug.trim() !== initial.slug;

  function set<K extends keyof ProfileInitial>(key: K, value: ProfileInitial[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setBusy(true);
    try {
      // Отправляем только изменённое: роут трактует присланный ключ как
      // «поменять», и лишние поля превратили бы правку телефона в правку
      // всей анкеты.
      const body: Record<string, unknown> = {};
      for (const key of Object.keys(initial) as Array<keyof ProfileInitial>) {
        if (form[key] !== initial[key]) body[key] = form[key];
      }
      if (await patchPartner(partnerId, body)) {
        toast.success("Карточка партнёра обновлена");
        onSaved();
      }
    } finally {
      setBusy(false);
      setSlugConfirm(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (slugChanged) setSlugConfirm(true);
        else void save();
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Название компании" required>
          <input
            value={form.companyName}
            onChange={(e) => set("companyName", e.target.value)}
            className={inputClass}
            maxLength={120}
          />
        </Field>
        <Field label="Вывеска для клиентов" hint="Её видят клиенты партнёра вместо названия компании">
          <input
            value={form.brandName}
            onChange={(e) => set("brandName", e.target.value)}
            className={inputClass}
            maxLength={40}
          />
        </Field>
        <Field label="Тип партнёра" required>
          <select
            value={form.type}
            onChange={(e) => set("type", e.target.value)}
            className={inputClass}
          >
            {PARTNER_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ИНН" required hint="10 цифр у юрлица, 12 у ИП и физлица">
          <input
            value={form.inn}
            onChange={(e) => set("inn", e.target.value.replace(/\D/g, "").slice(0, 12))}
            className={inputClass}
            inputMode="numeric"
          />
        </Field>
        <Field label="Город" required>
          <input
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            className={inputClass}
            maxLength={80}
          />
        </Field>
        <Field label="Телефон" required>
          <input
            {...phoneInputProps}
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Email" required>
          <input
            type="email"
            value={form.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
            className={inputClass}
            maxLength={160}
          />
        </Field>
        <Field label="Telegram" optional>
          <input
            value={form.telegram}
            onChange={(e) => set("telegram", e.target.value)}
            className={inputClass}
            maxLength={64}
            placeholder="@username"
          />
        </Field>
        <Field label="Объектов у клиентов">
          <input
            value={String(form.venuesCount)}
            onChange={(e) => set("venuesCount", Number(e.target.value.replace(/\D/g, "")) || 0)}
            className={inputClass}
            inputMode="numeric"
          />
        </Field>
        <Field label="Публичная ссылка" hint="Латиница, цифры и дефис. Старая ссылка перестанет работать.">
          <div className="flex items-stretch">
            <span className="inline-flex shrink-0 items-center rounded-l-2xl border border-r-0 border-[#dcdfed] bg-[#fafbff] px-3 text-[14px] text-[#6f7282]">
              wesetup.ru/p/
            </span>
            <input
              value={form.slug}
              onChange={(e) => set("slug", e.target.value.toLowerCase())}
              className={cn(inputClass, "rounded-l-none")}
              maxLength={32}
            />
          </div>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <SaveButton busy={busy} dirty={dirty} />
        <button type="button" onClick={onCancel} className={btnOutline}>
          Отмена
        </button>
      </div>

      <ConfirmDialog
        open={slugConfirm}
        onClose={() => setSlugConfirm(false)}
        onConfirm={save}
        variant="warn"
        title="Сменить публичную ссылку?"
        description={`Ссылка партнёра станет wesetup.ru/p/${form.slug.trim()}`}
        bullets={[
          { label: `Старая ссылка wesetup.ru/p/${initial.slug} перестанет работать`, tone: "warn" },
          { label: "Визитки, письма и QR-коды с прежней ссылкой приведут на страницу «не найдено»", tone: "warn" },
          { label: "Код подключения партнёра не меняется — по нему клиенты подключатся как раньше" },
        ]}
        confirmLabel="Сменить ссылку"
      />
    </form>
  );
}

export type PayoutInitial = {
  payoutType: string;
  fullName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  bank: string;
  bik: string;
  account: string;
};

/**
 * Реквизиты для выплат.
 *
 * Отдельная форма с подтверждением по слову: это банковский счёт, на
 * который уходят деньги партнёра. После сохранения партнёру уходит
 * письмо и сообщение в Telegram — чтобы подмену нельзя было не заметить.
 */
export function PartnerPayoutForm({
  partnerId,
  initial,
  onSaved,
  onCancel,
}: {
  partnerId: string;
  initial: PayoutInitial;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<PayoutInitial>(initial);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const dirty = (Object.keys(initial) as Array<keyof PayoutInitial>).some(
    (key) => form[key] !== initial[key],
  );
  const isCompany = form.payoutType === "company";

  function set<K extends keyof PayoutInitial>(key: K, value: PayoutInitial[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setBusy(true);
    try {
      const ok = await patchPartner(partnerId, {
        payoutType: form.payoutType,
        payoutDetails: {
          fullName: form.fullName,
          inn: form.inn,
          bank: form.bank,
          bik: form.bik,
          account: form.account,
          ...(isCompany ? { kpp: form.kpp } : {}),
          ...(form.payoutType !== "self_employed" && form.ogrn ? { ogrn: form.ogrn } : {}),
        },
      });
      if (ok) {
        toast.success("Реквизиты сохранены, партнёру отправлено уведомление");
        onSaved();
      }
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setConfirm(true);
      }}
      className="space-y-4"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {PAYOUT_TYPE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => set("payoutType", option.value)}
            className={cn(
              "rounded-2xl border px-4 py-3 text-left transition-colors duration-150",
              form.payoutType === option.value
                ? "border-[#5566f6] bg-[#f5f6ff]"
                : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
            )}
          >
            <span className="block text-[14px] font-medium text-[#0b1024]">{option.label}</span>
            <span className="block text-[12px] text-[#6f7282]">{option.hint}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={isCompany ? "Название юрлица" : "ФИО получателя"} required>
          <input
            value={form.fullName}
            onChange={(e) => set("fullName", e.target.value)}
            className={inputClass}
            maxLength={200}
          />
        </Field>
        <Field label="ИНН" required hint={isCompany ? "10 цифр" : "12 цифр"}>
          <input
            value={form.inn}
            onChange={(e) => set("inn", e.target.value.replace(/\D/g, "").slice(0, 12))}
            className={inputClass}
            inputMode="numeric"
          />
        </Field>
        {isCompany ? (
          <Field label="КПП" required hint="9 цифр">
            <input
              value={form.kpp}
              onChange={(e) => set("kpp", e.target.value.replace(/\D/g, "").slice(0, 9))}
              className={inputClass}
              inputMode="numeric"
            />
          </Field>
        ) : null}
        {form.payoutType !== "self_employed" ? (
          <Field label={isCompany ? "ОГРН" : "ОГРНИП"} optional hint={isCompany ? "13 цифр" : "15 цифр"}>
            <input
              value={form.ogrn}
              onChange={(e) => set("ogrn", e.target.value.replace(/\D/g, "").slice(0, 15))}
              className={inputClass}
              inputMode="numeric"
            />
          </Field>
        ) : null}
        <Field label="Банк" required>
          <input
            value={form.bank}
            onChange={(e) => set("bank", e.target.value)}
            className={inputClass}
            maxLength={200}
          />
        </Field>
        <Field label="БИК" required hint="9 цифр">
          <input
            value={form.bik}
            onChange={(e) => set("bik", e.target.value.replace(/\D/g, "").slice(0, 9))}
            className={inputClass}
            inputMode="numeric"
          />
        </Field>
        <Field label="Расчётный счёт" required hint="20 цифр">
          <input
            value={form.account}
            onChange={(e) => set("account", e.target.value.replace(/\D/g, "").slice(0, 20))}
            className={inputClass}
            inputMode="numeric"
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <SaveButton busy={busy} dirty={dirty} />
        <button type="button" onClick={onCancel} className={btnOutline}>
          Отмена
        </button>
      </div>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={save}
        variant="danger"
        title="Изменить реквизиты для выплат?"
        description="На эти реквизиты уйдут деньги партнёра в ближайшей ведомости."
        bullets={[
          { label: `Получатель: ${form.fullName || "—"}` },
          { label: `Банк: ${form.bank || "—"}, БИК ${form.bik || "—"}` },
          { label: `Счёт: ${form.account || "—"}` },
          { label: "Партнёру уйдёт письмо и сообщение в Telegram об изменении", tone: "warn" },
          { label: "Правка попадёт в журнал действий платформы", tone: "warn" },
        ]}
        typeToConfirm="РЕКВИЗИТЫ"
        confirmLabel="Сохранить реквизиты"
      />
    </form>
  );
}
