import { exec } from 'node:child_process';
import { prisma } from '../db/prisma.js';

export interface AmbientContext {
  now: string;
  timezone: string;
  battery?: number;
  activeApp?: string;
  unreadArticles: number;
  lastRun?: { slug: string; at: string };
}

function execWithTimeout(cmd: string, timeoutMs = 200): Promise<string> {
  return new Promise((resolve) => {
    const child = exec(cmd, { timeout: timeoutMs }, (err, stdout) => {
      if (err) resolve('');
      else resolve(stdout.trim());
    });
    child.unref();
  });
}

async function getBattery(): Promise<number | undefined> {
  try {
    if (process.platform === 'darwin') {
      const out = await execWithTimeout('pmset -g batt');
      const match = out.match(/(\d+)%/);
      return match ? Number(match[1]) : undefined;
    }
    if (process.platform === 'win32') {
      const out = await execWithTimeout(
        'powershell -NoProfile -Command "(Get-WmiObject Win32_Battery).EstimatedChargeRemaining"',
        300
      );
      const n = Number(out);
      return Number.isFinite(n) ? n : undefined;
    }
  } catch {}
  return undefined;
}

async function getActiveApp(): Promise<string | undefined> {
  try {
    if (process.platform === 'darwin') {
      const out = await execWithTimeout(
        `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`
      );
      return out || undefined;
    }
    if (process.platform === 'win32') {
      const out = await execWithTimeout(
        'powershell -NoProfile -Command "(Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -First 1).ProcessName"',
        300
      );
      return out || undefined;
    }
  } catch {}
  return undefined;
}

async function getUnreadArticleCount(): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return await prisma.article.count({ where: { createdAt: { gte: since } } });
  } catch {
    return 0;
  }
}

async function getLastRun(): Promise<{ slug: string; at: string } | undefined> {
  try {
    const run = await prisma.agentRun.findFirst({
      where: { status: 'success' },
      orderBy: { completedAt: 'desc' },
      include: { agent: { select: { slug: true } } },
    });
    if (!run?.completedAt) return undefined;
    return { slug: run.agent.slug, at: run.completedAt.toISOString() };
  } catch {
    return undefined;
  }
}

export async function gatherAmbient(): Promise<AmbientContext> {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [battery, activeApp, unreadArticles, lastRun] = await Promise.all([
    getBattery(),
    getActiveApp(),
    getUnreadArticleCount(),
    getLastRun(),
  ]);

  return {
    now: now.toISOString(),
    timezone,
    battery,
    activeApp,
    unreadArticles,
    lastRun,
  };
}

export function formatAmbientBlock(ctx: AmbientContext): string {
  const d = new Date(ctx.now);
  const locale = d.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ctx.timezone,
  });

  const lines: string[] = [
    `Time: ${locale} (${ctx.timezone})`,
  ];
  if (ctx.activeApp) lines.push(`Active app: ${ctx.activeApp}`);
  if (ctx.battery != null) lines.push(`Battery: ${ctx.battery}%`);
  lines.push(`Unread articles: ${ctx.unreadArticles}`);
  if (ctx.lastRun) {
    const ago = Math.round((Date.now() - new Date(ctx.lastRun.at).getTime()) / 3600000);
    lines.push(`Last run: ${ctx.lastRun.slug} ${ago} h ago`);
  }

  return `<ambient_context>\n${lines.join('\n')}\n</ambient_context>`;
}
