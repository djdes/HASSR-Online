/*
 * Minifies src/app/motion.css the way `next build --webpack` does (cssnano-simple, the minifier of
 * Next's CssMinimizerPlugin) and compares what went in with what came out: a rule the minifier
 * drops silently would never reach production.
 *
 *   node .agent/tasks/site-motion-2026-11-22/raw/prod-minify.cjs
 */
const path = require("path");
const fs = require("fs");
const root = process.cwd();
const postcss = require(path.join(root, "node_modules/postcss"));
const cssnanoSimple = require(path.join(root, "node_modules/next/dist/compiled/cssnano-simple"));
const file = path.join(root, "src/app/motion.css");
const input = fs.readFileSync(file, "utf8");
const count = (css) => {
  let rules = 0, declarations = 0, keyframes = 0;
  postcss.parse(css).walk((node) => {
    if (node.type === "rule") rules += 1;
    if (node.type === "decl") declarations += 1;
    if (node.type === "atrule" && node.name === "keyframes") keyframes += 1;
  });
  return { rules, declarations, keyframes };
};
postcss([cssnanoSimple({}, postcss)]).process(input, { from: file }).then((result) => {
  const before = count(input);
  const after = count(result.css);
  // Minified spellings: `::before` → `:before`, attribute values lose their quotes.
  const probes = [":has(", ":before", "[data-liquid-dir=up]", "motion-sheet-in", "@layer base", "(width < 40rem)", "--lq-lead", "data-view-still", "prefers-reduced-motion", "var(--spring-soft)", "@media print"];
  const kept = Object.fromEntries(probes.map((probe) => [probe, result.css.includes(probe)]));
  const same = JSON.stringify(before) === JSON.stringify(after) && Object.values(kept).every(Boolean);
  console.log(JSON.stringify({ file: "src/app/motion.css", bytes: { source: input.length, minified: result.css.length }, before, after, kept, nothingDropped: same }, null, 1));
  process.exit(same ? 0 : 1);
});
