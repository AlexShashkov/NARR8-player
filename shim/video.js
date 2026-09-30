// Replacement for the lost "foreditor/video.js" of the 2012-2013 NARR8 engine ("video 2.x" builds:
// utils/script.js + utils/scene.js). Its desktop path does `new videoController(engine)` and expects the same
// contract the iOS app's native player implemented (see utils/JSObjCBridge/videoController.js):
//
//   scenes are registered up front ........ startNewScene / setTransitionTypeAndDuration / addTimings / addPauses / addLoops
//   the first scene loads by itself ........ finalizeSceneDatas -> (async) onSceneIsReady
//   while playing the controller fires ..... engine.fireTiming(i), engine.firePause(i), engine.startLoop(i), engine.fireLoop(i)
//   scene changes ........................... transitionToNextSceneWithTypeAndDuration / transitionToSceneWithIndex… / jumpToSceneWithIndex
//
// Times are in milliseconds. Loops are played seamlessly by alternating two <video> elements, like the later
// HTML5 controller of the "universal" engine (utils/VideoController.js) that this is modelled on.
var videoController = (function () {
  // UIView transition constants used by the native player (MCTransition*)
  var DISSOLVE = 5 << 20, SLIDE_TOP = 1 << 28, SLIDE_RIGHT = 2 << 28, SLIDE_BOTTOM = 3 << 28, SLIDE_LEFT = 4 << 28;
  var noop = function () {};

  function makeVideo(z) {
    var v = document.createElement("video");
    v.preload = "auto";
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;background:transparent;z-index:" + z;
    return v;
  }

  function VC(delegate) {
    this.d = delegate;
    this.scenes = [];
    this.currentScene = -1;
    this.nextScene = undefined;
    this.state = 0;          // 0 stopped · 1 playing · 2 looping · 5 finishing a loop before continuing · -1 transition
    this.lastState = 0;
    this.currentLoop = undefined;
    this.sceneIsEnded = 0;
    this.token = 0;          // invalidates stale async loads when scenes change quickly

    this.canplay = this.startplay = this.endscene = this.endscenep = this.playfwd = this.trnended = noop;

    var layer = document.createElement("div");
    layer.className = "narr8-video-layer";
    layer.style.cssText = "position:absolute;left:0;top:0;overflow:hidden;z-index:0;pointer-events:none;background:#000;" +
      "width:" + delegate.videoWidth + "px;height:" + delegate.videoHeight + "px";
    this.layer = layer;
    this.cur = makeVideo(2);
    this.alt = makeVideo(1);
    this.pre = makeVideo(0);
    this.pre.style.visibility = "hidden";
    this.pre.muted = true;
    this.snap = document.createElement("canvas");
    this.snap.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;z-index:5;display:none";
    layer.appendChild(this.pre);
    layer.appendChild(this.alt);
    layer.appendChild(this.cur);
    layer.appendChild(this.snap);
    delegate.view.insertBefore(layer, delegate.view.firstChild);

    var that = this;
    this.timer = setInterval(function () { that.tick(); }, 16);
  }

  var p = VC.prototype;

  // ---------------------------------------------------------------- scene registration
  p.startNewScene = function (src) {
    this.scenes.push({ src: src, pauses: [], timings: [], loops: [], started: 0, transition: 0, duration: 0 });
  };
  p.last = function () { return this.scenes[this.scenes.length - 1]; };
  p.setTransitionTypeAndDuration = function (trn, dur) { this.last().transition = trn || 0; this.last().duration = dur || 0; };
  p.addTiming = function (t) { this.last().timings.push({ time: t, fired: 0 }); };
  p.addTimings = function (a) { for (var i = 0; i < a.length; i++) this.addTiming(a[i]); };
  p.addPause = function (t) { this.last().pauses.push({ time: t, fired: 0 }); };
  p.addPauses = function (a) { for (var i = 0; i < a.length; i++) this.addPause(a[i]); };
  p.addLoop = function (b, e) { this.last().loops.push({ begin: b, end: e, fired: 0, endFired: 0 }); };
  p.addLoops = function (a) { for (var i = 0; i < a.length; i++) this.addLoop(a[i][0], a[i][1]); };
  p.finalizeScene = noop;

  p.finalizeSceneDatas = function () {
    // The native player loaded scene 0 as soon as all scenes were sent. Must stay async: the engine sets its
    // state right after this call returns and only then expects "scene is ready".
    var that = this, token = ++this.token;
    this.load(this.cur, 0, function () {
      if (token !== that.token) return;
      that.currentScene = 0;
      that.resetScene(0);
      that.canplay();
      if (that.scenes.length > 1) that.preload(1);
    });
  };

  p.resetScene = function (k) {
    var s = this.scenes[k], i;
    for (i = 0; i < s.timings.length; i++) s.timings[i].fired = 0;
    for (i = 0; i < s.pauses.length; i++) s.pauses[i].fired = 0;
    for (i = 0; i < s.loops.length; i++) { s.loops[i].fired = 0; s.loops[i].endFired = 0; }
    s.started = 0;
  };

  // ---------------------------------------------------------------- subscriptions
  p.onSceneIsReady = function (f) { this.canplay = f || noop; };
  p.onSceneStartPlaying = function (f) { this.startplay = f || noop; };
  p.onSceneEndPlaying = function (f) { this.endscene = f || noop; };
  p.onSceneEndPlayingWithPause = function (f) { this.endscenep = f || noop; };
  p.onPlayForward = function (f) { this.playfwd = f || noop; };
  p.onTransitionEnded = function (f) { this.trnended = f || noop; };
  // only used by the native (touch) path; kept so nothing throws
  p.onScenePaused = p.onSceneTiming = p.onSceneLooped = p.onSceneLoopPrepared = p.onPlayerPause = p.onPlayerResume = noop;

  // ---------------------------------------------------------------- loading helpers
  p.load = function (video, k, done) {
    var src = this.scenes[k].src;
    var that = this;
    var finished = false;
    var spinnerTimer = setTimeout(function () { that.showSpinner(true); }, 400);
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(spinnerTimer);
      that.showSpinner(false);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
      done();
    }
    function onReady() { if (video.readyState >= 3) finish(); }
    function onError() { console.warn("[narr8] video failed to load:", src); finish(); }
    if (video.mySrc !== src) {
      video.mySrc = src;
      video.src = src;
      video.load();
    } else if (video.readyState >= 1) {
      try { video.currentTime = 0; } catch (e) {}
    }
    if (video.readyState >= 3) { setTimeout(finish, 0); return; }
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onError);
  };

  p.preload = function (k) {
    if (k < 0 || k >= this.scenes.length) return;
    if (this.pre.mySrc === this.scenes[k].src) return;
    this.pre.mySrc = this.scenes[k].src;
    this.pre.src = this.scenes[k].src;
    this.pre.load();
  };

  p.showSpinner = function (on) {
    if (on && !this.spinner) {
      var s = document.createElement("div");
      s.style.cssText = "position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;z-index:6;" +
        "border:3px solid rgba(255,255,255,.2);border-top-color:#fff;animation:narr8spin .9s linear infinite";
      if (!document.getElementById("narr8spin")) {
        var st = document.createElement("style");
        st.id = "narr8spin";
        st.textContent = "@keyframes narr8spin{to{transform:rotate(360deg)}}";
        document.head.appendChild(st);
      }
      this.layer.appendChild(s);
      this.spinner = s;
    } else if (!on && this.spinner) {
      this.spinner.parentNode.removeChild(this.spinner);
      this.spinner = null;
    }
  };

  p.takeSnapshot = function () {
    var c = this.snap, v = this.cur;
    c.width = Math.max(1, this.layer.clientWidth);
    c.height = Math.max(1, this.layer.clientHeight);
    var g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, c.width, c.height);
    try { if (v.readyState >= 2) g.drawImage(v, 0, 0, c.width, c.height); } catch (e) {}
    c.style.transition = "none";
    c.style.opacity = "1";
    c.style.transform = "none";
    c.style.display = "block";
  };

  p.hideSnapshot = function () {
    this.snap.style.display = "none";
    this.snap.style.transition = "none";
    this.cur.style.transition = "none";
    this.cur.style.transform = "none";
  };

  // ---------------------------------------------------------------- scene changes
  p.setNextScene = function (k) {
    this.nextScene = k;
    this.preload(k);
  };

  p.transitionToNextSceneWithTypeAndDuration = function (trn, dur) {
    var k = this.nextScene !== undefined && this.nextScene > this.currentScene ? this.nextScene : this.currentScene + 1;
    this.transitionToSceneWithIndexAndTypeAndDuration(k, trn, dur);
  };

  p.transitionToSceneWithIndexAndTypeAndDuration = function (k, trn, dur) {
    if (k < 0 || k >= this.scenes.length) return;
    var that = this, token = ++this.token;
    this.state = -1;
    this.currentLoop = undefined;
    this.takeSnapshot();
    this.alt.pause();
    this.cur.pause();
    this.resetScene(k);
    this.load(this.cur, k, function () {
      if (token !== that.token) return;
      that.currentScene = k;
      that.nextScene = undefined;
      that.sceneIsEnded = 0;
      that.canplay();
      var done = function () {
        if (token !== that.token) return;
        that.hideSnapshot();
        that.trnended();
        that.startplay();
        that.scenes[k].started = 1;
        that.state = 1;
        that.playForward();
        if (k + 1 < that.scenes.length) that.preload(k + 1);
      };
      if (!trn || !dur) done();
      else that.animate(trn, dur, done);
    });
  };

  p.animate = function (trn, dur, done) {
    var snap = this.snap, cur = this.cur;
    var ease = "cubic-bezier(.4,0,.2,1)";
    var dx = 0, dy = 0;
    if (trn === SLIDE_LEFT) dx = -1; else if (trn === SLIDE_RIGHT) dx = 1;
    else if (trn === SLIDE_TOP) dy = -1; else if (trn === SLIDE_BOTTOM) dy = 1;
    if (dx || dy) {
      // push: the old frame slides out while the new scene slides in behind it
      cur.style.transition = "none";
      cur.style.transform = "translate(" + (-dx * 100) + "%," + (-dy * 100) + "%)";
      void cur.offsetWidth;
      cur.style.transition = snap.style.transition = "transform " + dur + "ms " + ease;
      cur.style.transform = "translate(0,0)";
      snap.style.transform = "translate(" + (dx * 100) + "%," + (dy * 100) + "%)";
    } else {
      // cross-dissolve (also used for flips and page curls)
      void snap.offsetWidth;
      snap.style.transition = "opacity " + dur + "ms linear";
      snap.style.opacity = "0";
    }
    setTimeout(done, dur + 20);
  };

  p.jumpToSceneWithIndex = function (k) {
    if (k < 0 || k >= this.scenes.length) return;
    var that = this, token = ++this.token;
    this.state = 0;
    this.lastState = 0;
    this.sceneIsEnded = 0;
    this.currentLoop = undefined;
    this.hideSnapshot();
    this.alt.pause();
    this.cur.pause();
    this.resetScene(k);
    this.load(this.cur, k, function () {
      if (token !== that.token) return;
      that.currentScene = k;
      that.nextScene = undefined;
      that.canplay();
      that.trnended();
      if (k + 1 < that.scenes.length) that.preload(k + 1);
    });
  };

  // ---------------------------------------------------------------- playback
  p.playForward = function () {
    if (this.state === 5 || this.state === -1 || this.currentScene < 0) return;
    var s = this.scenes[this.currentScene];
    this.cur.play();
    if (this.state !== 2) {
      if (this.state === 1 && this.currentLoop !== undefined) {
        s.loops[this.currentLoop].fired = 1;       // tapped inside a loop's lead-in: skip the loop
        this.currentLoop = undefined;
      } else {
        this.playfwd(this.cur.currentTime * 1000);
      }
      if (!s.started && this.cur.currentTime < 0.1) {
        this.startplay();
        s.started = 1;
      }
      this.state = 1;
    } else {
      this.state = 5;                                // let the loop run to its end, then continue
    }
  };

  p.pause = function (t) {
    this.cur.pause();
    if (t !== undefined && this.cur.seekable.length) this.cur.currentTime = t / 1000;
    this.lastState = this.state;
    this.state = 0;
  };

  p.play = p.resume = function () {
    if (this.lastState !== 0 && this.lastState !== -1) this.cur.play();
    this.state = this.lastState;
  };

  p.loop = function (i) {
    var s = this.scenes[this.currentScene], l = s.loops[i];
    var prev = this.cur;
    this.d.fireLoop(i);
    this.currentLoop = i;
    this.state = 2;
    if (this.alt.mySrc === s.src && this.alt.readyState >= 2) {
      this.cur = this.alt;
      this.alt = prev;
      this.cur.style.zIndex = 2;
      this.alt.style.zIndex = 1;
      this.cur.play();
      prev.pause();
      prev.currentTime = l.begin / 1000;
    } else {
      prev.currentTime = l.begin / 1000;
      prev.play();
    }
  };

  p.loopStarted = function (i) {
    var s = this.scenes[this.currentScene], l = s.loops[i], alt = this.alt;
    this.d.startLoop(i);
    this.currentLoop = i;
    if (alt.mySrc !== s.src) {
      alt.mySrc = s.src;
      alt.src = s.src;
      alt.load();
    }
    if (alt.readyState >= 1) alt.currentTime = l.begin / 1000;
    else alt.addEventListener("loadedmetadata", function f() { alt.removeEventListener("loadedmetadata", f); alt.currentTime = l.begin / 1000; });
  };

  p.changeVideoSize = function () {
    var k = this.d.scaleKoef || 1;
    this.layer.style.width = Math.round(this.d.videoWidth * k) + "px";
    this.layer.style.height = Math.round(this.d.videoHeight * k) + "px";
  };

  // ---------------------------------------------------------------- main loop (like the native player's time observer)
  p.tick = function () {
    if (this.currentScene < 0) return;
    var s = this.scenes[this.currentScene], v = this.cur, t = v.currentTime * 1000, i;
    switch (this.state) {
      case 1:
        for (i = s.timings.length - 1; i >= 0; i--) {
          if (!s.timings[i].fired && t >= s.timings[i].time) { s.timings[i].fired = 1; this.d.fireTiming(i); }
        }
        for (i = s.pauses.length - 1; i >= 0; i--) {
          var ps = s.pauses[i];
          if (!ps.fired && t >= ps.time) {
            this.pause(ps.time);
            ps.fired = 1;
            if (v.duration * 1000 - ps.time <= 20) this.endscenep(i);
            else this.d.firePause(i);
            return;
          }
        }
        for (i = s.loops.length - 1; i >= 0; i--) {
          var l = s.loops[i];
          if (t >= l.end) {
            if (!l.fired) { l.fired = 1; l.endFired = 1; this.loop(i); return; }
            if (!l.endFired) { l.endFired = 1; this.playfwd(t); }
          }
        }
        if (this.currentLoop === undefined) {
          for (i = s.loops.length - 1; i >= 0; i--) {
            if (!s.loops[i].fired && t >= s.loops[i].begin) this.loopStarted(i);
          }
        }
        if (!this.sceneIsEnded && v.ended) {
          this.state = 0;
          this.sceneIsEnded = 1;
          this.endscene();
        }
        break;
      case 2:
        var lp = s.loops[this.currentLoop];
        if (t >= lp.end) {
          var prev = this.cur;
          if (this.alt.readyState >= 2) {
            this.cur = this.alt;
            this.alt = prev;
            this.cur.style.zIndex = 2;
            this.alt.style.zIndex = 1;
            this.cur.play();
            prev.pause();
            prev.currentTime = lp.begin / 1000;
          } else {
            prev.currentTime = lp.begin / 1000;
          }
        }
        break;
      case 5:
        var lf = s.loops[this.currentLoop];
        if (!lf || t >= lf.end) {
          this.playfwd(t);
          this.state = 1;
          this.currentLoop = undefined;
        }
        break;
    }
  };

  return VC;
})();
