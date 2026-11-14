import fs from 'node:fs';
import { chromium } from 'playwright';

export async function launchChromium(options = {}) {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    '/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    '/home/hj/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  ].filter(Boolean);
  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  return chromium.launch({
    ...options,
    ...(executablePath ? { executablePath } : {}),
  });
}
