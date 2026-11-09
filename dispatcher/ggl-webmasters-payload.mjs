// Data decoder only: no network, credentials, filesystem paths from input or model calls.
import { brotliDecompressSync } from 'node:zlib';
import { TextDecoder } from 'node:util';
const chunks = [];
let size = 0;
process.stdin.on('data', chunk => {
  size += chunk.length;
  if (size > 49003) { process.stderr.write('payload_too_large'); process.exit(1); }
  chunks.push(chunk);
});
process.stdin.on('end', () => {
  try {
    const raw = Buffer.concat(chunks);
    const clean = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf ? raw.subarray(3) : raw;
    if (clean.length > 49000) throw Error();
    const base64 = clean.toString('ascii');
    if (!base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw Error();
    const bytes = brotliDecompressSync(Buffer.from(base64, 'base64'), { maxOutputLength: 2600000 });
    const prompt = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (prompt.length > 650000 || !prompt.startsWith('type: wesetup_ggl_webmasters\n')) throw Error();
    process.stdout.write(prompt);
  } catch {
    process.stderr.write('invalid_ggl_payload');
    process.exitCode = 1;
  }
});
