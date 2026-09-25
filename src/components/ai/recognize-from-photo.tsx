"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, ImagePlus, Images, Loader2, RotateCcw, ScanText, X } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  JOURNAL_DIALOG_CONTENT_WIDE_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import { downscaleImageFile } from "@/lib/ai-vision/downscale";
import {
  VISION_FIELDS,
  VISION_FIELD_LABELS,
  VISION_MAX_PHOTOS,
  type VisionExtractError,
  type VisionExtractSuccess,
  type VisionFieldKey,
  type VisionItemByKind,
  type VisionKind,
} from "@/lib/ai-vision/shared";
import { normalizeTypedTime } from "@/lib/finished-product-bulk";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { pluralRu } from "@/lib/plural-ru";
import { cn } from "@/lib/utils";

/**
 * «С фото» — единая кнопка распознавания номенклатуры по фото.
 *
 * Нажатие сразу открывает камеру телефона (`capture="environment"`) или
 * выбор файла на компьютере. Дальше окно: до 3 снимков (уменьшаются в
 * браузере до ~1600 px) → «Распознать» → «Распознаём… обычно 10–40
 * секунд» (можно отменить) → таблица с галками и правкой полей →
 * «Добавить N строк» → `onItems(items)`. Пустой результат и ошибки —
 * понятным текстом с выходом «ввести вручную». Один вид на телефоне и
 * компьютере; кнопки на телефоне не ниже 48 px.
 *
 * Сервер: `POST /api/ai/vision-extract` (задание диспетчеру, см.
 * `src/lib/ai-vision/run.ts`).
 */

export type RecognizeResult = { added: number; skipped?: number; overflow?: number } | void;

type Photo = { id: string; blob: Blob; url: string };
type Phase = "photos" | "recognizing" | "review" | "empty" | "error";
type ReviewRow = { key: string; checked: boolean; values: Partial<Record<VisionFieldKey, string>> };

const COPY: Record<VisionKind, { title: string; hint: string; noun: [string, string, string] }> = {
  menu: {
    title: "Меню с фото",
    hint: "Сфотографируйте меню или план-меню целиком — ровно, при хорошем свете, без бликов. Если меню на нескольких страницах — до 3 фото.",
    noun: ["блюдо", "блюда", "блюд"],
  },
  raw: {
    title: "Сырьё с фото",
    hint: "Сфотографируйте накладную, этикетку или список сырья — ровно, при хорошем свете. Если документ на нескольких страницах — до 3 фото.",
    noun: ["позиция", "позиции", "позиций"],
  },
  generic: {
    title: "Список с фото",
    hint: "Сфотографируйте список — ровно, при хорошем свете. Если он на нескольких страницах — до 3 фото.",
    noun: ["позиция", "позиции", "позиций"],
  },
};

const PRIMARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50 sm:h-11 sm:text-[14px]";
const OUTLINE =
  "inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50 sm:h-11 sm:text-[14px]";
const INPUT =
  "h-11 w-full min-w-0 rounded-xl border border-[#dcdfed] bg-white px-3 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 sm:h-10 sm:text-[14px]";

/**
 * Раскладка полей строки проверки на сетке 12 колонок. Меню: наименование,
 * выход и время — одной строкой. Сырьё: наименование во всю ширину,
 * изготовитель и поставщик — пополам, количество и даты — по трети. На
 * телефоне длинные поля во всю ширину, даты и выход/время — по два в ряд.
 */
const SM_SPAN: Record<number, string> = {
  3: "sm:col-span-3",
  4: "sm:col-span-4",
  6: "sm:col-span-6",
  9: "sm:col-span-9",
  12: "sm:col-span-12",
};
const SHORT_FIELDS: VisionFieldKey[] = ["yield", "time"];
const PARTY_FIELDS: VisionFieldKey[] = ["manufacturer", "supplier"];
const TAIL_FIELDS: VisionFieldKey[] = ["quantity", "productionDate", "expiryDate"];

