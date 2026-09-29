'use strict';

/**
 * Онлайн принтер Wesetup — воркер.
 *
 * Спрашивает сервер, есть ли что печатать, забирает готовый PDF и
 * отправляет его на принтер. Каркас взят у агента Magday
 * (C:\www\managermagday\print-agent), но проще: HTML→PDF нам не нужен,
 * бланк уже собран сервером, поэтому puppeteer отсюда убран.
 *
 * Почему опрос, а не входящие соединения: машина с принтером стоит в
 * заведении за NAT, достучаться до неё снаружи нельзя.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOG_PATH = path.join(__dirname, 'logs', 'agent.log');
const VERSION = '1.0.0';

// Программа не должна падать от одиночной ошибки: она стоит на кассе без
// присмотра, и упавший агент замечают в худший момент — во время проверки.
process.on('uncaughtException', (err) => log(`СБОЙ: ${err.stack || err.message}`));
process.on('unhandledRejection', (reason) => log(`СБОЙ (promise): ${reason}`));

if (!fs.existsSync(CONFIG_PATH)) {
    console.log('\n  Нет config.json. Запустите setup.js — он подключит программу.\n');
    process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const apiUrl = String(config.apiUrl || '').replace(/\/+$/, '');
const pollIntervalMs = config.pollIntervalMs || 5000;
const maxLogBytes = (config.maxLogSizeMb || 10) * 1024 * 1024;

function log(message) {
    const line = `[${new Date().toLocaleString('ru-RU')}] ${message}\n`;
    process.stdout.write(line);
    try {
        fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
        // Ротация: лог живёт годами на машине, к которой никто не подходит.
        if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > maxLogBytes) {
            fs.renameSync(LOG_PATH, `${LOG_PATH}.1`);
        }
        fs.appendFileSync(LOG_PATH, line);
    } catch {
        /* некуда писать — консоли достаточно */
    }
}

function authHeaders() {
    return { Authorization: `Bearer ${config.agentToken}` };
}

async function poll() {
    const res = await fetch(`${apiUrl}/api/print/agent/poll`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) throw new Error('unauthorized');
    if (!res.ok) throw new Error(`poll HTTP ${res.status}`);
    return res.json();
}

async function report(jobId, ok, errorMessage) {
    const suffix = ok ? 'complete' : 'fail';
    await fetch(`${apiUrl}/api/print/jobs/${jobId}/${suffix}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(ok ? {} : { error: String(errorMessage).slice(0, 255) }),
        signal: AbortSignal.timeout(15000),
    }).catch((e) => log(`Не удалось отчитаться по заданию ${jobId}: ${e.message}`));
}

/** Сообщаем серверу выбранный принтер — дашборд показывает его в статусе. */
async function sendState() {
    try {
        await fetch(`${apiUrl}/api/print/agent/state`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                printerName: config.printerName || null,
                agentVersion: VERSION,
            }),
            signal: AbortSignal.timeout(15000),
        });
    } catch (e) {
        log(`Не удалось отправить состояние: ${e.message}`);
    }
}

/**
 * Печать PDF.
 *
 * Два пути, и оба работают из коробки. Если рядом лежит SumatraPDF.exe —
 * печатаем ею: она делает это молча, без окон и диалогов, и это самый
 * надёжный способ (так же устроен агент Я.Еды). Если её нет — печатаем
 * средствами самой Windows, чтобы программа работала сразу после
 * установки и ничего не пришлось доскачивать.
 */
function printPdf(file) {
    const sumatra = path.isAbsolute(config.sumatraPath || '')
        ? config.sumatraPath
        : path.join(__dirname, config.sumatraPath || 'SumatraPDF.exe');

    if (fs.existsSync(sumatra)) return printWithSumatra(sumatra, file);
    return printWithWindows(file);
}

function printWithSumatra(sumatra, file) {
    return new Promise((resolve, reject) => {
        const args = config.printerName
            ? ['-print-to', config.printerName, '-silent', file]
            : ['-print-to-default', '-silent', file];
        execFile(sumatra, args, { timeout: 120000 }, (err) =>
            err ? reject(err) : resolve(),
        );
    });
}

/**
 * Штатная печать Windows через обработчик PDF по умолчанию (Edge есть на
 * любой десятке). Медленнее Sumatra и может моргнуть окном, зато не
 * требует ничего доустанавливать.
 */
function printWithWindows(file) {
    return new Promise((resolve, reject) => {
        const target = config.printerName
            ? `Start-Process -FilePath '${file.replace(/'/g, "''")}' -Verb PrintTo -ArgumentList '${String(config.printerName).replace(/'/g, "''")}' -PassThru | Wait-Process -Timeout 120`
            : `Start-Process -FilePath '${file.replace(/'/g, "''")}' -Verb Print -PassThru | Wait-Process -Timeout 120`;
        execFile(
            'powershell',
            ['-NoProfile', '-NonInteractive', '-Command', target],
            { timeout: 150000 },
            (err) =>
                err
                    ? reject(
                          new Error(
                              'Windows не смогла напечатать файл. Положите SumatraPDF.exe рядом с программой — с ней печать надёжнее.',
                          ),
                      )
                    : resolve(),
        );
    });
}

async function handleJob(job) {
    log(`Задание ${job.id}: ${job.docTitle}`);
    const tmp = path.join(os.tmpdir(), `wesetup-print-${job.id}.pdf`);
    try {
        const res = await fetch(`${apiUrl}${job.pdfUrl}`, {
            headers: authHeaders(),
            signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) throw new Error(`не удалось скачать PDF журнала (HTTP ${res.status})`);
        fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));

        await printPdf(tmp);
        await report(job.id, true);
        log(`Задание ${job.id}: напечатано`);
    } catch (err) {
        log(`Задание ${job.id}: ошибка — ${err.message}`);
        await report(job.id, false, err.message);
    } finally {
        try {
            fs.unlinkSync(tmp);
        } catch {
            /* временный файл — не критично */
        }
    }
}

async function loop() {
    let quiet = false;
    for (;;) {
        try {
            const { job } = await poll();
            quiet = false;
            if (job) await handleJob(job);
        } catch (err) {
            if (err.message === 'unauthorized') {
                log('Ключ доступа отозван. Запустите setup.js и войдите заново.');
                await sleep(60000);
            } else if (!quiet) {
                // Первую ошибку пишем, повторяющиеся — нет: иначе лог
                // за ночь без интернета вырастет на сотню мегабайт.
                log(`Нет связи с Wesetup: ${err.message}`);
                quiet = true;
            }
        }
        await sleep(pollIntervalMs);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

log(`Онлайн принтер Wesetup ${VERSION}`);
log(`Сервер: ${apiUrl}`);
log(`Принтер: ${config.printerName || 'по умолчанию'}`);
log(
    fs.existsSync(path.join(__dirname, config.sumatraPath || 'SumatraPDF.exe'))
        ? 'Печать: SumatraPDF (тихая)'
        : 'Печать: средствами Windows. Для тихой печати положите рядом SumatraPDF.exe',
);
void sendState();
void loop();
