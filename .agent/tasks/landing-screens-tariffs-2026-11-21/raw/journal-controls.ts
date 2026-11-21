import "dotenv/config";
import { updateJournalControls } from "../../../../src/lib/journal-controls.server";
import { AUTOMATION_ALL_ON, AUTOMATION_OFF } from "../../../../src/lib/journal-controls";
const on = process.argv[2] === "on";
updateJournalControls("cmwpyvi9a0000rd7dqek1lstn", { automation: { ...(on ? AUTOMATION_ALL_ON : AUTOMATION_OFF) } })
  .then((c) => { console.log(JSON.stringify(c.automation)); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
