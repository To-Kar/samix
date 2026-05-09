import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { ApiClient, Article } from '../lib/api';
import type { AgentMode } from './ModeSelector';
import { VoiceRecognition, speak, stopSpeaking } from '../lib/voice';

export interface ChatHandle {
  focusInput: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  costUsd?: number;
  timestamp: Date;
}

interface Props {
  api: ApiClient;
  mode: AgentMode;
  onCostUpdate: (cost: number) => void;
}

const MODE_SLUG: Record<AgentMode, string> = {
  jarvis: 'jarvis',
  'web-search': 'web-search',
  'url-summary': 'url-summary',
  'newsletter-ai': 'newsletter-ai',
};

const MODE_PLACEHOLDER: Record<AgentMode, string> = {
  jarvis: 'Ask Jarvis...',
  'web-search': 'Search the web...',
  'url-summary': 'Paste a URL to summarise...',
  'newsletter-ai': 'Trigger newsletter run...',
};

export const Chat = forwardRef<ChatHandle, Props>(function Chat({ api, mode, onCostUpdate }, ref) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [articleContext, setArticleContext] = useState<Article[] | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<VoiceRecognition | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalCostRef = useRef(0);

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
  }));

  // Load recent articles for context injection
  useEffect(() => {
    api.listArticles({ limit: 5 }).then(setArticleContext).catch(() => {});
  }, [api]);

  // Listen for screenshot hotkey
  useEffect(() => {
    const unlisten = listen('screenshot:requested', async () => {
      try {
        const dataUrl = await invoke<string>('capture_screen');
        setPendingImage(dataUrl);
        inputRef.current?.focus();
      } catch { /* screenshot unavailable */ }
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const buildHistory = useCallback((): Array<{ role: 'user' | 'assistant'; content: string }> => {
    const hist: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // Inject article context as hidden first exchange
    if (articleContext && articleContext.length > 0 && hist.length === 0 && messages.length === 0) {
      const contextBlock = articleContext
        .map((a) => `- ${a.title}: ${a.summary}`)
        .join('\n');
      hist.push({
        role: 'user',
        content: `[context: recent curated articles]\n${contextBlock}\n[end context — user message follows]`,
      });
      hist.push({ role: 'assistant', content: 'Got it.' });
    }

    for (const msg of messages) {
      hist.push({ role: msg.role, content: msg.content });
    }

    return hist;
  }, [messages, articleContext]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const images = pendingImage ? [pendingImage] : undefined;
    setPendingImage(null);

    try {
      const history = buildHistory();
      const slug = MODE_SLUG[mode];
      const result = await api.askAgent(slug, text, {
        history: history.length > 0 ? history : undefined,
        images,
      });

      const content =
        result.output?.content ??
        result.error ??
        'No response';

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        costUsd: result.costUsd,
        timestamp: new Date(),
      };

      totalCostRef.current += result.costUsd;
      onCostUpdate(totalCostRef.current);
      setMessages((prev) => [...prev, assistantMsg]);

      const voiceEnabled = localStorage.getItem('samix_voice_output') !== 'false';
      if (voiceEnabled && content) {
        setSpeaking(true);
        speak(content, {
          rate: Number(localStorage.getItem('samix_voice_rate') || '1.0'),
          voice: localStorage.getItem('samix_voice_name') || undefined,
        });
        const check = setInterval(() => {
          if (!speechSynthesis.speaking) { setSpeaking(false); clearInterval(check); }
        }, 200);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    setMessages([]);
    totalCostRef.current = 0;
    onCostUpdate(0);
  };

  const toggleRecording = () => {
    if (recording) {
      voiceRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const vr = new VoiceRecognition();
      voiceRef.current = vr;
      setRecording(true);
      vr.start(
        (text) => setInput(text),
        () => {
          setRecording(false);
          if (input.trim()) void send();
        }
      );
    } catch { /* speech recognition unavailable */ }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && !loading && (
          <div className="h-full flex flex-col items-center justify-center gap-2">
            <span className="text-sm text-samix-text-muted">
              {articleContext && articleContext.length > 0
                ? 'Jarvis knows today\'s headlines'
                : 'Start a conversation'}
            </span>
            {articleContext && articleContext.length > 0 && (
              <span className="text-xs text-samix-accent">{articleContext.length} articles loaded as context</span>
            )}
          </div>
        )}

        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          {messages.map((msg) => (
            <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              {msg.role === 'user' ? (
                <div className="max-w-[80%] text-sm text-samix-text-primary whitespace-pre-wrap">
                  {msg.content}
                </div>
              ) : (
                <div className="max-w-[80%] border-l-2 border-samix-accent pl-3">
                  <div className="text-sm text-[#d0d0d0] whitespace-pre-wrap">{msg.content}</div>
                  {msg.costUsd != null && msg.costUsd > 0 && (
                    <div className="text-[11px] text-[#444] text-right mt-1">
                      ${msg.costUsd.toFixed(5)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="border-l-2 border-samix-accent pl-3">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-samix-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-samix-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-samix-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="px-6 pb-2 pt-1">
        <div className="max-w-2xl mx-auto">
          {messages.length > 0 && (
            <button
              onClick={clearConversation}
              className="text-[11px] text-samix-text-muted hover:text-samix-text-primary mb-1 transition-colors"
            >
              New conversation
            </button>
          )}
          {pendingImage && (
            <div className="flex items-center gap-2 mb-1">
              <img src={pendingImage} alt="Screenshot" className="h-16 rounded border border-samix-border" />
              <button
                onClick={() => setPendingImage(null)}
                className="text-[11px] text-samix-text-muted hover:text-samix-error"
              >
                &times; Remove
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 bg-samix-surface border border-samix-border rounded-lg px-3 py-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={MODE_PLACEHOLDER[mode]}
              disabled={loading}
              rows={1}
              className="flex-1 bg-transparent text-sm text-samix-text-primary placeholder:text-samix-text-muted resize-none outline-none disabled:opacity-50"
              style={{ fieldSizing: 'content', maxHeight: '150px' } as React.CSSProperties}
            />
            <button
              onClick={toggleRecording}
              disabled={loading}
              className={`transition-colors pb-0.5 ${recording ? 'text-samix-error animate-pulse' : 'text-samix-text-muted hover:text-samix-text-primary'}`}
              title={recording ? 'Stop recording' : 'Voice input'}
            >
              &#9679;
            </button>
            <button
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              className="text-samix-accent hover:text-samix-accent-hover disabled:opacity-30 transition-colors pb-0.5"
            >
              &#8593;
            </button>
          </div>
          {speaking && (
            <button
              onClick={() => { stopSpeaking(); setSpeaking(false); }}
              className="text-[11px] text-samix-text-muted hover:text-samix-error mt-1 transition-colors"
            >
              Stop speaking
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
