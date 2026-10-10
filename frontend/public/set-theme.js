// Run before Nuxt mounts. This marker belongs to this browser, never to an account.
let theme = "claude";
try {
  const key = "homebox/preferences/location";
  const marker = "homebox/preferences/theme-rollout";
  const parsed = JSON.parse(localStorage.getItem(key));
  const preferences = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  if (localStorage.getItem(marker) !== "claude-v1") {
    preferences.theme = "claude";
    localStorage.setItem(key, JSON.stringify(preferences));
    localStorage.setItem(marker, "claude-v1");
  }
  if (typeof preferences.theme === "string" && /^[a-z]+$/.test(preferences.theme)) theme = preferences.theme;
} catch {
  // Malformed or unavailable storage must not leave the old Homebox fallback.
}
for (const name of Array.from(document.documentElement.classList)) {
  if (name.startsWith("theme-")) document.documentElement.classList.remove(name);
}
document.documentElement.setAttribute("data-theme", theme);
document.documentElement.classList.add("theme-" + theme);
