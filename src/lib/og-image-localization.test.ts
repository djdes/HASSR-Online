import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import test from "node:test";
import vm from "node:vm";
import type {ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {loadMessages} from "@/i18n/messages";
import {OG_KINDS,clampOgText,ogImageUrl,ogImages,twitterImages} from "./og-image";

const htmlText=(value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;");

class CapturedImage extends Response {
  constructor(readonly element:ReactNode,readonly options:unknown){super(null);}
}
function handler(){
  const require=createRequire(import.meta.url),compiled={exports:{}};
  const source=ts.transpileModule(readFileSync("src/app/og/image/route.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(source,{module:compiled,exports:compiled.exports,URL,process,require:(id:string)=>id==="next/og"?{ImageResponse:CapturedImage}:require(id)});
  return (compiled.exports as {GET:(request:Request)=>Promise<CapturedImage>}).GET;
}

test("actual OG handler translates fixed labels by explicit URL locale and keeps cache responses isolated",async()=>{
  const GET=handler();
  for(const locale of ["ru","en","uz"] as const){
    const messages=(await loadMessages(locale)).publicOg;
    for(const kind of OG_KINDS){
      const image=await GET(new Request(`https://fixture.invalid/og/image?k=${kind}&l=${locale}`,{headers:{cookie:"wesetup.site-locale=uz"}}));
      const html=renderToStaticMarkup(image.element);
      assert.ok(html.includes(htmlText(messages.kind[kind])),`${locale}/${kind}`);assert.ok(html.includes(htmlText(messages.fallbackTitle)));assert.ok(html.includes(htmlText(messages.freeForever)));
      assert.equal(image.headers.get("Content-Language"),locale);
      assert.equal(image.headers.get("Cache-Control"),"public, max-age=86400, stale-while-revalidate=604800");
      const options=image.options as {width:number;height:number;fonts:Array<{name:string;data:Buffer;weight:number;style:string}>};
      assert.equal(options.width,1200);assert.equal(options.height,630);
      assert.deepEqual(Array.from(options.fonts,font=>({name:font.name,weight:font.weight,style:font.style})),[{name:"WeSetup Unicode",weight:400,style:"normal"},{name:"WeSetup Unicode",weight:700,style:"normal"}]);
      assert.ok(options.fonts.every(font=>font.data.length>100000));
      assert.ok(html.includes("https://wesetup.ru/brand/wordmark-dark.png"));
      assert.ok(html.includes("wesetup.ru"));
      if(locale!=="ru")assert.ok(!/[А-Яа-яЁё]/u.test(html));
    }
  }
  for(const value of ["","invalid","constructor"]){
    const response=await GET(new Request(`https://fixture.invalid/og/image?k=constructor&l=${value}`,{headers:{cookie:"wesetup.site-locale=en"}}));
    const html=renderToStaticMarkup(response.element),ru=(await loadMessages("ru")).publicOg;
    assert.equal(response.headers.get("Content-Language"),"ru");assert.ok(html.includes(ru.freeForever));assert.ok(html.includes(ru.kind.page));
  }
});

test("OG helpers preserve old URLs and original dynamic text while adding locale to new cache keys",async()=>{
  assert.equal(ogImageUrl({title:"  Original  title ",kind:"page"}),"https://wesetup.ru/og/image?t=Original+title");
  const title="Customer <literal> & original "+"x".repeat(110),subtitle="Original data "+"y".repeat(180);
  for(const locale of ["ru","en","uz"] as const){
    const url=new URL(ogImageUrl({title,subtitle,kind:"feature",locale}));
    assert.equal(url.searchParams.get("t"),clampOgText(title,90));assert.equal(url.searchParams.get("s"),clampOgText(subtitle,140));assert.equal(url.searchParams.get("l"),locale);
    assert.equal(twitterImages({title,locale})[0],ogImages({title,locale})[0].url);
    const response=await handler()(new Request(url)),html=renderToStaticMarkup(response.element);
    assert.ok(html.includes("Customer &lt;literal&gt; &amp; original"));assert.ok(!html.includes("Customer <literal>"));
    assert.equal(response.headers.get("Content-Language"),locale);
  }
});
