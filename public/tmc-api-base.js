// TMC_PATCH66 — Capacitor API base interceptor
//
// In native app (window.Capacitor.isNativePlatform() === true):
//   rewrites /api/* calls to https://tapmycar.io/api/*
// In browser (no Capacitor): no-op, existing behavior unchanged.

(function () {
  if (typeof window === "undefined") return;

  function isCapacitor() {
    try {
      return !!(window.Capacitor &&
                typeof window.Capacitor.isNativePlatform === "function" &&
                window.Capacitor.isNativePlatform());
    } catch (e) { return false; }
  }

  if (!isCapacitor()) return; // browser path: do nothing

  var API_BASE = "https://www.tapmycar.io";

  function rewrite(url) {
    if (typeof url !== "string") return url;
    if (url.indexOf("/api/") === 0) return API_BASE + url;
    return url;
  }

  // Patch window.fetch
  if (typeof window.fetch === "function") {
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        if (typeof input === "string") {
          input = rewrite(input);
        } else if (input && typeof input.url === "string" &&
                   input.url.indexOf("/api/") === 0) {
          input = new Request(rewrite(input.url), input);
        }
      } catch (e) { /* fall through to original */ }
      return origFetch(input, init);
    };
  }

  // Patch XMLHttpRequest.open
  if (typeof XMLHttpRequest !== "undefined" && XMLHttpRequest.prototype) {
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        if (typeof url === "string") {
          arguments[1] = rewrite(url);
        }
      } catch (e) { /* fall through */ }
      return origOpen.apply(this, arguments);
    };
  }

  // expose for debugging
  window.__TMC_API_BASE__ = API_BASE;
})();
