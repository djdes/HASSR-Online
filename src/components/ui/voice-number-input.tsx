"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNativeBridge, type NativeBridge } from "@/lib/native-bridge";
import { pickSpokenNumber, speechErrorMessage } from "@/lib/spoken-number";

type SpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
  resultIndex: number;
};
type SpeechRecognitionErrorLike = { error?: string };
type Ctor = { new (): SpeechRecognition };

function getSpeechCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: Ctor;
    webkitSpeechRecognition?: Ctor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceNumberInputProps = {
  /** Текущее значение в поле. */
  value: number | "" | null;
  /** Вызывается с распознанным числом (или `null`, если очистили голосом). */
  onChange: (next: number | null) => void;
  /** id связанного <input>. Кнопка будет помечена как его control. */
  inputId?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * Кнопка-микрофон для голосового ввода числа (температура, влажность,
 * вес партии). Использует Web Speech API (webkitSpeechRecognition).
 *
 * UX: один тап — началась запись, индикатор «слушаю», второй тап или
 * пауза — остановилась, распознано число, вызывается onChange.
 * Если браузер не поддерживает — кнопка прячется (return null), поле
 * работает как обычный number input.
 *
 * В приложении WeSetup для телефона — системное распознавание через плагин
 * SpeechRecognition: во встроенном браузере Android Web Speech есть, но
 * после разрешения микрофона молча ничего не делает (проверено на эмуляторе).
 */
export function VoiceNumberInput({
  value: _value,
  onChange,
  inputId,
  className,
  disabled,
}: VoiceNumberInputProps) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const nativeStopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const ctor = getSpeechCtor();
    setSupported(ctor !== null || nativeSpeech() !== null);
  }, []);

  useEffect(() => {
    return () => {
      nativeStopRef.current?.();
      recognitionRef.current?.abort?.();
      recognitionRef.current = null;
    };
  }, []);

  if (!supported) return null;

  function applyMatches(matches: readonly string[]) {
    const best = pickSpokenNumber(matches);
    if (best) {
      onChange(best.number);
      setHint(`${best.transcript.trim()} → ${best.number}`);
    } else if (matches.length === 0 || !matches[0]?.trim()) {
      setError(speechErrorMessage("no-speech"));
    } else {
      setError(`Не распознал число в «${matches[0].trim()}». Скажите ещё раз, например «два и восемь».`);
    }
  }

  async function startNative(bridge: NativeBridge) {
    setError(null);
    setHint(null);
    let handles: Array<Promise<{ remove: () => void | Promise<void> } | null>> = [];
    const cleanup = () => {
      nativeStopRef.current = null;
      for (const h of handles) void h.then((x) => x?.remove()).catch(() => undefined);
      handles = [];
    };
    try {
      const available = await bridge.call<{ available?: boolean }>("SpeechRecognition", "available");
      if (available?.available === false) {
        setError("Распознавание речи на этом телефоне недоступно. Введите число вручную.");
        return;
      }
      const permission = await bridge.call<{ speechRecognition?: string }>("SpeechRecognition", "requestPermissions");
      if (permission?.speechRecognition !== "granted") {
        setError(speechErrorMessage("permission"));
        return;
      }
      setListening(true);
      if (bridge.platform === "android") {
        // Системное окошко Android само слушает до паузы и возвращает варианты.
        const res = await bridge.call<{ matches?: string[] }>("SpeechRecognition", "start", {
          language: "ru-RU",
          maxResults: 3,
          partialResults: false,
          popup: true,
          prompt: "Скажите число, например «два и восемь»",
        });
        setListening(false);
        applyMatches(res?.matches ?? []);
        return;
      }
      // iOS: варианты приходят по ходу речи, запись останавливает кнопка или пауза.
      let latest: string[] = [];
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        cleanup();
        setListening(false);
        applyMatches(latest);
      };
      handles = [
        bridge.on("SpeechRecognition", "partialResults", (payload) => {
          const matches = (payload as { matches?: string[] } | null)?.matches;
          if (matches?.length) latest = matches;
        }),
        bridge.on("SpeechRecognition", "listeningState", (payload) => {
          if ((payload as { status?: string } | null)?.status === "stopped") finish();
        }),
      ];
      nativeStopRef.current = () => {
        void bridge.call("SpeechRecognition", "stop").catch(() => undefined);
        finish();
      };
      await bridge.call("SpeechRecognition", "start", { language: "ru-RU", maxResults: 3, partialResults: true });
    } catch (err) {
      cleanup();
      setListening(false);
      setError(speechErrorMessage(err instanceof Error ? err.message : String(err)));
    }
  }

  function start() {
    const bridge = nativeSpeech();
    if (bridge) {
      void startNative(bridge);
      return;
    }
    const ctor = getSpeechCtor();
    if (!ctor) return;
    const rec = new ctor();
    rec.lang = "ru-RU";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.onresult = (event) => {
      const result = event.results[event.resultIndex];
      const alternatives: string[] = [];
      for (let i = 0; i < result.length; i++) alternatives.push(result[i].transcript);
      applyMatches(alternatives);
    };
    rec.onerror = (event) => {
      const code = event.error ?? "unknown";
      if (code === "aborted") return;
      // Раньше: «Проверьте настройки браузера» и «Ошибка распознавания: network».
      setError(speechErrorMessage(code));
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    try {
      recognitionRef.current = rec;
      setError(null);
      setHint(null);
      rec.start();
      setListening(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить");
    }
  }

  function stop() {
    if (nativeStopRef.current) {
      nativeStopRef.current();
      return;
    }
    recognitionRef.current?.stop?.();
  }

  return (
    <div className={cn("flex flex-col items-stretch gap-1", className)}>
      <button
        type="button"
        aria-controls={inputId}
        aria-pressed={listening}
        aria-label={listening ? "Остановить запись" : "Голосовой ввод"}
        title={
          listening
            ? "Слушаю… Скажите «два и восемь» или «минус три»"
            : "Голосовой ввод температуры"
        }
        disabled={disabled}
        onClick={listening ? stop : start}
        className={cn(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border transition-all",
          listening
            ? "animate-pulse border-[#d2453d] bg-[#fff4f2] text-[#d2453d]"
            : "border-[#dcdfed] bg-white text-[#5566f6] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
      </button>
      {(hint || error) && (
        <div
          className={cn(
            "max-w-[220px] text-[11px] leading-tight",
            error ? "text-[#d2453d]" : "text-[#116b2a]"
          )}
        >
          {error ?? hint}
        </div>
      )}
    </div>
  );
}

/** Мост приложения WeSetup, если в нём есть системное распознавание речи. */
function nativeSpeech(): NativeBridge | null {
  const bridge = getNativeBridge();
  return bridge?.plugin("SpeechRecognition") ? bridge : null;
}
