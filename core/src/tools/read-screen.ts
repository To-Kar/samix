import { exec } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolDefinition } from '../types.js';

export const readScreenTool: ToolDefinition = {
  name: 'read_screen',
  description:
    'Capture a screenshot of the current screen and return it as a base64-encoded image. ' +
    'The image can be analyzed to understand what the user is looking at.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_input, ctx) => {
    const tmpPath = join(tmpdir(), `samix-screen-${Date.now()}.png`);

    try {
      await new Promise<void>((resolve, reject) => {
        const cmd =
          process.platform === 'darwin'
            ? `screencapture -x -t png "${tmpPath}"`
            : process.platform === 'win32'
              ? `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $bmp = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen([System.Drawing.Point]::Empty, [System.Drawing.Point]::Empty, $bmp.Size); $bmp.Save('${tmpPath.replace(/'/g, "''")}')"`
              : `import -window root "${tmpPath}"`;

        exec(cmd, { timeout: 5000 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const data = await readFile(tmpPath);
      await unlink(tmpPath).catch(() => {});

      const b64 = data.toString('base64');
      ctx.logger.info({ size: data.length }, 'screen_captured');

      return `data:image/png;base64,${b64}`;
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      return `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
