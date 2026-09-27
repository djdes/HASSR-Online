"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil, PencilLine, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import {
  JournalEnabledSwitch,
  useJournalToggle,
} from "@/components/journals/journal-enabled-indicator";
import {
  useApplyCustomNames,
  useCurrentJournalNames,
  type CurrentJournalNames,
} from "@/components/shared/custom-names-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  CUSTOM_NAME_MAX_LENGTH,
  checkJournalRename,
  type CustomNameFieldError,
  type CustomNames,
} from "@/lib/custom-names";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { cn } from "@/lib/utils";

/**
 * Кнопки в строку с названием журнала (владелец, 2026-09-26: «на название
 * журнала сделать возможность изменения… кнопку включить/отключить как-то
 * компактнее»):
 *
 *   • карандаш «Переименовать журнал» — тем, кому доступна страница
 *     «Настройки → Названия» (`canRename`, те же права, что у API);
 *   • маленький переключатель «Включён» вместо пилюли «Включён · отключить».
 *
 * Страница журнала кладёт этот компонент в `CurrentJournalProvider`, а
 * `JournalHeadingName` ставит его сразу за названием — поэтому ~36
 * клиентов журналов о нём не знают. Где клиенты журналов рисуются вне
 * страницы журнала (без провайдера), кнопок нет. Мини-приложение
 * показывает ту же страницу журнала (П-3) — там кнопки у тех же людей,
 * что и на сайте. В печать не попадает.
 */
export function JournalTitleControls({ canRename }: { canRename: boolean }) {
  const current = useCurrentJournalNames();
  const toggle = useJournalToggle();
  const [renameOpen, setRenameOpen] = useState(false);
  const pencilRef = useRef<HTMLButtonElement | null>(null);

  if (!current || (!canRename && !toggle)) return null;
  const displayName = current.customName ?? current.officialName;

  function closeRename() {
    setRenameOpen(false);
    // Фокус — туда, откуда открыли: клавиатура продолжает с карандаша.
    window.setTimeout(() => pencilRef.current?.focus({ preventScroll: true }), 0);
  }

  return (
    <>
      {canRename ? (
        // Неразрывный пробел и карандаш — в `nowrap`: карандаш не
        // отрывается от последнего слова названия и переносится только
        // вместе с ним (одного неразрывного пробела мало — рядом с кнопкой
        // браузер всё равно разрешает перенос).
        <span data-journal-title-controls="rename" className="whitespace-nowrap print:hidden">
          {" "}
          <button
            ref={pencilRef}
            type="button"
            onClick={() => setRenameOpen(true)}
            title="Переименовать журнал для своей организации"
            aria-label="Переименовать журнал"
            aria-haspopup="dialog"
            // На телефоне общее правило растягивает кнопку-иконку до
            // 48×48 — отрицательные поля не дают ей раздвинуть строку
            // заголовка, а нажимать по-прежнему удобно.
            className="-my-2 inline-flex size-8 items-center justify-center rounded-xl align-middle text-[#5566f6] transition-colors duration-150 hover:bg-[#eef1ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 touch:-mx-2 touch:-my-2.5"
          >
            <Pencil className="size-4" aria-hidden />
          </button>
        </span>
      ) : null}
      {toggle ? (
        <>
          {/* Обычный пробел: не хватает места — «Включён» уходит на
              следующую строку целиком и встаёт ровно под названием. */}{" "}
          <span
            data-journal-title-controls="toggle"
            className="inline-flex items-center align-middle text-[13px] font-medium leading-none tracking-normal print:hidden"
          >
            <JournalEnabledSwitch
              code={toggle.code}
              name={displayName}
              disabledCodes={toggle.disabledCodes}
              canToggle={toggle.canToggle}
            />
          </span>
        </>
      ) : null}
      {canRename && renameOpen ? (
        <JournalRenameDialog journal={current} onClose={closeRename} />
      ) : null}
    </>
  );
}

type SaveResponse = {
  names?: CustomNames;
  changed?: number;
  error?: string;
  errors?: CustomNameFieldError[];
};

/**
 * Обычное поле проекта (`Input` из ui/) в рецепте дизайн-системы (SKILL.md →
 * «Input recipe»): 48 px, скругление 2xl, индиго-рамка и кольцо в фокусе.
 * На телефоне кегль 16 px даёт общее правило для полей в окнах
 * (globals.css), iPhone не увеличивает страницу. Выделение — индиго
 * (`selection:bg-primary` у `Input`).
 */
const INPUT_CLASS =
  "h-12 rounded-2xl bg-white px-4 text-[15px] text-[#0b1024] shadow-none placeholder:text-[#9b9fb3] transition-[border-color,box-shadow] duration-150 focus-visible:ring-4 disabled:opacity-60 md:text-[15px]";

/**
 * Окно «Своё название журнала». Сохраняет тем же API и по тем же правилам,
 * что страница «Настройки → Названия» (`PATCH /api/settings/custom-names`
 * → `saveCustomNames`): 2–80 символов, без повторов, запись в журнал
 * действий. Пустое поле или официальное название — стандартное.
 *
 * После сохранения заголовок, крошки и меню берут новое название сразу
 * (`useApplyCustomNames`), а `router.refresh()` подтягивает остальное с
 * сервера — без перезагрузки страницы.
 */
