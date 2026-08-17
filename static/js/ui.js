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
