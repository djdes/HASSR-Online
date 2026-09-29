"use client";

import { CheckCircle2, Circle, FileText, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import type { ChecklistItem, PlatformRequisites } from "@/lib/closing-documents/types";
import { cn } from "@/lib/utils";

const INPUT =
  "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const CARD =
  "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const EYEBROW = "mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]";
const BTN_PRIMARY =
  "inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60";
const BTN_OUTLINE =
  "inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]";

type Form = Omit<PlatformRequisites, "updatedAt" | "facsimileFile" | "stampFile" | "vatMode">;

type ApiState = {
  requisites: PlatformRequisites;
  checklist: ChecklistItem[];
  complete: boolean;
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  inputMode,
  maxLength,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  inputMode?: "numeric" | "text" | "email" | "tel";
  maxLength?: number;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        className={INPUT}
      />
      {hint ? <span className="mt-1 block text-[12px] text-[#9b9fb3]">{hint}</span> : null}
    </label>
  );
}

export function RequisitesClient({
  initial,
  initialChecklist,
}: {
  initial: PlatformRequisites;
  initialChecklist: ChecklistItem[];
}) {
  const [form, setForm] = useState<Form>({
    nameFull: initial.nameFull,
    nameShort: initial.nameShort,
    inn: initial.inn,
    kpp: initial.kpp,
    ogrn: initial.ogrn,
    address: initial.address,
    bank: { ...initial.bank },
    head: { ...initial.head },
    email: initial.email,
    phone: initial.phone,
  });
  const [images, setImages] = useState({
    facsimile: Boolean(initial.facsimileFile),
    stamp: Boolean(initial.stampFile),
  });
  const [checklist, setChecklist] = useState(initialChecklist);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"facsimile" | "stamp" | null>(null);
  const [version, setVersion] = useState(() => Date.now());
  const facsimileInput = useRef<HTMLInputElement | null>(null);
  const stampInput = useRef<HTMLInputElement | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function applyState(state: ApiState) {
    setChecklist(state.checklist);
    setImages({
      facsimile: Boolean(state.requisites.facsimileFile),
      stamp: Boolean(state.requisites.stampFile),
    });
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/root/legal-requisites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => null)) as ApiState | { error?: string } | null;
      if (!response.ok || !data || !("requisites" in data)) {
        throw new Error((data as { error?: string } | null)?.error ?? "Не удалось сохранить");
      }
      applyState(data);
      toast.success(
        data.complete ? "Реквизиты сохранены — документы выпускаются" : "Реквизиты сохранены"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function upload(kind: "facsimile" | "stamp", file: File | null) {
    if (!file) return;
    setUploading(kind);
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      const response = await fetch("/api/root/legal-requisites/upload", { method: "POST", body });
      const data = (await response.json().catch(() => null)) as ApiState | { error?: string } | null;
      if (!response.ok || !data || !("requisites" in data)) {
        throw new Error((data as { error?: string } | null)?.error ?? "Не удалось загрузить");
      }
      applyState(data);
      setVersion(Date.now());
      toast.success(kind === "facsimile" ? "Подпись загружена" : "Печать загружена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setUploading(null);
    }
  }

  const done = checklist.filter((item) => item.ok).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <section className={CARD}>
          <div className={EYEBROW}>Организация</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Полное наименование"
              value={form.nameFull}
              onChange={(v) => set("nameFull", v)}
              placeholder="Общество с ограниченной ответственностью «…»"
              className="sm:col-span-2"
            />
            <Field
              label="Краткое наименование"
              value={form.nameShort}
              onChange={(v) => set("nameShort", v)}
              placeholder="ООО «…»"
            />
            <Field label="ИНН" value={form.inn} onChange={(v) => set("inn", v)} inputMode="numeric" maxLength={12} />
            <Field
              label="КПП"
              value={form.kpp}
              onChange={(v) => set("kpp", v)}
              inputMode="numeric"
              maxLength={9}
              hint="У ИП нет — оставьте пустым"
            />
            <Field
              label="ОГРН / ОГРНИП"
              value={form.ogrn}
              onChange={(v) => set("ogrn", v)}
              inputMode="numeric"
              maxLength={15}
            />
            <Field
              label="Юридический адрес"
              value={form.address}
              onChange={(v) => set("address", v)}
              placeholder="141065, Московская область, …"
              className="sm:col-span-2"
            />
            <Field label="E-mail для документов" value={form.email} onChange={(v) => set("email", v)} inputMode="email" />
            <Field label="Телефон" value={form.phone} onChange={(v) => set("phone", v)} inputMode="tel" />
          </div>
        </section>

        <section className={CARD}>
          <div className={EYEBROW}>Банк</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Банк"
              value={form.bank.name}
              onChange={(v) => set("bank", { ...form.bank, name: v })}
              placeholder="АО «…»"
              className="sm:col-span-2"
            />
            <Field
              label="БИК"
              value={form.bank.bik}
              onChange={(v) => set("bank", { ...form.bank, bik: v })}
              inputMode="numeric"
              maxLength={9}
            />
            <Field
              label="Расчётный счёт"
              value={form.bank.account}
              onChange={(v) => set("bank", { ...form.bank, account: v })}
              inputMode="numeric"
              maxLength={20}
            />
            <Field
              label="Корреспондентский счёт"
              value={form.bank.corrAccount}
              onChange={(v) => set("bank", { ...form.bank, corrAccount: v })}
              inputMode="numeric"
              maxLength={20}
              className="sm:col-span-2"
            />
          </div>
        </section>

        <section className={CARD}>
          <div className={EYEBROW}>Руководитель</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Должность"
              value={form.head.post}
              onChange={(v) => set("head", { ...form.head, post: v })}
              placeholder="Генеральный директор"
            />
            <Field
              label="ФИО в подписи"
              value={form.head.name}
              onChange={(v) => set("head", { ...form.head, name: v })}
              placeholder="Иванов И. И."
            />
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-[#6f7282]">
            Режим НДС: <strong className="text-[#0b1024]">без НДС (УСН)</strong> — УПД
            выпускается со статусом 2, счёт-фактура не составляется. Если режим изменится,
            понадобится правка формы документа.
          </p>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void save()} disabled={saving} className={BTN_PRIMARY}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Сохранить
          </button>
          <a href="/api/root/legal-requisites/sample" target="_blank" rel="noreferrer" className={BTN_OUTLINE}>
            <FileText className="size-4 text-[#5566f6]" />
            Скачать образец УПД
          </a>
          <span className="text-[13px] text-[#6f7282]">
            Образец — с условным покупателем; там видно, где встанут подпись и печать.
          </span>
        </div>
      </div>

      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <section className={CARD}>
          <div className={EYEBROW}>Готовность · {done}/{checklist.length}</div>
          <ul className="space-y-2">
            {checklist.map((item) => (
              <li key={item.key} className="flex items-center gap-2 text-[13.5px]">
                {item.ok ? (
                  <CheckCircle2 className="size-4 shrink-0 text-[#116b2a]" />
                ) : (
                  <Circle className="size-4 shrink-0 text-[#c9ccdb]" />
                )}
                <span className={item.ok ? "text-[#0b1024]" : "text-[#6f7282]"}>{item.label}</span>
              </li>
            ))}
          </ul>
          <p
            className={cn(
              "mt-4 rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed",
              done === checklist.length ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#fff8eb] text-[#b25f00]"
            )}
          >
            {done === checklist.length
              ? "Всё заполнено: клиенты видят «УПД (PDF)» в истории оплат, после оплаты документ уходит письмом."
              : "Пока не всё заполнено — документы не выпускаются и в письмах их нет."}
          </p>
        </section>

        {(
          [
            { kind: "facsimile", title: "Факсимиле подписи", hint: "PNG с прозрачным фоном, до 1 МБ. Впишется в рамку 34 × 11 мм.", ref: facsimileInput, box: "h-16" },
            { kind: "stamp", title: "Печать", hint: "PNG с прозрачным фоном, до 1 МБ. Круглая, 32 × 32 мм на документе.", ref: stampInput, box: "h-36" },
          ] as const
        ).map((slot) => (
          <section key={slot.kind} className={CARD}>
            <div className={EYEBROW}>{slot.title}</div>
            <div
              className={cn(
                "flex items-center justify-center rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-3",
                slot.box
              )}
            >
              {images[slot.kind] ? (
                // eslint-disable-next-line @next/next/no-img-element -- приватная картинка с no-store, next/image тут не нужен
                <img
                  src={`/api/root/legal-requisites/image/${slot.kind}?v=${version}`}
                  alt={slot.title}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-[13px] text-[#9b9fb3]">Не загружено</span>
              )}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-[#9b9fb3]">{slot.hint}</p>
            <input
              ref={slot.ref}
              type="file"
              accept="image/png"
              className="hidden"
              onChange={(event) => {
                void upload(slot.kind, event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => slot.ref.current?.click()}
              disabled={uploading === slot.kind}
              className={cn(BTN_OUTLINE, "mt-3 h-10 text-[13px]")}
            >
              {uploading === slot.kind ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4 text-[#5566f6]" />
              )}
              {images[slot.kind] ? "Заменить PNG" : "Загрузить PNG"}
            </button>
          </section>
        ))}
      </aside>
    </div>
  );
}
