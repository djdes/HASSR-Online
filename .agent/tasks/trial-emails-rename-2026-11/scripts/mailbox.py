"""Список писем из папки SMTP-приёмника: время, кому, тема (по порядку)."""
import email, glob, os, sys, json
from email.header import decode_header, make_header
out = []
for path in sorted(glob.glob(os.path.join(sys.argv[1], "*.eml"))):
    msg = email.message_from_string(open(path).read())
    out.append({"file": os.path.basename(path), "to": str(make_header(decode_header(msg["To"] or ""))), "subject": str(make_header(decode_header(msg["Subject"] or "")))})
print(json.dumps(out, ensure_ascii=False, indent=1))
