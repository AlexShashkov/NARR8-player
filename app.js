// NARR8 Player — host application.
// Reads NARR8 episode zips straight from a folder the user picks, and runs each episode's own 2012-2015 HTML5 engine
// in an iframe, playing the role the NARR8 iOS/Android apps and the narr8.com web player used to play.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var LANG_NAMES = { en: "English", ru: "Русский", es: "Español", ko: "한국어", de: "Deutsch", fr: "Français", it: "Italiano", pt: "Português", ja: "日本語", zh: "中文", he: "עברית", tr: "Türkçe" };
  var SCAN_VERSION = 4; // bump when scan results change shape

  // ================================================================== utilities

  function toast(msg, ms) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, ms || 3500);
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x"; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // "Prodigal Angel.Ep_01.50587a955050e8a92d00055b.zip" -> { series: "Prodigal Angel", episode: 1, tag: "5058…" }
  // "Jam.Ep_11.51703180550c3M9KYrn_a_540.zip"          -> { series: "Jam", episode: 11, tag: "51703180550c3M9KYrn_a_540" }
  // "Subject 9.ep01.cover.jpg"                         -> { series: "Subject 9", episode: 1, tag: "cover" }
  function parseName(fileName) {
    var base = fileName.replace(/\.[a-z0-9]+$/i, "");
    var m = /^(.+?)[\s._-]+ep(?:isode)?[\s._-]*0*(\d+)(?:[\s._-]+(.+))?$/i.exec(base);
    if (m) return { series: m[1].trim(), episode: parseInt(m[2], 10), tag: m[3] || null };
    return { series: base.trim(), episode: null, tag: null };
  }

  function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  }

  function getProgress(id) {
    try { return JSON.parse(localStorage.getItem("narr8:progress:" + id)) || null; } catch (e) { return null; }
  }
  function setProgress(id, p) {
    try { localStorage.setItem("narr8:progress:" + id, JSON.stringify(p)); } catch (e) {}
  }

  function preferredLang(langs) {
    var saved = null;
    try { saved = localStorage.getItem("narr8:lang"); } catch (e) {}
    var nav = (navigator.language || "en").slice(0, 2).toLowerCase();
    var order = [saved, nav, "en"];
    for (var i = 0; i < order.length; i++) if (order[i] && langs.indexOf(order[i]) >= 0) return order[i];
    return langs[0];
  }

  // ================================================================== service worker

  var swReady = (function () {
    if (!("serviceWorker" in navigator)) {
      return Promise.reject(new Error("This browser has no Service Worker support, or the page is not served over http://localhost or https://."));
    }
    return navigator.serviceWorker.register("sw.js").then(function () {
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      if (navigator.serviceWorker.controller) return;
      return new Promise(function (resolve) {
        navigator.serviceWorker.addEventListener("controllerchange", function () { resolve(); }, { once: true });
        if (reg.active) reg.active.postMessage("claim");
      });
    });
  })();
  swReady.catch(function (e) { toast(e.message, 15000); });

  // The service worker asks us for episode files (see sw.js). Assigning onmessage also starts the message queue.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.onmessage = function (e) {
      var d = e.data;
      if (!d || d.type !== "narr8-file" || !e.ports[0]) return;
      var port = e.ports[0];
      provideFile(d.id, d.path).then(function (blob) {
        port.postMessage(blob ? { blob: blob } : { missing: true });
      }, function (err) {
        console.warn("[narr8] cannot read", d.path, err);
        port.postMessage({ missing: true });
      });
    };
  }

  // ================================================================== library: folder -> episodes

  var library = { name: "", episodes: [], byId: {}, series: [] };
  var coverUrls = [];

  // Collect { path, file } for every file under a directory handle (File System Access API).
  function walkHandle(dir, prefix, out, depth) {
    var it = dir.values();
    function step() {
      return it.next().then(function (r) {
        if (r.done) return;
        var h = r.value;
        if (h.name.charAt(0) === ".") return step();
        if (h.kind === "directory") {
          return (depth < 6 ? walkHandle(h, prefix + h.name + "/", out, depth + 1) : Promise.resolve()).then(step);
        }
        if (!/\.(zip|jpe?g|png)$/i.test(h.name)) return step();
        return h.getFile().then(function (f) { out.push({ path: prefix + h.name, file: f }); }).then(step);
      });
    }
    return step();
  }

  function filesFromInput(list) {
    return Array.prototype.slice.call(list).filter(function (f) {
      return /\.(zip|jpe?g|png)$/i.test(f.name) && !/(^|\/)\./.test(f.webkitRelativePath || f.name);
    }).map(function (f) {
      var rel = f.webkitRelativePath || f.name;
      var parts = rel.split("/");
      if (parts.length > 1) parts.shift();         // drop the picked folder's own name
      return { path: parts.join("/"), file: f };
    });
  }

  function buildLibrary(rootName, files) {
    var zips = files.filter(function (x) { return /\.zip$/i.test(x.path); });
    var images = files.filter(function (x) { return /\.(jpe?g|png)$/i.test(x.path); });
    var covers = {};
    images.forEach(function (x) {
      var n = parseName(x.file.name);
      if (n.episode === null) return;
      var key = n.series.toLowerCase() + "|" + n.episode;
      if (!covers[key] || /cover/i.test(x.file.name)) covers[key] = x.file;
    });
    var used = {};
    var episodes = zips.map(function (x) {
      var n = parseName(x.file.name);
      var segs = x.path.split("/");
      var series = n.episode !== null ? n.series : (segs.length > 1 ? segs[0] : n.series);
      var id = n.tag ? n.tag.replace(/[^A-Za-z0-9_-]+/g, "_") : slug(series) + "-" + (n.episode !== null ? pad2(n.episode) : slug(n.series));
      while (used[id]) id += "_";
      used[id] = 1;
      return {
        id: id,
        series: series,
        episode: n.episode,
        title: n.episode !== null ? "Episode " + n.episode : n.series,
        path: x.path,
        file: x.file,
        cover: covers[series.toLowerCase() + "|" + n.episode] || null,
        key: x.path + "|" + x.file.size + "|" + x.file.lastModified,
        meta: null
      };
    });
    episodes.sort(function (a, b) {
      return naturalCompare(a.series, b.series) || (a.episode || 0) - (b.episode || 0) || naturalCompare(a.path, b.path);
    });
    var groups = {};
    var series = [];
    episodes.forEach(function (e) {
      var k = e.series.toLowerCase();
      if (!groups[k]) { groups[k] = { name: e.series, episodes: [] }; series.push(groups[k]); }
      groups[k].episodes.push(e);
    });
    library = { name: rootName, episodes: episodes, series: series, byId: {} };
    episodes.forEach(function (e) { library.byId[e.id] = e; });
    return scanAll();
  }

  // Read each zip's directory (cached): engine generation, languages, contents thumbnails, fallback cover.
  function scanAll() {
    var eps = library.episodes;
    renderLibrary();
    if (!eps.length) return Promise.resolve();
    return NarrDB.getMany("scans", eps.map(function (e) { return e.key; })).then(function (cached) {
      var todo = [];
      eps.forEach(function (e) {
        var c = cached[e.key];
        if (c && c.v === SCAN_VERSION) e.meta = c; else todo.push(e);
      });
      if (!todo.length) { renderLibrary(); return; }
      var status = $("scan-status");
      status.hidden = false;
      var done = 0, fresh = {};
      function update() {
        $("scan-label").textContent = "Reading episodes… " + done + " / " + todo.length;
        $("scan-bar").style.width = Math.round(100 * done / todo.length) + "%";
      }
      update();
      var queue = todo.slice();
      function worker() {
        var e = queue.shift();
        if (!e) return Promise.resolve();
        return scanZip(e).then(function (meta) {
          e.meta = meta;
          fresh[e.key] = meta;
        }, function (err) {
          console.warn("[narr8] could not read", e.path, err);
          e.meta = { v: SCAN_VERSION, error: String(err.message || err) };
        }).then(function () { done++; update(); }).then(worker);
      }
      var workers = [];
      for (var i = 0; i < 4; i++) workers.push(worker());
      return Promise.all(workers).then(function () {
        status.hidden = true;
        renderLibrary();
        return NarrDB.setMany("scans", fresh).catch(function () {});
      });
    });
  }

  function scanZip(ep) {
    return NarrZip.listEntries(ep.file).then(function (entries) {
      var files = entries.filter(function (x) { return !x.isDir && !/(^|\/)__MACOSX\//.test(x.name); });
      var canvas = files.filter(function (x) { return /(^|\/)canvas\.html$/i.test(x.name); })
        .sort(function (a, b) { return a.name.length - b.name.length; })[0];
      if (!canvas) throw new Error("no canvas.html inside — not a NARR8 episode");
      var prefix = canvas.name.slice(0, canvas.name.length - "canvas.html".length);
      var map = {};
      files.forEach(function (x) { if (x.name.indexOf(prefix) === 0) map[x.name.slice(prefix.length)] = x; });
      var meta = { v: SCAN_VERSION, prefix: prefix, langs: [], engine: "unknown", scenes: null, cover: null, count: 0 };
      Object.keys(map).forEach(function (p) {
        var m = /^([a-z]{2})\/data\.js$/i.exec(p);
        if (m) meta.langs.push(m[1].toLowerCase());
      });
      meta.langs.sort();
      if (map["utils/Engine.js"]) meta.engine = "universal";
      else if (map["utils/script.js"]) meta.engine = "video";
      // Page previews are named 0 (cover), 00, 000 (pages before page 1), 01, 02, … — the same order as the scenes.
      var previews = Object.keys(map).filter(function (p) { return /^img\/preview\/\d+\.(png|jpe?g)$/i.test(p); })
        .sort(function (a, b) {
          var x = /(\d+)\.\w+$/.exec(a)[1], y = /(\d+)\.\w+$/.exec(b)[1];
          return (parseInt(x, 10) - parseInt(y, 10)) || (x.length - y.length);
        });
      meta.previews = previews;
      var jobs = [];
      if (map["manifest.json"]) {
        jobs.push(NarrZip.extract(ep.file, map["manifest.json"]).then(function (b) { return b.text(); }).then(function (t) {
          try {
            var j = JSON.parse(t);
            if (j && j.scenes && j.scenes.length) {
              meta.scenes = j.scenes.map(function (s) { return { name: s.name || "", image: s.contents_image || "" }; });
              meta.count = j.scenes.length;
            }
          } catch (e) {}
        }));
      }
      if (!ep.cover && map["cover.jpg"]) {
        jobs.push(NarrZip.extract(ep.file, map["cover.jpg"]).then(function (b) { meta.cover = b; }));
      }
      return Promise.all(jobs).then(function () { return meta; });
    });
  }

  // ------------------------------------------------------------------ serving files to the engine (via sw.js)

  var zipIndex = {};   // episode id -> Promise<{ prefix, exact: {path: entry}, lower: {path: entry} }>
  var blobCache = {};  // "<id>/<path>" -> Promise<Blob>, only for the episode currently open
  var cacheOwner = null;

  function getIndex(ep) {
    if (!zipIndex[ep.id]) {
      zipIndex[ep.id] = NarrZip.listEntries(ep.file).then(function (entries) {
        var prefix = (ep.meta && ep.meta.prefix) || "";
        var exact = {}, lower = {};
        entries.forEach(function (x) {
          if (x.isDir || x.name.indexOf(prefix) !== 0) return;
          var p = x.name.slice(prefix.length);
          exact[p] = x;
          lower[p.toLowerCase()] = x;
        });
        return { exact: exact, lower: lower };
      });
      zipIndex[ep.id].catch(function () { delete zipIndex[ep.id]; });
    }
    return zipIndex[ep.id];
  }

  function provideFile(id, path) {
    var ep = library.byId[id];
    if (!ep) return Promise.resolve(null);
    if (cacheOwner !== id) { blobCache = {}; cacheOwner = id; }
    var key = id + "/" + path;
    if (!blobCache[key]) {
      blobCache[key] = getIndex(ep).then(function (idx) {
        // the apps ran on case-insensitive iOS/macOS file systems, so tolerate case mismatches
        var entry = idx.exact[path] || idx.lower[path.toLowerCase()];
        return entry ? NarrZip.extract(ep.file, entry) : null;
      });
      blobCache[key].catch(function () { delete blobCache[key]; });
    }
    return blobCache[key];
  }

  // ------------------------------------------------------------------ folder selection & persistence

  var supportsHandles = typeof window.showDirectoryPicker === "function";

  function chooseFolder() {
    if (supportsHandles) {
      window.showDirectoryPicker({ id: "narr8-comics", mode: "read" }).then(function (handle) {
        return NarrDB.set("kv", "folder", handle).catch(function () {}).then(function () { return openHandle(handle); });
      }, function (err) {
        if (err && err.name !== "AbortError") toast(err.message, 6000);
      });
    } else {
      $("folder-input").click();
    }
  }

  function openHandle(handle) {
    showState("loading");
    var files = [];
    return walkHandle(handle, "", files, 0).then(function () {
      return buildLibrary(handle.name, files);
    }).catch(function (err) {
      console.error(err);
      toast("Could not read the folder: " + err.message, 8000);
      showState("empty");
    });
  }

  // On start: reuse the folder picked last time (Chrome/Edge keep the handle; permission may need one click).
  function restoreFolder() {
    if (!supportsHandles) { showState("empty"); return; }
    NarrDB.get("kv", "folder").then(function (handle) {
      if (!handle) { showState("empty"); return; }
      return handle.queryPermission({ mode: "read" }).then(function (perm) {
        if (perm === "granted") return openHandle(handle);
        $("reconnect-name").textContent = handle.name;
        showState("reconnect");
        $("reconnect-btn").onclick = function () {
          handle.requestPermission({ mode: "read" }).then(function (p) {
            if (p === "granted") openHandle(handle);
          });
        };
      });
    }).catch(function () { showState("empty"); });
  }

  // "empty" (no folder yet) · "reconnect" (folder known, needs permission) · "loading" · "library"
  function showState(state) {
    $("onboarding").hidden = state !== "empty" && state !== "reconnect";
    $("reconnect").hidden = state !== "reconnect";
    $("pick-intro").hidden = state === "reconnect";
    $("lib-loading").hidden = state !== "loading";
    $("shelf").hidden = state !== "library";
    $("lib-toolbar").hidden = state !== "library";
  }

  $("choose-btn").addEventListener("click", chooseFolder);
  $("change-btn").addEventListener("click", chooseFolder);
  $("choose-other-btn").addEventListener("click", chooseFolder);
  $("files-link").addEventListener("click", function (e) { e.preventDefault(); $("files-input").click(); });
  $("folder-input").addEventListener("change", function (e) {
    var list = e.target.files;
    if (!list || !list.length) return;
    var root = (list[0].webkitRelativePath || "").split("/")[0] || "Comics";
    showState("loading");
    buildLibrary(root, filesFromInput(list));
    e.target.value = "";
  });
  $("files-input").addEventListener("change", function (e) {
    var list = e.target.files;
    if (!list || !list.length) return;
    showState("loading");
    buildLibrary("Selected files", filesFromInput(list));
    e.target.value = "";
  });

  // ------------------------------------------------------------------ library UI

  function nextToRead(group) {
    var eps = group.episodes;
    for (var i = 0; i < eps.length; i++) {
      var p = getProgress(eps[i].id);
      if (p && !p.finished && p.section > 0) return { ep: eps[i], resume: true };
    }
    var lastFinished = -1;
    for (i = 0; i < eps.length; i++) if ((getProgress(eps[i].id) || {}).finished) lastFinished = i;
    return { ep: eps[Math.min(lastFinished + 1, eps.length - 1)], resume: false };
  }

  function coverUrl(ep) {
    var src = ep.cover || (ep.meta && ep.meta.cover);
    if (!src) return null;
    var u = URL.createObjectURL(src);
    coverUrls.push(u);
    return u;
  }

  function renderLibrary() {
    coverUrls.forEach(URL.revokeObjectURL);
    coverUrls = [];
    var shelf = $("shelf");
    shelf.innerHTML = "";
    $("folder-name").textContent = library.name;
    var total = library.episodes.length;
    $("folder-count").textContent = library.series.length + (library.series.length === 1 ? " series · " : " series · ") + total + (total === 1 ? " episode" : " episodes");

    if (!total) {
      shelf.appendChild(el("p", "empty muted", "No NARR8 episode zips were found in “" + library.name + "”. Choose the folder that contains them."));
      showState("library");
      return;
    }

    library.series.forEach(function (group) {
      var section = el("section", "series");
      var head = el("div", "series-head");
      var titles = el("div", "series-titles");
      titles.appendChild(el("h2", "series-name", group.name));
      var finished = group.episodes.filter(function (e) { return (getProgress(e.id) || {}).finished; }).length;
      titles.appendChild(el("div", "muted", group.episodes.length + " episodes" + (finished ? " · " + finished + " finished" : "")));
      head.appendChild(titles);
      var nxt = nextToRead(group);
      var cont = el("button", "btn primary small", (nxt.resume ? "Resume " : (finished ? "Continue: " : "Start: ")) + nxt.ep.title);
      cont.onclick = function () { openEpisode(nxt.ep, {}); };
      head.appendChild(cont);
      section.appendChild(head);

      var row = el("div", "ep-row");
      group.episodes.forEach(function (ep) { row.appendChild(episodeCard(ep)); });
      section.appendChild(row);
      shelf.appendChild(section);
    });
    showState("library");
  }

  function episodeCard(ep) {
    var prog = getProgress(ep.id);
    var card = el("button", "ep-card");
    card.title = ep.series + " — " + ep.title;
    var art = el("div", "ep-art");
    var u = coverUrl(ep);
    if (u) {
      var img = el("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = "";
      img.src = u;
      art.appendChild(img);
    } else {
      art.appendChild(el("span", "ep-art-fallback", ep.episode !== null ? pad2(ep.episode) : "?"));
    }
    if (prog && prog.count > 1) {
      var line = el("span", "progress-line");
      line.style.width = (prog.finished ? 100 : Math.max(3, Math.round(100 * prog.section / (prog.count - 1)))) + "%";
      art.appendChild(line);
    }
    if (prog && prog.finished) art.appendChild(el("span", "ep-badge", "✓"));
    card.appendChild(art);
    var meta = el("div", "ep-meta");
    meta.appendChild(el("span", "ep-title", ep.title));
    var sub = "";
    if (ep.meta && ep.meta.error) sub = "Unreadable";
    else if (prog && prog.section > 0 && !prog.finished && prog.count) sub = "Page " + prog.section + " of " + (prog.count - 1);
    else if (ep.meta && ep.meta.langs) sub = ep.meta.langs.map(function (l) { return l.toUpperCase(); }).join(" · ");
    meta.appendChild(el("span", "ep-sub", sub));
    card.appendChild(meta);
    card.onclick = function () { openEpisode(ep, {}); };
    if (ep.meta && ep.meta.error) card.classList.add("broken");
    return card;
  }

  // ================================================================== player

  var player = $("player");
  var frame = $("frame");
  var S = null; // current session

  function openEpisode(ep, opts) {
    if (ep.meta && ep.meta.error) { toast("This episode could not be read: " + ep.meta.error, 6000); return; }
    var metaReady = ep.meta ? Promise.resolve() : scanZip(ep).then(function (m) { ep.meta = m; });
    Promise.all([swReady, metaReady]).then(function () {
      var prog = getProgress(ep.id);
      var section = opts.section !== undefined ? opts.section : (prog && !prog.finished ? prog.section || 0 : 0);
      var langs = ep.meta.langs.length ? ep.meta.langs : [""];
      var lang = opts.lang !== undefined ? opts.lang : preferredLang(langs);
      S = {
        ep: ep,
        lang: lang,
        startSection: section,
        current: section,
        count: ep.meta.count || 0,
        aspect: 16 / 9,
        nav: null,
        adapter: null,
        win: null,
        hostPaused: false,
        ended: false
      };
      $("library").hidden = true;
      player.hidden = false;
      $("loading").classList.remove("done");
      $("endcard").hidden = true;
      $("error").hidden = true;
      closeSheets(true);
      if (!history.state || !history.state.player) history.pushState({ player: ep.id }, "", "#play/" + encodeURIComponent(ep.id));
      else history.replaceState({ player: ep.id }, "", "#play/" + encodeURIComponent(ep.id));
      document.title = ep.series + " — " + ep.title;
      layout();
      frame.src = "comic/" + encodeURIComponent(ep.id) + "/canvas.html?" + (lang ? "lang=" + lang + "&" : "") + "disableCacheKiller=1";
      frame.focus();
    }, function (e) { toast(e.message, 10000); });
  }

  function closePlayer(fromPopState) {
    if (!S) return;
    frame.src = "about:blank";
    S = null;
    blobCache = {};
    cacheOwner = null;
    closeSheets(true);
    player.hidden = true;
    $("library").hidden = false;
    document.title = "NARR8 Player";
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    if (!fromPopState && history.state && history.state.player) history.back();
    renderLibrary();
  }

  window.addEventListener("popstate", function () {
    if (S && !(history.state && history.state.player)) closePlayer(true);
  });

  // Letterbox the engine between 4:3 (the iPad frame it was designed around) and its native aspect (16:9).
  function layout() {
    var W = window.innerWidth, H = window.innerHeight;
    var a = S ? S.aspect : 16 / 9;
    var maxA = Math.max(a, 4 / 3), minA = Math.min(a, 4 / 3);
    var w = W, h = H;
    if (W / H > maxA) w = Math.round(H * maxA);
    else if (W / H < minA) h = Math.round(W / minA);
    frame.style.width = w + "px";
    frame.style.height = h + "px";
  }
  window.addEventListener("resize", layout);

  function saveProgress(finished) {
    if (!S) return;
    var prev = getProgress(S.ep.id) || {};
    setProgress(S.ep.id, {
      section: S.current,
      count: S.count,
      finished: finished || (prev.finished && S.current >= S.count - 1) || false,
      at: Date.now()
    });
  }

  function pauseEngine() {
    if (S && S.adapter && S.nav && !S.hostPaused) {
      S.hostPaused = true;
      try { S.adapter.pause(); } catch (e) {}
    }
  }
  function resumeEngine() {
    if (S && S.adapter && S.hostPaused) {
      S.hostPaused = false;
      try { S.adapter.resume(); } catch (e) {}
    }
  }

  function bookEnded() {
    if (!S || S.ended) return;
    S.ended = true;
    saveProgress(true);
    var session = S;
    setTimeout(function () { if (S === session) showEndCard(); }, 1500);
  }

  // --- the API the episode's engine talks to (see shim/navigation.js and shim/foreditor.js)
  window.narr8Host = {
    engineCreated: function (adapter, win) {
      if (!S) return;
      S.adapter = adapter;
      S.win = win;
      if (adapter.aspect) S.aspect = adapter.aspect;
      layout();
      var hideTimer;
      win.addEventListener("mousemove", function () {
        player.classList.add("show-ui");
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () { player.classList.remove("show-ui"); }, 2200);
      });
    },
    engineIsReady: function (nav) {
      if (!S) return false;
      S.nav = nav;
      if (S.adapter) S.count = S.adapter.sceneCount() || S.count;
      $("loading").classList.add("done");
      var ep = S.ep;
      return {
        sectionNumber: Math.min(S.startSection || 0, Math.max(0, S.count - 1)),
        bookName: ep.series,
        issueName: "",
        issueNumber: ep.episode !== null ? pad2(ep.episode) : "",
        episodeWord: "episode"
      };
    },
    engineError: function (msg) {
      $("loading").classList.add("done");
      var box = $("error");
      box.textContent = "The episode's engine failed to start.\n\n" + msg;
      box.hidden = false;
    },
    setSectionNumber: function (n, count) {
      if (!S) return;
      S.current = n;
      if (count) S.count = count;
      if (n < S.count - 1) { S.ended = false; $("endcard").hidden = true; }
      saveProgress(false);
    },
    sectionFinished: function (n) {
      if (S && S.count && n >= S.count - 1) bookEnded();
    },
    bookIsEnded: function () { bookEnded(); },
    showNavigation: function () { openContents(); },
    showSettings: function () { openMenu(); },
    exit: function () { closePlayer(); },
    anyAction: function (action) { console.log("[narr8] action", action); },
    keydown: function (e) { onKey(e); }
  };

  // --- menu / contents / end card

  function closeSheets(silent) {
    var wasOpen = !$("menu").hidden || !$("contents").hidden;
    $("menu").hidden = true;
    $("contents").hidden = true;
    if (wasOpen && !silent) { resumeEngine(); frame.focus(); }
  }

  function openMenu() {
    if (!S) return;
    closeSheets(true);
    var ep = S.ep;
    $("menu-title").textContent = ep.series;
    $("menu-sub").textContent = ep.title + (S.count ? " · Page " + S.current + " of " + (S.count - 1) : "");
    var sel = $("m-lang");
    sel.innerHTML = "";
    (ep.meta.langs.length ? ep.meta.langs : [""]).forEach(function (l) {
      var o = document.createElement("option");
      o.value = l;
      o.textContent = l ? (LANG_NAMES[l] || l.toUpperCase()) : "Default";
      if (l === S.lang) o.selected = true;
      sel.appendChild(o);
    });
    sel.parentNode.hidden = ep.meta.langs.length < 2;
    $("m-fullscreen").textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
    $("m-fullscreen").hidden = !(player.requestFullscreen || player.webkitRequestFullscreen);
    pauseEngine();
    $("menu").hidden = false;
    $("m-resume").focus();
  }

  function openContents() {
    if (!S) return;
    closeSheets(true);
    var grid = $("contents-grid");
    grid.innerHTML = "";
    var base = "comic/" + encodeURIComponent(S.ep.id) + "/";
    var meta = S.ep.meta;
    var count = S.count || (meta.scenes && meta.scenes.length) || 0;
    var images = [];
    if (meta.scenes) images = meta.scenes.map(function (s) { return s.image; });
    else if (meta.previews) images = meta.previews;   // no scene list in the manifest: previews follow scene order
    for (var i = 0; i < count; i++) {
      (function (i) {
        var b = el("button", "scene-tile" + (i === S.current ? " current" : ""));
        var img = el("img");
        img.loading = "lazy";
        img.alt = "";
        if (images[i]) img.src = base + images[i];
        b.appendChild(img);
        var name = meta.scenes && meta.scenes[i] ? meta.scenes[i].name : "";
        b.appendChild(el("span", "", i === 0 ? "Cover" : (name || String(i))));
        b.onclick = function () { jumpTo(i); };
        grid.appendChild(b);
      })(i);
    }
    pauseEngine();
    $("contents").hidden = false;
    var cur = grid.querySelector(".current");
    if (cur) { cur.scrollIntoView({ block: "center" }); cur.focus(); }
  }

  function jumpTo(i) {
    closeSheets(false);
    if (!S || !S.nav || i === S.current) return;
    $("endcard").hidden = true;
    S.nav.jumpToSection(i);
  }

  function nextEpisode(ep) {
    var group = library.series.filter(function (g) { return g.name.toLowerCase() === ep.series.toLowerCase(); })[0];
    if (!group) return null;
    var i = group.episodes.indexOf(ep);
    return i >= 0 && i + 1 < group.episodes.length ? group.episodes[i + 1] : null;
  }

  function showEndCard() {
    var next = nextEpisode(S.ep);
    var btn = $("e-next");
    btn.hidden = !next;
    if (next) btn.textContent = "Next: " + next.title + " ›";
    btn.onclick = next ? function () { openEpisode(next, { section: 0 }); } : null;
    $("endcard").hidden = false;
  }

  function toggleFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      var fn = player.requestFullscreen || player.webkitRequestFullscreen;
      if (fn) { var p = fn.call(player); if (p && p.catch) p.catch(function () {}); }
    }
  }

  function onKey(e) {
    if (!S) return;
    var menuOpen = !$("menu").hidden || !$("contents").hidden;
    if (e.key === "Escape") {
      if (menuOpen) closeSheets(false); else openMenu();
      e.preventDefault();
    } else if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey) {
      toggleFullscreen();
    } else if ((e.key === "c" || e.key === "C") && !menuOpen && !e.metaKey && !e.ctrlKey) {
      openContents();
    }
  }
  document.addEventListener("keydown", function (e) {
    if (!S) return;
    // keys while focus is in the host page rather than inside the episode frame
    var menuOpen = !$("menu").hidden || !$("contents").hidden;
    if (!menuOpen && S.adapter && e.target.tagName !== "BUTTON" && e.target.tagName !== "SELECT") {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { S.adapter.forward(); e.preventDefault(); return; }
      if (e.key === "ArrowLeft") { S.adapter.back(); e.preventDefault(); return; }
    }
    onKey(e);
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (b) {
    b.addEventListener("click", function () { closeSheets(false); });
  });
  ["menu", "contents"].forEach(function (id) {
    $(id).addEventListener("click", function (e) { if (e.target === $(id)) closeSheets(false); });
  });
  $("menu-btn").addEventListener("click", openMenu);
  $("m-resume").addEventListener("click", function () { closeSheets(false); });
  $("m-contents").addEventListener("click", openContents);
  $("m-restart").addEventListener("click", function () { if (S) openEpisode(S.ep, { section: 0, lang: S.lang }); });
  $("m-fullscreen").addEventListener("click", function () { toggleFullscreen(); closeSheets(false); });
  $("m-exit").addEventListener("click", function () { closePlayer(); });
  $("m-lang").addEventListener("change", function (e) {
    if (!S) return;
    var lang = e.target.value;
    try { localStorage.setItem("narr8:lang", lang); } catch (err) {}
    openEpisode(S.ep, { section: S.current, lang: lang });
  });
  $("e-replay").addEventListener("click", function () { if (S) openEpisode(S.ep, { section: 0, lang: S.lang }); });
  $("e-exit").addEventListener("click", function () { closePlayer(); });

  // Scriptable entry points (handy for debugging from the console and for automated tests).
  window.narr8 = {
    library: function () { return library; },
    loadFiles: function (rootName, list) { showState("loading"); return buildLibrary(rootName, list); },
    open: function (id, opts) { var ep = library.byId[id]; if (ep) openEpisode(ep, opts || {}); return !!ep; },
    session: function () { return S; }
  };

  // ================================================================== boot
  if (location.hash.indexOf("#play/") === 0) history.replaceState(null, "", location.pathname + location.search);
  restoreFolder();
})();
