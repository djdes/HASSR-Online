"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice-input для textarea. Использует Web Speech API (Chrome/Safari)
 * для real-time транскрипции на родном устройстве — без отправки аудио
 * на сервер. На неподдерживаемых браузерах (часть Telegram WebApp на
 * iOS, Firefox) деградирует в обычный textarea.
 *
 * Race fix (decemberreview-find P0 #2): finalTranscript храним в ref
 * (а не в `let` внутри toggleRecording), и при `onresult` берём
 * стартовое value из props через ref'у. Без этого fix'а каждый
 * следующий final-event дублировал прошлый текст: `value` в closure
 * был stale, и `onChange(value + finalTranscript + interim)` каждый
 * раз перезаписывал свежие правки пользователя.
 */

// Web Speech API — declare global уже сделан в src/components/journals/voice-input.tsx
// (shared, поток 1), плюс TypeScript 5.6+ может ship'ить встроенные типы.
// Дублировать interface Window — конфликт TS2717. Используем структурную
// типизацию через cast: `window as unknown as { ... }` — никакой
// global-declarations не делаем, локальные types для events.
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};
type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Почему запись не пошла — словами, и что делать дальше. */
function micErrorText(code?: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Доступ к микрофону запрещён. Разрешите его в настройках телефона — или просто наберите текст вручную.";
  }
  if (code === "no-speech") {
    return "Ничего не расслышали. Попробуйте ещё раз поближе к телефону.";
  }
  if (code === "audio-capture") {
    return "Микрофон недоступен. Наберите текст вручную.";
  }
  if (code === "network") {
    return "Нет связи — распознавание речи не работает. Наберите текст вручную.";
  }
  return "Запись прервалась. Попробуйте ещё раз или наберите текст вручную.";
}

export function VoiceInput({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const [recording, setRecording] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  // Отказ в доступе к микрофону раньше просто гасил запись: человек
  // жал кнопку, ничего не происходило, и он жал снова.
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Базовое значение textarea на момент старта записи — все final/interim
  // транскрипты дописываются именно к нему, чтобы не было «снежного кома»
  // (см. JSDoc выше: stale-closure caused doubling).
  const baseValueRef = useRef<string>("");
  // Накопленные final-фрагменты текущей сессии записи. Reset на старте.
  const finalAccRef = useRef<string>("");

  useEffect(() => {
    if (!getSpeechRecognitionCtor()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnsupported(true);
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    // Зафиксировать базу один раз — больше «эффекта снежного кома».
    baseValueRef.current = value;
    finalAccRef.current = "";
    setMicError(null);

    rec.onresult = (event) => {
      // Iterate forward from event.resultIndex — Web Speech API кладёт
      // в `event.results` накопленный массив за всю сессию, но `resultIndex`
      // указывает первый НОВЫЙ result в этом конкретном событии. Берём
      // только новые final'ы и текущий interim, чтобы не дублировать.
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalAccRef.current += transcript + " ";
        } else {
          interim = transcript;
        }
      }
      onChange(baseValueRef.current + finalAccRef.current + interim);
    };

    rec.onerror = (event) => {
      setRecording(false);
      setMicError(micErrorText(event?.error));
    };

    rec.onend = () => {
      setRecording(false);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setRecording(true);
    } catch {
      setMicError("Не получилось включить запись. Наберите текст вручную.");
    }
  }, [recording, value, onChange]);

  if (unsupported) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full rounded-xl px-3 py-2 text-[16px] outline-none"
        style={{
          background: "var(--mini-surface-2)",
          border: "1px solid var(--mini-divider-strong)",
          color: "var(--mini-text)",
        }}
      />
    );
  }

  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        // 16 px — иначе iOS увеличивает страницу при фокусе.
        className="w-full rounded-xl px-3 py-2 pr-10 text-[16px] outline-none"
        style={{
          background: "var(--mini-surface-2)",
          border: "1px solid var(--mini-divider-strong)",
          color: "var(--mini-text)",
        }}
      />
      <button
        type="button"
        onClick={toggleRecording}
        className={`absolute right-2 top-2 rounded-full p-1.5 transition-colors ${
          recording ? "animate-pulse" : ""
        }`}
        style={
          recording
            ? { background: "var(--mini-crimson)", color: "#fff" }
            : { background: "var(--mini-surface-1)", color: "var(--mini-text-muted)" }
        }
        aria-label={recording ? "Остановить запись" : "Голосовой ввод"}
        title={recording ? "Остановить запись" : "Голосовой ввод"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
      </button>
      {recording ? (
        <div
          className="absolute right-2 top-10 rounded px-2 py-0.5 text-[10px]"
          style={{ background: "var(--mini-surface-1)", color: "var(--mini-text)" }}
        >
          Слушаем…
        </div>
      ) : null}
      {micError ? (
        <p
          className="mt-1.5 text-[12px] leading-4"
          style={{ color: "var(--mini-crimson)" }}
        >
          {micError}
        </p>
      ) : null}
    </div>
  );
}
