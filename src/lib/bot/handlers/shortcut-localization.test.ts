import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";

type Button = { text: string; callback_data?: string; web_app?: { url: string } };
type Options = { parse_mode: string; link_preview_options: { is_disabled: boolean }; reply_markup?: { inline_keyboard: Button[][] } };
type Handler = (ctx: { from?: { id: number }; reply: (text: string, options: Options) => Promise<void> }) => Promise<void>;
function fixture() {
  const require = createRequire(import.meta.url);
  const handlers = new Map<string, Handler>();
  const reads: unknown[] = [];
  const state: { user: { locale: string | null; organization: { locale: string | null } } | null; base: string | null } = {user:null,base:"https://fixture.invalid/mini"};
  const compiled = {exports:{}};
  const source = ts.transpileModule(readFileSync(new URL("./shortcut.ts", import.meta.url), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const mocks: Record<string, unknown> = {
    "@/lib/db": {db:{user:{findFirst:async (query:unknown) => {reads.push(query);return state.user;}}}},
    "@/lib/journal-obligation-links": {...require("@/lib/journal-obligation-links"),getMiniAppBaseUrlFromEnv:()=>state.base},
  };
  vm.runInNewContext(source,{module:compiled,exports:compiled.exports,require:(id:string)=>Object.hasOwn(mocks,id)?mocks[id]:require(id)});
  (compiled.exports as {registerShortcutHandlers:(composer:{command:(name:string,handler:Handler)=>void})=>void}).registerShortcutHandlers({command:(name,handler)=>{handlers.set(name,handler);}});
  async function invoke(command:string,fromId:number|null=77) {
    const replies:{text:string;options:Options}[]=[];
    await handlers.get(command)!({...(fromId===null?{}:{from:{id:fromId}}),reply:async(text,options)=>{replies.push({text,options});}});
    assert.equal(replies.length,1);
    return JSON.parse(JSON.stringify(replies[0])) as {text:string;options:Options};
  }
  return {state,reads,invoke};
}

for (const command of ["journals","reports"] as const) {
  test(`${command}: actual registered command resolves each recipient and preserves URLs/protocol`,async()=>{
    const f=fixture();
    for(const [personal,organization,locale] of [["en","uz","en"],["uz","en","uz"],[null,"en","en"],["invalid","uz","uz"],[null,null,"ru"]] as const) {
      f.state.user={locale:personal,organization:{locale:organization}};
      const messages=(await loadMessages(locale as Locale)).telegramShortcuts;
      const result=await f.invoke(command);
      assert.equal(result.text,`${messages[command].heading}\n${messages[command].description}`);
      assert.equal(result.options.parse_mode,"HTML");
      assert.deepEqual(result.options.link_preview_options,{is_disabled:true});
      assert.deepEqual(result.options.reply_markup?.inline_keyboard,command === "journals" ? [
        [{text:messages.journals.openInMiniApp,web_app:{url:"https://fixture.invalid/mini/journals"}}],
        [{text:messages.journals.chooseDocument,callback_data:"edit:home"}],
      ] : [[{text:messages.reports.button,web_app:{url:"https://fixture.invalid/mini/reports"}}]]);
      assert.deepEqual(JSON.parse(JSON.stringify(f.reads.at(-1))),{where:{telegramChatId:"77",isActive:true,archivedAt:null},select:{locale:true,organization:{select:{locale:true}}}});
    }
    f.state.user=null;
    const ru=(await loadMessages("ru")).telegramShortcuts;
    assert.equal((await f.invoke(command)).text,`${ru[command].heading}\n${ru[command].description}`);
    const reads=f.reads.length;
    assert.equal((await f.invoke(command,null)).text,`${ru[command].heading}\n${ru[command].description}`);
    assert.equal(f.reads.length,reads,"Missing sender must not query another recipient");
  });
  test(`${command}: missing Mini App base retains the original callback-only/no-button behavior`,async()=>{
    const f=fixture();f.state.base=null;f.state.user={locale:"uz",organization:{locale:"ru"}};
    const result=await f.invoke(command),messages=(await loadMessages("uz")).telegramShortcuts;
    assert.deepEqual(result.options.reply_markup,command === "journals" ? {inline_keyboard:[[{text:messages.journals.chooseDocument,callback_data:"edit:home"}]]} : undefined);
  });
}
