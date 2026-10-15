import { allChecklistQuestions, checklistDefinitionSchema, newChecklistQuestion, QUESTION_LABELS, QUESTION_TYPES, type ChecklistDefinition } from "./custom-checklists";

export function checklistPortableJson(title: string, definition: ChecklistDefinition) {
  return JSON.stringify({ format: "wesetup-checklist", version: 1, title, definition }, null, 2);
}
export function parseChecklistJson(text: string): { title: string; definition: ChecklistDefinition } {
  if (text.length > 2_000_000) throw new Error("JSON-файл до 2 МБ");
  let value; try { value = JSON.parse(text); } catch { throw new Error("Некорректный JSON"); }
  if (value?.format !== "wesetup-checklist" || value.version !== 1 || typeof value.title !== "string" || !value.title.trim() || value.title.length > 200) throw new Error("Выберите файл экспорта WeSetup версии 1");
  const parsed = checklistDefinitionSchema.safeParse(value.definition);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Проверьте структуру файла");
  return { title: value.title.trim(), definition: parsed.data };
}

const HEADERS = ["Раздел", "Категория", "Вопрос", "Тип", "Обязательный", "Вес", "Описание", "Варианты через |", "Минимум", "Максимум"];
export async function checklistXlsxSample(): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default; const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Чек-лист"); sheet.addRow(HEADERS);
  sheet.addRow(["Безопасность", "Помещение", "Помещение чистое?", "yes_no", "Да", 1, "Проверьте стены и пол", "", 0, 10]);
  sheet.addRow(["Безопасность", "Хранение", "Температура", "number", "Да", 1, "В градусах Цельсия", "", -30, 40]);
  sheet.addRow(["Безопасность", "Хранение", "Состояние упаковки", "choice", "Да", 1, "", "Целая|Повреждена", 0, 10]);
  sheet.columns = HEADERS.map((name, index) => ({ header: name, width: index === 2 || index === 6 ? 40 : 23 }));
  const help = book.addWorksheet("Инструкция");
  help.addRow(["Типы вопросов", ...QUESTION_TYPES]);
  help.addRow(["Обязательный: Да или Нет. Не более 400 вопросов. Формулы и объединённые ячейки запрещены."]);
  help.addRow(["Условия, баллы вариантов и файлы настраиваются после импорта. Для переноса всех настроек используйте JSON."]);
  return await book.xlsx.writeBuffer() as ArrayBuffer;
}
export async function parseChecklistXlsx(buffer: ArrayBuffer, uid: () => string): Promise<ChecklistDefinition> {
  if (buffer.byteLength > 1_000_000) throw new Error("Excel-файл до 1 МБ");
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer); let expanded = 0;
  const files = Object.values(zip.files);
  if (files.length > 100) throw new Error("Слишком сложный Excel-файл. Используйте образец.");
  for (const file of files) { const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0; expanded += size; if (expanded > 8_000_000) throw new Error("Слишком большой объём Excel-файла"); }
  const ExcelJS = (await import("exceljs")).default; const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const sheet = book.getWorksheet("Чек-лист") ?? book.worksheets[0];
  if (!sheet || sheet.rowCount > 401 || sheet.columnCount > 10) throw new Error("Используйте образец: до 400 вопросов и 10 столбцов");
  if (book.worksheets.some(s => s !== sheet && s.name !== "Инструкция" && s.actualRowCount > 0)) throw new Error("Обнаружены дополнительные листы с данными. Перенесите вопросы на один лист.");
  if (Object.keys(sheet.model.merges ?? {}).length) throw new Error("Уберите объединение ячеек");
  const value = (row: number, column: number): string => {
    const cell = sheet.getCell(row, column);
    if (cell.type === ExcelJS.ValueType.Formula || cell.formula) throw new Error(`Строка ${row}: замените формулу значением`);
    if (cell.value && typeof cell.value === "object") throw new Error(`Строка ${row}: используйте простой текст или число`);
    return String(cell.value ?? "").trim();
  };
  if (HEADERS.some((header, i) => value(1, i + 1) !== header)) throw new Error("Заголовки не соответствуют образцу");
  const definition: ChecklistDefinition = { description: "", sections: [] };
  for (let row = 2; row <= sheet.rowCount; row++) {
    const cells = HEADERS.map((_, i) => value(row, i + 1)); if (cells.every(cell => !cell)) continue;
    const [sectionTitle, categoryTitle, title, type, required, weight, description, variants, min, max] = cells;
    if (!sectionTitle || !categoryTitle || !title || !QUESTION_TYPES.includes(type as typeof QUESTION_TYPES[number]) || !["Да", "Нет"].includes(required)) throw new Error(`Строка ${row}: заполните раздел, категорию, вопрос, тип и обязательность по образцу`);
    for (const numeric of [weight, min, max]) if (numeric && !Number.isFinite(Number(numeric.replace(",", ".")))) throw new Error(`Строка ${row}: некорректное число`);
    let section = definition.sections.find(s => s.title === sectionTitle);
    if (!section) { section = { id: uid(), title: sectionTitle, active: true, categories: [] }; definition.sections.push(section); }
    let category = section.categories.find(c => c.title === categoryTitle);
    if (!category) { category = { id: uid(), title: categoryTitle, active: true, questions: [] }; section.categories.push(category); }
    category.questions.push({ ...newChecklistQuestion(uid()), title, type: type as typeof QUESTION_TYPES[number], description, required: required === "Да", weight: weight ? Number(weight.replace(",", ".")) : 1, min: min ? Number(min.replace(",", ".")) : 0, max: max ? Number(max.replace(",", ".")) : 10, options: variants ? variants.split("|").map(label => ({ value: uid(), label: label.trim(), score: 1 })) : [] });
  }
  const result = checklistDefinitionSchema.safeParse(definition);
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Проверьте вопросы");
  if (allChecklistQuestions(result.data).length === 0) throw new Error("В файле нет вопросов");
  return result.data;
}
export function checklistTypeSummary(definition: ChecklistDefinition): string {
  const questions = allChecklistQuestions(definition);
  return `${definition.sections.length} разделов, ${questions.length} вопросов: ${[...new Set(questions.map(q => QUESTION_LABELS[q.type]))].join(", ")}`;
}
