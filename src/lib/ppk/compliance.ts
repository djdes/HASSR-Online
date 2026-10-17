/**
 * Проверки «Готовность к проверке» по разделу «Производственный контроль».
 * Чистая логика: статусы блоков и наличие файла программы приходят снаружи.
 */
import { ppkBlock } from "./registry";
import type { PpkStatus } from "./status";

export type PpkComplianceInput = {
  /** Загружен ли файл программы (`KnowledgeDocument.kind = ppk`). */
  hasProgramFile: boolean;
  /** Прогресс раздела: готовых блоков и всего. */
  progress: { done: number; total: number };
  teamStatus: PpkStatus;
  controlPointsStatus: PpkStatus;
};

export type PpkComplianceCheck = {
  id: "ppk.program" | "ppk.team" | "ppk.ccp";
  title: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fixUrl: string;
  weight: number;
  score: number;
};

/** Порог прогресса раздела, с которого программа считается собранной. */
export const PPK_PROGRAM_PROGRESS_THRESHOLD = 0.6;

export function productionControlChecks(input: PpkComplianceInput): PpkComplianceCheck[] {
  const { done, total } = input.progress;
  const ratio = total > 0 ? done / total : 0;
  const percent = Math.round(ratio * 100);
  const programOk = input.hasProgramFile || ratio >= PPK_PROGRAM_PROGRESS_THRESHOLD;

  const byStatus = (status: PpkStatus): { status: "ok" | "warn" | "fail"; score: number } =>
    status === "done"
      ? { status: "ok", score: 1 }
      : status === "started"
        ? { status: "warn", score: 0.5 }
        : { status: "fail", score: 0 };

  const team = byStatus(input.teamStatus);
  const ccp = byStatus(input.controlPointsStatus);

  return [
    {
      id: "ppk.program",
      title: "Программа производственного контроля есть",
      status: programOk ? "ok" : percent > 0 ? "warn" : "fail",
      detail: input.hasProgramFile
        ? "Файл программы загружен."
        : programOk
          ? `Раздел заполнен на ${percent}% — программу можно собрать из блоков.`
          : `Файл не загружен, раздел заполнен на ${percent}%. Загрузите свою программу или заполните блоки раздела.`,
      fixUrl: "/production-control",
      weight: 5,
      score: programOk ? 1 : percent > 0 ? 0.5 : 0,
    },
    {
      id: "ppk.team",
      title: "Группа ХАССП собрана",
      status: team.status,
      detail:
        team.status === "ok"
          ? "В группе есть руководитель и не меньше двух человек."
          : "Нужна группа из двух и более человек с руководителем.",
      fixUrl: ppkBlock("team").href,
      weight: 5,
      score: team.score,
    },
    {
      id: "ppk.ccp",
      title: "Критические точки определены",
      status: ccp.status,
      detail:
        ccp.status === "ok"
          ? "Критические контрольные точки определены, ответственные назначены."
          : "Определите ККТ и ОПП по значимым опасностям и назначьте ответственных.",
      fixUrl: ppkBlock("control-points").href,
      weight: 5,
      score: ccp.score,
    },
  ];
}
