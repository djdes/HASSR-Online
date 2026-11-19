export function webmasterMessageDraftKey(userId: string, slotId: string, siteId: number): string {
  return `wesetup:ggl:webmaster-draft:${JSON.stringify([userId, slotId, siteId])}`;
}

export function saveWebmasterMessageDraft(storage: Pick<Storage, "setItem" | "removeItem">, key: string, body: string) {
  if (body) storage.setItem(key, body);
  else storage.removeItem(key);
}

export function clearSentWebmasterMessageDraft(storage: Pick<Storage, "getItem" | "removeItem">, key: string, sentBody: string) {
  if (storage.getItem(key) === sentBody) storage.removeItem(key);
}
