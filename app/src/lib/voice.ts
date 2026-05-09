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

const PREFERRED_VOICES = [
  'Daniel',
  'Google UK English Male',
  'Microsoft David',
  'Alex',
  'Fred',
];

function selectVoice(preference?: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  if (preference) {
    const match = voices.find((v) => v.name.includes(preference));
    if (match) return match;
  }
  for (const name of PREFERRED_VOICES) {
    const match = voices.find((v) => v.name.includes(name));
    if (match) return match;
  }
  return voices.find((v) => v.lang.startsWith('en')) ?? voices[0];
}

export function speak(text: string, opts?: SpeakOptions) {
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts?.rate ?? 1.0;
  u.pitch = opts?.pitch ?? 0.95;
  u.voice = selectVoice(opts?.voice) ?? null;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

export function playTone(type: 'activate' | 'deactivate' | 'notify') {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    gain.gain.value = 0.15;
    const now = ctx.currentTime;

    if (type === 'activate') {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.linearRampToValueAtTime(880, now + 0.15);
      gain.gain.linearRampToValueAtTime(0, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'deactivate') {
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.linearRampToValueAtTime(330, now + 0.15);
      gain.gain.linearRampToValueAtTime(0, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else {
      osc.frequency.setValueAtTime(587, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }

    osc.onended = () => ctx.close();
  } catch { /* AudioContext unavailable */ }
}

export function stopSpeaking() {
  speechSynthesis.cancel();
}

export function getAvailableVoices(): SpeechSynthesisVoice[] {
  return speechSynthesis.getVoices();
}

const WAKE_PHRASES = ['hey jarvis', 'jarvis', 'hey samix', 'samix'];

export class WakeWordListener {
  private rec: SpeechRecognitionInstance | null = null;
  private active = false;

  start(onWake: () => void) {
    const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
    if (!SR) throw new Error('Speech recognition unavailable');
    this.rec = new SR();
    this.rec.continuous = true;
    this.rec.interimResults = false;
    this.rec.lang = navigator.language || 'en-US';
    this.active = true;

    this.rec.onresult = (e: SpeechRecognitionEvent) => {
      for (const result of Array.from(e.results)) {
        const transcript = result[0].transcript.toLowerCase().trim();
        if (WAKE_PHRASES.some((p) => transcript.includes(p))) {
          onWake();
          break;
        }
      }
    };

    this.rec.onend = () => {
      if (this.active) {
        setTimeout(() => {
          try { this.rec?.start(); } catch { /* already started */ }
        }, 100);
      }
    };

    this.rec.start();
  }

  stop() {
    this.active = false;
    this.rec?.stop();
    this.rec = null;
  }

  get isActive() {
    return this.active;
  }
}
