#!/usr/bin/env node
/**
 * Озвучка ролика «Как работает QR» через ElevenLabs.
 *
 *   node scripts/landing-video/voice.mjs --env D:/www/Wesetup.ru/.env --voice <voice_id>
 *   node scripts/landing-video/voice.mjs --env … --samples <папка> --voices id1,id2,id3
 *
 * Сценарий — `remotion/narration.ru.json`: `text` идёт в субтитры, `say` — в
 * синтез (подсказки произношения, число слов то же). Для каждого куска
 * запрос `POST /v1/text-to-speech/{voice}/with-timestamps` отдаёт MP3 и время
 * каждого символа; из них — время каждого слова `text`. Результат —
 * `public/landing/video/voice/ru/<file>.mp3` и `<file>.json`.
 *
 * Ключ: `ELEVENLABS_API_KEY` из окружения или из файла `--env`. Сеть: с этой
 * машины ElevenLabs закрыт по стране, поэтому запросы идут через прокси
 * `ELEVENLABS_PROXY_URL` или `TELEGRAM_PROXY_URL`. Транспорт — `curl`
 * (сам Node до прокси на этой машине не достаёт), ключ и прокси уходят ему
 * конфигом через stdin, а не в командной строке; в вывод они не печатаются.
 * Уже озвученный кусок с тем же текстом, голосом и настройками повторно не
 * запрашивается — кредиты не тратятся (`--force` перезаписывает).
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const API = "https://api.elevenlabs.io";

function args() {
  const out = {};
  const list = process.argv.slice(2);
  for (let i = 0; i < list.length; i += 1) {
    const key = list[i];
    if (!key.startsWith("--")) continue;
    const next = list[i + 1];
    if (next === undefined || next.startsWith("--")) out[key.slice(2)] = true;
    else {
      out[key.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

function readEnvFile(file) {
  if (!file || !existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return env;
}

const opts = args();
const fileEnv = readEnvFile(typeof opts.env === "string" ? opts.env : path.join(ROOT, ".env"));
const KEY = process.env.ELEVENLABS_API_KEY || fileEnv.ELEVENLABS_API_KEY;
const PROXY = process.env.ELEVENLABS_PROXY_URL || fileEnv.ELEVENLABS_PROXY_URL || process.env.TELEGRAM_PROXY_URL || fileEnv.TELEGRAM_PROXY_URL;
if (!KEY) {
  console.error("Нет ELEVENLABS_API_KEY (окружение или --env <путь к .env>).");
  process.exit(1);
}
const narration = JSON.parse(readFileSync(path.join(ROOT, "remotion/narration.ru.json"), "utf8"));
const MODEL = narration.model;
/** Спокойная дикция: стабильность чуть выше середины, без «актёрского» стиля. */
const SETTINGS = { stability: 0.55, similarity_boost: 0.8, style: 0, use_speaker_boost: true, speed: 1 };
const SEED = 4242;

const forConfig = (value) => String(value).replace(/\\/g, "/").replace(/"/g, '\\"');

/** Запрос к API через curl: конфиг (ключ, прокси) — через stdin. */
function api(pathname, { method = "GET", body } = {}) {
  const work = path.join(tmpdir(), `elevenlabs-${randomUUID()}`);
  mkdirSync(work, { recursive: true });
  const bodyFile = path.join(work, "body.json");
  const outFile = path.join(work, "out.json");
  if (body !== undefined) writeFileSync(bodyFile, body);
  const config = [
    `url = "${forConfig(`${API}${pathname}`)}"`,
    `request = "${method}"`,
    `header = "xi-api-key: ${forConfig(KEY)}"`,
    `header = "Content-Type: application/json"`,
    PROXY ? `proxy = "${forConfig(PROXY)}"` : null,
    body !== undefined ? `data-binary = "@${forConfig(bodyFile)}"` : null,
    `output = "${forConfig(outFile)}"`,
    "silent",
    "show-error",
    `max-time = "180"`,
    `write-out = "%{http_code}"`,
  ]
    .filter(Boolean)
    .join("\n");
  return new Promise((resolve, reject) => {
    const child = execFile("curl", ["--config", "-"], { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      try {
        if (error) throw new Error(`curl ${pathname}: ${stderr.trim().slice(0, 200)}`);
        const status = Number(stdout.trim());
        const text = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
        if (status < 200 || status >= 300) throw new Error(`ElevenLabs ${pathname}: HTTP ${status} ${text.slice(0, 300)}`);
        resolve(JSON.parse(text));
      } catch (failure) {
        reject(failure);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    });
    child.stdin.end(`${config}\n`);
  });
}

/** Длительность MP3 по заголовкам кадров (MPEG-1/2 Layer III). */
export function mp3Seconds(buffer) {
  let offset = 0;
  if (buffer.slice(0, 3).toString("latin1") === "ID3") {
    const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    offset = 10 + size;
  }
  const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let seconds = 0;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const version = (buffer[offset + 1] >> 3) & 0x03;
    const layer = (buffer[offset + 1] >> 1) & 0x03;
    const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
    const rateIndex = (buffer[offset + 2] >> 2) & 0x03;
    const padding = (buffer[offset + 2] >> 1) & 0x01;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
      offset += 1;
      continue;
    }
    const sampleRate = RATES[version][rateIndex];
    const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex] * 1000;
    const samples = version === 3 ? 1152 : 576;
    const length = Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
    seconds += samples / sampleRate;
    offset += length;
  }
  return seconds;
}

