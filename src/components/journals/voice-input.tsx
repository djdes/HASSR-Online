"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { getNativeBridge } from "@/lib/native-bridge";

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognition;
    SpeechRecognition?: new () => SpeechRecognition;
  }
}

interface SpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}

const noopSubscribe = () => () => {};

const NOTHING_HEARD = "Ничего не расслышали. Попробуйте ещё раз поближе к телефону.";

export function VoiceInput({
  value,
  onChange,
  placeholder,
  rows = 3,
  required,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  id?: string;
}) {
  const [recording, setRecording] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  // Приложение WeSetup для телефона: системное распознавание речи через
  // плагин — во встроенном браузере Web Speech API нет или он не работает.
  const native = useSyncExternalStore(
    noopSubscribe,
    () => Boolean(getNativeBridge()?.plugin("SpeechRecognition")),
    () => false
  );
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const nativeCleanupRef = useRef<(() => void) | null>(null);
  // iOS: завершение записи (кнопкой или паузой) — одно на запись.
  const nativeFinishRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (native) return;
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setUnsupported(true);
    }
  }, [native]);

  // Ушли со страницы во время записи — выключаем микрофон, а не только
  // перестаём слушать ответы.
  useEffect(
    () => () => {
      if (nativeFinishRef.current) {
        void getNativeBridge()?.call("SpeechRecognition", "stop").catch(() => undefined);
      }
      nativeFinishRef.current = null;
      nativeCleanupRef.current?.();
    },
    []
  );

  const toggleNative = useCallback(async () => {
    const bridge = getNativeBridge();
    if (!bridge) return;
    if (recording) {
      await bridge.call("SpeechRecognition", "stop").catch(() => undefined);
      if (nativeFinishRef.current) {
        nativeFinishRef.current();
      } else {
        nativeCleanupRef.current?.();
        setRecording(false);
      }
      return;
    }
    const denied = "Разрешите микрофон и распознавание речи в настройках телефона";
    try {
      const available = await bridge.call<{ available?: boolean }>("SpeechRecognition", "available");
      if (available?.available === false) {
        toast.error("Распознавание речи на этом телефоне недоступно. Наберите текст вручную.");
        return;
      }
      const permission = await bridge.call<{ speechRecognition?: string }>(
        "SpeechRecognition",
        "requestPermissions"
      );
      if (permission?.speechRecognition !== "granted") {
        toast.error(denied);
        return;
      }
      // Новый текст — через пробел после уже набранного.
      const base = value.trim() ? value.replace(/\s*$/, " ") : "";
      setRecording(true);
      if (bridge.platform === "android") {
        // Системное окошко Android само слушает до паузы и возвращает текст.
        const res = await bridge.call<{ matches?: string[] }>("SpeechRecognition", "start", {
          language: "ru-RU",
          maxResults: 1,
          partialResults: false,
          popup: true,
          prompt: "Говорите",
        });
        const text = res?.matches?.[0];
        if (text) onChange(base + text);
        setRecording(false);
        return;
      }
      // iOS: текст приходит по ходу речи, запись останавливает кнопка.
      let latest = "";
      const finish = () => {
        // Уже завершили (кнопкой, ошибкой, уходом со страницы) — второй
        // сигнал «запись остановлена» ничего не делает.
        if (nativeFinishRef.current !== finish) return;
        nativeFinishRef.current = null;
        nativeCleanupRef.current?.();
        setRecording(false);
        // iOS молча выключает запись, если речи не было: без сообщения
        // человек не понимал, почему поле осталось пустым.
        if (!latest) toast.error(NOTHING_HEARD);
      };
      nativeFinishRef.current = finish;
      const handles = [
        bridge.on("SpeechRecognition", "partialResults", (payload) => {
          const text = (payload as { matches?: string[] } | null)?.matches?.[0];
          if (!text) return;
          latest = text;
          onChange(base + latest);
        }),
        bridge.on("SpeechRecognition", "listeningState", (payload) => {
          if ((payload as { status?: string } | null)?.status === "stopped") finish();
        }),
      ];
      nativeCleanupRef.current = () => {
        nativeCleanupRef.current = null;
        for (const h of handles) void h.then((x) => x?.remove()).catch(() => undefined);
      };
      await bridge.call("SpeechRecognition", "start", {
        language: "ru-RU",
        maxResults: 1,
        partialResults: true,
      });
    } catch (err) {
      nativeFinishRef.current = null;
      nativeCleanupRef.current?.();
      setRecording(false);
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        /permission|denied|access/i.test(message)
          ? denied
          : /no match|didn.t understand/i.test(message)
            ? NOTHING_HEARD
            : "Запись прервалась. Попробуйте ещё раз или наберите текст вручную."
      );
    }
  }, [recording, value, onChange]);

  const toggleRecording = useCallback(() => {
    if (native) {
      void toggleNative();
      return;
    }
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const rec = new SpeechRecognition();
    rec.lang = "ru-RU";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalTranscript = "";

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.results.length - 1; i >= 0; i--) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + " ";
        } else {
          interim = result[0].transcript;
        }
      }
      onChange(value + finalTranscript + interim);
    };

    // Раньше кнопка при любом сбое просто гасла — человек жал её снова и снова,
    // не понимая, что микрофон запрещён в настройках телефона.
    rec.onerror = (event) => {
      setRecording(false);
      const code = event?.error;
      if (code === "aborted") return;
      toast.error(
        code === "not-allowed" || code === "service-not-allowed"
          ? "Доступ к микрофону запрещён. Разрешите его в настройках телефона или наберите текст вручную."
          : code === "no-speech"
            ? NOTHING_HEARD
            : code === "audio-capture"
              ? "Микрофон недоступен. Наберите текст вручную."
              : code === "network"
                ? "Нет связи: распознавание речи не работает. Наберите текст вручную."
                : "Запись прервалась. Попробуйте ещё раз или наберите текст вручную.",
      );
    };

    rec.onend = () => {
      setRecording(false);
    };

    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
  }, [native, toggleNative, recording, value, onChange]);

  if (unsupported && !native) {
    return (
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        required={required}
        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
    );
  }

  return (
    <div className="relative">
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        required={required}
        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <button
        type="button"
        onClick={toggleRecording}
        className={`absolute right-2 top-2 rounded-full p-1.5 transition-colors ${
          recording
            ? "animate-pulse bg-red-500 text-white"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
        title={recording ? "Остановить запись" : "Голосовой ввод"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
      </button>
      {recording ? (
        <div className="absolute right-2 top-10 rounded bg-slate-800 px-2 py-0.5 text-[10px] text-white">
          Слушаем…
        </div>
      ) : null}
    </div>
  );
}
