import "server-only";
import { createHash } from "node:crypto";
import { types } from "node:util";

/**
 * A small, locale-free witness of persisted JSON, never of generated fallback IDs.
 * Inspect data descriptors only: accessors, toJSON and exotic/native objects must
 * retain the legacy client fallback rather than gain any additional field reads.
 */
export function auditProtocolConfigSourceIdentity(value: unknown): string | undefined {
  const ancestors = new Set<object>();
  function encode(input: unknown): string | undefined {
    if (input === null) return "null";
    if (typeof input === "string" || typeof input === "boolean") return JSON.stringify(input);
    if (typeof input === "number") return Number.isFinite(input) ? JSON.stringify(input) : undefined;
    if (typeof input !== "object" || types.isProxy(input) || ancestors.has(input)) return undefined;
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) return undefined;
    const keys = Object.keys(descriptors);
    if (keys.some(key => !("value" in descriptors[key]) || (!descriptors[key].enumerable && !(array && key === "length")))) return undefined;
    ancestors.add(input);
    const parts: string[] = [];
    if (array) {
      const length: number = descriptors.length.value;
      if (keys.length !== length + 1) return undefined;
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) return undefined;
        const encoded = encode(descriptor.value);
        if (encoded === undefined) return undefined;
        parts.push(encoded);
      }
    } else {
      for (const key of keys.sort()) {
        const encoded = encode(descriptors[key].value);
        if (encoded === undefined) return undefined;
        parts.push(`${JSON.stringify(key)}:${encoded}`);
      }
    }
    ancestors.delete(input);
    return array ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
  }
  // Unsupported values are outside persisted Prisma JSON; leave legacy callers alone.
  try {
    const encoded = encode(value);
    return encoded === undefined ? undefined : `raw-json-sha256:${createHash("sha256").update(encoded).digest("hex")}`;
  } catch {
    return undefined;
  }
}
