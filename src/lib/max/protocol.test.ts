import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMaxUpdate, maxUpdateKey } from "./protocol";
test("MAX bot_started identifies the real user and private chat",()=>{
  assert.deepEqual(parseMaxUpdate({update_type:"bot_started",timestamp:100,user:{user_id:42,first_name:"Анна"},chat_id:10,payload:"link_test"}),{kind:"start",userId:"42",chatId:"10",name:"Анна",payload:"link_test",private:true});
});
test("MAX group messages are explicitly marked and malformed IDs fail closed",()=>{
  const e={update_type:"message_created",message:{sender:{user_id:42,first_name:"Иван"},recipient:{chat_id:-7,chat_type:"chat"},body:{mid:"m1",text:"/connect test"}}};
  assert.equal(parseMaxUpdate(e)?.private,false);
  assert.equal(parseMaxUpdate({...e,message:{...e.message,sender:{user_id:9007199254740993}}}),null);
  assert.equal(parseMaxUpdate({update_type:"bot_started",user:{user_id:42,is_bot:true},chat_id:1}),null);
  assert.equal(parseMaxUpdate({update_type:"unknown"}),null);
});
test("MAX callback sender is the callback user, never the bot message sender",()=>{
  const update={update_type:"message_callback",callback:{callback_id:"c1",user:{user_id:42,first_name:"Анна"},payload:"journals:0"},message:{sender:{user_id:99,is_bot:true},recipient:{chat_id:10,chat_type:"dialog"}}};
  assert.equal(parseMaxUpdate(update)?.userId,"42");
  assert.equal(parseMaxUpdate(update)?.payload,"journals:0");
});
test("MAX duplicate event IDs are stable across JSON key order",()=>{
  const a={update_type:"message_created",timestamp:123,message:{body:{mid:"m1",text:"/menu"}}};
  const b={message:{body:{text:"/menu",mid:"m1"}},timestamp:123,update_type:"message_created"};
  assert.equal(maxUpdateKey(a),maxUpdateKey(b));
});