function fieldSpans(fields: VisionFieldKey[]): Partial<Record<VisionFieldKey, string>> {
  const short = fields.filter((field) => SHORT_FIELDS.includes(field));
  const parties = fields.filter((field) => PARTY_FIELDS.includes(field));
  const tail = fields.filter((field) => TAIL_FIELDS.includes(field));
  const spans: Partial<Record<VisionFieldKey, string>> = {
    name: `col-span-2 ${SM_SPAN[parties.length > 0 ? 12 : Math.max(6, 12 - 3 * short.length)]}`,
  };
  for (const field of short) spans[field] = "sm:col-span-3";
  for (const field of parties) spans[field] = `col-span-2 ${SM_SPAN[12 / parties.length]}`;
  for (const field of tail) spans[field] = `${field === "quantity" ? "col-span-2 " : ""}${SM_SPAN[12 / tail.length]}`;
  return spans;
}

let photoSeq = 0;

function rowsFromItems(kind: VisionKind, items: Array<Record<string, string>>): ReviewRow[] {
  return items.map((item, index) => {
    const values: Partial<Record<VisionFieldKey, string>> = {};
    for (const field of VISION_FIELDS[kind]) values[field] = item[field] ?? "";
    return { key: `r${index}-${item.name}`, checked: true, values };
  });
}

function toItem<K extends VisionKind>(kind: K, values: Partial<Record<VisionFieldKey, string>>): VisionItemByKind[K] {
  const item: Record<string, string> = {};
  for (const field of VISION_FIELDS[kind]) {
    const raw = (values[field] ?? "").replace(/\s+/g, " ").trim();
    item[field] = field === "time" ? normalizeTypedTime(raw) : raw;
  }
  return item as VisionItemByKind[K];
}

