import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadConfirmMessages } from "@/i18n/confirm-messages";
import type { PromptAsyncOptions } from "./prompt-async";

const require = createRequire(import.meta.url);
type DialogProps = { options: PromptAsyncOptions; onResolve: (value: string | null) => void };

function fixture(documentLocale: string, deferLoad = false) {
  const rendered: ReactElement<DialogProps>[] = [];
  const loaders: { locale: string; resolve: (copy: Awaited<ReturnType<typeof loadConfirmMessages>>) => void }[] = [];
  let hosts = 0;
  const fixtureModule = { exports: {} };
  const code = ts.transpileModule(readFileSync("src/components/ui/prompt-async.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module: fixtureModule, exports: fixtureModule.exports, window: {}, setTimeout,
    document: {
      documentElement: { lang: documentLocale },
      body: { appendChild: () => { hosts++; } },
      createElement: () => ({ dataset: {}, remove: () => { hosts--; } }),
    },
    require: (id: string) => {
      if (id === "react-dom/client") return { createRoot: () => ({ render: (element: ReactElement<DialogProps>) => rendered.push(element), unmount() {} }) };
      if (deferLoad && id === "@/i18n/confirm-messages") return {
        loadConfirmMessages: (locale: string) => new Promise(resolve => loaders.push({ locale, resolve })),
      };
      return require(id);
    },
  });
  return { ...fixtureModule.exports as typeof import("./prompt-async"), rendered, loaders, get hosts() { return hosts; } };
}

async function waitForRender(f: ReturnType<typeof fixture>) {
  for (let i = 0; i < 100 && f.rendered.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(f.rendered.length > 0, "localized prompt must render after catalog load");
  return f.rendered.at(-1)!;
}

test("imperative prompts use explicit/document locale and preserve custom text and original submitted values", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const f = fixture("ru");
    const pending = f.promptAsync({ locale, title: "Customer O‘tkir", label: "Custom field", defaultValue: "Плов O‘tkir" });
    const dialog = await waitForRender(f);
    const html = renderToStaticMarkup(dialog);
    const copy = await loadConfirmMessages(locale);
    for (const text of [copy.common.close, copy.common.save, copy.common.cancel, "Customer O‘tkir", "Плов O‘tkir"]) assert.ok(html.includes(text));
    dialog.props.onResolve("Плов O‘tkir");
    assert.equal(await pending, "Плов O‘tkir");
    assert.equal(f.hosts, 0);
  }
  const f = fixture("uz");
  const pending = f.promptAsync({ title: "Custom", confirmLabel: "YES CUSTOM", cancelLabel: "NO CUSTOM" });
  const dialog = await waitForRender(f);
  const html = renderToStaticMarkup(dialog);
  assert.ok(html.includes("YES CUSTOM") && html.includes("NO CUSTOM"));
  assert.ok(html.includes((await loadConfirmMessages("uz")).common.close));
  dialog.props.onResolve(null);
  assert.equal(await pending, null);
});

test("superseded asynchronous prompt loads settle the previous promise without rendering a stale locale", async () => {
  const f = fixture("ru", true);
  const first = f.promptAsync({ title: "Old", locale: "en" });
  const second = f.promptAsync({ title: "Current", locale: "uz" });
  assert.equal(await first, null);
  f.loaders[0].resolve(await loadConfirmMessages("en"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.rendered.length, 0);
  f.loaders[1].resolve(await loadConfirmMessages("uz"));
  const dialog = await waitForRender(f);
  const html = renderToStaticMarkup(dialog);
  assert.ok(html.includes("Current"));
  assert.ok(html.includes((await loadConfirmMessages("uz")).common.close));
  assert.equal(f.hosts, 1);
  dialog.props.onResolve(null);
  assert.equal(await second, null);
  assert.equal(f.hosts, 0);
});
