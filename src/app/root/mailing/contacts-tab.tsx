"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ClipboardPaste,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Scale,
  Search,
  Trash2,
  Upload,
  UserCheck,
  UserMinus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ContactFilters } from "@/lib/mailing/audience";
import type { ContactDto, ImportPreview } from "@/lib/mailing/contacts.server";
import { CONTACT_FIELDS, CONTACT_FIELD_LABELS, type ColumnMapping, type ContactField } from "@/lib/mailing/csv";
import { CONTACT_STATUS_LABELS } from "@/lib/mailing/labels";
import { ORG_SPHERES } from "@/lib/org-profile";
import { cn } from "@/lib/utils";

import { CARD, CHECKBOX, DANGER_SM, FilterSelect, INPUT, Notice, OUTLINE, OUTLINE_SM, PRIMARY, SECTION_LABEL, api, formatDate } from "./ui";

const PAGE = 100;
const SPHERE_LABEL = new Map<string, string>(ORG_SPHERES.map((s) => [s.value, s.label]));
const BASIS_SUGGESTIONS = [
  "Согласие на сайте",
  "Деловая переписка",
  "Сами оставили контакт на выставке",
  "Запросили коммерческое предложение",
];

type ListResponse = { total: number; rows: ContactDto[]; sources: string[]; tags: string[] };