export function RecognizeFromPhoto<K extends VisionKind>({
  kind,
  onItems,
  fields,
  label = "С фото",
  title,
  hint,
  resultLabel = "Добавлено строк",
  disabled = false,
  className,
  testId = "photo-recognize",
}: {
  kind: K;
  /**
   * Выбранные в таблице проверки строки. Можно вернуть итог (сразу или
   * промисом): сколько легло, сколько уже было, сколько не влезло. Ошибка
   * промиса — окно остаётся открытым, текст ошибки — в тосте.
   */
  onItems: (items: Array<VisionItemByKind[K]>) => RecognizeResult | Promise<RecognizeResult>;
  /** Какие поля показать в проверке (по умолчанию — все поля вида). */
  fields?: Array<keyof VisionItemByKind[K] & VisionFieldKey>;
  label?: string;
  title?: string;
  hint?: string;
  /** Начало подтверждения: «Добавлено строк: 5» / «В таблицу добавлено: 5». */
  resultLabel?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  const copy = COPY[kind];
  const shownFields = useMemo<VisionFieldKey[]>(
    () => (fields && fields.length > 0 ? VISION_FIELDS[kind].filter((field) => (fields as string[]).includes(field)) : VISION_FIELDS[kind]),
    [fields, kind]
  );
  const spans = useMemo(() => fieldSpans(shownFields), [shownFields]);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("photos");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [coarse, setCoarse] = useState(false);
  const [adding, setAdding] = useState(false);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const galleryInput = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const photosRef = useRef<Photo[]>([]);
  photosRef.current = photos;

  useEffect(() => {
    try {
      setCoarse(window.matchMedia("(pointer: coarse)").matches);
    } catch {
      setCoarse(false);
    }
  }, []);

  // Освобождаем превью при размонтировании.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    },
    []
  );

  useEffect(() => {
    if (phase !== "recognizing") return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    setPhotos([]);
    setRows([]);
    setError(null);
    setTruncated(false);
    setPhase("photos");
  }

  function close() {
    setOpen(false);
    reset();
  }

  function pickCamera() {
    if (cameraInput.current) {
      cameraInput.current.value = "";
      cameraInput.current.click();
    }
  }

  function pickGallery() {
    if (galleryInput.current) {
      galleryInput.current.value = "";
      galleryInput.current.click();
    }
  }

  async function onFilesChosen(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const room = VISION_MAX_PHOTOS - photosRef.current.length;
    if (room <= 0) {
      toast.info(`Не больше ${VISION_MAX_PHOTOS} фото за раз`);
      return;
    }
    if (files.length > room) toast.info(`Взяли первые ${room} — не больше ${VISION_MAX_PHOTOS} фото за раз`);
    setOpen(true);
    setPhase("photos");
    setError(null);
    setPreparing(true);
    try {
      const added: Photo[] = [];
      for (const file of files.slice(0, room)) {
        try {
          const blob = await downscaleImageFile(file);
          photoSeq += 1;
          added.push({ id: `p${photoSeq}`, blob, url: URL.createObjectURL(blob) });
        } catch {
          toast.error("Не удалось открыть фото — сфотографируйте ещё раз или выберите снимок JPG / PNG");
        }
      }
      if (added.length > 0) setPhotos((prev) => [...prev, ...added].slice(0, VISION_MAX_PHOTOS));
    } finally {
      setPreparing(false);
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const photo = prev.find((item) => item.id === id);
      if (photo) URL.revokeObjectURL(photo.url);
      return prev.filter((item) => item.id !== id);
    });
  }

  async function recognize() {
    if (photos.length === 0 || phase === "recognizing") return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setPhase("recognizing");
    try {
      const form = new FormData();
      form.set("kind", kind);
      photos.forEach((photo, index) => form.append("photo", photo.blob, `photo-${index + 1}.jpg`));
      const response = await fetch("/api/ai/vision-extract", { method: "POST", body: form, signal: controller.signal });
      const json = (await response.json().catch(() => null)) as (VisionExtractSuccess<K> & Partial<VisionExtractError>) | null;
      if (controller.signal.aborted) return;
      if (!response.ok || !json || !Array.isArray(json.items)) {
        setError(json?.error ?? "Не получилось распознать фото — попробуйте ещё раз или введите строки вручную.");
        setPhase("error");
        return;
      }
      if (json.items.length === 0) {
        setPhase("empty");
        return;
      }
      setRows(rowsFromItems(kind, json.items as unknown as Array<Record<string, string>>));
      setTruncated(Boolean(json.truncated));
      setPhase("review");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(humanizeFetchError(err, "Не получилось распознать фото — попробуйте ещё раз или введите строки вручную."));
      setPhase("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function cancelRecognition() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("photos");
  }

  function retake() {
    for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    setPhotos([]);
    setRows([]);
    setError(null);
    setPhase("photos");
    pickCamera();
  }

  const selected = rows.filter((row) => row.checked && (row.values.name ?? "").trim() !== "");
  const allChecked = rows.length > 0 && rows.every((row) => row.checked);

  async function addSelected() {
    if (selected.length === 0 || adding) return;
    const items = selected.map((row) => toItem(kind, row.values));
    setAdding(true);
    let result: RecognizeResult;
    try {
      result = await onItems(items);
    } catch (err) {
      toast.error(humanizeFetchError(err, "Не удалось добавить строки — попробуйте ещё раз"));
      return;
    } finally {
      setAdding(false);
    }
    const added = result ? result.added : items.length;
    const parts = [`${resultLabel}: ${added}`];
    if (result?.skipped) parts.push(`уже были: ${result.skipped}`);
    if (result?.overflow) parts.push(`не влезло: ${result.overflow}`);
    if (added > 0) toast.success(parts.join(" · "));
    else toast.info(parts.slice(1).join(" · ") || "Новых строк нет");
    close();
  }

  const nounCount = (count: number) => `${count} ${pluralRu(count, copy.noun[0], copy.noun[1], copy.noun[2])}`;
  const rowsWord = (count: number) => pluralRu(count, "строку", "строки", "строк");

  return (
    <>
      <button
        type="button"
        onClick={pickCamera}
        disabled={disabled}
        title="Сфотографировать или выбрать фото — строки заполнятся сами"
        className={cn(
          "inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:rounded-xl sm:text-[14px]",
          className
        )}
        data-testid={testId}
      >
        <Camera className="size-4 text-[#5566f6]" />
        {label}
      </button>
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(event) => void onFilesChosen(event.target.files)}
        data-testid={`${testId}-input`}
      />
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => void onFilesChosen(event.target.files)}
        data-testid={`${testId}-gallery`}
      />

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        {/* z-[70]: окно открывается и поверх окон на z-60 (ConfirmDialog, листы снизу). */}
        <DialogContent
          className={cn(JOURNAL_DIALOG_CONTENT_WIDE_CLASS, "z-[70]")}
          data-testid="photo-recognize-dialog"
          data-phase={phase}
        >
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={cn(JOURNAL_DIALOG_TITLE_CLASS, "flex items-center gap-2")}>
              <ScanText className="size-5 text-[#5566f6]" />
              {title ?? copy.title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Фото уходит на распознавание, строки можно проверить и поправить перед добавлением.
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-4 px-4 py-4 sm:px-6 sm:py-5" aria-live="polite">
            {phase === "photos" || phase === "recognizing" ? (
              <>
                {phase === "photos" ? (
                  <p className="text-[14px] leading-[1.55] text-[#3c4053]">{hint ?? copy.hint}</p>
                ) : null}
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {photos.map((photo, index) => (
                    <div
                      key={photo.id}
                      className={cn(
                        "relative aspect-[3/4] overflow-hidden rounded-2xl border border-[#ececf4] bg-[#fafbff]",
                        phase === "recognizing" ? "opacity-60" : ""
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- локальное превью blob: */}
                      <img src={photo.url} alt={`Фото ${index + 1}`} className="size-full object-contain" />
                      {phase === "photos" ? (
                        <button
                          type="button"
                          onClick={() => removePhoto(photo.id)}
                          aria-label={`Убрать фото ${index + 1}`}
                          className="absolute right-1.5 top-1.5 flex size-10 items-center justify-center rounded-full bg-white/90 text-[#3c4053] shadow-[0_4px_12px_-4px_rgba(11,16,36,0.35)] transition-colors hover:bg-white hover:text-[#a13a32]"
                        >
                          <X className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {phase === "photos" && photos.length < VISION_MAX_PHOTOS ? (
                    <button
                      type="button"
                      onClick={pickCamera}
                      disabled={preparing}
                      className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[#c8cdf7] bg-[#f5f6ff] px-2 text-center text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/60 hover:bg-[#eef1ff] disabled:opacity-60"
                      data-testid="photo-recognize-more"
                    >
                      {preparing ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
                      {photos.length === 0 ? "Сфотографировать" : "Ещё фото"}
                    </button>
                  ) : null}
                </div>
                {phase === "photos" ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] leading-snug text-[#6f7282]">
                    <span>
                      Фото {photos.length} из {VISION_MAX_PHOTOS}. Хранится на сервере несколько минут — только для
                      распознавания.
                    </span>
                    {coarse ? (
                      <button
                        type="button"
                        onClick={pickGallery}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2 text-[13px] font-medium text-[#3848c7] hover:bg-[#f5f6ff]"
                      >
                        <Images className="size-4" />
                        Выбрать из галереи
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-3 rounded-2xl border border-[#dfe3ff] bg-[#f5f6ff] px-4 py-3.5"
                    role="status"
                    data-testid="photo-recognize-progress"
                  >
                    <Loader2 className="size-5 shrink-0 animate-spin text-[#5566f6]" />
                    <div className="min-w-0">
                      <div className="text-[15px] font-medium text-[#0b1024]">Распознаём… обычно 10–40 секунд</div>
                      <div className="mt-0.5 text-[13px] tabular-nums text-[#6f7282]">
                        {elapsed >= 50 ? `Дольше обычного — ещё немного (${elapsed} с)` : `Прошло ${elapsed} с`}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : null}

            {phase === "review" ? (
              <>
                <p className="text-[14px] leading-[1.55] text-[#3c4053]" data-testid="photo-recognize-summary">
                  Распознано: <b className="font-semibold tabular-nums">{nounCount(rows.length)}</b>. Снимите галки с лишнего и
                  поправьте, если модель ошиблась.
                  {truncated ? " Показаны первые 200 строк." : ""}
                </p>
                <label className="flex h-11 cursor-pointer items-center gap-3 rounded-xl px-1 text-[14px] font-medium text-[#3c4053]">
                  <CheckBox
                    checked={allChecked}
                    onChange={() => setRows((prev) => prev.map((row) => ({ ...row, checked: !allChecked })))}
                    label="Выбрать все"
                  />
                  Выбрать все
                </label>
                <ol className="max-h-[min(52vh,520px)] space-y-2 overflow-y-auto overscroll-contain pr-0.5">
                  {rows.map((row, index) => (
                    <li
                      key={row.key}
                      className={cn(
                        "flex items-start gap-2 rounded-2xl border p-2.5 transition-colors duration-150",
                        row.checked ? "border-[#dfe3ff] bg-white" : "border-[#ececf4] bg-[#fafbff] opacity-70"
                      )}
                      data-testid={`photo-recognize-row-${index}`}
                    >
                      <span className="mt-4 shrink-0 sm:mt-3.5">
                        <CheckBox
                          checked={row.checked}
                          onChange={() =>
                            setRows((prev) => prev.map((item, i) => (i === index ? { ...item, checked: !item.checked } : item)))
                          }
                          label={`Добавить строку ${index + 1}`}
                          testId={`photo-recognize-check-${index}`}
                        />
                      </span>
                      <div className={cn("grid min-w-0 flex-1 grid-cols-2 gap-x-2 gap-y-1.5", "sm:grid-cols-12")}>
                        {shownFields.map((field) => (
                          <label key={field} className={cn("min-w-0 space-y-0.5", spans[field] ?? "")}>
                            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">
                              {VISION_FIELD_LABELS[field]}
                            </span>
                            <input
                              className={INPUT}
                              type={field === "productionDate" || field === "expiryDate" ? "date" : "text"}
                              inputMode={field === "time" ? "numeric" : undefined}
                              placeholder={field === "time" ? "ЧЧ:ММ" : field === "name" ? "Наименование" : "—"}
                              value={row.values[field] ?? ""}
                              maxLength={field === "name" ? 200 : 60}
                              onChange={(event) => {
                                const value = event.target.value;
                                setRows((prev) =>
                                  prev.map((item, i) => (i === index ? { ...item, values: { ...item.values, [field]: value } } : item))
                                );
                              }}
                              data-testid={`photo-recognize-${field}-${index}`}
                            />
                          </label>
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}

            {phase === "empty" ? (
              <div
                className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-10 text-center"
                data-testid="photo-recognize-empty"
              >
                <div className="text-[16px] font-medium text-[#0b1024]">Ничего не распознали</div>
                <p className="mx-auto mt-1.5 max-w-[420px] text-[14px] leading-[1.55] text-[#6f7282]">
                  На фото не нашлось строк, которые читаются однозначно. Сфотографируйте ближе, ровно и без бликов — или
                  введите строки вручную.
                </p>
              </div>
            ) : null}

            {phase === "error" ? (
              <div
                className="flex items-start gap-3 rounded-2xl border border-[#f3c9c2] bg-[#fff4f2] px-4 py-3.5"
                role="alert"
                data-testid="photo-recognize-error"
              >
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#a13a32]" />
                <p className="text-[14px] leading-[1.55] text-[#a13a32]">{error}</p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-[#ececf4] bg-white px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
            {phase === "photos" ? (
              <>
                <button type="button" onClick={close} className={OUTLINE}>
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => void recognize()}
                  disabled={photos.length === 0 || preparing}
                  className={PRIMARY}
                  data-testid="photo-recognize-submit"
                >
                  <ScanText className="size-4" />
                  Распознать{photos.length > 1 ? ` ${photos.length} фото` : ""}
                </button>
              </>
            ) : null}
            {phase === "recognizing" ? (
              <button type="button" onClick={cancelRecognition} className={OUTLINE} data-testid="photo-recognize-cancel">
                Отменить
              </button>
            ) : null}
            {phase === "review" ? (
              <>
                <button type="button" onClick={retake} className={OUTLINE}>
                  <RotateCcw className="size-4 text-[#5566f6]" />
                  Другое фото
                </button>
                <button
                  type="button"
                  onClick={() => void addSelected()}
                  disabled={selected.length === 0 || adding}
                  className={PRIMARY}
                  data-testid="photo-recognize-add"
                >
                  {adding ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Добавить {selected.length} {rowsWord(selected.length)}
                </button>
              </>
            ) : null}
            {phase === "empty" ? (
              <>
                <button type="button" onClick={close} className={OUTLINE}>
                  Ввести вручную
                </button>
                <button type="button" onClick={retake} className={PRIMARY}>
                  <Camera className="size-4" />
                  Сфотографировать ещё раз
                </button>
              </>
            ) : null}
            {phase === "error" ? (
              <>
                <button type="button" onClick={close} className={OUTLINE}>
                  Ввести вручную
                </button>
                <button
                  type="button"
                  onClick={() => void recognize()}
                  disabled={photos.length === 0}
                  className={PRIMARY}
                  data-testid="photo-recognize-retry"
                >
                  <RotateCcw className="size-4" />
                  Попробовать ещё раз
                </button>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Галка с зоной нажатия 44 px: на телефоне по крошечному квадрату не попасть. */
function CheckBox({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        onChange();
      }}
      className="-m-2.5 flex size-11 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      data-testid={testId}
    >
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-md border-2 transition-colors duration-150",
          checked ? "border-[#5566f6] bg-[#5566f6] text-white" : "border-[#c8cdf7] bg-white"
        )}
      >
        {checked ? <Check className="size-4" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}
