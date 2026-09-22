import type { BrakerageRowEdit } from "@/lib/brakerage-qr";
import type { BrakerageQrRole } from "@/lib/brakerage-qr-role";
import type { BrakerageSignEntry } from "@/lib/brakerage-signatures";

/**
 * Разбор формы QR-списка бракеража с правами по ролям (решение владельца):
 *   • зав. производством (редактор) — блюдо, время изготовления, выход, оценка;
 *   • член комиссии — только оценка и время бракеража, а «Допущено» /
 *     «Не допущено» (по умолчанию не выбрано) — это его подпись.
 * Поля, которых роль не может менять, игнорируются, даже если пришли.
 * Чистый модуль: без базы, покрыт тестами.
 */
type Row = {
  documentId: string;
  rowId: string;
  name: string;
  time: string;
  grade: string;
  portionWeight: string;
  rejectionTime: string;
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function cleanTime(value: string | undefined): string | null {
  const match = TIME_RE.exec((value ?? "").trim());
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

function push<T>(map: Map<string, T[]>, key: string, item: T) {
  const list = map.get(key) ?? [];
  list.push(item);
  map.set(key, list);
}

export function parseBrakerageListPost(
  get: (name: string) => string | undefined,
  rows: readonly Row[],
  role: BrakerageQrRole,
  options: { isFinished: boolean; gradeValues: readonly string[] }
): { editsByDoc: Map<string, BrakerageRowEdit[]>; signsByDoc: Map<string, BrakerageSignEntry[]> } {
  const editsByDoc = new Map<string, BrakerageRowEdit[]>();
  const signsByDoc = new Map<string, BrakerageSignEntry[]>();
  const validGrade = (value: string | undefined) => (value && options.gradeValues.includes(value) ? value : null);

  for (const row of rows) {
    const id = row.rowId;
    const admission = get(`adm:${id}`);
    const signs = role.evaluator && (admission === "yes" || admission === "no");
    const grade = validGrade(get(`grade:${id}`));

    if (role.editor) {
      const edit: BrakerageRowEdit = { rowId: id };
      const name = (get(`name:${id}`) ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (name && name !== row.name) edit.name = name;
      const time = cleanTime(get(`time:${id}`));
      if (time && time !== row.time) edit.time = time;
      if (options.isFinished) {
        const weight = get(`w:${id}`);
        if (weight !== undefined && weight.trim().slice(0, 20) !== row.portionWeight) edit.portionWeight = weight.trim().slice(0, 20);
      }
      // Оценка редактора — правкой; если он же подписывает — оценка уйдёт с подписью.
      if (grade && grade !== row.grade && !signs) edit.grade = grade;
      if (Object.keys(edit).length > 1) push(editsByDoc, row.documentId, edit);
    }

    if (signs) {
      const entry: BrakerageSignEntry = { rowId: id };
      if (grade) entry.grade = grade;
      entry.releaseAllowed = admission as "yes" | "no";
      const rejection = cleanTime(get(`rej:${id}`));
      if (rejection && rejection !== row.rejectionTime) entry.rejectionTime = rejection;
      push(signsByDoc, row.documentId, entry);
    }
  }
  return { editsByDoc, signsByDoc };
}
