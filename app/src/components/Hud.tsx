import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { motion, AnimatePresence } from 'framer-motion';

interface HudMessage {
  text: string;
  id: number;
}

export function Hud() {
  const [messages, setMessages] = useState<HudMessage[]>([]);

  useEffect(() => {
    const win = getCurrentWindow();
    win.setIgnoreCursorEvents(true).catch(() => {});

    const unlisten = listen<{ text: string }>('hud:message', (event) => {
      const id = Date.now();
      setMessages((prev) => [...prev.slice(-2), { text: event.payload.text, id }]);
      setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }, 8000);
    });

    return () => { unlisten.then((fn) => fn()); };
  }, []);

  return (
    <div className="h-screen w-screen bg-transparent p-4 flex flex-col justify-end gap-2 overflow-hidden">
      <AnimatePresence>
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="bg-black/70 backdrop-blur-md text-white text-sm px-4 py-3 rounded-xl border border-white/10 shadow-lg max-h-32 overflow-hidden"
          >
            {msg.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
