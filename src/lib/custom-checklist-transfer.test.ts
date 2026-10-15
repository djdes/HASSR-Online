import { test } from "node:test";
import assert from "node:assert/strict";
import { checklistPortableJson, parseChecklistJson, checklistXlsxSample, parseChecklistXlsx } from "./custom-checklist-transfer";
import { allChecklistQuestions, checklistDefinitionSchema, newChecklistQuestion, type ChecklistDefinition } from "./custom-checklists";
import { editChecklistStructure, moveChecklistNode } from "./custom-checklist-structure";
import { checklistAttachmentType, checklistByteRange } from "./custom-checklist-files";
import { generateChecklistPdf } from "./custom-checklist-pdf";

const definition: ChecklistDefinition={description:"Проверка",sections:[{id:"s",title:"Кухня",active:true,categories:[{id:"c",title:"Холодильник",active:true,repeatable:true,questions:[newChecklistQuestion("parent"),{...newChecklistQuestion("child"),showIf:{questionId:"parent",value:"no"} }]},{id:"empty",title:"Другая категория",active:true,questions:[]}]}]};
test("structural copies remap internal parents, moves/deletions leave valid conditions",()=>{
  let nextId=0;const uid=()=>`copy-${++nextId}`;
  const copy=editChecklistStructure(definition,"category","c","copy",uid);
  const category=copy.sections[0].categories[1];assert.notEqual(category.id,"c");assert.equal(category.questions[1].showIf?.questionId,category.questions[0].id);
  assert.equal(checklistDefinitionSchema.safeParse(copy).success,true);
  const moved=moveChecklistNode(copy,"question",category.questions[0].id,"empty");
  assert.equal(allChecklistQuestions(moved).find(q=>q.id===category.questions[1].id)?.showIf,undefined);
  assert.equal(checklistDefinitionSchema.safeParse(moved).success,true);
  assert.equal(editChecklistStructure(definition,"question","parent","delete",uid).sections[0].categories[0].questions[0].showIf,undefined);
  assert.deepEqual(parseChecklistJson(checklistPortableJson("Чек-лист",definition)),{title:"Чек-лист",definition});
  assert.throws(()=>parseChecklistJson('{"format":"other"}'));
});
test("Excel sample imports, formulas, extra sheets and invalid rows are rejected",async()=>{
  let i=0;const uid=()=>`import-${++i}`;const buffer=await checklistXlsxSample();
  const imported=await parseChecklistXlsx(buffer,uid);assert.equal(allChecklistQuestions(imported).length,3);
  const ExcelJS=(await import("exceljs")).default;const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  book.getWorksheet("Чек-лист")!.getCell("F2").value={formula:"1+1",result:2};
  await assert.rejects(parseChecklistXlsx(await book.xlsx.writeBuffer() as ArrayBuffer,uid),/формул/);
  book.getWorksheet("Чек-лист")!.getCell("F2").value=1;book.getWorksheet("Чек-лист")!.getCell("D2").value="unknown";
  await assert.rejects(parseChecklistXlsx(await book.xlsx.writeBuffer() as ArrayBuffer,uid),/Строка 2/);
  book.getWorksheet("Чек-лист")!.getCell("D2").value="yes_no";book.addWorksheet("Не терять данные").addRow(["Важная строка"]);
  await assert.rejects(parseChecklistXlsx(await book.xlsx.writeBuffer() as ArrayBuffer,uid),/дополнительные листы/);
});
test("private media signatures and HTTP byte ranges reject misleading extensions and malformed bounds",()=>{
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,0]);assert.equal(checklistAttachmentType("x.png",png,"photo"),"image/png");
  assert.equal(checklistAttachmentType("x.mp4",png,"video"),null);assert.equal(checklistAttachmentType("x.svg",new TextEncoder().encode('<svg onload="alert(1)"/>'),"reference"),null);
  const mp4=new Uint8Array(24);mp4.set(new TextEncoder().encode("ftyp"),4);assert.equal(checklistAttachmentType("x.mp4",mp4,"video"),"video/mp4");
  assert.deepEqual(checklistByteRange("bytes=3-7",10),{start:3,end:7});assert.deepEqual(checklistByteRange("bytes=-4",10),{start:6,end:9});
  for(const range of ["bytes=-0","bytes=10-","bytes=7-2","bytes=1-2,3-4","bytes=-","other"] )assert.equal(checklistByteRange(range,10),"invalid");
});
test("Cyrillic blank and completed checklist PDF render real reports",async()=>{
  const blank=await generateChecklistPdf({title:"Проверка кухни",definition});assert.equal(new TextDecoder().decode(blank.slice(0,4)),"%PDF");assert.ok(blank.length>20000);
  const report=await generateChecklistPdf({title:"Проверка кухни",definition,answers:{parent:"no",child:"yes"},evidence:{parent:{comment:"Обнаружено нарушение",barcode:"12345"}}});assert.ok(report.length>20000);
});
