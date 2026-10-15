import { checklistPdfResponse } from "@/lib/custom-checklist-export.server";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(_request:Request,ctx:{params:Promise<{id:string}>}) {return checklistPdfResponse("template",(await ctx.params).id);}
