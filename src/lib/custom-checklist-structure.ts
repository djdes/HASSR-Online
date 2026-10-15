import { allChecklistQuestions, type ChecklistDefinition } from "./custom-checklists";

export type ChecklistNodeKind = "section" | "category" | "question";
// Keep references in the same copied branch, and drop conditions whose parent
// was removed or moved after its dependent. Never leave a dangling condition.
export function repairChecklistReferences(definition: ChecklistDefinition): ChecklistDefinition {
  const seen = new Set<string>();
  const next = structuredClone(definition);
  for (const question of allChecklistQuestions(next)) {
    if (question.showIf && !seen.has(question.showIf.questionId)) delete question.showIf;
    seen.add(question.id);
  }
  return next;
}
export function editChecklistStructure(definition: ChecklistDefinition, kind: ChecklistNodeKind, id: string, action: "copy" | "delete" | "up" | "down", uid: () => string): ChecklistDefinition {
  const next = structuredClone(definition);
  const lists = kind === "section" ? [next.sections] : kind === "category" ? next.sections.map(s => s.categories) : next.sections.flatMap(s => s.categories.map(c => c.questions));
  for (const list of lists) {
    const index = list.findIndex(node => node.id === id);
    if (index < 0) continue;
    if (action === "delete") list.splice(index, 1);
    else if (action === "copy") {
      const copy = structuredClone(list[index]);
      const mapping = new Map<string, string>();
      function remap(node: object) {
        const item = node as { id: string; sections?: object[]; categories?: object[]; questions?: object[]; logic?: {id: string}[] };
        const newId = uid(); mapping.set(item.id, newId); item.id = newId;
        item.logic?.forEach(rule => { rule.id = uid(); });
        for (const child of [...(item.categories ?? []), ...(item.questions ?? [])]) remap(child);
      }
      remap(copy); copy.title = `${copy.title} — копия`.slice(0, kind === "question" ? 300 : 200);
      const questions = kind === "question" ? [copy] : kind === "category" ? (copy as typeof next.sections[0]["categories"][0]).questions : (copy as typeof next.sections[0]).categories.flatMap(c => c.questions);
      for (const question of questions) if ("showIf" in question && question.showIf && mapping.has(question.showIf.questionId)) question.showIf.questionId = mapping.get(question.showIf.questionId)!;
      // Every list has a single node kind, despite the union above.
      (list as typeof copy[]).splice(index + 1, 0, copy);
    } else {
      const target = index + (action === "up" ? -1 : 1);
      if (target >= 0 && target < list.length) [list[index], list[target]] = [list[target], list[index]];
    }
    break;
  }
  return repairChecklistReferences(next);
}
export function moveChecklistNode(definition: ChecklistDefinition, kind: "category" | "question", id: string, destination: string): ChecklistDefinition {
  const next = structuredClone(definition);
  if (kind === "category") {
    const target = next.sections.find(s => s.id === destination);
    const source = next.sections.find(s => s.categories.some(c => c.id === id));
    if (target && source && target !== source) target.categories.push(...source.categories.splice(source.categories.findIndex(c => c.id === id), 1));
  } else {
    const categories = next.sections.flatMap(s => s.categories);
    const target = categories.find(c => c.id === destination);
    const source = categories.find(c => c.questions.some(q => q.id === id));
    if (target && source && target !== source) target.questions.push(...source.questions.splice(source.questions.findIndex(q => q.id === id), 1));
  }
  return repairChecklistReferences(next);
}
