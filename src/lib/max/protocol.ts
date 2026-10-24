import { createHash } from "node:crypto";
import { z } from "zod";
import { maxId } from "./security";

const userSchema=z.object({user_id:z.union([z.string(),z.number()]),first_name:z.string().optional(),last_name:z.string().optional(),is_bot:z.boolean().optional()});
const messageSchema=z.object({recipient:z.object({chat_id:z.union([z.string(),z.number()]),chat_type:z.string()}),body:z.object({mid:z.string().optional(),text:z.string().max(8000).nullable().optional()}).optional()});
const schema=z.discriminatedUnion("update_type",[
  z.object({update_type:z.literal("bot_started"),user:userSchema,chat_id:z.union([z.string(),z.number()]),payload:z.string().max(512).nullable().optional()}),
  z.object({update_type:z.literal("bot_stopped"),user:userSchema,chat_id:z.union([z.string(),z.number()])}),
  z.object({update_type:z.literal("message_created"),message:messageSchema.extend({sender:userSchema})}),
  z.object({update_type:z.literal("message_callback"),callback:z.object({callback_id:z.string().max(256),user:userSchema,payload:z.string().max(512).nullable().optional()}),message:messageSchema}),
]);
export type MaxEvent={kind:"start"|"stop"|"message"|"callback";userId:string;chatId:string;name:string;payload:string;private:boolean;callbackId?:string};
export function parseMaxUpdate(input:unknown):MaxEvent|null {
  const result=schema.safeParse(input); if(!result.success) return null;
  const e=result.data;
  const user=e.update_type==="message_callback"?e.callback.user:e.update_type==="message_created"?e.message.sender:e.user;
  if(user.is_bot) return null;
  const userId=maxId(user.user_id);
  const chatId=maxId("chat_id" in e?e.chat_id:e.message.recipient.chat_id,true);
  if(!userId || !chatId) return null;
  const name=[user.first_name,user.last_name].filter(Boolean).join(" ").trim().slice(0,180)||"Пользователь MAX";
  const base={userId,chatId,name};
  if(e.update_type==="bot_started") return {...base,kind:"start",payload:e.payload??"",private:true};
  if(e.update_type==="bot_stopped") return {...base,kind:"stop",payload:"",private:true};
  const isPrivate=e.message.recipient.chat_type==="dialog";
  if(e.update_type==="message_callback") return {...base,kind:"callback",payload:e.callback.payload??"",private:isPrivate,callbackId:e.callback.callback_id};
  return {...base,kind:"message",payload:e.message.body?.text??"",private:isPrivate};
}
export function maxUpdateKey(input:unknown):string {
  const e=input as {update_type?:unknown;timestamp?:unknown;callback?:{callback_id?:unknown};message?:{body?:{mid?:unknown}};user?:{user_id?:unknown};chat_id?:unknown};
  return createHash("sha256").update(JSON.stringify([e.update_type,e.callback?.callback_id ?? e.message?.body?.mid ?? [e.timestamp,e.user?.user_id,e.chat_id]])).digest("hex");
}
