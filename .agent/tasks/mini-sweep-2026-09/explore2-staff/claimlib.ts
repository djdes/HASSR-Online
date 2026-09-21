import type { Page } from "playwright";
export async function releaseActive(p: Page) {
  const my: any = await p.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
  if (my?.claim?.id) {
    const r = await p.evaluate(`fetch('/api/journal-task-claims/${my.claim.id}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'release'})}).then(async r=>r.status+' '+(await r.text()).slice(0,200))`);
    return { released: my.claim, r };
  }
  return { released: null, r: "no active" };
}
/** Берёт задачу по подстроке scopeLabel из /api/mini/today. Возвращает claim id. */
export async function claimScope(p: Page, journalCode: string, labelPart: string) {
  const today: any = await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`);
  const g = today.groups.find((x: any) => x.code === journalCode);
  if (!g) throw new Error("нет группы " + journalCode + "; есть: " + today.groups.map((x:any)=>x.code).join(","));
  const sc = g.scopes.find((x: any) => x.scopeLabel.includes(labelPart) && x.availability === "available") ?? g.scopes.find((x: any) => x.availability === "available");
  if (!sc) throw new Error("нет свободных задач в " + journalCode);
  const body = JSON.stringify({ journalCode, scopeKey: sc.scopeKey, scopeLabel: sc.scopeLabel, dateKey: today.dateKey, parentHint: sc.sublabel ?? null });
  const res: any = await p.evaluate(`fetch('/api/journal-task-claims',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(async r=>({s:r.status,j:await r.json()}))`);
  return { scope: sc, res };
}