function toQuery(f: ContactFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (f.search) q.set("search", f.search);
  q.set("sphere", f.sphere);
  if (f.tag) q.set("tag", f.tag);
  q.set("status", f.status);
  if (f.source) q.set("source", f.source);
  return q;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const CLS_LABEL: Record<string, { label: string; tone: string }> = {
  new: { label: "Новый", tone: "bg-[#ecfdf5] text-[#116b2a]" },
  exists: { label: "Уже в базе", tone: "bg-[#f5f6ff] text-[#6f7282]" },
  suppressed: { label: "В стоп-листе", tone: "bg-[#fff8eb] text-[#a16d32]" },
  duplicate: { label: "Дубль в файле", tone: "bg-[#f5f6ff] text-[#6f7282]" },
  invalid: { label: "Плохой адрес", tone: "bg-[#fff4f2] text-[#a13a32]" },
};

export function ContactsTab({
  filters,
  onFilters,
  selected,
  onSelect,
  rememberLabels,
}: {
  filters: ContactFilters;
  onFilters: (next: ContactFilters) => void;
  selected: ReadonlySet<string>;
  onSelect: (ids: string[], on: boolean) => void;
  rememberLabels: (entries: Array<[string, string]>) => void;
}) {
  const [list, setList] = useState<ListResponse>({ total: 0, rows: [], sources: [], tags: [] });
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [search, setSearch] = useState(filters.search);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [deleting, setDeleting] = useState<{ ids: string[]; label: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== filters.search) onFilters({ ...filters, search });
    }, 350);
    return () => clearTimeout(t);
  }, [search, filters, onFilters]);

  const load = useCallback(
    async (offset: number) => {
      const q = toQuery(filters);
      q.set("offset", String(offset));
      q.set("limit", String(PAGE));
      const data = await api<ListResponse>(`/api/root/mailing/contacts?${q}`);
      rememberLabels(
        data.rows.map((c) => [`contact:${c.id}`, [c.name, c.company, c.email].filter(Boolean).join(" · ")])
      );
      return data;
    },
    [filters, rememberLabels]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load(0)
      .then((data) => alive && setList(data))
      .catch((error) => toast.error(error instanceof Error ? error.message : "Не удалось загрузить"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load, reload]);

  async function showMore() {
    setMore(true);
    try {
      const data = await load(list.rows.length);
      setList((prev) => ({ ...data, rows: [...prev.rows, ...data.rows] }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить");
    } finally {
      setMore(false);
    }
  }

  async function selectAllFound(on: boolean) {
    setBulkBusy(true);
    try {
      const q = toQuery(filters);
      q.set("idsOnly", "1");
      const data = await api<{ ids: string[] }>(`/api/root/mailing/contacts?${q}`);
      onSelect(data.ids, on);
      toast.success(on ? `Выбрано найденных: ${data.ids.length}` : `Снят выбор: ${data.ids.length}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBulkBusy(false);
    }
  }

  async function removeContacts(ids: string[]) {
    try {
      const r = await api<{ deleted: number }>("/api/root/mailing/contacts/delete", { method: "POST", json: { ids } });
      onSelect(ids, false);
      toast.success(`Удалено контактов: ${r.deleted}`);
      setDeleting(null);
      setReload((n) => n + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить");
    }
  }

  const selectedHere = useMemo(() => list.rows.filter((r) => selected.has(r.id)).length, [list.rows, selected]);
  const set = (patch: Partial<ContactFilters>) => onFilters({ ...filters, ...patch });

  return (
    <div className="space-y-4" data-testid="mailing-contacts-tab">
      <Notice tone="warn" icon={<Scale />} testId="law-warning">
        <span className="font-medium">
          Реклама по email — только с согласия получателя (38-ФЗ «О рекламе», ст. 18). Указывайте, откуда адрес и на
          каком основании.
        </span>{" "}
        Отписавшиеся сами попадают в стоп-лист — реклама им больше не уходит.
      </Notice>

      <ImportCard onImported={() => setReload((n) => n + 1)} />

      <section className={CARD}>
        <div className={cn(SECTION_LABEL, "mb-3")}>Загруженные контакты</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block min-w-0 lg:col-span-1">
            <span className="mb-1.5 block text-[12px] font-medium text-[#6f7282]">Поиск</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Почта, имя, компания"
                className={cn(INPUT, "pl-10")}
                data-testid="contacts-filter-search"
              />
            </span>
          </label>
          <FilterSelect
            label="Сфера"
            value={filters.sphere}
            onChange={(v) => set({ sphere: v as ContactFilters["sphere"] })}
            options={[
              { value: "any", label: "Все сферы" },
              { value: "none", label: "Без сферы" },
              ...ORG_SPHERES.map((s) => ({ value: s.value, label: s.label })),
            ]}
          />
          <FilterSelect
            label="Тег"
            value={filters.tag || "any"}
            onChange={(v) => set({ tag: v === "any" ? "" : v })}
            options={[{ value: "any", label: "Любой тег" }, ...list.tags.map((t) => ({ value: t, label: t }))]}
          />
          <FilterSelect
            label="Статус"
            value={filters.status}
            onChange={(v) => set({ status: v as ContactFilters["status"] })}
            options={[
              { value: "any", label: "Любой статус" },
              ...Object.entries(CONTACT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <FilterSelect
            label="Источник"
            value={filters.source || "any"}
            onChange={(v) => set({ source: v === "any" ? "" : v })}
            options={[{ value: "any", label: "Любой источник" }, ...list.sources.map((s) => ({ value: s, label: s }))]}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[14px] text-[#3c4053]" data-testid="contacts-found">
            Найдено: <span className="font-semibold tabular-nums text-[#0b1024]">{list.total}</span>
            <span className="text-[#9b9fb3]"> · выбрано всего: </span>
            <span className="font-semibold tabular-nums text-[#3848c7]" data-testid="contacts-selected-count">
              {selected.size}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={OUTLINE_SM}
              disabled={bulkBusy || list.total === 0}
              onClick={() => void selectAllFound(true)}
              data-testid="contacts-select-all-found"
            >
              {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4 text-[#5566f6]" />}
              Выбрать всех найденных ({list.total})
            </button>
            <button
              type="button"
              className={OUTLINE_SM}
              disabled={bulkBusy || selected.size === 0}
              onClick={() => void selectAllFound(false)}
            >
              <UserMinus className="size-4 text-[#5566f6]" />
              Снять с найденных
            </button>
            {selectedHere > 0 ? (
              <button
                type="button"
                className={DANGER_SM}
                onClick={() =>
                  setDeleting({
                    ids: list.rows.filter((r) => selected.has(r.id)).map((r) => r.id),
                    label: `Удалить выбранные на экране контакты (${selectedHere})?`,
                  })
                }
              >
                <Trash2 className="size-4" />
                Удалить выбранные ({selectedHere})
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-[14px] text-[#6f7282]">
            <Loader2 className="size-4 animate-spin" /> Загружаем контакты…
          </div>
        ) : list.rows.length === 0 ? (
          <div className="mt-4 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center">
            <div className="text-[15px] font-medium text-[#0b1024]">Контактов пока нет</div>
            <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] text-[#6f7282]">
              Загрузите CSV или вставьте адреса выше — они появятся здесь, и их можно будет выбрать для рассылки.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[980px] text-[14px]">
                <thead className="text-left text-[12px] text-[#6f7282]">
                  <tr className="border-b border-[#ececf4]">
                    <th className="w-10 py-2.5 pr-2">
                      <input
                        type="checkbox"
                        aria-label="Выбрать показанных"
                        checked={list.rows.length > 0 && selectedHere === list.rows.length}
                        onChange={(e) => onSelect(list.rows.map((r) => r.id), e.target.checked)}
                        className={CHECKBOX}
                      />
                    </th>
                    <th className="py-2.5 pr-3 font-medium">Контакт</th>
                    <th className="py-2.5 pr-3 font-medium">Сфера, город</th>
                    <th className="py-2.5 pr-3 font-medium">Теги</th>
                    <th className="py-2.5 pr-3 font-medium">Источник и основание</th>
                    <th className="py-2.5 pr-3 font-medium">Статус</th>
                    <th className="py-2.5 pr-3 font-medium">Письмо</th>
                    <th className="py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((c) => (
                    <tr
                      key={c.id}
                      className={cn("border-b border-[#f2f3f8] align-top", selected.has(c.id) && "bg-[#f5f6ff]")}
                      data-testid="contacts-row"
                    >
                      <td className="py-3 pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Выбрать ${c.email}`}
                          checked={selected.has(c.id)}
                          onChange={(e) => onSelect([c.id], e.target.checked)}
                          className={CHECKBOX}
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-medium text-[#0b1024] [overflow-wrap:anywhere]">{c.email}</div>
                        <div className="text-[13px] text-[#6f7282]">
                          {[c.name, c.company].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-[13px] text-[#3c4053]">
                        {c.sphere ? SPHERE_LABEL.get(c.sphere) ?? c.sphere : <span className="text-[#9b9fb3]">—</span>}
                        {c.city ? <div className="text-[#6f7282]">{c.city}</div> : null}
                      </td>
                      <td className="py-3 pr-3">
                        <div className="flex max-w-[180px] flex-wrap gap-1">
                          {c.tags.map((t) => (
                            <span key={t} className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px] text-[#3848c7]">
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-[13px]">
                        <div className="text-[#0b1024]">{c.source}</div>
                        <div className="text-[#6f7282]">{c.basis}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[12px] font-medium",
                            c.status === "active" ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#fff8eb] text-[#a16d32]"
                          )}
                        >
                          {CONTACT_STATUS_LABELS[c.status] ?? c.status}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-[13px] tabular-nums text-[#6f7282]">{formatDate(c.lastSentAt)}</td>
                      <td className="py-3">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className="inline-flex size-8 items-center justify-center rounded-xl text-[#5566f6] hover:bg-[#f5f6ff]"
                            aria-label="Изменить"
                            onClick={() => setEditing(c)}
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex size-8 items-center justify-center rounded-xl text-[#a13a32] hover:bg-[#fff4f2]"
                            aria-label="Удалить"
                            onClick={() => setDeleting({ ids: [c.id], label: `Удалить контакт ${c.email}?` })}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-4 space-y-2 md:hidden">
              {list.rows.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "rounded-2xl border border-[#ececf4] p-3",
                    selected.has(c.id) ? "bg-[#f5f6ff]" : "bg-[#fafbff]"
                  )}
                  data-testid="contacts-card"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={(e) => onSelect([c.id], e.target.checked)}
                      className={cn(CHECKBOX, "mt-1")}
                      aria-label={`Выбрать ${c.email}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[#0b1024] [overflow-wrap:anywhere]">{c.email}</div>
                      <div className="text-[13px] text-[#6f7282]">
                        {[c.name, c.company, c.sphere ? SPHERE_LABEL.get(c.sphere) : null].filter(Boolean).join(" · ")}
                      </div>
                      <div className="mt-1 text-[12px] text-[#6f7282]">
                        {c.source} · {c.basis} · {CONTACT_STATUS_LABELS[c.status] ?? c.status}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="inline-flex size-8 items-center justify-center rounded-xl text-[#5566f6] hover:bg-white"
                      aria-label="Изменить"
                      onClick={() => setEditing(c)}
                    >
                      <Pencil className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {list.rows.length < list.total ? (
              <div className="mt-4 flex justify-center">
                <button type="button" className={OUTLINE_SM} disabled={more} onClick={() => void showMore()}>
                  {more ? <Loader2 className="size-4 animate-spin" /> : null}
                  Показать ещё ({list.total - list.rows.length})
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {editing ? (
        <EditContactDialog
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReload((n) => n + 1);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? removeContacts(deleting.ids) : undefined)}
        variant="danger"
        title={deleting?.label ?? "Удалить?"}
        description="Контакт исчезнет из списка. В истории рассылок строки останутся — без ссылки на контакт."
        bullets={[
          { label: "Удаление попадёт в аудит", tone: "info" },
          { label: "Чтобы просто не писать человеку — добавьте адрес в стоп-лист", tone: "warn" },
        ]}
        confirmLabel="Удалить"
      />
    </div>
  );
}

// ------------------------------------------------------------------ import

function ImportCard({ onImported }: { onImported: () => void }) {
  const [mode, setMode] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [source, setSource] = useState("");
  const [basis, setBasis] = useState("");
  const [tags, setTags] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const input = () => (mode === "file" && file ? { fileBase64: file.base64, fileName: file.name } : { text });

  async function runPreview(nextMapping: ColumnMapping | null) {
    if (mode === "text" && !text.trim()) {
      toast.error("Вставьте адреса или таблицу");
      return;
    }
    if (mode === "file" && !file) {
      toast.error("Выберите файл CSV");
      return;
    }
    setBusy("preview");
    try {
      const data = await api<ImportPreview>("/api/root/mailing/contacts/preview", {
        method: "POST",
        json: { ...input(), mapping: nextMapping },
      });
      setPreview(data);
      setMapping(data.mapping);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось разобрать");
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!preview) return;
    if (!source.trim() || !basis.trim()) {
      toast.error("Заполните «Источник» и «Основание» — без них загрузить нельзя");
      return;
    }
    setBusy("commit");
    try {
      const r = await api<{ created: number }>("/api/root/mailing/contacts", {
        method: "POST",
        json: { ...input(), mapping, source, basis, tags },
      });
      toast.success(`Загружено новых контактов: ${r.created}`);
      setPreview(null);
      setMapping(null);
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onImported();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить");
    } finally {
      setBusy(null);
    }
  }

  async function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error("Файл больше 5 МБ — разбейте его на части");
      return;
    }
    setFile({ name: f.name, base64: await fileToBase64(f) });
    setPreview(null);
    setMapping(null);
  }

  const counts = preview?.counts;
  const canCommit = Boolean(preview && counts && counts.new > 0 && source.trim() && basis.trim());

  return (
    <section className={CARD} data-testid="contacts-import">
      <div className={cn(SECTION_LABEL, "mb-3")}>Загрузить контакты</div>
      <div className="mb-3 inline-flex rounded-2xl border border-[#ececf4] bg-[#fafbff] p-1">
        {(
          [
            ["text", "Вставить текстом", ClipboardPaste],
            ["file", "Файл CSV", FileSpreadsheet],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setMode(key);
              setPreview(null);
              setMapping(null);
            }}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[14px] font-medium transition-colors",
              mode === key ? "bg-white text-[#3848c7] shadow-[0_1px_4px_rgba(11,16,36,0.08)]" : "text-[#6f7282]"
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {mode === "text" ? (
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          rows={5}
          data-testid="contacts-paste"
          placeholder={"Можно просто адреса по одному в строке или через запятую,\nлибо таблицу из Excel: email;имя;компания;сфера;город;телефон;теги"}
          className="w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-3 text-[14px] leading-[1.6] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={(e) => void pickFile(e.target.files?.[0])}
            className="text-[14px] text-[#3c4053] file:mr-3 file:h-10 file:rounded-xl file:border file:border-[#dcdfed] file:bg-white file:px-3 file:text-[14px] file:font-medium file:text-[#0b1024]"
          />
          <span className="text-[13px] text-[#6f7282]">
            CSV с разделителем «;» или «,», кодировка UTF-8 или Windows-1251 (Excel) — определим сами.
          </span>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
            Источник <span className="text-[#a13a32]">*</span>
          </span>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Выгрузка 2ГИС 29.09"
            maxLength={200}
            className={INPUT}
            data-testid="contacts-source"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
            Основание <span className="text-[#a13a32]">*</span>
          </span>
          <input
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="Согласие на сайте"
            list="mailing-basis-suggestions"
            maxLength={200}
            className={INPUT}
            data-testid="contacts-basis"
          />
          <datalist id="mailing-basis-suggestions">
            {BASIS_SUGGESTIONS.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Теги для всей партии</span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="выставка, москва"
            maxLength={300}
            className={INPUT}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={OUTLINE}
          disabled={busy !== null}
          onClick={() => void runPreview(null)}
          data-testid="contacts-preview-button"
        >
          {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4 text-[#5566f6]" />}
          Проверить
        </button>
        {preview ? (
          <button type="button" className={OUTLINE} onClick={() => setPreview(null)}>
            <X className="size-4 text-[#5566f6]" />
            Скрыть предпросмотр
          </button>
        ) : null}
      </div>

      {preview && counts ? (
        <div className="mt-5 space-y-4" data-testid="contacts-preview">
          <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[14px]" data-testid="contacts-preview-summary">
              <span>
                Новых: <b className="tabular-nums text-[#116b2a]">{counts.new}</b>
              </span>
              <span>
                Уже в базе: <b className="tabular-nums text-[#0b1024]">{counts.exists}</b>
              </span>
              <span>
                В стоп-листе: <b className="tabular-nums text-[#a16d32]">{counts.suppressed}</b>
              </span>
              <span>
                Дублей в файле: <b className="tabular-nums text-[#0b1024]">{counts.duplicate}</b>
              </span>
              <span>
                Плохих адресов: <b className="tabular-nums text-[#a13a32]">{counts.invalid}</b>
              </span>
            </div>
            <p className="mt-2 text-[12px] text-[#6f7282]">
              {preview.encoding === "windows-1251"
                ? "Кодировка Windows-1251 · "
                : preview.encoding === "utf-8"
                  ? "Кодировка UTF-8 · "
                  : ""}
              {preview.delimiter === ";"
                ? "разделитель «;»"
                : preview.delimiter === ","
                  ? "разделитель «,»"
                  : preview.delimiter === "\t"
                    ? "разделитель — табуляция"
                    : "одна колонка"}
              {preview.hasHeader ? " · первая строка — заголовок" : " · без заголовка"}
              {preview.truncated ? " · файл длиннее 20 000 строк — загрузятся первые 20 000" : ""}. Уже загруженные
              адреса не меняем, адреса из стоп-листа не загружаем.
            </p>
          </div>

          {mapping && mapping.length > 1 ? (
            <div>
              <div className="mb-2 text-[13px] font-medium text-[#3c4053]">Что в какой колонке</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {preview.headers.map((header, i) => (
                  <label key={i} className="block rounded-2xl border border-[#ececf4] bg-white p-3">
                    <span className="block truncate text-[13px] font-medium text-[#0b1024]">{header}</span>
                    <span className="block truncate text-[12px] text-[#9b9fb3]">
                      {preview.samples[i]?.join(", ") || "пусто"}
                    </span>
                    <select
                      value={mapping[i] ?? "skip"}
                      onChange={(e) => {
                        const next = [...mapping];
                        next[i] = e.target.value as ContactField | "skip";
                        setMapping(next);
                        void runPreview(next);
                      }}
                      className="mt-2 h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-2 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
                      data-testid={`contacts-mapping-${i}`}
                    >
                      {[...CONTACT_FIELDS, "skip" as const].map((f) => (
                        <option key={f} value={f}>
                          {CONTACT_FIELD_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-2xl border border-[#ececf4]">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="bg-[#fafbff] text-left text-[12px] text-[#6f7282]">
                <tr>
                  <th className="px-3 py-2 font-medium">Строка</th>
                  <th className="px-3 py-2 font-medium">Почта</th>
                  <th className="px-3 py-2 font-medium">Имя, компания</th>
                  <th className="px-3 py-2 font-medium">Сфера</th>
                  <th className="px-3 py-2 font-medium">Итог</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-t border-[#f2f3f8] align-top">
                    <td className="px-3 py-2 tabular-nums text-[#9b9fb3]">{r.line}</td>
                    <td className="px-3 py-2 text-[#0b1024] [overflow-wrap:anywhere]">{r.email || "—"}</td>
                    <td className="px-3 py-2 text-[#3c4053]">{[r.name, r.company].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-[#3c4053]">
                      {r.sphere ? SPHERE_LABEL.get(r.sphere) ?? r.sphere : r.sphereRaw ? <span className="text-[#a16d32]">{r.sphereRaw}?</span> : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", CLS_LABEL[r.cls]?.tone)}>
                        {CLS_LABEL[r.cls]?.label ?? r.cls}
                      </span>
                      {r.error || r.warning ? (
                        <div className="mt-1 text-[12px] text-[#6f7282]">{r.error ?? r.warning}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.shown < preview.summary.total ? (
            <p className="text-[12px] text-[#9b9fb3]">
              Показаны первые {preview.shown} строк из {preview.summary.total}.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={PRIMARY}
              disabled={!canCommit || busy !== null}
              onClick={() => void commit()}
              data-testid="contacts-commit"
            >
              {busy === "commit" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Загрузить {counts.new} {counts.new === 1 ? "контакт" : "контактов"}
            </button>
            {!source.trim() || !basis.trim() ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-[#a16d32]">
                <AlertTriangle className="size-4" />
                Нужны «Источник» и «Основание»
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ edit

function EditContactDialog({
  contact,
  onClose,
  onSaved,
}: {
  contact: ContactDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: contact.name ?? "",
    company: contact.company ?? "",
    sphere: contact.sphere ?? "none",
    city: contact.city ?? "",
    phone: contact.phone ?? "",
    tags: contact.tags.join(", "),
    source: contact.source,
    basis: contact.basis,
    status: contact.status,
    note: contact.note ?? "",
  });

  async function save() {
    try {
      await api(`/api/root/mailing/contacts/${contact.id}`, {
        method: "PATCH",
        json: { ...form, sphere: form.sphere === "none" ? null : form.sphere },
      });
      toast.success("Контакт сохранён");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
      throw error;
    }
  }

  const field = (key: keyof typeof form, label: string, placeholder = "") => (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-[#6f7282]">{label}</span>
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
      />
    </label>
  );

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={save}
      title={contact.email}
      description="Почту поменять нельзя — это ключ контакта. Удалите и загрузите заново, если адрес другой."
      confirmLabel="Сохранить"
      variant="default"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", "Имя")}
        {field("company", "Компания")}
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-[#6f7282]">Сфера</span>
          <select
            value={form.sphere}
            onChange={(e) => setForm({ ...form, sphere: e.target.value })}
            className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-2 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
          >
            <option value="none">Без сферы</option>
            {ORG_SPHERES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {field("city", "Город")}
        {field("phone", "Телефон")}
        {field("tags", "Теги", "через запятую")}
        {field("source", "Источник")}
        {field("basis", "Основание")}
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-[#6f7282]">Статус</span>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-2 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
          >
            {Object.entries(CONTACT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {field("note", "Заметка")}
      </div>
    </ConfirmDialog>
  );
}
