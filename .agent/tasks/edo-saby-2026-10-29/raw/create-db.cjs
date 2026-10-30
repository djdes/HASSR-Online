// Создаёт локальную БД wesetup_edo копией wesetup_memos (127.0.0.1:5432, НЕ прод-туннель 5433).
const { Client } = require("pg");

async function main() {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const c = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/postgres" });
    await c.connect();
    try {
      const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = 'wesetup_edo'");
      if (exists.rowCount) {
        console.log("wesetup_edo already exists");
        return;
      }
      await c.query("CREATE DATABASE wesetup_edo TEMPLATE wesetup_memos");
      console.log("created wesetup_edo");
      return;
    } catch (e) {
      console.log(`attempt ${attempt}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 4000));
    } finally {
      await c.end();
    }
  }
  process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
