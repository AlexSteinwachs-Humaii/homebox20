import { expect, test } from "@playwright/test";
import { themes } from "../../lib/data/themes";

test.use({ serviceWorkers: "block" });

test("Claude preview and live shared components update without stale theme classes", async ({ page, request }) => {
  const email = `claude-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Claude-theme-test-42!";
  expect(
    (await request.post("/api/v1/users/register", { data: { email, name: "Theme tester", password } })).status()
  ).toBe(204);
  await page.goto("/");
  await page.locator("input[type='text']").fill(email);
  await page.locator("input[type='password']").fill(password);
  await page.locator("button[type='submit']").click();
  await expect(page).toHaveURL("/home");
  await page.goto("/profile");

  const root = page.locator("html");
  const picker = (value: string) => page.locator(`[data-set-theme='${value}']`);
  for (const theme of themes) {
    await expect(picker(theme.value)).toHaveText(new RegExp(theme.label));
  }
  // The preview carries its own tokens before the theme is applied globally.
  await expect(picker("claude").locator(".bg-primary")).toHaveCSS("background-color", "rgb(145, 81, 59)");
  await picker("claude").click();
  await expect(root).toHaveAttribute("data-theme", "claude");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(248, 246, 241)");
  await expect(page.locator(".bg-card").first()).toHaveCSS("background-color", "rgb(252, 250, 248)");
  await expect(page.locator("input").first()).toHaveCSS("border-color", "rgb(140, 128, 115)");
  await page.locator("input").first().focus();
  await expect(page.locator("input").first()).toHaveCSS("--tw-ring-color", "hsl(15 42% 40%)");

  // Seed legacy/stale classes and a non-theme class to exercise cleanup.
  await root.evaluate(el => el.classList.add("theme-cyberpunk", "dark", "keep-me"));
  await picker("night").click();
  await expect(root).toHaveAttribute("data-theme", "night");
  await expect(root).toHaveClass("keep-me theme-night");
  await expect(page.locator("body")).not.toHaveCSS("background-color", "rgb(248, 246, 241)");
  await picker("claude").click();
  await expect(root).toHaveClass("keep-me theme-claude");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(248, 246, 241)");

  // Theme selection survives SPA navigation, including narrow-screen layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/home");
  await expect(root).toHaveAttribute("data-theme", "claude");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(248, 246, 241)");
});

async function account(page: import("@playwright/test").Page) {
  const email = `prefs-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Theme-reconciliation-42!";
  expect(
    (
      await page.request.post("/api/v1/users/register", {
        data: { email, name: "Preference tester", password },
      })
    ).status()
  ).toBe(204);
  return { email, password };
}
async function signIn(page: import("@playwright/test").Page, user: { email: string; password: string }) {
  expect(
    (
      await page.request.post("/api/v1/users/login", {
        data: { username: user.email, password: user.password, stayLoggedIn: true },
      })
    ).ok()
  ).toBeTruthy();
}
async function signInForm(page: import("@playwright/test").Page, user: { email: string; password: string }) {
  await page.locator("input[type='text']").fill(user.email);
  await page.locator("input[type='password']").fill(user.password);
  await page.locator("button[type='submit']").click();
  await expect(page).toHaveURL("/home");
}
async function serverTheme(page: import("@playwright/test").Page) {
  const response = await page.request.get("/api/v1/users/self/settings");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).item.theme;
}
for (const theme of ["claude", "dracula"]) {
  test(`server ${theme} wins on first upgraded visit; later choice survives reload, login and another browser`, async ({
    page,
    browser,
  }) => {
    const user = await account(page);
    await signIn(page, user);
    expect(
      (
        await page.request.put("/api/v1/users/self/settings", {
          data: { theme, showDetails: false, unknown: { keep: true } },
        })
      ).ok()
    ).toBeTruthy();
    await page.addInitScript(() => {
      if (!localStorage.getItem("seeded")) {
        localStorage.setItem(
          "homebox/preferences/location",
          JSON.stringify({ theme: "night", itemDisplayView: "table" })
        );
        localStorage.setItem("seeded", "yes");
      }
    });
    await page.goto("/profile");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await serverTheme(page)).toBe(theme);
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem("homebox/preferences/location")!).itemDisplayView)
      )
      .toBe("table");
    await page.locator("[data-set-theme='night']").click();
    await expect.poll(() => serverTheme(page)).toBe("night");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await page.getByTestId("logout-button").click();
    await expect(page).toHaveURL("/");
    await signInForm(page, user);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const other = await context.newPage();
    await signIn(other, user);
    await other.goto("/profile");
    await expect(other.locator("html")).toHaveAttribute("data-theme", "night");
    expect((await (await other.request.get("/api/v1/users/self/settings")).json()).item.unknown).toEqual({
      keep: true,
    });
    await context.close();
  });
}
test("failed fetch and save leave local choice usable and retry without uploading stale settings", async ({ page }) => {
  const user = await account(page);
  await signIn(page, user);
  let failFetch = true;
  let failSave = true;
  let saves = 0;
  await page.route("**/api/v1/users/self/settings", async route => {
    if (route.request().method() === "GET" && failFetch) await route.fulfill({ status: 503, body: "offline" });
    else if (route.request().method() === "PUT") {
      saves++;
      if (failSave) await route.fulfill({ status: 503, body: "offline" });
      else await route.continue();
    } else await route.continue();
  });
  await page.goto("/profile");
  await page.locator("[data-set-theme='night']").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  expect(saves).toBe(0);
  failFetch = false;
  await expect.poll(() => saves).toBeGreaterThan(0);
  expect(await serverTheme(page)).toBe("claude");
  failSave = false;
  await expect.poll(() => serverTheme(page)).toBe("night");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
});
test("account switching isolates each account's saved theme", async ({ page }) => {
  const a = await account(page);
  const b = await account(page);
  await signIn(page, a);
  await page.goto("/profile");
  await page.locator("[data-set-theme='night']").click();
  await expect.poll(() => serverTheme(page)).toBe("night");
  await page.getByTestId("logout-button").click();
  await expect(page).toHaveURL("/");
  await signInForm(page, b);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "claude");
  expect(await serverTheme(page)).toBe("claude");
  await page.getByTestId("logout-button").click();
  await expect(page).toHaveURL("/");
  await signInForm(page, a);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
});
test("a selection during delayed hydration is saved only after fetching", async ({ page }) => {
  const user = await account(page);
  await signIn(page, user);
  let release!: () => void;
  const gate = new Promise<void>(r => {
    release = r;
  });
  let puts = 0;
  await page.route("**/api/v1/users/self/settings", async route => {
    if (route.request().method() === "GET") await gate;
    else puts++;
    await route.continue();
  });
  await page.goto("/profile");
  await page.locator("[data-set-theme='dracula']").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dracula");
  expect(puts).toBe(0);
  release();
  await expect.poll(() => serverTheme(page)).toBe("dracula");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dracula");
});
test("user-mutation refresh honors a later server choice without writing back the old theme", async ({ page }) => {
  let notify!: () => void;
  // Direct account settings requests have no X-Tenant. Deliver the collection-scoped
  // websocket notification deterministically to test the browser's refresh handling.
  await page.routeWebSocket("**/api/v1/ws/events*", socket => {
    socket.connectToServer();
    notify = () => socket.send(JSON.stringify({ event: "user.mutation" }));
  });
  const user = await account(page);
  await signIn(page, user);
  await page.goto("/profile");
  await page.locator("[data-set-theme='night']").click();
  await expect.poll(() => serverTheme(page)).toBe("night");
  const settings = (await (await page.request.get("/api/v1/users/self/settings")).json()).item;
  expect(
    (await page.request.put("/api/v1/users/self/settings", { data: { ...settings, theme: "dracula" } })).ok()
  ).toBeTruthy();
  await expect.poll(() => typeof notify).toBe("function");
  // The established dispatcher throttles UserMutation events for one second.
  await expect
    .poll(async () => {
      notify();
      return page.locator("html").getAttribute("data-theme");
    })
    .toBe("dracula");
  expect(await serverTheme(page)).toBe("dracula");
});
