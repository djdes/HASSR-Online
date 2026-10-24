import { maxConfig } from "./config";

export type MaxButton = {type:"callback";text:string;payload:string}|{type:"link";text:string;url:string};
export async function maxApi<T>(path:string,options:{method?:string;body?:unknown}={}):Promise<T> {
  const cfg=maxConfig();
  if (!cfg.token) throw new Error("MAX is not configured");
  // Never include upstream body, headers or request URLs in logs/errors.
  const response=await fetch(cfg.apiBase+path,{
    method:options.method ?? "GET",
    headers:{Authorization:cfg.token,"Content-Type":"application/json"},
    ...(options.body===undefined?{}:{body:JSON.stringify(options.body)}),
    signal:AbortSignal.timeout(12_000),cache:"no-store",
  });
  if (!response.ok) throw new Error(`MAX API returned ${response.status}`);
  return await response.json() as T;
}
export function maxSend(chatId:string,text:string,buttons:MaxButton[][]=[]) {
  return maxApi("/messages?chat_id="+encodeURIComponent(chatId),{method:"POST",body:{text,attachments:buttons.length?[{type:"inline_keyboard",payload:{buttons}}]:[]}});
}
