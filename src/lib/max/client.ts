import { maxConfig } from "./config";

export type MaxButton = {type:"callback";text:string;payload:string}|{type:"link";text:string;url:string};
/** One bot screen: text plus inline keyboard rows. */
export type MaxView = {text:string;buttons:MaxButton[][]};

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
// MAX limits: 4000 characters of text, 30 rows, 7 buttons per row.
export function maxMessageBody(view:MaxView) {
  const buttons=view.buttons.filter(row=>row.length).slice(0,30).map(row=>row.slice(0,7));
  return {text:view.text.slice(0,4000),attachments:buttons.length?[{type:"inline_keyboard",payload:{buttons}}]:[]};
}
export function maxSend(chatId:string,text:string,buttons:MaxButton[][]=[]) {
  return maxApi("/messages?chat_id="+encodeURIComponent(chatId),{method:"POST",body:maxMessageBody({text,buttons})});
}
/** Answers a button press; with a view the pressed message is replaced in place. */
export async function maxAnswer(callbackId:string,answer:{view?:MaxView;notification?:string}) {
  const result=await maxApi<{success?:boolean}>("/answers?callback_id="+encodeURIComponent(callbackId),{method:"POST",body:{...(answer.view?{message:maxMessageBody(answer.view)}:{}),...(answer.notification?{notification:answer.notification}:{})}});
  if(result.success===false) throw new Error("MAX rejected the callback answer");
}
