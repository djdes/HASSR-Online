// Проверка целостности рабочей копии на D: (диск подменяет содержимое файлов,
// сохраняя размер и mtime — `git status` этого не видит). Хэширует КАЖДЫЙ
// отслеживаемый файл и сравнивает с индексом.
//   node integrity.cjs d:/wt/kp [--restore]
// --restore: испорченные файлы (кроме изменённых мной — список ALLOW) удаляются
// и достаются из git заново.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = process.argv[2] || "d:/wt/kp";
const restore = process.argv.includes("--restore");
const git = (args, input) =>
  execFileSync("git", ["-C", repo, "-c", "core.quotepath=false", ...args], {
    input,
    maxBuffer: 1024 * 1024 * 512,
    encoding: "utf8",
  });

const entries = git(["ls-files", "-s", "-z"])
  .split("\0")
  .filter(Boolean)
  .map((line) => {
    const tab = line.indexOf("\t");
    const [mode, sha] = line.slice(0, tab).split(" ");
    return { mode, sha, file: line.slice(tab + 1) };
  })
  .filter((e) => e.mode !== "160000" && e.mode !== "120000");

// Файлы, изменённые осознанно (git diff против HEAD по stat) — их не трогаем.
const changed = new Set(git(["diff", "--name-only", "-z", "HEAD"]).split("\0").filter(Boolean));

const missing = [];
const present = [];
for (const e of entries) {
  if (fs.existsSync(path.join(repo, e.file))) present.push(e);
  else missing.push(e.file);
}
const hashes = git(["hash-object", "--stdin-paths"], present.map((e) => e.file).join("\n") + "\n")
  .split("\n")
  .filter(Boolean);
if (hashes.length !== present.length) throw new Error(`hash count mismatch ${hashes.length} vs ${present.length}`);
const corrupt = [];
present.forEach((e, i) => {
  if (hashes[i] !== e.sha && !changed.has(e.file)) corrupt.push(e.file);
});
console.log(`files=${entries.length} changedByMe=${changed.size} missing=${missing.length} corrupt=${corrupt.length}`);
for (const f of corrupt.slice(0, 200)) console.log(`CORRUPT ${f}`);
for (const f of missing.slice(0, 50)) console.log(`MISSING ${f}`);
if (restore && (corrupt.length || missing.length)) {
  for (const f of corrupt) fs.rmSync(path.join(repo, f), { force: true });
  const targets = [...corrupt, ...missing];
  for (let i = 0; i < targets.length; i += 200) {
    git(["checkout", "--", ...targets.slice(i, i + 200)]);
  }
  console.log(`restored ${targets.length}`);
}