function JournalRenameDialog({
  journal,
  onClose,
}: {
  journal: CurrentJournalNames;
  onClose: () => void;
}) {
  const router = useRouter();
  const applyNames = useApplyCustomNames();
  const [value, setValue] = useState(journal.customName ?? journal.officialName);
  const [saving, setSaving] = useState(false);
  // Ответ сервера про поле (например, «Так уже назван журнал …») — виден,
  // пока текст в поле тот же, с которым отправляли.
  const [serverError, setServerError] = useState<{ value: string; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const hintId = `${inputId}-hint`;

  const check = checkJournalRename({
    value,
    officialName: journal.officialName,
    customName: journal.customName,
  });
  const error = check.error ?? (serverError?.value === value ? serverError.message : null);
  const canSave = check.changed && !check.error && !saving;
  const isStandardValue = check.name === null;
  // В поле уже стоит официальное название — возвращать нечего. Пустое
  // поле кнопка заполняет официальным, чтобы было видно, что будет.
  const showsOfficial = isStandardValue && value.trim().length > 0;

  // Окно открылось — поле сразу в фокусе, текущее название выделено
  // целиком: можно печатать новое поверх или поставить курсор куда нужно.
  // Везде, и на телефоне: фокус ставится в том же касании карандаша
  // (эффект разметки, без таймера), поэтому клавиатура открывается вместе
  // с листом, а не через секунду, сдвигая поле из-под пальца. Лист сам
  // поднимается над клавиатурой (`ConfirmDialog`). У длинного названия в
  // поле видно начало, а не хвост: выделение «назад» и прокрутка к началу
  // (фокус сам уводит поле к концу текста).
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, input.value.length, "backward");
    input.scrollLeft = 0;
  }, []);

  function resetToStandard() {
    setValue(journal.officialName);
    inputRef.current?.focus();
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const response = await fetch("/api/settings/custom-names", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Только этот журнал: остальные названия организации сервер
        // оставляет как есть. Пусто — стандартное название.
        body: JSON.stringify({ journals: { [journal.code]: check.name ?? "" } }),
      });
      const data = (await response.json().catch(() => null)) as SaveResponse | null;
      if (!response.ok || !data?.names) {
        const fieldError = data?.errors?.find(
          (item) => item.kind === "journal" && item.key === journal.code
        );
        if (fieldError) {
          setServerError({ value, message: fieldError.message });
          inputRef.current?.focus();
          return;
        }
        throw new Error(data?.error || "Не удалось сохранить название");
      }
      applyNames(data.names);
      const saved = data.names.journals[journal.code] ?? null;
      toast.success(
        saved ? `Журнал переименован: «${saved}»` : "Вернули стандартное название журнала"
      );
      onClose();
      router.refresh();
    } catch (failure) {
      toast.error(humanizeFetchError(failure, "Не удалось сохранить название"));
    } finally {
      setSaving(false);
    }
  }

  let hint: string;
  if (isStandardValue) {
    hint = journal.customName
      ? "Сохраните — сотрудники снова увидят официальное название"
      : "Сейчас у журнала официальное название";
  } else {
    hint = "Так журнал увидят сотрудники";
  }

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={save}
      icon={PencilLine}
      title="Своё название журнала"
      confirmLabel="Сохранить"
      confirmDisabled={!canSave}
    >
      <div className="space-y-4" data-testid="journal-rename-dialog">
        <div>
          <label htmlFor={inputId} className="mb-2 block text-[12px] font-medium text-[#3c4053]">
            Название журнала в вашей организации
          </label>
          <Input
            id={inputId}
            ref={inputRef}
            type="text"
            // Без подсказок автозаполнения браузера поверх окна; Enter на
            // клавиатуре телефона подписан «Готово» — он и сохраняет.
            autoComplete="off"
            enterKeyHint="done"
            value={value}
            maxLength={CUSTOM_NAME_MAX_LENGTH}
            placeholder={journal.officialName}
            disabled={saving}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void save();
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={hintId}
            className={cn(
              INPUT_CLASS,
              error
                ? "border-[#e8a39b] focus-visible:border-[#d2453d] focus-visible:ring-[#d2453d]/15 aria-invalid:border-[#e8a39b] aria-invalid:ring-[#d2453d]/15"
                : "border-[#dcdfed] focus-visible:border-[#5566f6] focus-visible:ring-[#5566f6]/15"
            )}
          />
          <p
            id={hintId}
            aria-live="polite"
            className={cn("mt-1.5 text-[12px] leading-snug", error ? "text-[#a13a32]" : "text-[#6f7282]")}
          >
            {error ?? hint}
          </p>
        </div>

        {/* Предупреждение простыми словами и сброс — в одном месте. */}
        <div
          role="note"
          data-testid="journal-rename-warning"
          className="rounded-2xl border border-[#f3e1bd] bg-[#fff8eb] px-4 py-3.5"
        >
          <div className="flex gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#a16d32]" aria-hidden />
            <div className="min-w-0 text-[13px] leading-[1.55] text-[#3c4053]">
              <p>
                Это название увидят ваши сотрудники в кабинете, на QR и в Telegram. В печати и у
                проверяющего останется официальное:{" "}
                <span className="font-medium text-[#0b1024]">«{journal.officialName}»</span> — так
                требуют правила.
              </p>
              <button
                type="button"
                onClick={resetToStandard}
                disabled={saving || showsOfficial}
                title={showsOfficial ? "Уже стоит официальное название" : undefined}
                className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[#dcdfed] disabled:hover:bg-white"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Вернуть стандартное
              </button>
            </div>
          </div>
        </div>
      </div>
    </ConfirmDialog>
  );
}
