// Prisma cannot model this partial index; it is maintained by the application.
const PRESERVED_INDEX = 'PartnerClient_one_active_per_org';
function additiveSchemaSql(diff) {
  const preserved = [];
  const statements = diff.replace(/^\s*--[^\n]*(?:\n|$)/gm, '').split(';').map(s=>s.trim()).filter(Boolean);
  const accepted=[];
  for(const statement of statements) {
    if(statement === `DROP INDEX "${PRESERVED_INDEX}"`) { preserved.push(PRESERVED_INDEX); continue; }
    const create = /^CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\s+/i.test(statement);
    const add = /^ALTER TABLE\s+"[^"]+"\s+ADD\s+(?:COLUMN|CONSTRAINT)\s+/i.test(statement);
    if((!create && !add) || /\b(?:DROP|TRUNCATE|RENAME)\b|\bALTER\s+COLUMN\b|\bSET\s+DATA\s+TYPE\b/i.test(statement)) throw new Error('Schema diff contains a non-additive operation; manual review is required');
    accepted.push(statement+';');
  }
  return {sql:accepted.join('\n\n'),preserved,statementCount:accepted.length};
}
module.exports={additiveSchemaSql};
