// Replacement for the NARR8 web player's lost "foreditor/navigation.js" (used by both engine generations).
//
// Engine.initDesktop() (2013-2015 "universal" engine) does `new Navigation(engine)` and ctx.initDesctop()
// (2012-2013 "video" engine) does `new Navigation()`; both then talk to the host exclusively through this
// object. On iOS/Android the same API went through the native bridge (utils/JSObjCBridge/navigation.js);
// here it is forwarded to the parent page (window.parent.narr8Host) when the episode runs inside our player,
// or handled locally when canvas.html is opened on its own.
function Navigation(engine) {
  this.engine = engine;
  this.handlers = {};
  var host = null;
  try { host = window.parent !== window ? window.parent.narr8Host : null; } catch (e) { host = null; }
  this.host = host || null;
  window.narr8Navigation = this;
}

(function (p) {
  function subscribe(name) {
    return function (f) { this.handlers[name] = f; };
  }
  function call(nav, method, args) {
    if (nav.host && typeof nav.host[method] === "function") {
      try { return nav.host[method].apply(nav.host, args || []); } catch (e) { console.error("[narr8 host]", method, e); }
    }
    return undefined;
  }

  // ---- host -> engine subscriptions (native used to fire these) ----
  p.onSectionChanged = subscribe("sectionChanged");        // host asks engine to jump to a scene (contents menu)
  p.onBookLoadedWithSection = subscribe("bookLoaded");     // host tells engine the book is ready -> playback starts
  p.onPageBecameKey = subscribe("pageBecameKey");
  p.onPageNoLongerKey = subscribe("pageNoLongerKey");
  p.onStoredValue = subscribe("storedValue");
  p.onGlobalAlert = subscribe("globalAlert");
  p.onPlayOptions = subscribe("playOptions");              // 2012-2013 engine: autoplay settings

  // Used by the host (and by shim/foreditor.js) to fire those subscriptions.
  p.fire = function (name, arg) {
    var f = this.handlers[name];
    if (f) f(arg);
  };
  p.jumpToSection = function (n) { this.fire("sectionChanged", n); };

  // ---- engine -> host ----
  p.engineIsReady = function () {
    var info = call(this, "engineIsReady", [this]);
    if (info === false) return;            // host will call startBook() itself (e.g. after a user gesture)
    this.startBook(info);
  };
  p.startBook = function (info) {
    info = info || {};
    this.fire("bookLoaded", {
      sectionNumber: info.sectionNumber || 0,
      bookName: info.bookName || "",
      issueName: info.issueName || "",
      issueNumber: info.issueNumber || "",
      episodeWord: info.episodeWord || "episode"
    });
  };
  p.setSectionNumber = function (n, count) { call(this, "setSectionNumber", [n, count]); };
  p.sectionFinished = function (n) { call(this, "sectionFinished", [n]); };
  p.setProgress = function (t) { call(this, "setProgress", [t]); };
  p.setSceneProgress = function (t) { call(this, "setSceneProgress", [t]); };
  p.setSettings = function (s) { call(this, "setSettings", [s]); };
  p.showNavigation = function () { call(this, "showNavigation", []); };   // "contents" button (top-right)
  p.showSettings = function () { call(this, "showSettings", []); };       // "home" button (top-left)
  p.exit = function () { call(this, "exit", []); };
  p.anyAction = function (action, params) { call(this, "anyAction", [action, params]); };
  p.askForAutoplay = p.askForAutoPlay = function () { call(this, "askForAutoplay", []); };
  p.resourceLoadError = function (e) { console.warn("[narr8] resource load error", e); call(this, "resourceLoadError", [e]); };
  p.log = function (m) { console.log("[narr8]", m); };
  p.globalAlert = function (d) { call(this, "globalAlert", [d]); };

  // Some plugins persist small values (quiz answers, counters) through the host.
  p.setStoredValueForKey = function (value, key) {
    try { localStorage.setItem("narr8:" + key, JSON.stringify(value)); } catch (e) {}
  };
  p.getStoredValueForKey = function (key) {
    var value = null;
    try { value = JSON.parse(localStorage.getItem("narr8:" + key)); } catch (e) {}
    var that = this;
    setTimeout(function () { that.fire("storedValue", { key: key, value: value }); }, 0);
  };

  // Used only by HTML "books", never by motion comics; kept so nothing throws.
  p.goToNextPage = p.goToPrevPage = p.getPageNumber = function () {};
  p.enableNativeNavigationButtons = p.disableNativeNavigationButtons = p.scrollingEnabled = function () {};
})(Navigation.prototype);
