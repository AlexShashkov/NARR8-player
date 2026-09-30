// Replacement for the NARR8 web player's lost "foreditor/foreditor.js".
// Both engine generations load it last from utils/init.js, after the engine and before window "load", which makes
// it the place to adapt them to modern browsers without touching any episode file:
//
//   "universal" engine (2013-2015): utils/Engine.js + utils/creator.js, boots with Engine#initDesktop()
//   "video" engine     (2012-2013): utils/script.js + utils/engine.js, boots with ctx#initDesctop() and also needs
//                                  foreditor/video.js and foreditor/mouse.js (see shim/video.js, shim/mouse.js)
//
// Whatever the generation, the host page gets the same small adapter through narr8Host.engineCreated(adapter, window).
(function () {
  var host = null;
  try { host = window.parent !== window ? window.parent.narr8Host : null; } catch (e) { host = null; }
  var adapter = null;
  var isLegacy = typeof ctx === "function" && typeof ctx.prototype.initDesctop === "function";
  var isUniversal = typeof Engine === "function" && typeof Engine.prototype.initDesktop === "function";

  function report(e) {
    console.error(e);
    if (host && host.engineError) host.engineError(String((e && e.stack) || e));
  }

  // 1. Firefox/Opera adapters rewrite .mp4 -> .webm and .mp3 -> .ogg; only mp4/mp3 ship in the episodes and
  //    every current browser plays them, so use the source as-is everywhere.
  if (HTMLVideoElement.setSrc) HTMLVideoElement.setSrc = function (video, src) { video.src = src; video.mySrc = src; };
  if (HTMLAudioElement.setSrc) HTMLAudioElement.setSrc = function (audio, src) { audio.src = src; audio.mySrc = src; };

  // 2. Always boot the HTML5 (desktop) path: the engines choose initTouch() for iPad/iPhone/Android user agents,
  //    which needs the native video player and the native:// bridge of the old apps.
  window.eWidth = window.innerWidth;
  window.eHeight = window.innerHeight;

  if (isUniversal) {
    // Touch screens: the desktop path only listens to the mouse, so swipes never arrived.
    if (typeof MouseController === "function" && typeof TouchController === "function") {
      var OriginalMouseController = MouseController;
      var hasTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
      MouseController = function (x, y, canvas, delegate) {
        this.mouse = new OriginalMouseController(x, y, canvas, delegate);
        this.touch = hasTouch ? new TouchController(x, y, canvas, delegate) : null;
      };
      MouseController.prototype.changeOffset = function () {
        this.mouse.changeOffset.apply(this.mouse, arguments);
        if (this.touch) this.touch.changeOffset.apply(this.touch, arguments);
      };
    }

    window.initEngine = function () {
      try {
        mi = new Engine(data);
        mi.initDesktop();
        mi.init();
      } catch (e) { report(e); return; }
      adapter = {
        kind: "universal",
        engine: mi,
        aspect: data.settings.width / data.settings.height,
        sceneCount: function () { return mi.scenes.length; },
        currentScene: function () { return mi.scene; },
        forward: function () {
          var subs = mi.subscribtions && mi.subscribtions.externalPlayForward;
          if (subs && subs.length) { mi.fireEvent("externalPlayForward"); return; }
          // Builds before ~2.15 have no "externalPlayForward" hook: press the engine's own forward arrow
          // (bottom-right corner) with a synthetic click, which takes exactly the path of a real one.
          var layer = mi.interactionController && mi.interactionController.view;
          if (!layer) return;
          var r = layer.getBoundingClientRect();
          var opts = { bubbles: true, cancelable: true, view: window, button: 0,
            clientX: r.left + r.width * 0.96, clientY: r.top + r.height * 0.95 };
          layer.dispatchEvent(new MouseEvent("mousedown", opts));
          layer.dispatchEvent(new MouseEvent("mouseup", opts));
        },
        back: function () { if (!mi.jumped) mi.goToPrevScene(); },
        pause: function () { mi.pause(); },
        resume: function () { mi.resume(); },
        resize: function (w, h) { mi.setViewportSize(w, h); }
      };
      mi.addEventListener("bookIsEnded", function () { if (host && host.bookIsEnded) host.bookIsEnded(); }, window);
      window.narr8Adapter = adapter;
      if (host && host.engineCreated) host.engineCreated(adapter, window);
    };
  } else if (isLegacy) {
    var st = document.createElement("style");
    st.textContent = "html,body{margin:0;padding:0;background:#000;overflow:hidden}#bigrect{top:0;left:0}";
    document.head.appendChild(st);

    window.onload = function () {
      try {
        if (typeof textObjects === "undefined") window.textObjects = undefined;
        mi = new ctx("bigrect", settings, animateObjects, audioObjects, textObjects, videoObjects, scenes);
        mi.initDesctop();
      } catch (e) { report(e); return; }
      var c = mi;
      adapter = {
        kind: "legacy",
        engine: c,
        aspect: settings.width / settings.height,
        sceneCount: function () { return c.scenesCnt; },
        currentScene: function () { return c.scene; },
        forward: function () {
          // exactly the conditions of a tap on the engine's own forward arrow (ctx#touchend)
          if (c.pauseCounter === 0 && c.forwardIsEnabled == 1 && c.playIsEnabled == 1 &&
              ((c.state === 0 && (c.scene < c.scenesCnt - 1 || c.sceneIsEnded == 0)) || (c.state === 1 && c.currentLoop !== undefined))) {
            c.playForward();
          }
        },
        back: function () {
          if (c.scene > 0 && c.state !== -3 && c.pauseCounter === 0) c.jumpToSceneWithIndex(c.scene - 1);
        },
        pause: function () { c.pause(); },
        resume: function () { c.play(); },
        resize: function (w, h) {
          // ctx#changeViewportSize was the editor's preview resizer: it skips rescaling at exactly the native
          // height and draws a pink outline around the cropped area, so normalise around it.
          c.scaleKoef = 1;
          c.changeViewportSize(w, h);
          if (h == c.videoHeight) {
            c.content.style[brprefix + "transform"] = c.down ? bradapter.buildTranslateString(0, c.bigheight) : "";
            c.control.style.width = c.videoWidth + "px";
            c.control.style.height = h + "px";
            c.videoController.changeVideoSize(w, h);
          }
          c.elements.style.outline = "none";
          c.view.style.top = "0px";
          c.view.style.left = (-((c.videoWidth * c.scaleKoef - c.bigwidth) / 2)) + "px";
          c.changeOffset();
        }
      };
      adapter.resize(window.innerWidth, window.innerHeight);
      window.narr8Adapter = adapter;
      if (host && host.engineCreated) host.engineCreated(adapter, window);
    };
  } else {
    console.warn("[narr8] unknown engine build; running its own boot code");
  }

  // 3. Keep the engine sized to the frame.
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (adapter) adapter.resize(window.innerWidth, window.innerHeight);
    }, 50);
  });

  // 4. Autoplay policies: if the browser refuses to start a video/sound, ask for one tap and retry.
  var originalPlay = HTMLMediaElement.prototype.play;
  var originalPause = HTMLMediaElement.prototype.pause;
  var blocked = [];
  var overlay = null;
  function showTapToPlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,.55);color:#fff;font:600 20px/1.3 system-ui,sans-serif;cursor:pointer;-webkit-user-select:none;user-select:none";
    overlay.innerHTML = '<div style="padding:18px 28px;border:2px solid rgba(255,255,255,.8);border-radius:999px">&#9654;&nbsp; Tap to play</div>';
    var go = function (e) {
      e.preventDefault(); e.stopPropagation();
      var list = blocked; blocked = [];
      list.forEach(function (el) { if (el.paused && !el.ended) originalPlay.call(el).catch(function () {}); });
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
    };
    overlay.addEventListener("click", go, true);
    overlay.addEventListener("touchend", go, true);
    document.body.appendChild(overlay);
  }
  HTMLMediaElement.prototype.play = function () {
    var el = this;
    // Pauses are often placed on a scene video's very last frame. Seeking there leaves the browser's `ended`
    // flag set, and play() on an ended element restarts it from 0, so tapping "next" replayed the whole scene.
    // The native players simply finished the scene: leave it ended, and both engines' video loops then see
    // `ended` and move on to the next scene. (Audio is not affected: sound effects rely on restart-on-play.)
    if (el.ended && !el.loop && el instanceof HTMLVideoElement) return Promise.resolve();
    var p = originalPlay.apply(el, arguments);
    if (p && typeof p.catch === "function") {
      p.catch(function (err) {
        if (err && err.name === "NotAllowedError") {
          if (blocked.indexOf(el) < 0) blocked.push(el);
          showTapToPlay();
        }
      });
    }
    return p;
  };
  HTMLMediaElement.prototype.pause = function () {
    var i = blocked.indexOf(this);
    if (i >= 0) blocked.splice(i, 1);
    return originalPause.apply(this, arguments);
  };

  // 5. Keyboard: → / Space / Enter = next (same as the on-screen arrow), ← = previous scene.
  window.addEventListener("keydown", function (e) {
    if (!adapter) return;
    var k = e.key;
    if (k === "ArrowRight" || k === " " || k === "Enter" || k === "PageDown") {
      adapter.forward();
      e.preventDefault();
    } else if (k === "ArrowLeft" || k === "PageUp") {
      adapter.back();
      e.preventDefault();
    } else if (host && host.keydown) {
      host.keydown(e);
    }
  });

  // 6. Pause while the tab is hidden, as the apps did when backgrounded.
  var hiddenPaused = false;
  document.addEventListener("visibilitychange", function () {
    if (!adapter) return;
    if (document.hidden && !hiddenPaused) {
      hiddenPaused = true;
      adapter.pause();
    } else if (!document.hidden && hiddenPaused) {
      hiddenPaused = false;
      adapter.resume();
    }
  });
})();
