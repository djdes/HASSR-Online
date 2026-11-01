import { checklistPdfResponse } from "@/lib/custom-checklist-export.server";
import { checklistInspectionAreaRefusal } from "@/lib/custom-checklists.server";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(_request:Request,ctx:{params:Promise<{id:string}>}) {
  const {id}=await ctx.params;
  // Точка (2026-11-01, «точка видит только своё»): PDF проверки другой точки — «не найден».
  const refusal=await checklistInspectionAreaRefusal(id);if(refusal)return refusal;
  return checklistPdfResponse("inspection",id);
}