/**
 * Слова из посимвольных таймингов: слово `say` — непрерывный кусок без
 * пробелов, его время — от первого до последнего символа. Слова `text`
 * получают время слова `say` с тем же номером.
 */
function wordsFrom(segment, alignment) {
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const spoken = [];
  let current = null;
  for (let i = 0; i < chars.length; i += 1) {
    if (/\s/.test(chars[i])) {
      if (current) spoken.push(current);
      current = null;
      continue;
    }
    if (!current) current = { text: "", start: starts[i], end: ends[i] };
    current.text += chars[i];
    current.end = ends[i];
  }
  if (current) spoken.push(current);
  const shown = segment.text.split(/\s+/).filter(Boolean);
  if (shown.length !== spoken.length) {
    throw new Error(`${segment.id}: в text ${shown.length} слов, в озвучке ${spoken.length} — выровняйте say`);
  }
  return shown.map((text, index) => ({
    text,
    start: Number(spoken[index].start.toFixed(3)),
    end: Number(spoken[index].end.toFixed(3)),
  }));
}

function fingerprint(segment, voiceId) {
  return createHash("sha256").update(JSON.stringify({ say: segment.say, voiceId, MODEL, SETTINGS, SEED })).digest("hex").slice(0, 16);
}

async function synthesize(segment, voiceId, context = {}) {
  const body = {
    text: segment.say,
    model_id: MODEL,
    voice_settings: SETTINGS,
    seed: SEED,
    ...(context.previous ? { previous_text: context.previous } : {}),
    ...(context.next ? { next_text: context.next } : {}),
  };
  const result = await api(`/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const audio = Buffer.from(result.audio_base64, "base64");
  const words = wordsFrom(segment, result.alignment);
  return {
    audio,
    meta: {
      id: segment.id,
      text: segment.text,
      say: segment.say,
      model: MODEL,
      voiceId,
      settings: SETTINGS,
      seed: SEED,
      fingerprint: fingerprint(segment, voiceId),
      characters: segment.say.length,
      audioSeconds: Number(mp3Seconds(audio).toFixed(3)),
      speechStart: words[0].start,
      speechEnd: words[words.length - 1].end,
      words,
    },
  };
}

async function usage() {
  const sub = await api("/v1/user/subscription");
  return `${sub.character_count} из ${sub.character_limit}`;
}

async function voiceName(voiceId) {
  try {
    const voice = await api(`/v1/voices/${voiceId}`);
    return voice.name;
  } catch {
    return voiceId;
  }
}

async function samples(outDir, voiceIds) {
  mkdirSync(outDir, { recursive: true });
  const segment = narration.segments[0];
  for (const [index, voiceId] of voiceIds.entries()) {
    const name = await voiceName(voiceId);
    const slug = `${index + 1}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    const { audio, meta } = await synthesize(segment, voiceId);
    writeFileSync(path.join(outDir, `${slug}.mp3`), audio);
    writeFileSync(path.join(outDir, `${slug}.json`), `${JSON.stringify({ ...meta, voiceName: name }, null, 2)}\n`);
    console.log(`проба ${slug}: ${meta.audioSeconds} с, речь ${meta.speechStart}–${meta.speechEnd} с, ${meta.characters} симв.`);
  }
}

async function full(voiceId) {
  const outDir = path.join(ROOT, "public/landing/video/voice", narration.locale);
  mkdirSync(outDir, { recursive: true });
  const name = await voiceName(voiceId);
  let spent = 0;
  for (const [index, segment] of narration.segments.entries()) {
    const jsonPath = path.join(outDir, `${segment.file}.json`);
    const mp3Path = path.join(outDir, `${segment.file}.mp3`);
    if (!opts.force && existsSync(jsonPath) && existsSync(mp3Path)) {
      const old = JSON.parse(readFileSync(jsonPath, "utf8"));
      if (old.fingerprint === fingerprint(segment, voiceId) && old.text === segment.text) {
        console.log(`${segment.file}: уже озвучен — пропуск`);
        continue;
      }
    }
    const { audio, meta } = await synthesize(segment, voiceId, {
      previous: narration.segments[index - 1]?.say,
      next: narration.segments[index + 1]?.say,
    });
    spent += meta.characters;
    writeFileSync(mp3Path, audio);
    writeFileSync(jsonPath, `${JSON.stringify({ ...meta, voiceName: name }, null, 2)}\n`);
    console.log(`${segment.file}: ${meta.audioSeconds} с, речь до ${meta.speechEnd} с, ${meta.characters} симв.`);
  }
  console.log(`Потрачено в этом запуске: ${spent} симв.`);
}

if (typeof opts.samples === "string") {
  const voices = String(opts.voices ?? "").split(",").filter(Boolean);
  if (voices.length === 0) throw new Error("--voices id1,id2,…");
  await samples(path.resolve(opts.samples), voices);
} else {
  if (typeof opts.voice !== "string") throw new Error("--voice <voice_id>");
  await full(opts.voice);
}
console.log(`Кредиты ElevenLabs за месяц: ${await usage()}`);
