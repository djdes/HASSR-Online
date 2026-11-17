"""HTML-часть письма .eml → файл; картинки боевого домена — на локальные public/ (их ещё нет на проде)."""
import email, sys, os
src, dst, public = sys.argv[1], sys.argv[2], sys.argv[3]
msg = email.message_from_string(open(src).read())
html = None
for part in msg.walk():
    if part.get_content_type() == "text/html":
        html = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8")
html = html.replace("https://wesetup.ru/email/", "file://" + os.path.join(public, "email") + "/")
open(dst, "w").write(html)
