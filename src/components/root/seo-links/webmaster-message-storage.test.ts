import assert from "node:assert/strict";
import test from "node:test";
import { clearSentWebmasterMessageDraft, saveWebmasterMessageDraft, webmasterMessageDraftKey } from "./webmaster-message-storage";

test("the last draft can be reopened for the same administrator, slot and donor", () => {
  const drafts = new Map<string, string>();
  const storage = {
    getItem: (key: string) => drafts.get(key) ?? null,
    setItem: (key: string, body: string) => { drafts.set(key, body); },
    removeItem: (key: string) => { drafts.delete(key); },
  };
  const key = webmasterMessageDraftKey("admin", "slot", 20);
  saveWebmasterMessageDraft(storage, key, "Текст диспетчера");
  const edited = "Уточните, пожалуйста, рубрику.\nМы подготовили статью.";
  saveWebmasterMessageDraft(storage, key, edited);
  assert.equal(storage.getItem(webmasterMessageDraftKey("admin", "slot", 20)), edited);
  assert.equal(storage.getItem(webmasterMessageDraftKey("other-admin", "slot", 20)), null);
  assert.equal(storage.getItem(webmasterMessageDraftKey("admin", "other-slot", 20)), null);
  assert.equal(storage.getItem(webmasterMessageDraftKey("admin", "slot", 21)), null);

  clearSentWebmasterMessageDraft(storage, key, "Текст диспетчера");
  assert.equal(storage.getItem(key), edited, "confirmation for an older draft preserves newer edits");
  clearSentWebmasterMessageDraft(storage, key, edited);
  assert.equal(storage.getItem(key), null);
  saveWebmasterMessageDraft(storage, key, "Новый текст");
  saveWebmasterMessageDraft(storage, key, "");
  assert.equal(storage.getItem(key), null);
});
