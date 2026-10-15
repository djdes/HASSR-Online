import { NextResponse } from "next/server";
import { db } from "./db";
import { requireChecklistAccess } from "./custom-checklists.server";
import { allChecklistQuestions, checklistDefinitionSchema, checklistAnswersSchema } from "./custom-checklists";
import { checklistEvidenceSchema, checklistInstancesSchema } from "./custom-checklist-rules";
import { checklistFileUses, expandChecklistDefinition } from "./custom-checklist-runtime";
import { generateChecklistPdf } from "./custom-checklist-pdf";

export async function checklistPdfResponse(kind:"template"|"inspection",id:string) {
  const auth=await requireChecklistAccess();if(!auth.ok)return auth.response;
  const template=kind==="template"?await db.checklistTemplate.findFirst({where:{id,organizationId:auth.organizationId,archived:false}}):null;
  const inspection=kind==="inspection"?await db.checklistInspection.findFirst({where:{id,organizationId:auth.organizationId,...(auth.canManage?{}:{createdById:auth.session.user.id})}}):null;
  if(!template&&!inspection)return NextResponse.json({error:"Чек-лист не найден"},{status:404});
  const definition=inspection?expandChecklistDefinition(checklistDefinitionSchema.parse(inspection.snapshot),checklistInstancesSchema.parse(inspection.categoryInstances??{})):checklistDefinitionSchema.parse(template!.definition);
  const answers=inspection?checklistAnswersSchema.parse(inspection.answers):undefined;
  const evidence=inspection?checklistEvidenceSchema.parse(inspection.evidence??{}):{};
  const ids=[...allChecklistQuestions(definition).flatMap(q=>(q.references??[]).map(ref=>ref.slice(5))),...(answers?checklistFileUses(definition,answers,evidence).map(use=>use.id):[])];
  const attachments=await db.checklistAttachment.findMany({where:{organizationId:auth.organizationId,id:{in:[...new Set(ids)]}},select:{id:true,fileName:true,mimeType:true,sizeBytes:true}});
  const title=inspection?.title??template!.title;
  const bytes=await generateChecklistPdf({title,definition,answers,evidence,attachments,recordedResult:inspection?.status==="completed"?inspection.result:undefined,meta:inspection?[`Версия шаблона: ${inspection.templateVersion}`,`Начал: ${inspection.createdByName} · ${inspection.createdAt.toISOString()}`,inspection.completedAt?`Завершил: ${inspection.completedByName} · ${inspection.completedAt.toISOString()}`:"Черновик · последние сохранённые ответы"]:[`Версия шаблона: ${template!.version}`],imageBytes:async fileId=>attachments.some(a=>a.id===fileId)?(await db.checklistAttachment.findFirst({where:{id:fileId,organizationId:auth.organizationId},select:{content:true}}))?.content??null:null});
  return new NextResponse(Uint8Array.from(bytes).buffer,{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename="checklist-${id.replace(/[^a-zA-Z0-9_-]/g,"")}.pdf"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
