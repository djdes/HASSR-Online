"use client";

import { useState } from "react";
import { Check, Code2, Copy } from "lucide-react";

/**
 * «Встроить на свой сайт» (спека seo-speed-pack-2026-11, п. 18): готовый код
 * iframe с калькулятором и ссылкой на WeSetup — для отраслевых сайтов,
 * блогов технологов и ассоциаций.
 */
export function EmbedCode({ src, title, height = 720 }: { src: string; title: string; height?: number }) {
  const [copied, setCopied] = useState(false);
  const code = `<iframe src="${src}" title="${title}" width="100%" height="${height}" style="border:0;max-width:760px" loading="lazy"></iframe>\n<p><a href="https://wesetup.ru/">Электронные журналы СанПиН и ХАССП — WeSetup</a></p>`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* без буфера обмена — код можно выделить вручную */
    }
  }
  return (
    <div className="mt-10 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5 sm:p-7" data-testid="embed-code">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
        <Code2 className="size-4 text-[#5566f6]" />
        Встроить калькулятор на свой сайт
      </div>
      <p className="mt-1 text-[14px] leading-[1.55] text-[#3c4053]">
        Бесплатно для сайтов о питании, санитарии и ХАССП. Вставьте код на страницу — калькулятор будет работать у вас.
      </p>
      <textarea
        readOnly
        value={code}
        rows={3}
        onFocus={(event) => event.currentTarget.select()}
        className="mt-3 w-full resize-none rounded-xl border border-[#dcdfed] bg-white p-3 font-mono text-[12px] text-[#3c4053]"
        aria-label="Код для вставки"
      />
      <button
        type="button"
        onClick={copy}
        className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] hover:border-[#5566f6]/40"
      >
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4 text-[#5566f6]" />}
        {copied ? "Скопировано" : "Скопировать код"}
      </button>
    </div>
  );
}
