/*
 * Self-time breakdown of the long main-thread tasks in a DevTools trace
 * (written by measure-staff-dialog.cjs with TRACE=...).
 *
 *   node .agent/tasks/staff-dialog-lag-2026-11-23/raw/analyze-trace.cjs trace.json
 */
const fs = require("node:fs");

const file = process.argv[2];
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const events = raw.traceEvents || raw;

const mainThreads = new Set(
  events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`),
);
const slices = events
  .filter((e) => e.ph === "X" && mainThreads.has(`${e.pid}:${e.tid}`) && typeof e.dur === "number")
  .sort((a, b) => a.ts - b.ts || b.dur - a.dur);

// Self time per event name inside each long top-level task.
const LONG_US = 50_000;
const tasks = [];
const stack = [];
for (const e of slices) {
  while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
  const node = { e, end: e.ts + e.dur, self: e.dur, children: [] };
  if (stack.length) {
    const parent = stack[stack.length - 1];
    parent.self -= e.dur;
    parent.children.push(node);
  } else {
    tasks.push(node);
  }
  stack.push(node);
}

function collect(node, acc) {
  const key = node.e.name;
  acc[key] = (acc[key] || 0) + Math.max(0, node.self);
  for (const child of node.children) collect(child, acc);
  return acc;
}

function details(node, out) {
  if (node.e.name === "UpdateLayoutTree" || node.e.name === "RecalculateStyles") {
    out.push({ style_ms: Math.round(node.e.dur / 1000), elements: node.e.args?.elementCount ?? node.e.args?.data?.elementCount ?? null });
  }
  for (const child of node.children) details(child, out);
  return out;
}

const long = tasks.filter((t) => t.e.dur >= LONG_US);
for (const task of long) {
  const acc = collect(task, {});
  const top = Object.entries(acc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, us]) => `${name}=${Math.round(us / 1000)}ms`);
  const styles = details(task, []).filter((s) => s.style_ms >= 5);
  console.log(`task ${Math.round(task.e.dur / 1000)}ms: ${top.join(", ")}`);
  if (styles.length) console.log(`   style recalcs: ${JSON.stringify(styles)}`);
}
