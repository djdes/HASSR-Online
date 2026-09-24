"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type SeedSummary = {
  created: { code: string; name: string; nodeCount: number }[];
  skippedExisting: { code: string; name: string; existingNodeCount: number }[];
  skippedNoFields: { code: string; name: string }[];
  exempt?: { code: string; name: string }[];
};

/**
 * Bulk-seed pipeline-шаблонов для всех журналов организации одним кликом.
 * Эквивалент: пройти все журналы каталога и нажать «Создать из колонок» в каждом.
 *
 * Skipped (нечего сидить — у журнала нет полей в JournalTemplate.fields)
 * приходят в Notifications, чтобы менеджер увидел, что нужно настроить руками.
 */
export function SeedAllPipelinesButton({
  totalActiveTrees,
  totalJournals,
}: {
  totalActiveTrees: number;
  totalJournals: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSeed() {
    setBusy(true);
    try {
      const response = await fetch(
        "/api/settings/journal-pipelines/seed-all",
        { method: "POST" }
      );
      const data = (await response.json().catch(() => null)) as
        | { summary: SeedSummary }
        | null;
      if (!response.ok || !data) {
        toast.error("Не удалось создать pipeline для всех журналов");
        return;
      }
      const { created, skippedExisting, skippedNoFields } = data.summary;
      const exempt = data.summary.exempt ?? [];
      const total =
        created.length +
        skippedExisting.length +
        skippedNoFields.length +
        exempt.length;

      // Полная сводка в одном toast'е. Exempt — отдельной фразой,
      // т.к. это не «требует настройки», а «не нужен pipeline-tree».
      const parts: string[] = [];
      if (created.length > 0) parts.push(`создано: ${created.length}`);
      if (skippedExisting.length > 0)
        parts.push(`уже было: ${skippedExisting.length}`);
      if (exempt.length > 0)
        parts.push(`со своим адаптером: ${exempt.length}`);
      if (skippedNoFields.length > 0)
        parts.push(`нужна ручная настройка: ${skippedNoFields.length}`);

      const summary = parts.join(" · ") || "изменений нет";
      const heading = `Журналов: ${total} · ${summary}`;

      if (skippedNoFields.length > 0) {
        toast.warning(
          heading + ". См. уведомления — там список журналов для ручной настройки."
        );
      } else if (created.length > 0) {
        toast.success(heading);
      } else {
        toast.info(heading);
      }
      setConfirmOpen(false);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
      >
        <Sparkles className="size-4" />
        Создать pipeline для всех журналов
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        variant="default"
        title="Создать pipeline для всех журналов?"
        description={
          <span>
            Для каждого из <strong>{totalJournals}</strong> журналов
            (где это возможно) будет создано дерево pinned-узлов по
            колонкам. Уже настроенные журналы (
            <strong>{totalActiveTrees}</strong>) не пересоздаются —
            твоя работа сохранится.
          </span>
        }
        bullets={[
          {
            label:
              "Сотрудники сразу смогут заполнять реальные колонки журнала через TasksFlow — без ручной настройки.",
          },
          {
            label:
              "Где у журнала нет описанных полей — пропускаем и присылаем в уведомления для ручной настройки.",
            tone: "info",
          },
          {
            label:
              "Ничего не удаляется. Только создаётся базовый pipeline там, где его ещё нет.",
            tone: "info",
          },
        ]}
        confirmLabel={busy ? "Создаю…" : "Создать"}
        onConfirm={handleSeed}
      />
    </>
  );
}
