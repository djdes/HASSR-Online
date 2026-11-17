"""Минимальный SMTP-приёмник для e2e: принимает всё, письма кладёт файлами .eml."""
import asyncio, os, sys, time
OUT = sys.argv[1]; PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 2525
async def handle(reader, writer):
    w = lambda s: writer.write((s + "\r\n").encode())
    w("220 sink ESMTP"); await writer.drain()
    data_mode = False; buf = []
    while True:
        line = await reader.readline()
        if not line: break
        text = line.decode("utf-8", "replace")
        if data_mode:
            if text.rstrip("\r\n") == ".":
                data_mode = False
                name = os.path.join(OUT, f"{time.time_ns()}.eml")
                open(name, "w").write("".join(buf)); buf = []
                w("250 OK"); await writer.drain(); continue
            buf.append(text[1:] if text.startswith("..") else text); continue
        cmd = text.strip().upper()
        if cmd.startswith("EHLO"): w("250-sink"); w("250 8BITMIME")
        elif cmd.startswith("DATA"): data_mode = True; w("354 go")
        elif cmd.startswith("QUIT"): w("221 bye"); await writer.drain(); break
        else: w("250 OK")
        await writer.drain()
    writer.close()
async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", PORT)
    async with server: await server.serve_forever()
asyncio.run(main())
