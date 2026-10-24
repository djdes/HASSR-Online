import { NextResponse } from "next/server";
import { maxConfig } from "@/lib/max/config";
import { timingSafeEqualStrings } from "@/lib/timing-safe";
import { handleMaxUpdate } from "@/lib/max/bot";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
  const secret=maxConfig().webhookSecret;
  if(!secret) return NextResponse.json({ok:false},{status:503});
  if(!timingSafeEqualStrings(request.headers.get("X-Max-Bot-Api-Secret"),secret)) return NextResponse.json({ok:false},{status:403});
  const text=await request.text();
  if(text.length>100_000) return NextResponse.json({ok:false},{status:413});
  let update:unknown;
  try{update=JSON.parse(text);}catch{return NextResponse.json({ok:false},{status:400});}
  try {
    await handleMaxUpdate(update);
    return NextResponse.json({ok:true});
  } catch {
    console.error("[max:webhook] delivery failed; retry required");
    return NextResponse.json({ok:false},{status:503});
  }
}
