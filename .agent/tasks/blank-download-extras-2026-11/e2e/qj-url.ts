import { journalShortQrUrl } from "@/lib/journal-pdf-qr-link";
console.log(journalShortQrUrl("http://localhost:3000", process.argv[2], "hygiene"));
