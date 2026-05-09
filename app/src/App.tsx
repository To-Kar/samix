import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { initApi, type ApiClient } from './lib/api';
import { Chat, type ChatHandle } from './components/Chat';
import { NewspaperPanel } from './components/NewspaperPanel';
import { SettingsModal } from './components/SettingsModal';
import { StatusBar } from './components/StatusBar';
import { ModeSelector, type AgentMode } from './components/ModeSelector';

const NOTIFICATION_AGENTS = ['newsletter-ai', 'daily-briefing'];

export default function App() {
  const [api, setApi] = useState<ApiClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [mode, setMode] = useState<AgentMode>('jarvis');
  const [showNewspaper, setShowNewspaper] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [articleCount, setArticleCount] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const chatRef = useRef<ChatHandle>(null);

  useEffect(() => {
    initApi()
      .then(setApi)
      .catch((err: unknown) =>
        setInitError(err instanceof Error ? err.message : String(err))
      );
  }, []);

  // Health polling
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const poll = async () => {
      try {
        await api.health();
        if (alive) setConnected(true);
      } catch {
        if (alive) setConnected(false);
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [api]);

  // SSE events for notifications
  useEffect(() => {
    if (!api) return;
    return api.subscribeEvents(async (event) => {
      if (NOTIFICATION_AGENTS.includes(event.agentSlug) && event.articleCount > 0) {
        try {
          const { sendNotification, isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
          let granted = await isPermissionGranted();
          if (!granted) granted = (await requestPermission()) === 'granted';
          if (granted) {
            sendNotification({
              title: 'Samix',
              body: `${event.articleCount} new article${event.articleCount === 1 ? '' : 's'} curated`,
            });
          }
        } catch { /* notification plugin not available in dev */ }
      }
    });
  }, [api]);

  // Load article count for status bar
  const refreshArticleCount = useCallback(async () => {
    if (!api) return;
    try {
      const articles = await api.listArticles({ limit: 500 });
      setArticleCount(articles.length);
    } catch { /* ignore */ }
  }, [api]);

  useEffect(() => { void refreshArticleCount(); }, [refreshArticleCount]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') {
        e.preventDefault();
        chatRef.current?.focusInput();
      }
      if (mod && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        const modes: AgentMode[] = ['jarvis', 'web-search', 'url-summary', 'newsletter-ai'];
        setMode(modes[Number(e.key) - 1]);
      }
      if (e.key === 'Escape') {
        setShowNewspaper(false);
        setShowSettings(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (initError) {
    return (
      <main className="h-full bg-samix-bg flex items-center justify-center p-8">
        <div className="max-w-md">
          <h1 className="text-lg font-medium text-samix-error mb-2">Core config unavailable</h1>
          <p className="text-sm text-samix-text-muted font-mono">{initError}</p>
          <p className="text-xs text-samix-text-muted mt-3">
            Make sure <code className="text-samix-text-primary">pnpm dev:core</code> is running with matching env vars.
          </p>
        </div>
      </main>
    );
  }

  if (!api) {
    return (
      <main className="h-full bg-samix-bg flex items-center justify-center">
        <span className="text-sm text-samix-text-muted">Connecting...</span>
      </main>
    );
  }

  return (
    <main className="h-full bg-samix-bg flex flex-col overflow-hidden">
      {/* Header */}
      <header
        className={`h-10 flex items-center justify-between px-4 border-b shrink-0 transition-colors duration-300 ${
          connected === false
            ? 'bg-[#1a0000] border-samix-error/30'
            : 'bg-samix-surface border-samix-border'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-samix-text-primary">Samix</span>
          {connected === false && (
            <span className="text-xs text-samix-error">Core offline</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowNewspaper((v) => !v); setShowSettings(false); }}
            className="px-2 py-1 text-xs text-samix-text-muted hover:text-samix-text-primary transition-colors"
          >
            ...
          </button>
          <button
            onClick={() => { setShowSettings((v) => !v); setShowNewspaper(false); }}
            className="px-2 py-1 text-xs text-samix-text-muted hover:text-samix-text-primary transition-colors"
          >
            &#9881;
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 flex flex-col overflow-hidden">
          <Chat
            ref={chatRef}
            api={api}
            mode={mode}
            onCostUpdate={setTotalCost}
          />
          <ModeSelector mode={mode} onModeChange={setMode} />
        </div>

        {/* Newspaper slide-over */}
        <AnimatePresence>
          {showNewspaper && (
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="absolute right-0 top-0 bottom-0 w-96 bg-samix-surface border-l border-samix-border overflow-y-auto z-10"
            >
              <NewspaperPanel api={api} onClose={() => setShowNewspaper(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings modal */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 z-20 flex items-center justify-center"
              onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-samix-surface border border-samix-border rounded-lg w-full max-w-lg max-h-[80vh] overflow-y-auto"
              >
                <SettingsModal onClose={() => setShowSettings(false)} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status bar */}
      <StatusBar articleCount={articleCount} totalCost={totalCost} />
    </main>
  );
}
