(function () {
  const root = document.documentElement;
  const toggle = document.querySelector(".theme-toggle");
  if (!toggle) return;

  function apply(theme, persist) {
    // Swap colours in one frame: suspend transitions (bar the sun/moon swap) while the theme flips.
    const freeze = document.createElement("style");
    freeze.textContent = "*:not(.theme-icon),*::before,*::after{transition:none!important}";
    document.head.appendChild(freeze);
    root.dataset.theme = theme;
    getComputedStyle(root).opacity;
    requestAnimationFrame(() => requestAnimationFrame(() => freeze.remove()));
    toggle.setAttribute("aria-pressed", String(theme === "dark"));
    if (persist) localStorage.setItem("theme", theme);
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  }

  toggle.addEventListener("click", () => {
    apply(root.dataset.theme === "dark" ? "light" : "dark", true);
  });

  apply(root.dataset.theme === "dark" ? "dark" : "light", false);
})();
