import { jsPDF } from "jspdf";
import { registerUnicodeFont } from "./closing-documents/pdf-font";
import { visibleChecklistQuestions, QUESTION_LABELS, type ChecklistDefinition, type ChecklistAnswers, type ChecklistQuestion } from "./custom-checklists";
import type { ChecklistEvidence } from "./custom-checklist-rules";
import { checklistQuestionResult, evaluateChecklistRun } from "./custom-checklist-runtime";

export function checklistAnswerText(question: ChecklistQuestion, value: unknown): string {
  if(value === undefined || value === "" || (Array.isArray(value) && !value.length)) return "—";
  if(question.type === "yes_no") return (question.labels ?? {yes:"Да",no:"Нет",na:"Не применимо"})[value as "yes"|"no"|"na"] ?? String(value);
  if(question.type === "checkbox") return value ? "Да" : "Нет";
  if(["photo","signature"].includes(question.type)) return question.type === "signature" ? "Подпись приложена" : "Фотографии приложены";
  if(question.type === "choice" || question.type === "multi") return (Array.isArray(value) ? value : [value]).map(item => question.options.find(o => o.value === item)?.label ?? String(item)).join(", ");
  if(question.type === "datetime" && typeof value === "string") return `${value.slice(8,10)}-${value.slice(5,7)}-${value.slice(0,4)}, ${value.slice(11,16)}`;
  return `${value}${question.unit ? ` ${question.unit}` : ""}`;
}
type PdfAttachment = { id:string; fileName:string; mimeType:string; sizeBytes:number };
export async function generateChecklistPdf({title,definition,answers,evidence = {},meta = [],attachments = [],imageBytes}: {
  title:string; definition:ChecklistDefinition; answers?:ChecklistAnswers; evidence?:ChecklistEvidence; meta?:string[]; attachments?:PdfAttachment[]; imageBytes?: (id:string) => Promise<Uint8Array | null>;
}): Promise<Uint8Array> {
  const doc = new jsPDF({compress:true}); const font = registerUnicodeFont(doc); doc.setFont(font); let y = 18; let imageBudget = 20*1024*1024;
  const line = (text:string,size=10) => {
    doc.setFontSize(size); const lines = doc.splitTextToSize(text || " ",174) as string[];
    for(const textLine of lines) {if(y > 278){doc.addPage();doc.setFont(font);y=18;}doc.text(textLine,18,y);y+=size*0.48;}
    y+=2;
  };
  const image = (bytes:Uint8Array|string,mime:string) => {
    try { const props = doc.getImageProperties(bytes); const width = Math.min(150,props.width*0.2646); const height = Math.min(75,width*props.height/props.width); const fitWidth = height*props.width/props.height;
      if(y+height>278){doc.addPage();doc.setFont(font);y=18;}
      doc.addImage(bytes,mime === "image/jpeg" ? "JPEG" : "PNG",18,y,fitWidth,height);y+=height+4;
    } catch {line("Предпросмотр изображения недоступен; используйте ссылку на файл.",9);}
  };
  const file = async (ref:string) => {
    const item = attachments.find(a => a.id === ref.slice(5)); if(!item) return;
    line(`Файл: ${item.fileName}`,9);
    if(y>274){doc.addPage();doc.setFont(font);y=18;}
    doc.setFontSize(9);doc.setTextColor(56,72,199);doc.textWithLink("Открыть в WeSetup (требуется вход)",18,y,{url:`https://wesetup.ru/api/checklists/attachments/${item.id}`});doc.setTextColor(0);y+=7;
    if(imageBytes && ["image/png","image/jpeg"].includes(item.mimeType) && imageBudget >= item.sizeBytes) {const bytes=await imageBytes(item.id);if(bytes){imageBudget-=bytes.length;image(bytes,item.mimeType);}}
  };
  line(title,16);for(const text of meta)line(text,10);
  line(answers ? "Отчёт о проверке" : "Шаблон чек-листа",12);
  if(definition.description)line(definition.description);
  if(answers){const result=evaluateChecklistRun(definition,answers);line(`Результат: ${result.score.earned} / ${result.score.possible} баллов. Нарушений: ${result.violations.length}.`);if(result.stopped)line(`Досрочное завершение: ${result.critical.map(q=>q.title).join(", ")}`);if(result.zeroScore)line("Результат обнулён по критическому нарушению.");}
  const visible = answers ? new Set(visibleChecklistQuestions(definition,answers).map(q=>q.id)) : null;let number=0;
  for(const section of definition.sections.filter(s=>s.active)) {
    if(visible && !section.categories.some(c=>c.questions.some(q=>visible.has(q.id))))continue;
    line(section.title,14);
    for(const category of section.categories.filter(c=>c.active)){
      const questions = category.questions.filter(q=>q.active && (!visible || visible.has(q.id)));if(!questions.length)continue;
      line(category.title,12);
      for(const question of questions){number++;line(`${definition.numbering !== false ? `${number}. ` : ""}${question.title}${question.required ? " *" : ""}`,11);if(question.description)line(question.description,9);
        for(const ref of question.references ?? [])await file(ref);
        if(!answers){line(`${QUESTION_LABELS[question.type]} · вес ${question.weight}${question.unit ? ` · ${question.unit}` : ""}`,9);if(question.options.length)line(question.options.map(o=>o.label).join(" / "),9);line("Ответ: __________________________________________________");continue;}
        const value=answers[question.id];if(question.type!=="info")line(`Ответ: ${checklistAnswerText(question,value)}`);
        if(question.type==="photo")for(const ref of Array.isArray(value)?value:typeof value==="string"?[value]:[]) {if(ref.startsWith("file:"))await file(ref);else if(ref.startsWith("data:image/"))image(ref,ref.startsWith("data:image/jpeg")?"image/jpeg":"image/png");}
        if(question.type==="signature" && typeof value==="string" && value.startsWith("data:image/"))image(value,value.startsWith("data:image/jpeg")?"image/jpeg":"image/png");
        const proof=evidence[question.id];if(proof?.comment)line(`Комментарий: ${proof.comment}`);if(proof?.barcode)line(`Код: ${proof.barcode}`);if(proof?.location)line(`Геопозиция: ${proof.location.latitude}, ${proof.location.longitude}; точность ${Math.round(proof.location.accuracy)} м; ${proof.location.capturedAt}`);
        for(const ref of [...(proof?.photos??[]),...(proof?.videos??[]),...(proof?.audios??[])])await file(ref);
        const problem=checklistQuestionResult(question,value);if(problem.violation)line(problem.critical?"КРИТИЧЕСКОЕ НАРУШЕНИЕ":"Нарушение",10);
      }
    }
  }
  const total=doc.getNumberOfPages();for(let page=1;page<=total;page++){doc.setPage(page);doc.setFontSize(8);doc.text(`WeSetup · ${page} / ${total}`,18,289);}
  return new Uint8Array(doc.output("arraybuffer"));
}
