"use client";

import { useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type Props = {
  code: string;
  /** false — только просмотр: настройки общие для всех компаний. */
  canEdit?: boolean;
  initial: {
    taskScope: "personal" | "shared";
    allowNoEvents: boolean;
    noEventsReasons: string[];
    allowFreeTextReason: boolean;
  };
};

export function JournalScopeClient({ code, initial, canEdit = true }: Props) {
  const [taskScope, setTaskScope] = useState<"personal" | "shared">(
    initial.taskScope
  );
  const [allowNoEvents, setAllowNoEvents] = useState(initial.allowNoEvents);
  const [reasons, setReasons] = useState<string[]>(initial.noEventsReasons);
  const [allowFreeText, setAllowFreeText] = useState(
    initial.allowFreeTextReason
  );
  const [newReason, setNewReason] = useState("");
  const [savingState, setSaving] = useState(false);
  // Без права правки все переключатели и кнопки неактивны — как во время
  // сохранения.
  const saving = savingState || !canEdit;

  const dirty =
    taskScope !== initial.taskScope ||
    allowNoEvents !== initial.allowNoEvents ||
    allowFreeText !== initial.allowFreeTextReason ||
    JSON.stringify(reasons) !== JSON.stringify(initial.noEventsReasons);

  function addReason() {
    const trimmed = newReason.trim();
    if (!trimmed) return;
    if (reasons.includes(trimmed)) {
      toast.error("Эта причина уже в списке");
      return;
    }
    setReasons([...reasons, trimmed]);
    setNewReason("");
  }

  function removeReason(idx: number) {
    setReasons(reasons.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(
        `/api/settings/journal-scope/${encodeURIComponent(code)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskScope,
            allowNoEvents,
            noEventsReasons: reasons,
            allowFreeTextReason: allowFreeText,
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось сохранить");
      }
      toast.success("Настройки сохранены");
      // Update initial-snapshot in-place to clear dirty flag
      initial.taskScope = taskScope;
      initial.allowNoEvents = allowNoEvents;
      initial.noEventsReasons = [...reasons];
      initial.allowFreeTextReason = allowFreeText;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {!canEdit ? (
        <div className="rounded-2xl border border-[#ffe7c0] bg-[#fff8eb] px-4 py-3 text-[13px] leading-relaxed text-[#7a4a00]">
          Эти настройки общие для всех компаний, их меняет администратор
          платформы. Здесь можно посмотреть, как они заданы сейчас.
        </div>
      ) : null}
      {/* Task scope */}
      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          Тип задачи
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ScopeOption
            value="personal"
            disabled={saving}
            current={taskScope}
            onPick={setTaskScope}
            title="Личная задача"
            description="Закрепляется за конкретным сотрудником на смену. Закрывается одним заполнением. Подходит для гигиены, проверки здоровья, уборки матрицы."
          />
          <ScopeOption
            value="shared"
            disabled={saving}
            current={taskScope}
            onPick={setTaskScope}
            title="Общая задача смены"
            description="Видна всем подходящим по роли. Можно дописывать события несколько раз за день. Подходит для приёмок, бракеража, жалоб, поломок."
          />
        </div>
      </div>

      {/* Allow no-events */}
      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[15px] font-semibold text-[#0b1024]">
              Кнопка «Не требуется сегодня»
            </div>
            <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-[#6f7282]">
              Сотрудник может закрыть журнал без заполнения, указав
              причину (например, «Поставок нет»). Compliance в дашборде
              станет зелёным. Отключите для критичных журналов
              (например, проверка здоровья — нельзя пропускать).
            </p>
          </div>
          <Switch
            checked={allowNoEvents}
            onCheckedChange={setAllowNoEvents}
            disabled={saving}
          />
        </div>
      </div>

      {/* Reasons */}
      {allowNoEvents ? (
        <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[15px] font-semibold text-[#0b1024]">
                Список причин
              </div>
              <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-[#6f7282]">
                Сотрудник выбирает одну из этих причин при нажатии «Не
                требуется сегодня».
              </p>
            </div>
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-[13px] text-[#3a3f55]">
              <Switch
                checked={allowFreeText}
                onCheckedChange={setAllowFreeText}
                disabled={saving}
              />
              <span>Свой текст</span>
            </label>
          </div>

          <div className="mt-4 space-y-2">
            {reasons.map((reason, idx) => (
              <div
                key={`${reason}-${idx}`}
                className="flex items-center gap-2 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-3 py-2"
              >
                <span className="flex-1 text-[14px] text-[#0b1024]">
                  {reason}
                </span>
                <button
                  type="button"
                  onClick={() => removeReason(idx)}
                  disabled={saving}
                  className="rounded-lg p-1.5 text-[#a13a32] hover:bg-[#fff4f2]"
                  aria-label="Удалить"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}

            {reasons.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-6 text-center text-[13px] text-[#6f7282]">
                Список пуст. Добавьте хотя бы одну причину или включите
                «Свой текст».
              </div>
            ) : null}

            <div className="flex items-center gap-2 pt-1">
              <Input
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addReason();
                  }
                }}
                placeholder="Например: Поставщик не приехал"
                maxLength={120}
                disabled={saving}
                className="rounded-xl"
              />
              <Button
                type="button"
                onClick={addReason}
                disabled={saving || !newReason.trim()}
                className="h-10 rounded-xl bg-[#5566f6] px-4 text-[13px] text-white hover:bg-[#4a5bf0]"
              >
                <Plus className="mr-1 size-4" />
                Добавить
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Save bar */}
      {canEdit ? (
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-[#ececf4] bg-white/95 px-4 py-3 backdrop-blur-sm sm:mx-0 sm:rounded-2xl sm:border">
        {dirty ? (
          <span className="text-[12px] text-[#a13a32]">
            Есть несохранённые изменения
          </span>
        ) : (
          <span className="text-[12px] text-[#6f7282]">
            Все изменения сохранены
          </span>
        )}
        <Button
          type="button"
          onClick={save}
          disabled={savingState || !dirty}
          className="h-10 rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-50"
        >
          {savingState ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Save className="mr-2 size-4" />
          )}
          Сохранить
        </Button>
      </div>
      ) : null}
    </div>
  );
}

function ScopeOption({
  value,
  current,
  onPick,
  title,
  description,
  disabled,
}: {
  value: "personal" | "shared";
  current: "personal" | "shared";
  onPick: (v: "personal" | "shared") => void;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(value)}
      className={`flex flex-col items-start gap-1.5 rounded-2xl border p-4 text-left transition-all ${
        active
          ? "border-[#5566f6] bg-[#f5f6ff] shadow-[0_0_0_3px_rgba(85,102,246,0.15)]"
          : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40"
      }`}
    >
      <span
        className={`text-[14px] font-semibold ${
          active ? "text-[#3848c7]" : "text-[#0b1024]"
        }`}
      >
        {title}
      </span>
      <span className="text-[12px] leading-snug text-[#6f7282]">
        {description}
      </span>
    </button>
  );
}
