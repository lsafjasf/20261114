import { defineConfig } from "@playwright/test";
import puppeteer from "puppeteer";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4391",
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    launchOptions: {
      executablePath: puppeteer.executablePath(),
      args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
    },
  },
  webServer: {
    command: "node tests/server.mjs",
    url: "http://127.0.0.1:4391",
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
