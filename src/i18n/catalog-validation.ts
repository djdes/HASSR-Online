import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";

export function flattenMessages(input: unknown, prefix = ""): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`Invalid catalog: ${prefix}`);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key || key.includes(".")) throw new Error(`Invalid message key segment: ${prefix}/${key}`);
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      if (!value.trim()) throw new Error(`Empty message: ${name}`);
      if (/\uFFFD|\?{3,}/.test(value)) throw new Error(`Corrupted message encoding: ${name}`);
      result[name] = value;
    } else Object.assign(result, flattenMessages(value, name));
  }
  return result;
}

/** Plural branches differ by language; argument names and kinds must not. */
export function messageArguments(message: string): string[] {
  const args = new Set<string>();
  function visit(elements: MessageFormatElement[]) {
    for (const element of elements) {
      switch (element.type) {
        case TYPE.argument: args.add(`${element.value}:argument`); break;
        case TYPE.number: args.add(`${element.value}:number`); break;
        case TYPE.date: args.add(`${element.value}:date`); break;
        case TYPE.time: args.add(`${element.value}:time`); break;
        case TYPE.select:
        case TYPE.plural:
          args.add(`${element.value}:${element.type === TYPE.select ? "select" : element.pluralType}`);
          Object.values(element.options).forEach((option) => visit(option.value));
          break;
        case TYPE.tag: args.add(`${element.value}:tag`); visit(element.children); break;
      }
    }
  }
  visit(parse(message));
  return [...args].sort();
}

export function validateCatalog(reference: unknown, translated: unknown): string[] {
  const base = flattenMessages(reference);
  const target = flattenMessages(translated);
  const issues: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(target)])) {
    if (!(key in base)) { issues.push(`Unexpected key: ${key}`); continue; }
    if (!(key in target)) { issues.push(`Missing key: ${key}`); continue; }
    try {
      if (JSON.stringify(messageArguments(base[key])) !== JSON.stringify(messageArguments(target[key]))) {
        issues.push(`Argument mismatch: ${key}`);
      }
    } catch (error) { issues.push(`Invalid ICU: ${key}: ${String(error)}`); }
  }
  return issues;
}
