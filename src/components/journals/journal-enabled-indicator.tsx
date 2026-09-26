"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

/**
 * «Журнал включён / отключён» прямо на странице журнала.
 *
 * Зачем: включить или убрать журнал можно было только уйдя в «Настройки →
 * Набор журналов» и найдя его там среди тридцати пяти. А решение обычно
 * принимают ровно тогда, когда журнал открыли и поняли, что он этой кухне
 * не нужен (или наоборот — нужен, а он серый).
 *
 * Два вида, поведение одно (`useJournalEnabledToggle`):
 *   • `JournalEnabledSwitch` — маленький переключатель «Включён» в строку
 *     с названием журнала (кнопки заголовка, `JournalTitleControls`);
 *   • `JournalEnabledIndicator` — пилюля на заглушке отключённого журнала.
 *
 * Выключение спрашивает подтверждение, включение — нет: вернуть журнал
 * безопасно, ничего не теряется. Подтверждение рисует `ConfirmDialog` —
 * он сам показывается окном на компьютере и шторкой снизу на телефоне.
 *
 * Если прав на настройку нет, статус остаётся, но не нажимается: знать
 * статус журнала полезно и сотруднику, а менять его — дело руководителя.
 */
function useJournalEnabledToggle({
  code,
  name,
  disabledCodes,
}: {
  code: string;
  name: string;
  /** Полный список отключённых кодов: PATCH ждёт набор, а не дельту. */
  disabledCodes: string[];
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function patch(next: string[], successText: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/journals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabledCodes: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Не удалось сохранить настройку");
      }
      toast.success(successText);
      router.refresh();
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось сохранить настройку"));
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  function enable() {
    return patch(
      disabledCodes.filter((item) => item !== code),
      `Журнал включён: ${name}`,
    );
  }

  function turnOff() {
    return patch(Array.from(new Set([...disabledCodes, code])), `Журнал отключён: ${name}`);
  }

  const confirmDialog = (
    <ConfirmDialog
      open={confirmOpen}
      onClose={() => setConfirmOpen(false)}
      onConfirm={turnOff}
      variant="warn"
      icon={EyeOff}
      title="Отключить журнал?"
      description={`«${name}» перестанет считаться обязательным для вашей организации.`}
      bullets={[
        { label: "Исчезнет с дашборда и у сотрудников в приложении", tone: "warn" },
        { label: "Задачи по нему больше не создаются" },
        { label: "Записи и документы сохраняются — ничего не удаляется" },
        { label: "Включить обратно можно здесь же или в «Настройки → Набор журналов»", tone: "info" },
      ]}
      confirmLabel="Отключить"
    />
  );

  return { busy, enable, askTurnOff: () => setConfirmOpen(true), confirmDialog };
}

/** Пилюля «Включён / Отключён» — на заглушке отключённого журнала. */
export function JournalEnabledIndicator({
  code,
  name,
  disabled,
  disabledCodes,
  canToggle,
  className = "",
}: {
  code: string;
  name: string;
  disabled: boolean;
  /** Полный список отключённых кодов: PATCH ждёт набор, а не дельту. */
  disabledCodes: string[];
  canToggle: boolean;
  className?: string;
}) {
  const { busy, enable, askTurnOff, confirmDialog } = useJournalEnabledToggle({
    code,
    name,
    disabledCodes,
  });

  const label = disabled ? "Отключён" : "Включён";
  const Icon = disabled ? EyeOff : Eye;

  const pill = (
    <span
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-[13px] font-medium transition-colors duration-150",
        disabled
          ? "bg-[#eef0f6] text-[#6f7282]"
          : "bg-[#ecfdf5] text-[#116b2a]",
        canToggle &&
          (disabled
            ? "hover:bg-[#e4e7f0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            : "hover:bg-[#d9f7e7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"),
        className,
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      {label}
      {canToggle ? (
        <span className={cn("text-[12px] font-normal", disabled ? "text-[#9b9fb3]" : "text-[#116b2a]/70")}>
          · {disabled ? "включить" : "отключить"}
        </span>
      ) : null}
    </span>
  );

  if (!canToggle) return pill;

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => (disabled ? void enable() : askTurnOff())}
        title={disabled ? "Включить журнал" : "Отключить журнал"}
        aria-label={
          disabled ? `Включить журнал «${name}»` : `Отключить журнал «${name}»`
        }
        className="disabled:opacity-60"
      >
        {pill}
      </button>
      {confirmDialog}
    </>
  );
}

/**
 * Компактный «Включён» в строку с названием журнала: маленький
 * переключатель с подписью. Раньше здесь стояла пилюля «Включён ·
 * отключить», и на телефоне она занимала целую строку под заголовком
 * (владелец, 2026-09-26: «кнопку включить/отключить как-то компактнее»).
 *
 * Сюда попадают только включённые журналы: отключённый показывает
 * заглушку со своей кнопкой «Включить». Выключение — то же
 * подтверждение, что и раньше; переключатель встаёт в «выкл.» только
 * вместе со страницей, после ответа сервера.
 *
 * Без прав — просто статус «● Включён», не притворяясь переключателем.
 */
export function JournalEnabledSwitch({
  code,
  name,
  disabledCodes,
  canToggle,
}: {
  code: string;
  name: string;
  disabledCodes: string[];
  canToggle: boolean;
}) {
  const { busy, askTurnOff, confirmDialog } = useJournalEnabledToggle({
    code,
    name,
    disabledCodes,
  });

  if (!canToggle) {
    return (
      <span
        data-journal-enabled="on"
        title="Журнал включён для вашей организации"
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-[#116b2a]"
      >
        <span aria-hidden className="size-2 rounded-full bg-[#22c55e]" />
        Включён
      </span>
    );
  }

  return (
    <>
      <label
        data-journal-enabled="on"
        title="Отключить журнал"
        className={cn(
          "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-[#3c4053]",
          busy && "cursor-progress",
        )}
      >
        {/* Стоит в строке заголовка: журнал уже назван, поэтому имя
            короткое. Состояние («вкл.») читает сам переключатель, а
            подпись рядом — для глаз. */}
        <Switch
          size="sm"
          checked
          disabled={busy}
          onCheckedChange={(checked) => {
            if (!checked) askTurnOff();
          }}
          aria-label="Вести журнал"
        />
        {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin text-[#6f7282]" /> : null}
        <span aria-hidden>Включён</span>
      </label>
      {confirmDialog}
    </>
  );
}

/**
 * Контекст раздела журнала: страница знает набор отключённых кодов и
 * права, а нарисовать переключатель нужно в строке с названием журнала —
 * внутри клиентов журналов, через которые эти данные не проходят.
 *
 * Без провайдера (`useJournalToggle()` → null) переключателя нет — там,
 * где клиенты журналов рисуются вне страницы журнала. Название журнала
 * для подтверждения и уведомлений берётся из `CustomNamesProvider`:
 * после переименования оно уже новое.
 */
type JournalToggleValue = {
  code: string;
  disabledCodes: string[];
  canToggle: boolean;
};

const JournalToggleContext = createContext<JournalToggleValue | null>(null);

export function JournalToggleProvider({
  value,
  children,
}: {
  value: JournalToggleValue;
  children: React.ReactNode;
}) {
  return (
    <JournalToggleContext.Provider value={value}>{children}</JournalToggleContext.Provider>
  );
}

/** Данные переключателя «Включён» открытого журнала или null. */
export function useJournalToggle(): JournalToggleValue | null {
  return useContext(JournalToggleContext);
}
