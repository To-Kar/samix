import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export type AgentMode = 'jarvis' | 'web-search' | 'url-summary' | 'newsletter-ai';

const MODES: { id: AgentMode; label: string; desc: string }[] = [
  { id: 'jarvis', label: 'Jarvis', desc: 'general chat' },
  { id: 'web-search', label: 'Web Search', desc: 'live Perplexity' },
  { id: 'url-summary', label: 'Summarise URL', desc: 'page summary' },
  { id: 'newsletter-ai', label: 'Newsletter', desc: 'manual trigger' },
];

interface Props {
  mode: AgentMode;
  onModeChange: (m: AgentMode) => void;
}

export function ModeSelector({ mode, onModeChange }: Props) {
  const [open, setOpen] = useState(false);
  const current = MODES.find((m) => m.id === mode)!;

  return (
    <div className="px-6 pb-1">
      <div className="max-w-2xl mx-auto relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-samix-text-muted hover:text-samix-text-primary transition-colors"
        >
          <span className="bg-samix-surface border border-samix-border rounded-full px-2.5 py-0.5">
            {current.label} &#9662;
          </span>
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full mb-1 left-0 bg-samix-surface border border-samix-border rounded-lg py-1 min-w-[200px] z-10"
            >
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { onModeChange(m.id); setOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                    m.id === mode
                      ? 'text-samix-accent'
                      : 'text-samix-text-muted hover:text-samix-text-primary hover:bg-samix-bg'
                  }`}
                >
                  <span>{m.id === mode ? '\u25CF' : '\u25CE'}</span>
                  <span className="font-medium">{m.label}</span>
                  <span className="text-samix-text-muted">({m.desc})</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
