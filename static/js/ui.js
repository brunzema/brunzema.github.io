/* Nav chrome: the hairline under the bar appears only once the page
   has scrolled beneath it, so the header sits flush at rest. */
(function () {
  const nav = document.querySelector("nav");
  if (!nav) return;

  let ticking = false;

  function sync() {
    nav.classList.toggle("is-scrolled", window.scrollY > 4);
    ticking = false;
  }

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(sync);
    },
    { passive: true }
  );

  sync();
})();

document.querySelectorAll("[data-bibtex-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const panel = document.getElementById(button.getAttribute("aria-controls"));
    const expanded = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(expanded));
    panel.hidden = !expanded;
  });
});

document.querySelectorAll("[data-bibtex-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const panel = button.closest(".pub-citation");
    const citation = panel.querySelector("textarea");
    const status = panel.querySelector(".pub-copy-status");
    try {
      await navigator.clipboard.writeText(citation.value);
      status.textContent = "Copied!";
    } catch {
      citation.focus();
      citation.select();
      status.textContent = "Selected — press ⌘C or Ctrl+C to copy.";
    }
  });
});

/* ASCII easter egg: shortly after load the pill types its own label once,
   key by key, so the one moving thing in the hero invites a click. */
(function () {
  const label = document.querySelector(".ascii-egg-label");
  if (!label || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const text = label.textContent;
  label.textContent = "";
  let i = 0;
  setTimeout(function type() {
    label.textContent = text.slice(0, ++i);
    if (i < text.length) setTimeout(type, 55 + Math.random() * 70);
  }, 900);
})();
