"""Minimal local SMTP sink for the CRM checks: accepts every letter and logs
envelope + subject to the file given as argv[2]. Listens on 127.0.0.1:argv[1].
No STARTTLS, no auth — local verification only."""
import asyncio
import email
import email.header
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 2525
LOG = sys.argv[2] if len(sys.argv) > 2 else "smtp-sink.log"
EML_DIR = sys.argv[3] if len(sys.argv) > 3 else None
COUNTER = {"n": 0}


def decode(value: str) -> str:
    return "".join(
        part.decode(charset or "utf-8", "replace") if isinstance(part, bytes) else part
        for part, charset in email.header.decode_header(value or "")
    )


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    def send(line: str) -> None:
        writer.write((line + "\r\n").encode())

    send("220 sink ESMTP")
    await writer.drain()
    sender, rcpts = "", []
    while True:
        raw = await reader.readline()
        if not raw:
            break
        line = raw.decode(errors="replace").strip()
        verb = line.split(" ", 1)[0].upper()
        if verb in ("EHLO", "HELO"):
            send("250-sink")
            send("250 8BITMIME")
        elif verb == "MAIL":
            sender, rcpts = line[10:].strip("<> "), []
            send("250 OK")
        elif verb == "RCPT":
            rcpts.append(line[8:].strip("<> "))
            send("250 OK")
        elif verb == "DATA":
            send("354 go")
            await writer.drain()
            chunks = []
            while True:
                data = await reader.readline()
                if data in (b".\r\n", b".\n", b""):
                    break
                chunks.append(data[1:] if data.startswith(b"..") else data)
            raw = b"".join(chunks)
            message = email.message_from_bytes(raw)
            files = [decode(part.get_filename() or "") for part in message.walk() if part.get_filename()]
            COUNTER["n"] += 1
            if EML_DIR:
                import os
                os.makedirs(EML_DIR, exist_ok=True)
                with open(os.path.join(EML_DIR, f"{COUNTER['n']:03d}.eml"), "wb") as out:
                    out.write(raw)
            with open(LOG, "a", encoding="utf-8") as log:
                log.write(f"#{COUNTER['n']:03d} FROM={sender} TO={','.join(rcpts)} REPLY-TO={message.get('Reply-To', '')} SUBJECT={decode(message.get('Subject', ''))} FILES={'|'.join(files)}\n")
            send("250 queued")
        elif verb == "QUIT":
            send("221 bye")
            await writer.drain()
            break
        else:
            send("250 OK")
        await writer.drain()
    writer.close()


async def main() -> None:
    server = await asyncio.start_server(handle, "127.0.0.1", PORT)
    async with server:
        await server.serve_forever()


asyncio.run(main())
