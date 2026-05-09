interface SpeechRecognitionResult {
  readonly [index: number]: { transcript: string; confidence: number };
  readonly length: number;
}

interface SpeechRecognitionEvent {
  readonly results: SpeechRecognitionResult[];
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    SpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

export class VoiceRecognition {
  private rec: SpeechRecognitionInstance | null = null;

  start(onResult: (text: string) => void, onEnd: () => void) {
    const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
    if (!SR) throw new Error('Speech recognition unavailable');
    this.rec = new SR();
    this.rec.continuous = false;
    this.rec.interimResults = true;
    this.rec.lang = navigator.language || 'en-US';
    this.rec.onresult = (e: SpeechRecognitionEvent) => {
      const text = Array.from(e.results)
        .map((r: SpeechRecognitionResult) => r[0].transcript)
        .join('');
      onResult(text);
    };
    this.rec.onend = onEnd;
    this.rec.start();
  }

  stop() {
    this.rec?.stop();
  }
}

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  voice?: string;
}

export function speak(text: string, opts?: SpeakOptions) {
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts?.rate ?? 1.0;
  u.pitch = opts?.pitch ?? 0.95;
  if (opts?.voice) {
    const v = speechSynthesis.getVoices().find((v) => v.name.includes(opts.voice!));
    if (v) u.voice = v;
  }
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  speechSynthesis.cancel();
}

export function getAvailableVoices(): SpeechSynthesisVoice[] {
  return speechSynthesis.getVoices();
}
