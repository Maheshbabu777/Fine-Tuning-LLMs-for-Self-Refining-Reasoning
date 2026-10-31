import { expect, test, type Page } from "@playwright/test";

// The mocks replay the real 4B/2B eval outputs for MATH-500 problem 67 (square to rectangle, answer 10).
const A = "http://localhost:9100"; // account A, 4B models
const B = "http://localhost:9101"; // account B, 2B models
const EXAMPLE = "The lengths of two opposite sides of a square";

const set = (url: string, body: object) => fetch(`${url}/__set`, { method: "POST", body: JSON.stringify(body) });
const stats = async (url: string) => (await (await fetch(`${url}/__stats`)).json()) as { generateCalls: number; aborted: number };

test.beforeEach(async () => {
  await fetch(`${A}/__reset`, { method: "POST" });
  await fetch(`${B}/__reset`, { method: "POST" });
});

async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "GPU online" })).toBeVisible();
}

async function pickModel(page: Page, label: string) {
  await page.locator(".picker-button").click();
  await page.getByRole("menuitemradio", { name: new RegExp(label) }).click();
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Question" });

test.describe("start screen", () => {
  test("shows the project question, 8 MATH-500 examples and all 8 models online", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("heading", { name: "Can a small model check its own work?" })).toBeVisible();
    await expect(page.locator(".example")).toHaveCount(8);
    await expect(page.locator(".picker-button")).toHaveText(/Self-refine 4B/); // default model is the best one
    await page.locator(".picker-button").click();
    const items = page.getByRole("menuitemradio");
    await expect(items).toHaveCount(9); // compare + 8 models
    for (const item of await items.all()) await expect(item).toBeEnabled();
  });
});

