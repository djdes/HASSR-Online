/**
 * LRU в памяти процесса с лимитом по объёму (байты), а не по числу
 * записей: листы журналов весят от десятков КБ до мегабайтов, и лимит
 * «100 записей» либо ничего не держит, либо съедает всю память PM2.
 *
 * Map хранит порядок вставки — свежесть поддерживаем, переставляя
 * запись в конец при каждом чтении.
 */
export class ByteLru<V> {
  private readonly map = new Map<string, { value: V; size: number }>();
  private total = 0;

  constructor(private readonly maxBytes: number) {}

  get bytes(): number {
    return this.total;
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, size: number): void {
    this.delete(key);
    if (size > this.maxBytes) return;
    this.map.set(key, { value, size });
    this.total += size;
    this.evict(key);
  }

  /** Запись выросла (дорисовали лист) — пересчитать объём и вытеснить лишнее. */
  resize(key: string, size: number): void {
    const hit = this.map.get(key);
    if (!hit) return;
    if (size > this.maxBytes) {
      this.delete(key);
      return;
    }
    this.total += size - hit.size;
    hit.size = size;
    this.map.delete(key);
    this.map.set(key, hit);
    this.evict(key);
  }

  delete(key: string): void {
    const hit = this.map.get(key);
    if (!hit) return;
    this.map.delete(key);
    this.total -= hit.size;
  }

  private evict(keep: string): void {
    for (const [key, entry] of this.map) {
      if (this.total <= this.maxBytes) break;
      if (key === keep) continue;
      this.map.delete(key);
      this.total -= entry.size;
    }
  }
}
