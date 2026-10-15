import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { FILLING_GUIDES, getFillingGuide } from "@/lib/journal-filling-guides";
import type { FillingGuideTranslators } from "@/lib/journal-filling-guide-copy";
import type { JournalAdapter } from "./types";

const source = ts.transpileModule(readFileSync("src/lib/tasksflow-adapters/generic.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function adapterFixture(code: string, customTree = false): JournalAdapter {
  const fixtureModule = { exports: {} };
  const require = createRequire(import.meta.url);
  const fields = [{ key: "custom_choice", type: "select", label: "Своя метка O‘tkir", options: [{ value: "stored-value", label: "Исходный вариант" }] }];
  vm.runInNewContext(source, {
    module: fixtureModule, exports: fixtureModule.exports,
    require: (id: string) => {
      if (id === "@/lib/db") return { db: {
        journalDocument: { findUnique: async () => ({ organizationId: "test-org", organization: { requirePhotoOnTaskFillStep: true } }) },
        journalTemplate: { findUnique: async () => ({ fields }) },
      } };
      if (id === "@/lib/journal-roster-db") return { findTaskEmployee() { throw new Error("Unexpected write-path call"); } };
      if (id === "@/lib/journal-pipeline-tree") return {
        loadPipelineTree: async () => customTree ? { nodes: [{
          id: "custom-step-id", parentId: null, ordering: 0, kind: "pinned", linkedFieldKey: "custom_choice",
          title: "Своя инструкция O‘tkir", detail: "Исходные указания", hint: "Свой совет",
          photoMode: "required", requireComment: true, requireSignature: true,
        }] } : null,
      };
      return require(id);
    },
  });
  return (fixtureModule.exports as typeof import("./generic")).buildGenericAdapter(code, "Customer journal name");
}

test("generic task-form fallback uses explicit translated guide content with stable pipeline IDs and fields", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const onError = (error: Error) => { throw error; };
    const guideTranslators: FillingGuideTranslators = {
      guide: createTranslator({ locale, messages, namespace: "journalFillingGuides", onError }),
      walkthrough: createTranslator({ locale, messages, namespace: "journalControls.walkthroughs", onError }),
    };
    for (const code of Object.keys(FILLING_GUIDES)) {
      const adapter = adapterFixture(code);
      const form = await adapter.getTaskForm!({ documentId: "document-id", rowKey: "employee-id", guideTranslators });
      const guide = getFillingGuide(code, guideTranslators)!;
      assert.equal(form!.intro, guide.summary);
      const steps = form!.pipeline!;
      assert.equal(steps[0].id, "materials");
      assert.equal(steps[0].detail, guide.materials.map(item => `• ${item}`).join("\n"));
      for (const [index, step] of guide.steps.entries()) {
        assert.equal(steps[index + 1].id, `step-${index + 1}`);
        assert.equal(steps[index + 1].title, step.title);
        assert.equal(steps[index + 1].detail, step.detail);
        assert.equal(steps[index + 1].requirePhoto, true);
      }
      assert.equal(steps.at(-1)!.id, "completion");
      assert.equal(steps.at(-1)!.detail, guide.completionCriteria);
      assert.equal(steps.at(-1)!.hint, guide.regulationRef);
      assert.equal(form!.fields[0].key, "custom_choice");
      assert.equal(form!.fields[0].label, "Своя метка O‘tkir");
      assert.equal(adapter.meta.label, "Customer journal name");
    }
  }
});

test("legacy adapter calls retain Russian defaults and custom pipeline nodes remain untranslated", async () => {
  const adapter = adapterFixture("cleaning");
  const form = await adapter.getTaskForm!({ documentId: "document-id", rowKey: "employee-id" });
  assert.equal(form!.intro, FILLING_GUIDES.cleaning.summary);
  assert.equal(form!.pipeline![1].title, FILLING_GUIDES.cleaning.steps[0].title);
  const messages = await loadMessages("en");
  const customForm = await adapterFixture("cleaning", true).getTaskForm!({
    documentId: "document-id", rowKey: "employee-id",
    guideTranslators: {
      guide: createTranslator({ locale: "en", messages, namespace: "journalFillingGuides" }),
      walkthrough: createTranslator({ locale: "en", messages, namespace: "journalControls.walkthroughs" }),
    },
  });
  const step = customForm!.pipeline![0];
  assert.equal(step.id, "custom-step-id");
  assert.equal(step.title, "Своя инструкция O‘tkir");
  assert.equal(step.detail, "Исходные указания");
  assert.equal(step.hint, "Свой совет");
  assert.equal(step.field!.key, "custom_choice");
  assert.equal(step.requirePhoto, true);
  assert.equal(step.requireComment, true);
  assert.equal(step.requireSignature, true);
  assert.equal(step.depth, 0);
});
