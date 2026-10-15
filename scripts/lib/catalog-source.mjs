import ts from "typescript";

/** JSON.parse silently discards duplicate keys, which can hide lost messages. */
export function parseCatalogSource(raw, filename = "messages.json") {
  const data = JSON.parse(raw);
  const source = ts.parseJsonText(filename, raw);
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = property.name.text;
        if (keys.has(key)) {
          const { line } = source.getLineAndCharacterOfPosition(property.getStart(source));
          throw new Error(`Duplicate catalog key ${key} in ${filename}:${line + 1}`);
        }
        keys.add(key);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return data;
}
