"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

/**
 * Индикатор «журнал включён / отключён» справа от заголовка журнала.
 *
 * Зачем: включить или убрать журнал можно было только уйдя в «Настройки →
 * Набор журналов» и найдя его там среди тридцати пяти. А решение обычно
 * принимают ровно тогда, когда журнал открыли и поняли, что он этой кухне
 * не нужен (или наоборот — нужен, а он серый).
 *
 * Выключение спрашивает подтверждение, включение — нет: вернуть журнал
 * безопасно, ничего не теряется. Подтверждение рисует `ConfirmDialog` —
 * он сам показывается окном на компьютере и шторкой снизу на телефоне.
 *
 * Если прав на настройку нет, индикатор остаётся, но не нажимается: знать
 * статус журнала полезно и сотруднику, а менять его — дело руководителя.
 */
export function JournalEnabledIndicator({
  code,
  name,
  disabled,
  disabledCodes,
  canToggle,
  className = "",
  size = "md",
}: {
  code: string;
  name: string;
  disabled: boolean;
  /** Полный список отключённых кодов: PATCH ждёт набор, а не дельту. */
  disabledCodes: string[];
  canToggle: boolean;
  className?: string;
  /** `sm` — когда индикатор стоит вплотную к заголовку журнала. */
  size?: "sm" | "md";
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

  const label = disabled ? "Отключён" : "Включён";
  const Icon = disabled ? EyeOff : Eye;

  const pill = (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-2xl font-medium transition-colors duration-150",
        size === "sm" ? "h-9 px-2.5 text-[12.5px]" : "h-10 px-3 text-[13px]",
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
        onClick={() => (disabled ? void enable() : setConfirmOpen(true))}
        title={disabled ? "Включить журнал" : "Отключить журнал"}
        aria-label={
          disabled ? `Включить журнал «${name}»` : `Отключить журнал «${name}»`
        }
        className="disabled:opacity-60"
      >
        {pill}
      </button>

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
    </>
  );
}

/**
 * Контекст раздела журнала: страница знает набор отключённых кодов и
 * права, а нарисовать индикатор нужно внутри общей шапки документных
 * журналов (`JournalTopBar`), через которую эти данные не проходят.
 *
 * Без провайдера слот не рисует ничего — так Mini App, который
 * переиспользует те же клиенты, остаётся без лишней кнопки.
 */
type JournalToggleValue = {
  code: string;
  name: string;
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

/** Индикатор рядом с заголовком журнала. Сюда попадают только включённые. */
export function JournalEnabledIndicatorSlot() {
  const value = useContext(JournalToggleContext);
  if (!value) return null;
  return (
    <JournalEnabledIndicator
      code={value.code}
      name={value.name}
      disabled={false}
      disabledCodes={value.disabledCodes}
      canToggle={value.canToggle}
      size="sm"
    />
  );
}
