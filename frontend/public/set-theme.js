try {
  // Signed-in routes are Night Atelier, not a saved DaisyUI theme. Public auth
  // pages keep the preference. Do not read it on the signed-in paths: a saved
  // "night" or "black" must not paint before the layout mounts.
  var path = location.pathname.replace(/\/+$/, "") || "/";
  var publicAuth = path === "/" || path === "/forgot-password" || path === "/reset-password";
  if (!publicAuth) {
    document.documentElement.classList.add("night-atelier");
    document.documentElement.removeAttribute("data-theme");
  } else {
    var theme = JSON.parse(localStorage.getItem("homebox/preferences/location")).theme;
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.classList.add("theme-" + theme);
    }
  }
} catch (e) {
  console.error("Failed to set theme", e);
}
