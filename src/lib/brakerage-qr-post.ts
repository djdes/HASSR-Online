import type { BrakerageRowEdit } from "@/lib/brakerage-qr";
import type { BrakerageQrRole } from "@/lib/brakerage-qr-role";
import type { BrakerageSignEntry } from "@/lib/brakerage-signatures";
import { brakerageCommentRequiredFor, parseBrakerageTimeDigits } from "@/lib/brakerage-assessment";

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
  note?: string;
};

function cleanTime(value: string | undefined): string | null {
  return parseBrakerageTimeDigits(value ?? "");
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
): { editsByDoc: Map<string, BrakerageRowEdit[]>; signsByDoc: Map<string, BrakerageSignEntry[]>; error?: string } {
  const editsByDoc = new Map<string, BrakerageRowEdit[]>();
  const signsByDoc = new Map<string, BrakerageSignEntry[]>();
  const validGrade = (value: string | undefined) => (value && options.gradeValues.includes(value) ? value : null);
  // Скоропорт: комментарий нужен только к позиции, не допущенной к реализации.
  const commentRequired = (grade: string) => brakerageCommentRequiredFor(options.isFinished, grade);
  const commentError = (name: string) =>
    options.isFinished ? `Добавьте комментарий к оценке блюда «${name}»` : `Добавьте комментарий к оценке позиции «${name}»`;

  for (const row of rows) {
    const id = row.rowId;
    const grade = validGrade(get(`grade:${id}`));
    const signs = role.evaluator && Boolean(grade);
    if (role.evaluator && get(`grade:${id}`) && !grade) return { editsByDoc: new Map(), signsByDoc: new Map(), error: "Выберите оценку из списка" };
    for (const key of role.editor ? [`time:${id}`, ...(signs ? [`rej:${id}`] : [])] : signs ? [`rej:${id}`] : []) {
      const raw = get(key);
      if (raw && !cleanTime(raw)) return { editsByDoc: new Map(), signsByDoc: new Map(), error: "Введите время четырьмя цифрами: например, 1430" };
    }

    if (role.editor) {
      const edit: BrakerageRowEdit = { rowId: id };
      const note = get(`note:${id}`);
      if (note !== undefined && note.trim().slice(0, 500) !== (row.note ?? "")) {
        edit.note = note.trim().slice(0, 500);
        if (commentRequired(grade || row.grade) && !edit.note) return { editsByDoc: new Map(), signsByDoc: new Map(), error: commentError(row.name) };
      }
      const name = (get(`name:${id}`) ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (name && name !== row.name) edit.name = name;
      const time = cleanTime(get(`time:${id}`));
      if (time && time !== row.time) edit.time = time;
      if (options.isFinished) {
        const weight = get(`w:${id}`);
        if (weight !== undefined && weight.trim().slice(0, 20) !== row.portionWeight) edit.portionWeight = weight.trim().slice(0, 20);
      }
      // Оценка редактора — правкой; если он же подписывает — оценка уйдёт с подписью.
      if (grade && grade !== row.grade && !signs) {
        const note = (get(`note:${id}`) ?? "").trim().slice(0, 500);
        if (commentRequired(grade) && !note) return { editsByDoc: new Map(), signsByDoc: new Map(), error: commentError(row.name) };
        edit.grade = grade;
        edit.note = note;
      }
      if (Object.keys(edit).length > 1) push(editsByDoc, row.documentId, edit);
    }

    if (signs) {
      const entry: BrakerageSignEntry = { rowId: id };
      if (grade) entry.grade = grade;
      const note = (get(`note:${id}`) ?? "").trim().slice(0, 500);
      if (grade && commentRequired(grade) && !note) return { editsByDoc: new Map(), signsByDoc: new Map(), error: commentError(row.name) };
      entry.note = note;
      const rejection = cleanTime(get(`rej:${id}`));
      if (rejection && rejection !== row.rejectionTime) entry.rejectionTime = get(`rej:${id}`);
      push(signsByDoc, row.documentId, entry);
    }
  }
  return { editsByDoc, signsByDoc };
}
