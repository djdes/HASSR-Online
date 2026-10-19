// Сводка ESLint (stdin — `eslint --format json`) для evidence.
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  const files = JSON.parse(raw);
  let errors = 0;
  let warnings = 0;
  for (const file of files) {
    errors += file.errorCount;
    warnings += file.warningCount;
    const rel = file.filePath.split("pages-points")[1]?.replace(/^[\\/]/, "") ?? file.filePath;
    console.log(`${rel} errors=${file.errorCount} warnings=${file.warningCount}`);
    for (const message of file.messages) console.log(`    ${message.line}:${message.column} ${message.ruleId} ${message.message}`);
  }
  console.log(`TOTAL files=${files.length} errors=${errors} warnings=${warnings}`);
});
