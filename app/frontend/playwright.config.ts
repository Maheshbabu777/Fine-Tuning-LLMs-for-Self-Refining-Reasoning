import { defineConfig } from "@playwright/test";

// End-to-end tests of the chat app against two mock Kaggle servers (scripts/mock-backend.mjs):
// port 9100 pretends to be account A (4B models), 9101 account B (2B models).
// Run: npm run test:e2e   (builds the app first). Uses the installed Microsoft Edge, no browser download.
export default defineConfig({
  testDir: "e2e",
  workers: 1, // the mocks hold shared state (offline, key, delay), so tests run one at a time
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", channel: "msedge", trace: "retain-on-failure" },
  webServer: [
    { command: "node scripts/mock-backend.mjs 9100 4b", url: "http://localhost:9100/health", reuseExistingServer: false },
    { command: "node scripts/mock-backend.mjs 9101 2b", url: "http://localhost:9101/health", reuseExistingServer: false },
    {
      command: "npx next start -p 3100",
      url: "http://localhost:3100",
      reuseExistingServer: false,
      env: { BACKEND_URL_A: "http://localhost:9100", BACKEND_URL_B: "http://localhost:9101", APP_API_KEY: "dev-key" },
    },
  ],
});
