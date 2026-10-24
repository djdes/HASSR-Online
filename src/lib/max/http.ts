import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { maxConfig } from "./config";
import { MaxError, maxAccount } from "./service";

export async function maxSession() {
  const session=await getServerSession(authOptions);
  if(!session?.user?.id) throw new MaxError("Войдите в свой аккаунт WeSetup.",401);
  if(session.user.kioskDeviceId) throw new MaxError("Привяжите MAX на личном устройстве. На общем планшете привязка недоступна.",403);
  if(session.user.partnerAccess) throw new MaxError("Привязывайте MAX из собственного кабинета, завершив вход в кабинет клиента.",403);
  await maxAccount(session.user.id);
  return session;
}
export async function maxJson(request:Request):Promise<unknown> {
  if(!request.headers.get("content-type")?.startsWith("application/json")) throw new MaxError("Ожидается JSON.",415);
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin && origin!==maxConfig().siteBase) throw new MaxError("Запрос с другого сайта запрещён.",403);
  const body=await request.text();
  if(body.length>20_000) throw new MaxError("Запрос слишком большой.",413);
  try{return JSON.parse(body);}catch{throw new MaxError("Не удалось прочитать запрос.");}
}
export function maxFailure(error:unknown) {
  if(error instanceof MaxError) return NextResponse.json({error:error.message},{status:error.status,headers:{"Cache-Control":"no-store"}});
  // No upstream payloads or Prisma error objects: they may contain credentials.
  console.error("[max] operation failed",error instanceof Error?error.name:"UnknownError");
  return NextResponse.json({error:"Не удалось выполнить действие. Повторите через минуту."},{status:503,headers:{"Cache-Control":"no-store"}});
}