test.describe("asking a question", () => {
  test("an example streams cleanly and ends with the graded final answer", async ({ page }) => {
    await open(page);
    await page.locator(".example", { hasText: EXAMPLE }).click();
    const reply = page.locator(".reply").first();

    // Sample the visible text while it streams: no raw LaTeX and no half-written section markers.
    const raw = /\\\[|\\\(|\\frac|\\boxed|\\times|\[Answ|\[Rev|\[Fin/;
    let samples = 0;
    while ((await reply.getAttribute("aria-busy")) === "true" && samples < 200) {
      const text = await reply.innerText();
      const hit = raw.exec(text);
      expect(hit, `raw LaTeX or marker on screen while streaming: ...${hit ? JSON.stringify(text.slice(Math.max(0, hit.index - 120), hit.index + 80)) : ""}`).toBeNull();
      samples++;
      await page.waitForTimeout(100);
    }
    expect(samples).toBeGreaterThan(5); // the check really ran during streaming

    await expect(reply.locator(".final-label")).toHaveText("Final answer");
    await expect(reply.locator(".final-value")).toContainText("10");
    await expect(reply.getByText("✓ Correct")).toBeVisible();
    await expect(reply.getByText("↻ Fixed its first answer")).toBeVisible();
    await expect(reply.locator(".reply-foot")).toContainText("731 tokens");
    await expect(page.locator(".reference")).toContainText("Known answer");
  });

  test("the reasoning block holds attempt 1, attempt 2 and the review", async ({ page }) => {
    await open(page);
    await page.locator(".example", { hasText: EXAMPLE }).click();
    const reply = page.locator(".reply").first();
    await expect(reply.locator(".final")).toBeVisible();
    const toggle = reply.locator(".reasoning-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false"); // collapses once the answer is done
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(reply.locator(".step-head")).toHaveText([/Attempt 1/, /Attempt 2/, /Review/]);
  });

  test("Enter sends, Shift+Enter adds a new line, and an own question gets no correct/wrong grade", async ({ page }) => {
    await open(page);
    const box = composer(page);
    await box.fill("Line one");
    await box.press("Shift+Enter");
    await box.pressSequentially("line two");
    await expect(box).toHaveValue("Line one\nline two");
    await expect(page.locator(".turn")).toHaveCount(0);
    await box.press("Enter");
    await expect(page.locator(".turn")).toHaveCount(1);
    await expect(box).toHaveValue("");
    const reply = page.locator(".reply").first();
    await expect(reply.locator(".final")).toBeVisible();
    await expect(reply.getByText("↻ Changed its answer after review")).toBeVisible();
    await expect(reply.getByText(/Correct|Wrong/)).toHaveCount(0); // no known answer, so no grade
  });

  test("Stop cancels the answer on the server too", async ({ page }) => {
    await set(A, { delay: 60 });
    await open(page);
    await composer(page).fill("A slow question");
    await composer(page).press("Enter");
    await expect(page.locator(".reply").first()).toHaveAttribute("aria-busy", "true");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Stop generating" }).click();
    await expect(page.locator(".reply-foot", { hasText: "Stopped" })).toBeVisible();
    await expect.poll(async () => (await stats(A)).aborted).toBe(1);
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });

  test("the thread follows the stream, and offers Jump to latest after scrolling up", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 560 });
    await set(A, { delay: 25 });
    await open(page);
    await page.locator(".example", { hasText: EXAMPLE }).click();
    const thread = page.locator(".thread");
    await expect.poll(() => thread.evaluate((t) => t.scrollHeight > t.clientHeight + 150)).toBe(true);
    expect(await thread.evaluate((t) => t.scrollHeight - t.scrollTop - t.clientHeight)).toBeLessThan(90);
    await thread.hover();
    await page.mouse.wheel(0, -3000);
    await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();
    await page.getByRole("button", { name: "Jump to latest" }).click();
    await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveCount(0);
  });
});

test.describe("models and servers", () => {
  test("compare mode answers with Base, CoT and Self-refine 4B side by side, all from account A", async ({ page }) => {
    await open(page);
    await pickModel(page, "Compare side by side");
    await page.locator(".example", { hasText: EXAMPLE }).click();
    const replies = page.locator(".replies.grid .reply");
    await expect(replies).toHaveCount(3);
    await expect(replies.locator(".reply-name")).toHaveText(["Base 4B", "CoT 4B", "Self-refine 4B"]);
    await expect(page.locator(".replies.grid .reply-foot")).toHaveCount(3);
    expect((await stats(A)).generateCalls).toBe(3);
    expect((await stats(B)).generateCalls).toBe(0);
  });

  test("a 2B model is answered by account B", async ({ page }) => {
    await open(page);
    await pickModel(page, "Refine 2B");
    await composer(page).fill("Any question");
    await composer(page).press("Enter");
    await expect(page.locator(".reply .final")).toBeVisible();
    expect((await stats(B)).generateCalls).toBe(1);
    expect((await stats(A)).generateCalls).toBe(0);
  });

  test("with account B off, 2B models are greyed out and 4B still works", async ({ page }) => {
    await set(B, { offline: true });
    await open(page);
    await page.locator(".picker-button").click();
    await expect(page.getByRole("menuitemradio", { name: /CoT 2B/ })).toBeDisabled();
    await expect(page.getByRole("menuitemradio", { name: /CoT 4B/ })).toBeEnabled();
    await page.keyboard.press("Escape");
    await page.locator(".example", { hasText: EXAMPLE }).click();
    await expect(page.locator(".reply .final")).toBeVisible();
  });

  test("with both accounts off, the page says so and examples are disabled", async ({ page }) => {
    await set(A, { offline: true });
    await set(B, { offline: true });
    await page.goto("/");
    await expect(page.getByRole("status").filter({ hasText: "GPU offline" })).toBeVisible();
    await expect(page.getByText("The model servers are offline")).toBeVisible();
    await expect(page.locator(".example").first()).toBeDisabled();
  });

  test("a server that dies after the page loaded gives a plain message, not a hang", async ({ page }) => {
    await open(page);
    await set(A, { offline: true });
    await composer(page).fill("Question while the GPU went away");
    await composer(page).press("Enter");
    await expect(page.locator(".reply").getByRole("alert")).toContainText("offline");
  });

  test("a wrong API key shows the server's message", async ({ page }) => {
    await set(A, { key: "a-different-key" });
    await open(page);
    await composer(page).fill("Hello");
    await composer(page).press("Enter");
    await expect(page.locator(".reply").getByRole("alert")).toContainText("Wrong or missing API key");
  });
});

test.describe("history", () => {
  test("a chat survives a reload, can be reopened and deleted", async ({ page }) => {
    await open(page);
    await page.locator(".example", { hasText: EXAMPLE }).click();
    await expect(page.locator(".reply .final")).toBeVisible();
    await page.reload();
    await expect(page.locator(".history-item")).toHaveCount(1);
    await page.locator(".history-title").first().click();
    await expect(page.locator(".reply .final-value")).toContainText("10");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /Delete chat/ }).click();
    await expect(page.locator(".history-item")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Can a small model check its own work?" })).toBeVisible();
  });
});

test.describe("API proxy", () => {
  test("validates input and never needs the key from the browser", async ({ request }) => {
    expect((await request.post("/api/generate", { data: { model: "4b-review" } })).status()).toBe(400);
    expect((await request.post("/api/generate", { data: { model: "4b-review", question: "x".repeat(3001) } })).status()).toBe(422);
    const unknown = await request.post("/api/generate", { data: { model: "no-such-model", question: "hi" } });
    expect(unknown.status()).toBe(503);
    const health = await (await request.get("/api/health")).json();
    expect(health.models).toHaveLength(8);
    expect(health.servers).toEqual([true, true]);
  });

  test("the key and backend URLs are not in anything sent to the browser", async ({ page }) => {
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (/\.(js|css|html)(\?|$)|localhost:3100\/$/.test(r.url())) bodies.push(await r.text().catch(() => ""));
    });
    await open(page);
    await page.waitForLoadState("networkidle");
    expect(bodies.length).toBeGreaterThan(3);
    for (const b of bodies) {
      expect(b).not.toContain("dev-key");
      expect(b).not.toContain("localhost:9100");
      expect(b).not.toContain("localhost:9101");
    }
  });
});

test.describe("layout and access", () => {
  test("phone width: menu button opens the chats, no sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page);
    await expect(page.locator(".sidebar")).not.toBeInViewport();
    await page.getByRole("button", { name: "Open chats" }).click();
    await expect(page.locator(".sidebar")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator(".thread").evaluate((t) => t.scrollTop)).toBe(0); // start screen opens at the top
  });

  test("keyboard only: Tab reaches the picker and the composer, Escape closes the menu", async ({ page }) => {
    await open(page);
    await page.locator(".picker-button").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".picker-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".picker-menu")).toHaveCount(0);
    await composer(page).focus();
    await page.keyboard.type("Typed with the keyboard");
    await page.keyboard.press("Enter");
    await expect(page.locator(".turn")).toHaveCount(1);
  });

  test("reduced motion turns animations off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    const ms = await page.locator(".example").first().evaluate((e) => parseFloat(getComputedStyle(e).animationDuration) * 1000);
    expect(ms).toBeLessThan(1);
  });
});
