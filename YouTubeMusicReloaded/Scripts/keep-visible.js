// The page counts as "hidden" whenever the phone is locked or the app is in
// the background, and YouTube Music stops or pauses then. Always report it as
// visible (background playback is part of YouTube Premium).
(() => {
  const visible = { configurable: true, get: () => 'visible' };
  const shown = { configurable: true, get: () => false };
  Object.defineProperty(Document.prototype, 'visibilityState', visible);
  Object.defineProperty(Document.prototype, 'webkitVisibilityState', visible);
  Object.defineProperty(Document.prototype, 'hidden', shown);
  Object.defineProperty(Document.prototype, 'webkitHidden', shown);
  const swallow = (event) => event.stopImmediatePropagation();
  for (const type of ['visibilitychange', 'webkitvisibilitychange']) {
    window.addEventListener(type, swallow, true);
    document.addEventListener(type, swallow, true);
  }
})();
