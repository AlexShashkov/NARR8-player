// NARR8 Player — host application.
// Reads NARR8 episode zips straight from a folder the user picks, and runs each episode's own 2012-2015 HTML5 engine
// in an iframe, playing the role the NARR8 iOS/Android apps and the narr8.com web player used to play.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var LANG_NAMES = { en: "English", ru: "Русский", es: "Español", ko: "한국어", de: "Deutsch", fr: "Français", it: "Italiano", pt: "Português", ja: "日本語", zh: "中文", he: "עברית", tr: "Türkçe" };
  var SCAN_VERSION = 4; // bump when scan results change shape

  var theme = readSetting("theme") === "modern" ? "modern" : "classic";
  var savedInterface = readSetting("interface-lang");
  var interfaceLang = savedInterface === "ru" || savedInterface === "en" ? savedInterface :
    (/^ru(?:-|$)/i.test(navigator.language) ? "ru" : "en");

  function readSetting(key) {
    try { return localStorage.getItem("narr8:" + key); } catch (e) { return null; }
  }

  function writeSetting(key, value) {
    try { localStorage.setItem("narr8:" + key, value); } catch (e) {}
  }

  function t(key, values) { return NarrLocale.translate(interfaceLang, key, values); }
  function countText(key, number) { return NarrLocale.count(interfaceLang, key, number); }
  function episodeTitle(ep) {
    return ep.episode === null ? ep.title : t("episodeTitle", { number: ep.episode });
  }

  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === "classic" ? "#212121" : "#0e0e10";
    $("theme-select").value = theme;
  }

  function applyInterfaceLanguage() {
    document.documentElement.lang = interfaceLang;
    $("interface-lang").value = interfaceLang;
    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-label]").forEach(function (node) {
      node.setAttribute("aria-label", t(node.dataset.i18nLabel));
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function (node) {
      node.title = t(node.dataset.i18nTitle);
    });
  }

  $("theme-select").addEventListener("change", function () {
    theme = this.value;
    writeSetting("theme", theme);
    applyTheme();
    if (!$("shelf").hidden) renderLibrary();
  });
  $("interface-lang").addEventListener("change", function () {
    interfaceLang = this.value;
    writeSetting("interface-lang", interfaceLang);
    applyInterfaceLanguage();
    if (!$("shelf").hidden) renderLibrary();
  });

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
      return Promise.reject(new Error("unsupported"));
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
  swReady.catch(function (e) {
    console.error(e);
    toast(t(e.message === "unsupported" ? "unsupported" : "workerError"), 15000);
  });

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
  var coverUrls = new Map();
  var collapsedShelves = new Set();

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

  function buildLibrary(rootName, files, nameKey) {
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
    library = { name: rootName, nameKey: nameKey, episodes: episodes, series: series, byId: {} };
    collapsedShelves.clear();
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
        $("scan-count").textContent = done + " / " + todo.length;
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
        if (err && err.name !== "AbortError") {
          console.warn(err);
          toast(t("pickerError"), 6000);
        }
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
      toast(t("folderError"), 8000);
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
    var root = (list[0].webkitRelativePath || "").split("/")[0];
    showState("loading");
    buildLibrary(root, filesFromInput(list), root ? null : "comics");
    e.target.value = "";
  });
  $("files-input").addEventListener("change", function (e) {
    var list = e.target.files;
    if (!list || !list.length) return;
    showState("loading");
    buildLibrary("Selected files", filesFromInput(list), "selectedFiles");
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
    if (!coverUrls.has(src)) coverUrls.set(src, URL.createObjectURL(src));
    return coverUrls.get(src);
  }

  function addCover(container, ep, eager) {
    var url = coverUrl(ep);
    if (url) {
      var img = el("img");
      img.loading = eager ? "eager" : "lazy";
      img.decoding = "async";
      img.alt = "";
      img.src = url;
      container.appendChild(img);
    } else {
      container.appendChild(el("span", "ep-art-fallback", ep.episode !== null ? pad2(ep.episode) : "?"));
    }
  }

  function renderClassicCatalog(shelf) {
    var playable = library.episodes.filter(function (ep) { return !ep.meta || !ep.meta.error; });
    // The local archives provide no consistent release dates. Use the files' modification times.
    var latest = playable.sort(function (a, b) { return b.file.lastModified - a.file.lastModified; });
    var featured = [];
    var featuredSeries = new Set();
    latest.filter(function (ep) { return ep.cover || (ep.meta && ep.meta.cover); }).forEach(function (ep) {
      var name = ep.series.toLowerCase();
      if (featured.length < 3 && !featuredSeries.has(name)) {
        featuredSeries.add(name);
        featured.push(ep);
      }
    });
    if (featured.length) {
      var hero = el("section", "classic-featured");
      hero.setAttribute("aria-label", t("featured"));
      featured.forEach(function (ep) {
        var tile = el("button", "classic-feature");
        addCover(tile, ep, true);
        var title = el("span", "classic-feature-title", ep.series);
        title.appendChild(el("small", "", episodeTitle(ep)));
        tile.appendChild(title);
        tile.onclick = function () { openEpisode(ep, {}); };
        hero.appendChild(tile);
      });
      shelf.appendChild(hero);
    }

    if (latest.length) {
      var recentRow = el("div", "ep-row");
      latest.slice(0, 6).forEach(function (ep) { recentRow.appendChild(episodeCard(ep, true)); });
      appendClassicShelf(shelf, "recent", recentRow);
    }

    var seriesRow = el("div", "ep-row");
    library.series.forEach(function (group, index) {
      var card = el("button", "ep-card");
      var art = el("div", "ep-art");
      var withCover = group.episodes.find(function (ep) { return ep.cover || (ep.meta && ep.meta.cover); });
      if (withCover) addCover(art, withCover);
      card.appendChild(art);
      var meta = el("div", "ep-meta");
      meta.appendChild(el("span", "ep-title", group.name));
      meta.appendChild(el("span", "ep-sub", countText("episodes", group.episodes.length)));
      card.appendChild(meta);
      card.onclick = function () {
        var heading = $("series-" + index);
        heading.scrollIntoView({ block: "start" });
        heading.focus({ preventScroll: true });
      };
      seriesRow.appendChild(card);
    });
    appendClassicShelf(shelf, "seriesShelf", seriesRow);
  }

  function appendClassicShelf(shelf, key, row) {
    var section = el("section", "classic-shelf");
    var head = el("div", "classic-shelf-head");
    var button = el("button", "classic-toggle");
    row.id = "classic-" + key;
    button.setAttribute("aria-controls", row.id);
    function update() {
      row.hidden = collapsedShelves.has(key);
      button.setAttribute("aria-expanded", String(!row.hidden));
      button.textContent = t(row.hidden ? "expand" : "collapse");
    }
    button.onclick = function () {
      if (row.hidden) collapsedShelves.delete(key);
      else collapsedShelves.add(key);
      update();
    };
    update();
    head.appendChild(el("h2", "", t(key)));
    head.appendChild(button);
    section.appendChild(head);
    section.appendChild(row);
    shelf.appendChild(section);
  }

  function renderLibrary() {
    coverUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    coverUrls.clear();
    var shelf = $("shelf");
    shelf.innerHTML = "";
    var folderName = library.nameKey ? t(library.nameKey) : library.name;
    $("folder-name").textContent = folderName;
    var total = library.episodes.length;
    $("folder-count").textContent = countText("series", library.series.length) + " · " + countText("episodes", total);

    if (!total) {
      shelf.appendChild(el("p", "empty muted", t("empty", { folder: folderName })));
      showState("library");
      return;
    }

    if (theme === "classic") renderClassicCatalog(shelf);
    library.series.forEach(function (group, index) {
      var section = el("section", "series");
      var head = el("div", "series-head");
      var titles = el("div", "series-titles");
      var heading = el("h2", "series-name", group.name);
      heading.id = "series-" + index;
      heading.tabIndex = -1;
      titles.appendChild(heading);
      var finished = group.episodes.filter(function (e) { return (getProgress(e.id) || {}).finished; }).length;
      titles.appendChild(el("div", "muted", countText("episodes", group.episodes.length) + (finished ? " · " + countText("finished", finished) : "")));
      head.appendChild(titles);
      var nxt = nextToRead(group);
      var cont = el("button", "btn primary small", t(nxt.resume ? "resumeEpisode" : (finished ? "continueEpisode" : "startEpisode"), { title: episodeTitle(nxt.ep) }));
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

  function episodeCard(ep, showSeries) {
    var prog = getProgress(ep.id);
    var card = el("button", "ep-card");
    card.title = ep.series + " — " + episodeTitle(ep);
    var art = el("div", "ep-art");
    addCover(art, ep);
    if (prog && prog.count > 1) {
      var line = el("span", "progress-line");
      line.style.width = (prog.finished ? 100 : Math.max(3, Math.round(100 * prog.section / (prog.count - 1)))) + "%";
      art.appendChild(line);
    }
    if (prog && prog.finished) art.appendChild(el("span", "ep-badge", "✓"));
    card.appendChild(art);
    var meta = el("div", "ep-meta");
    if (showSeries) meta.appendChild(el("span", "ep-series", ep.series));
    meta.appendChild(el("span", "ep-title", episodeTitle(ep)));
    var sub = "";
    if (ep.meta && ep.meta.error) sub = t("unreadable");
    else if (prog && prog.section > 0 && !prog.finished && prog.count) sub = t("progress", { page: prog.section, last: prog.count - 1 });
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
    if (ep.meta && ep.meta.error) { toast(t("unreadableError"), 6000); return; }
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
      if (opts.viaScroll) {
        // the new episode's cover card is covering the screen: snap the slid-away stage back behind it
        var stage = $("stage");
        stage.style.transition = "none";
        player.classList.remove("to-next", "to-prev");
        void stage.offsetWidth;
        stage.style.transition = "";
      } else {
        hideNextPeek();
      }
      updateNextHint();
      $("loading").classList.remove("done");
      hideEndCard(true);
      $("error").hidden = true;
      closeSheets(true);
      if (!history.state || !history.state.player) history.pushState({ player: ep.id }, "", "#play/" + encodeURIComponent(ep.id));
      else history.replaceState({ player: ep.id }, "", "#play/" + encodeURIComponent(ep.id));
      document.title = ep.series + " — " + episodeTitle(ep);
      layout();
      frame.src = "comic/" + encodeURIComponent(ep.id) + "/canvas.html?" + (lang ? "lang=" + lang + "&" : "") + "disableCacheKiller=1";
      frame.focus();
    }, function (e) {
      console.error(e);
      toast(t(e.message === "unsupported" ? "unsupported" : "unreadableError"), 10000);
    });
  }

  function closePlayer(fromPopState) {
    if (!S) return;
    hideEndCard(true);
    hideNextPeek();
    frame.src = "about:blank";
    S = null;
    updateNextHint();
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

  // The end panel slides in a fixed time after the last scene starts; the last scene keeps animating behind it.
  var END_PANEL_DELAY = 3000;

  function scheduleEndPanel() {
    cancelEndPanel();
    var session = S;
    S.endTimer = setTimeout(function () {
      if (S !== session) return;
      S.endTimer = null;
      S.ended = true;
      saveProgress(true);
      showEndCard();
    }, END_PANEL_DELAY);
  }

  function cancelEndPanel() {
    if (S && S.endTimer) { clearTimeout(S.endTimer); S.endTimer = null; }
  }

  // The engine says the book is over. Normally the panel is already scheduled from the last scene's start;
  // this is only the fallback for episodes whose scene count is unknown.
  function bookEnded() {
    if (!S) return;
    saveProgress(true);
    if (!S.endTimer && !S.ended) { S.ended = true; showEndCard(); }
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
      win.addEventListener("wheel", onWheel, { passive: true });
      attachSwipeUp(win);
    },
    engineIsReady: function (nav) {
      if (!S) return false;
      S.nav = nav;
      if (S.adapter) S.count = S.adapter.sceneCount() || S.count;
      $("loading").classList.add("done");
      revealAfterScroll();
      updateNextHint();
      var ep = S.ep;
      return {
        sectionNumber: Math.min(S.startSection || 0, Math.max(0, S.count - 1)),
        bookName: ep.series,
        issueName: "",
        issueNumber: ep.episode !== null ? pad2(ep.episode) : "",
        episodeWord: t("episode").toLowerCase()
      };
    },
    engineError: function (msg) {
      $("loading").classList.add("done");
      hideNextPeek();
      var box = $("error");
      console.error("[narr8]", msg);
      box.textContent = t("engineError");
      box.hidden = false;
    },
    setSectionNumber: function (n, count) {
      if (!S) return;
      S.current = n;
      if (count) S.count = count;
      updateNextHint();
      saveProgress(false);
      if (S.count && n === S.count - 1) {
        if (!S.endTimer && !S.ended) scheduleEndPanel();
      } else {
        cancelEndPanel();
        if (S.ended) { S.ended = false; hideEndCard(false); }
      }
    },
    sectionFinished: function (n) {
      if (S && S.count && n >= S.count - 1) bookEnded();
    },
    bookIsEnded: function () { bookEnded(); },
    showNavigation: function () { openContents(); },
    tapToPlay: function () { return t("tapToPlay"); },
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
    updateNextHint();
  }

  function openMenu() {
    if (!S) return;
    closeSheets(true);
    var ep = S.ep;
    $("menu-title").textContent = ep.series;
    $("menu-sub").textContent = episodeTitle(ep) + (S.count ? " · " + t("progress", { page: S.current, last: S.count - 1 }) : "");
    var sel = $("m-lang");
    sel.innerHTML = "";
    (ep.meta.langs.length ? ep.meta.langs : [""]).forEach(function (l) {
      var o = document.createElement("option");
      o.value = l;
      o.textContent = l ? (LANG_NAMES[l] || l.toUpperCase()) : t("defaultLanguage");
      if (l === S.lang) o.selected = true;
      sel.appendChild(o);
    });
    sel.parentNode.hidden = ep.meta.langs.length < 2;
    $("m-fullscreen").textContent = t(document.fullscreenElement ? "exitFullscreen" : "fullscreen");
    $("m-fullscreen").hidden = !(player.requestFullscreen || player.webkitRequestFullscreen);
    pauseEngine();
    $("menu").hidden = false;
    updateNextHint();
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
        var name = meta.scenes && meta.scenes[i] ? meta.scenes[i].name : "";
        if (images[i]) {
          img.src = base + images[i];
          b.appendChild(img);
          b.appendChild(el("span", "", i === 0 ? t("cover") : (name || String(i))));
        } else if (i === count - 1) {
          b.appendChild(el("div", "end-ph", t("end")));
        } else {
          b.appendChild(img);
          b.appendChild(el("span", "", i === 0 ? t("cover") : (name || String(i))));
        }
        b.onclick = function () { jumpTo(i); };
        grid.appendChild(b);
      })(i);
    }
    pauseEngine();
    $("contents").hidden = false;
    updateNextHint();
    var cur = grid.querySelector(".current");
    if (cur) { cur.scrollIntoView({ block: "center" }); cur.focus(); }
  }

  function jumpTo(i) {
    closeSheets(false);
    if (!S || !S.nav || i === S.current) return;
    hideEndCard(false);
    S.nav.jumpToSection(i);
  }

  function nextEpisode(ep) {
    var group = library.series.filter(function (g) { return g.name.toLowerCase() === ep.series.toLowerCase(); })[0];
    if (!group) return null;
    var i = group.episodes.indexOf(ep);
    return i >= 0 && i + 1 < group.episodes.length ? group.episodes[i + 1] : null;
  }

  // Closing lines for the end-of-episode panel; one is picked at random each time an episode ends.
  var END_LINES = [
    "Every story needs a pause. This one is only catching its breath.",
    "The last page turns, but the characters keep living somewhere between the frames.",
    "Stories don't end. They wait for someone to come back to them.",
    "Somewhere, a pencil is already sketching what happens next.",
    "You made it to the final frame. The characters will remember that.",
    "Take a breath. The next chapter is patient.",
    "Ten years in an archive, and this episode still found its reader.",
    "Some stories are over when the credits roll. The good ones stay in your head a little longer.",
    "The panels are quiet now, but the story is still turning in someone's head.",
    "Every ending is just a cliffhanger that hasn't been drawn yet.",
    "Thank you for reading. Somewhere, the artists who drew this would be glad.",
    "The frame freezes here. Your imagination doesn't have to.",
    "That's a wrap for now. Grab a snack, then see what happens next.",
    "Motion comics were a small miracle of their time, and this one just played again.",
    "The music fades, the balloons empty, and the story waits for its next reader.",
    "You reached the end. Not everyone who started this episode did.",
    "Heroes rest, villains plot, and the next episode is one tap away.",
    "Every frame here was drawn by hand, a long time ago, for someone exactly like you.",
    "End of the line for this episode. The tracks keep going.",
    "Some stories deserve a second read. This might be one of them.",
    // restoration lines
    "The servers went dark years ago. The story didn't.",
    "This episode waited a decade on a hard drive for exactly this moment.",
    "The app is gone, the company is gone, and the comic is still here. Stories are stubborn like that.",
    "Somewhere in a zip file, these frames kept their balloons folded, waiting to be read again.",
    "Once it played on an iPad in 2013. Tonight it played for you.",
    "The last official reader closed this episode years ago. You just opened it again.",
    "No store, no login, no servers — just a folder, a browser, and a story that refused to disappear.",
    "An archive is a promise that someone will come back. You kept it.",
    "Its original engine never knew it would be running a decade later. It held up.",
    "The code that played this was written in another era. It still remembered every pause and every loop.",
    "Somewhere on archive.org, a backup quietly made this moment possible.",
    "Lost software is only lost until someone decides to look for it.",
    "A decade of silence, and not a single frame out of place.",
    // nostalgia
    "Remember waiting for the next episode to download on hotel Wi-Fi? It was worth it then, too.",
    "Back when tablets were new and every tap felt like magic, this is what they were for.",
    "This episode first arrived as a notification. Somebody dropped everything to read it.",
    "The iPad 2 ran this at full speed. Somewhere, one is still charging in a drawer.",
    "There was a time when a new episode meant a new Friday evening plan.",
    "Comics used to be paper, then pixels, then this — paper that learned to move.",
    "Screens were smaller, batteries died faster, and stories like this one made the commute disappear.",
    "The reader who first opened this probably holds a very different phone now.",
    "Some evenings were spent refreshing a shelf, waiting for exactly this cover to appear.",
    "2013 had fewer apps and more wonder. This episode remembers.",
    "Somewhere, someone read this under a blanket, screen brightness all the way down.",
    "Before binge-watching, there was tapping through a whole season in one night.",
    "The soundtrack you just heard once played through tiny tablet speakers on a thousand couches.",
    "A new episode was an event: the cover appeared, the download bar crawled, the evening was planned.",
    "Old devices, old stores, old logins — all gone. The feeling of turning the page is still here.",
    "Some readers of this episode are grown up now. Some of them are probably still reading.",
    "It used to live in an app with a red icon. Now it lives wherever you are.",
    "The pixels are the same ones people saw years ago. Only the screen got better.",
    "Remember when motion comics felt like the future? For a few minutes, they were again.",
    "Once upon a time, this was the newest episode in the store.",
    // bittersweet
    "The series never got its final episode. This one still deserves an ending, so here it is.",
    "The studio closed its doors, but it left the lights on in these frames.",
    "Some of these stories stopped mid-sentence when the company did. They still sound good out loud.",
    "The people who drew this moved on long ago. Their work stayed behind to say hello.",
    "It's strange how a story can outlive the place that made it.",
    "The last update never came. This episode kept its promise anyway.",
    "Somebody stayed late to animate this scene. They never knew you would be the one to see it.",
    "The store is closed, the shelf is empty, and this episode is still here, a little defiant.",
    "Not every story gets a proper goodbye. Consider this one.",
    "The characters don't know their world was switched off for a decade. Don't tell them.",
    "Every ending is a little sad. This one had to wait years to happen.",
    "The people who made this are scattered across the world now. For a few minutes, their work was together again.",
    "It was supposed to be a Tuesday episode among hundreds. It became one of the last ones left.",
    "Somewhere, a half-finished next episode lives only in somebody's memory.",
    "The applause never came for this one. Take a moment and clap anyway.",
    "Nothing lasts forever, but some things last longer than anyone expected.",
    "It's a small thing, a story coming back. It still feels like a big one.",
    "This was made by people who believed motion comics were the future. For them, it was.",
    "The credits roll to an empty theatre, and then someone like you walks in.",
    "Endings are easier when you know the story can be read again.",
    // longing
    "Some places only exist inside a story. You can visit again whenever you like.",
    "You'll miss these characters a little. That's how you know it was a good one.",
    "There's a quiet after the last frame. Stay in it for a moment.",
    "Somewhere, in a different timeline, the next episode is already out.",
    "You can close the tab, but part of you will still be standing in that last scene.",
    "It's hard to leave a world you only just got to know again.",
    "Some stories feel like a place you lived once. This is one of those places.",
    "The music is gone, but you can probably still hear it.",
    "You'll think about this ending on some random evening. That's what stories are for.",
    "What happens next? Only the frames know, and they're not telling.",
    "It's okay to want one more episode. Everyone always did.",
    "Leaving always feels too soon, even when the story has ended.",
    "The characters wave goodbye from the last frame. They would like you to come back.",
    "Some goodbyes are really just see-you-laters with nicer music.",
    "You know the ending now. You'll still want to see it again.",
    "There will always be one more scene you wish existed.",
    "Close your eyes and the last frame is still there. It will be for a while.",
    "The shelf is quiet, but the stories on it are waiting, patiently, for tonight.",
    "Some worlds are too good to leave just once.",
    "Until next time. It might be a while. The story will be right here.",
    // corporate
    "This episode was free of charge. Somewhere, a monetization team just felt a disturbance.",
    "No gems, no energy bar, no \u201cwait 24 hours or pay 99\u00a2\u201d \u2014 just the next page.",
    "Nobody asked you to buy 500 coins to see this ending. Enjoy the novelty.",
    "The story survived. The quarterly targets did not.",
    "This ending contains no loot boxes. We checked twice.",
    "Art outlives business plans. This episode is the proof.",
    "Once, this episode had a price tag. Now it just has readers.",
    "No subscription, no auto-renewal at 3 a.m., no \u201crestore purchases\u201d button that never works.",
    "Somewhere, a spreadsheet decided this series wasn't profitable enough. The spreadsheet was wrong.",
    "This comic was never \u201coptimised for engagement\u201d. It just wanted to be read.",
    "The money moved through a lot of accounts. The story only needed one reader.",
    "Somewhere, a very creative accountant is still explaining where the budget went. The comic is right here.",
    "Offshore accounts can hide a lot of things. They couldn't hide this comic.",
    "Acquired, merged, rebranded, shut down \u2014 the usual story. This one ended better.",
    "No bonus browser, no surprise toolbar, no default search engine quietly changed. Just a comic.",
    "No premium tier, no ad break, no \u201crate us five stars\u201d. Just a story that outlived its owners.",
    "The servers were shut down to cut costs. It turns out stories are cheap to keep.",
    "This episode once needed an account, a login and a payment method. Now it needs a folder.",
    "Executives come and go with their bonuses. The artists' work is still on screen.",
    "Nobody here will ask for your phone number to unlock the next chapter.",
    // the NARR8 series
    "Buster saved his girlfriend from the monsters of Flatland again. In JAM, that's just called Tuesday.",
    "Somewhere in the Free Light, the monsters are already planning next week's kidnapping. In JAM, it's tradition.",
    "In JAM, even the end credits look like they could use a power-up.",
    "Max spent ten years in a coma before Prodigal Angel began. You only had to wait a few seconds for this ending.",
    "If Max from Prodigal Angel were here, he'd already be borrowing someone else's body to read the next episode.",
    "Eight strangers broke out of the EXA labs in Subject 9. You broke out of this episode. Well done.",
    "Subject 9 taught us one thing: never trust a secret laboratory with a friendly logo.",
    "Dr. Powell's Fear Hunters fought monsters inside people's minds. This ending might linger in yours.",
    "The Fear Hunters would call this feeling post-episode withdrawal. Treatable with another episode.",
    "Somewhere in New York, the Great Houses of The Secret City are still feuding. Some rivalries outlive their publishers.",
    "Witches, vampires, dark knights and fairies share one hidden city in The Secret City. They'd get along with you.",
    "The heroes of Final Feat came back to save a dying world. This episode came back too.",
    "In Final Feat, the last heroes rose one more time. So did these frames.",
    "Kate stole a starship to prove herself in Knights of the Void. You only had to press the right arrow.",
    "Somewhere in the void, Kate and Jack are still arguing about who crashed the ship.",
    "The Knights of the Void fought a tyrannical Empire. Their comics fought something worse: a server shutdown.",
    "Jane was just a med student in Chicago until Prime Blood happened. Your evening was just an evening until this.",
    "Werewolves and vampires are still at war somewhere in Prime Blood. Nobody told them the app closed.",
    "Mark Stone learned in Multiverse that parallel worlds are real. In one of them, the NARR8 app is still online.",
    "The agents of Alpha II would classify this timeline as stable. The comic survived, and that counts.",
    "Steve from Spin could fix corporate wars, elections and dog shows. Even he couldn't fix a shutdown.",
    "In Spin, Steve always worked backstage. Tonight, the backstage crew was an archive.",
    "Sabrina Sharp had one year to build a business that made people happy. This episode waited a decade for you.",
    "The Agency matched lonely hearts. This player just matched a lost comic with a new reader.",
    "In Qumi-Qumi, the wizards, the scientists and the military finally agree on something: that was a good episode.",
    "Juga and Shumadan are still competing for Yusi's attention in Qumi-Qumi. Some things never change.",
    "Two mysterious newcomers once arrived in PandaBoom's Mysterious Forest. Welcome, you're the third.",
    "The talking animals of PandaBoom would say it's bedtime now. They're probably right.",
    "Paradigm explained complex things with a single tap. Here's one more: stories last longer than servers.",
    "Micro packed the world into bite-sized facts. Here's another: you just watched a comic nobody could open for ten years.",
    "Biographics said everyone needs an \u201cand\u201d: Darwin and evolution, Freud and psychoanalysis. This episode and you.",
    "Eureka! told the life stories of inventions. The motion comic deserves a chapter too.",
    "Alma Mater turned tablets into telescopes and microscopes. Tonight your screen turned into a time machine.",
    "FIVE ranked the greatest wonders of the world. Tonight's number one: this still works.",
    "A hippie and a metalhead in rival kung fu monasteries: Skunk & Ocelot would have wrecked this ending by now.",
    "P.J. Bloodwaters and San Taurus would celebrate this ending with a small global catastrophe. You can just close the tab.",
    "Fear Hunters, Final Feat, Knights of the Void, JAM \u2014 they once shared one shelf. Tonight they share a folder.",
    "Twenty series, hundreds of episodes, one red icon. This was one of them.",
    "Somewhere on this old shelf, The Secret City, Subject 9 and PandaBoom are waiting their turn.",
    "From pandas to psychiatrists, witches to starship pilots, there used to be a story here for every evening.",
    // JAM, Subject 9 and Prodigal Angel
    "Bubble spent half of JAM trapped inside a jammer. This episode spent a decade trapped inside a zip file. Both got out.",
    "Python would try to steal this ending and sell it to the jam hunters. Luckily, it's already saved.",
    "Minnie's guitar could hypnotise an entire town square. The soundtrack you just heard came close.",
    "The first rule of a jam hunter: always carry extra lives. The second: come back for the next episode.",
    "Detective Morrigan still has one question left: who shot the sheriff? You'll have to keep reading to find out.",
    "Game over? In JAM, there's always a continue screen somewhere.",
    "The Free Light has robot bikers, sky pirates and goblins with magic boxes. Your evening was quieter. Probably.",
    "Rick only meant to steal something small. He ended up with a whole team. Stories are like that.",
    "Mantek taught them to control their powers. He'd tell you to rest before the next episode.",
    "The Forbidden Zone was too dangerous even for hardened robbers. The escapees of Subject 9 called it home.",
    "The EXA soldiers are still searching Middletown. They won't find this episode; it's safe in your folder.",
    "Shado never says much. After an ending like this, maybe we shouldn't either.",
    "Operation Grand Slam went exactly to plan, right until it didn't. This episode did better.",
    "The escape from EXA took thirty-two episodes. Leaving this one takes a single tap.",
    "Max woke from ten years in a coma and learned to jump between bodies. Now he can jump into the next episode.",
    "Martha asked Max for just one small favour. That was a lot of trouble ago.",
    "Dave, the godfather of Middletown, doesn't like surprise endings. Better not tell him about this one.",
    "The Sphinx corporation would pay a fortune for Max's gift. Luckily, this episode costs nothing.",
    "Even a mafia boss stops for Christmas dinner. Dave did once. You can take a break now too.",
    "Ray was an actor with nothing but debts. He'd have loved an audience like you.",
    "Somewhere out there is a free New Year special from the winter of 2012(3?), when the app had just launched. Nobody seems to have kept a copy. If it's still sitting on an old tablet, it deserves a folder like this one.",
    // Mail.ru satire
    "If Mail.ru made a game about money laundering, the washing machine would come with a quarterly report and the spin cycle would require a subscription.",
    "In an imaginary Mail.ru heist comic, the villains try to launder the loot. The auditor asks why the receipts say «delicate cycle».",
    "If Mail.ru handled censorship in this comic, the speech balloons would survive. Most of the words would need to apply for reinstatement.",
    "In the imaginary Mail.ru director’s cut, every dissenting character is played by the same black rectangle.",
    "At a fictional Mail.ru meeting, the small project got ten minutes on the agenda. Nine were for deciding what to call its closure.",
    "If Mail.ru were a comic-book villain, its special move would shut down a tiny studio and a flagship service with the same slide deck.",
    "In an imaginary Mail.ru management sim, small projects are too small to save and big projects are too big to keep. The only safe asset is the deck explaining both decisions.",
    "If a Mail.ru boardroom rewrote this ending, the hero would be sunsetted and the villain would get a bonus for reducing the cast.",
    "In a Mail.ru-themed escape room, every exit leads to an account registration form. The emergency exit leads to password recovery.",
    "If this ZIP were pitching to Mail.ru, it would get one question: how do we make «open the comic» a paid feature?",
  ];
  var END_LINES_RU = [
    "Каждой истории нужна пауза. Эта просто переводит дыхание.",
    "Последняя страница перевёрнута, а герои всё ещё живут где-то между кадрами.",
    "Истории не заканчиваются. Они ждут, когда к ним кто-нибудь вернётся.",
    "Где-то карандаш уже рисует то, что будет дальше.",
    "Ты добрался до последнего кадра. Герои это запомнят.",
    "Переведи дыхание. Следующая глава подождёт.",
    "Этот эпизод пролежал в архиве десять лет и всё-таки нашёл своего читателя.",
    "Некоторые истории заканчиваются с титрами. Хорошие задерживаются в голове чуть дольше.",
    "Кадры затихли, а у кого-то в голове история всё ещё продолжается.",
    "Любой финал обрывается на самом интересном. Просто продолжение ещё не нарисовали.",
    "Спасибо за чтение. Художники, которые это нарисовали, были бы рады.",
    "Кадр замер. Воображение может двигаться дальше.",
    "На сегодня всё. Перекуси, а потом узнаешь, что было дальше.",
    "Анимированные комиксы были маленьким чудом своего времени. И вот один из них снова ожил.",
    "Музыка стихла, облачка опустели, и история ждёт следующего читателя.",
    "Ты дошёл до конца. Удалось это не всем, кто начинал.",
    "Герои отдыхают, злодеи строят планы, а до следующего эпизода одно касание.",
    "Давным-давно каждый кадр здесь нарисовали от руки для такого читателя, как ты.",
    "Для этого эпизода станция конечная. Рельсы идут дальше.",
    "Некоторые истории хочется перечитать. Возможно, это одна из них.",
    // restoration lines
    "Серверы погасли много лет назад. История пережила их.",
    "Этот эпизод ждал на жёстком диске десять лет именно этого момента.",
    "Приложение исчезло, компании больше нет, а комикс всё ещё здесь. Упрямая штука, история.",
    "Где-то в ZIP-архиве эти кадры хранили свои реплики, пока их не открыли снова.",
    "В 2013-м этот эпизод запускали на iPad. Сегодня он запустился для тебя.",
    "Последний читатель закрыл этот эпизод в официальном приложении много лет назад. И вот ты снова его открыл.",
    "Без магазина, логина и серверов. Просто папка, браузер и история, которая отказалась исчезать.",
    "Архив — это обещание, что кто-нибудь вернётся. Ты его сдержал.",
    "Движок и представить не мог, что ему придётся работать десять лет спустя. Справился.",
    "Этот код написали в другую эпоху. Он всё ещё помнит каждую паузу и каждый повтор.",
    "Где-то на archive.org лежала копия, благодаря которой ты сейчас это читаешь.",
    "Потерянная программа остаётся потерянной, пока кто-нибудь не решит её поискать.",
    "Десять лет тишины, и ни один кадр не сдвинулся с места.",
    // nostalgia
    "Помнишь, как ждали, пока очередной эпизод скачается по гостиничному Wi-Fi? Даже тогда оно того стоило.",
    "Когда планшеты были новинкой и каждое касание казалось волшебством, вот ради чего их покупали.",
    "Впервые этот эпизод пришёл уведомлением. Кто-то бросил все дела и открыл его.",
    "iPad 2 тянул этот эпизод без тормозов. Где-то в ящике до сих пор заряжается один такой.",
    "Было время, когда выход эпизода решал, чем заняться в пятницу вечером.",
    "Сначала комиксы были бумажными, потом цифровыми. А потом бумага научилась двигаться.",
    "Экраны были меньше, батареи садились быстрее, а с такими историями дорога пролетала незаметно.",
    "У первого читателя этого эпизода сейчас, наверное, совсем другой телефон.",
    "Бывало, весь вечер обновляли каталог в ожидании именно этой обложки.",
    "В 2013-м приложений было меньше, а удивлялись чаще. Этот эпизод помнит.",
    "Кто-то читал это под одеялом, выкрутив яркость до минимума.",
    "До сериалов залпом был целый сезон, пролистанный за одну ночь.",
    "Этот саундтрек когда-то звучал из крошечных динамиков планшетов на тысяче диванов.",
    "Новый эпизод был событием. Появлялась обложка, ползла полоска загрузки, и планы на вечер были ясны.",
    "Старые устройства, магазины и логины исчезли. Ощущение от перевёрнутой страницы осталось.",
    "Некоторые читатели этого эпизода уже выросли. Кто-то из них наверняка читает до сих пор.",
    "Эпизод жил в приложении с красной иконкой. Теперь он живёт там, где ты.",
    "Люди видели те же пиксели много лет назад. Экран с тех пор стал лучше.",
    "Помнишь, как анимированные комиксы казались будущим? На несколько минут будущее вернулось.",
    "Когда-то этот эпизод был самой свежей новинкой в магазине.",
    // bittersweet
    "У сериала так и не вышел финальный эпизод. Пусть хотя бы у этого будет финал.",
    "Студия закрыла двери, а свет в этих кадрах оставила включённым.",
    "Некоторые истории оборвались на полуслове вместе со студией. Вслух они всё ещё звучат хорошо.",
    "Художники давно занялись другими делами. Их работа осталась и передаёт привет.",
    "Странно, как история может пережить место, где её придумали.",
    "Последнее обновление так и не вышло. Этот эпизод всё равно сдержал обещание.",
    "Кто-то засиделся допоздна, чтобы оживить эту сцену. Откуда ему было знать, что её увидишь ты?",
    "Магазин закрыт, полки пусты, а этот эпизод упрямо остаётся на месте.",
    "У некоторых историй не было возможности попрощаться. Считай, что эта только что попрощалась.",
    "Герои не знают, что их мир выключили на десять лет. Не говори им.",
    "В любом финале есть немного грусти. Этому пришлось ждать своей очереди годами.",
    "Создатели давно разъехались по всему миру. На несколько минут их работа снова собрала их вместе.",
    "Это должен был быть рядовой эпизод, один из сотен, вышедший во вторник. А стал одним из последних уцелевших.",
    "Где-то недоделанный следующий эпизод остался только в чьей-то памяти.",
    "Здесь так и не прозвучали аплодисменты. Можно похлопать и сейчас.",
    "Всё когда-нибудь кончается. Но кое-что держится дольше, чем кто-либо ожидал.",
    "Подумаешь, вернулась одна история. А ощущение, будто случилось что-то большое.",
    "Эти люди верили, что будущее за анимированными комиксами. Для них так и было.",
    "Титры идут в пустом зале. И тут в зал заходишь ты.",
    "Прощаться легче, когда знаешь, что историю можно перечитать.",
    // longing
    "Есть места, которые существуют только внутри истории. Туда можно вернуться в любое время.",
    "Тебе будет немного не хватать этих героев. Так и узнаёшь, что история удалась.",
    "После последнего кадра наступает тишина. Побудь в ней немного.",
    "Где-то в другой версии будущего следующий эпизод уже вышел.",
    "Можно закрыть вкладку, но какая-то часть тебя ещё постоит в последней сцене.",
    "Трудно уходить из мира, с которым только что заново познакомился.",
    "В некоторые истории возвращаешься, как в город, где когда-то жил. Эта из таких.",
    "Музыка стихла, а ты, наверное, всё ещё её слышишь.",
    "Как-нибудь вечером ты вдруг вспомнишь этот финал. Для этого истории и нужны.",
    "Что дальше? Кадры знают, но не выдают секрет.",
    "Хотеть ещё один эпизод нормально. Его всегда хотели все.",
    "Уходить всегда рано, даже если история уже закончилась.",
    "Герои машут из последнего кадра. Им хочется, чтобы ты вернулся.",
    "Иногда «прощай» — это «до встречи», только музыка красивее.",
    "Теперь ты знаешь финал. Всё равно захочется увидеть его снова.",
    "Всегда найдётся ещё одна сцена, которую хотелось бы увидеть.",
    "Закрой глаза. Последний кадр всё ещё там и побудет там какое-то время.",
    "На полке тихо. Истории на ней терпеливо ждут сегодняшнего вечера.",
    "Из некоторых миров хочется уходить и возвращаться снова.",
    "До встречи. Сколько бы времени ни прошло, история будет здесь.",
    // corporate
    "Этот эпизод был бесплатным. Где-то отдел монетизации почувствовал неладное.",
    "Ни кристаллов, ни шкалы энергии, ни «подождите 24 часа или заплатите 99 центов». Просто следующая страница.",
    "Чтобы увидеть финал, покупать 500 монет не пришлось. Насладись редким случаем.",
    "История выжила. Квартальные показатели — нет.",
    "В этом финале нет лутбоксов. Мы дважды проверили.",
    "Искусство переживает бизнес-планы. Вот тебе доказательство.",
    "Когда-то у этого эпизода был ценник. Теперь у него просто есть читатели.",
    "Ни подписки, ни автопродления в три ночи, ни вечной кнопки «Восстановить покупки», которая не работает.",
    "Где-то таблица решила, что сериал не окупится. Таблица ошиблась.",
    "Этот комикс никогда не оптимизировали «под вовлечённость». Он просто хотел, чтобы его прочитали.",
    "Деньги прошли через много счетов. Истории хватило одного читателя.",
    "Где-то очень творческий бухгалтер до сих пор объясняет, куда делся бюджет. Комикс вот он.",
    "На офшорных счетах можно многое спрятать. Этот комикс спрятать не удалось.",
    "Купили, слили, переименовали, закрыли. Обычное дело. У этой истории конец получше.",
    "Никакого браузера в подарок, панели-сюрприза и тихой подмены поисковика. Просто комикс.",
    "Никаких премиум-тарифов, рекламных пауз и просьб поставить пять звёзд. Просто история, пережившая своих владельцев.",
    "Серверы отключили ради экономии. Оказалось, хранить истории дёшево.",
    "Когда-то для этого эпизода нужны были аккаунт, логин и способ оплаты. Теперь хватит папки.",
    "Руководители приходят и уходят вместе со своими бонусами. Работа художников всё ещё на экране.",
    "Здесь никто не попросит номер телефона, чтобы открыть следующую главу.",
    // the NARR8 series
    "Бастер снова спас подругу от монстров Флэтленда. В JAM это обычный вторник.",
    "Где-то в Свободном Свете монстры уже планируют похищение на следующую неделю. В JAM это традиция.",
    "В JAM даже финальным титрам не помешал бы бонус к силе.",
    "До начала «Блудного ангела» Макс десять лет пролежал в коме. Тебе этот финал пришлось ждать всего несколько секунд.",
    "Будь здесь Макс из «Блудного ангела», он уже одолжил бы чужое тело, чтобы прочитать следующий эпизод.",
    "В «Образце №9» восемь незнакомцев сбежали из лабораторий EXA. Ты выбрался из этого эпизода. Поздравляем.",
    "«Образец №9» учит одному: секретным лабораториям с дружелюбным логотипом доверять нельзя.",
    "Охотники доктора Пауэлла сражались с монстрами в чужих головах. Этот финал может задержаться в твоей.",
    "Охотники назвали бы это синдромом отмены эпизода. Лечится следующим эпизодом.",
    "Где-то в Нью-Йорке Великие дома «Тайного города» всё ещё враждуют. Некоторые распри переживают издателей.",
    "В «Тайном городе» ведьмы, вампиры, тёмные рыцари и феи уживаются в одном скрытом городе. С тобой бы они тоже поладили.",
    "Герои «Последнего подвига» вернулись, чтобы спасти умирающий мир. Этот эпизод тоже вернулся.",
    "В «Последнем подвиге» последние герои восстали ещё раз. И эти кадры тоже.",
    "В «Рыцарях Пустоты» Кейт угнала звездолёт, чтобы доказать, чего стоит. Тебе хватило стрелки вправо.",
    "Где-то в пустоте Кейт и Джек всё ещё спорят, кто разбил корабль.",
    "Рыцари Пустоты сражались с Империей тиранов. Их комикс столкнулся с противником пострашнее: отключением сервера.",
    "До событий Prime Blood Джейн была обычной студенткой-медиком в Чикаго. И твой вечер до этого тоже был обычным.",
    "Где-то в Prime Blood оборотни и вампиры всё ещё воюют. Им никто не сказал, что приложение закрыли.",
    "В «Мультиверсе» Марк Стоун узнал, что параллельные миры существуют. В одном из них NARR8 всё ещё онлайн.",
    "Агенты «Альфы II» назвали бы эту ветку событий стабильной. Комикс выжил, и это главное.",
    "Стив из Spin умел разруливать корпоративные войны, выборы и выставки собак. С отключением даже он бы не справился.",
    "В Spin Стив всегда работал за кулисами. Сегодня за кулисами работал архив.",
    "У Сабрины Шарп был год, чтобы построить бизнес, который делал бы людей счастливыми. Этот эпизод ждал тебя десять лет.",
    "«Агентство» сводило одинокие сердца. Этот плеер только что свёл потерянный комикс с новым читателем.",
    "В «Куми-Куми» волшебники, учёные и военные наконец сошлись в одном: эпизод удался.",
    "Джуга и Шумадан в «Куми-Куми» всё ещё соперничают за внимание Юси. Некоторые вещи не меняются.",
    "Однажды в загадочный лес «ПандаБум» пришли двое таинственных незнакомцев. Добро пожаловать, ты третий.",
    "Говорящие звери из «ПандаБум» сказали бы, что пора спать. Наверное, они правы.",
    "«Парадигма» объясняла сложные вещи в одно касание. Вот ещё одна: истории живут дольше серверов.",
    "Micro раскладывал мир на короткие факты. Вот ещё один: ты только что прочитал комикс, который десять лет никто не мог открыть.",
    "«Биографика» говорила, что каждому нужен союз «и»: Дарвин и эволюция, Фрейд и психоанализ. Этот эпизод и ты.",
    "«Эврика!» рассказывала о судьбах изобретений. Анимированный комикс тоже заслуживает главу.",
    "Alma Mater превращал планшеты в телескопы и микроскопы. Сегодня твой экран стал машиной времени.",
    "FIVE составлял рейтинги чудес света. Сегодня на первом месте то, что это всё ещё работает.",
    "Хиппи и металлист из враждующих монастырей кунг-фу. Скунс и Оцелот к этому моменту уже разнесли бы весь финал.",
    "Пи Джей Бладвотерс и Сан Таурус отметили бы этот финал небольшой глобальной катастрофой. Ты можешь просто закрыть вкладку.",
    "Охотники за страхом, «Последний подвиг», «Рыцари Пустоты» и JAM когда-то делили одну полку. Сегодня они делят папку.",
    "Двадцать сериалов, сотни эпизодов, одна красная иконка. Это был один из них.",
    "Где-то на этой старой полке «Тайный город», «Образец №9» и «ПандаБум» ждут своей очереди.",
    "Панды и психиатры, ведьмы и пилоты звездолётов. Когда-то здесь была история на любой вечер.",
    // JAM, Subject 9 and Prodigal Angel
    "Баббл провела половину JAM в ловушке внутри джаммера. Этот эпизод провёл десять лет в ZIP-архиве. Оба выбрались.",
    "Питон попытался бы украсть финал и продать его охотникам за джемом. Хорошо, что он уже сохранён.",
    "Гитара Минни могла загипнотизировать целую площадь. Саундтрек, который ты только что слышал, был близок к этому.",
    "Первое правило охотника за джемом: всегда носи с собой запасные жизни. Второе: возвращайся за следующим эпизодом.",
    "У детектива Морриган остался один вопрос: кто стрелял в шерифа? Придётся читать дальше.",
    "Игра окончена? В JAM всегда где-то есть кнопка «Продолжить».",
    "В Свободном Свете есть роботы-байкеры, воздушные пираты и гоблины с волшебными коробками. Твой вечер был спокойнее. Наверное.",
    "Рик хотел украсть какую-нибудь мелочь. В итоге обзавёлся целой командой. С историями так бывает.",
    "Мантек учил их управлять своими силами. Он бы посоветовал тебе передохнуть перед следующим эпизодом.",
    "Запретная зона пугала даже матёрых грабителей. Беглецы из «Образца №9» называли её домом.",
    "Солдаты EXA всё ещё прочёсывают Мидлтаун. Эпизод они не найдут: он у тебя в папке.",
    "Шадо обычно немногословен. После такого финала и нам, пожалуй, лучше помолчать.",
    "Операция «Большой шлем» шла по плану до тех пор, пока не перестала. У этого эпизода вышло лучше.",
    "Побег из EXA занял тридцать два эпизода. Из этого можно выйти одним касанием.",
    "Макс очнулся после десяти лет комы и научился перескакивать из тела в тело. Теперь может перескочить в следующий эпизод.",
    "Марта попросила Макса об одной маленькой услуге. С тех пор случилась уйма неприятностей.",
    "Дэйв, крёстный отец Мидлтауна, не любит неожиданных финалов. Об этом ему лучше не рассказывать.",
    "Корпорация «Сфинкс» заплатила бы целое состояние за дар Макса. К счастью, эпизод бесплатный.",
    "Даже мафиозный босс делает перерыв на рождественский ужин. Дэйв однажды так и сделал. Теперь и ты можешь отдохнуть.",
    "Рэй был актёром, у которого ничего не было, кроме долгов. Он был бы рад такому зрителю.",
    "Где-то есть бесплатный новогодний спецвыпуск зимы 2012-го (или 2013-го?), когда приложение только запустилось. Похоже, копию никто не сохранил. Если он ещё лежит на старом планшете, то заслуживает такой же папки.",
    // Mail.ru
    "Если бы Mail.ru выпустила игру про отмывание денег, к стиральной машине прилагался бы квартальный отчёт, а отжим был бы по подписке.",
    "В вымышленном комиксе про ограбление от Mail.ru злодеи пытаются отмыть добычу. Аудитор спрашивает, почему в чеках написано «деликатная стирка».",
    "Если бы Mail.ru отвечала за цензуру в этом комиксе, облачка с репликами уцелели бы. Большинству слов пришлось бы подать апелляцию.",
    "В воображаемой режиссёрской версии от Mail.ru всех несогласных персонажей играет один и тот же чёрный прямоугольник.",
    "На вымышленной планёрке Mail.ru маленькому проекту отвели десять минут. Девять ушло на выбор названия для его закрытия.",
    "Если бы Mail.ru была злодеем из комикса, её суперприёмом было бы закрыть маленькую студию и флагманский сервис одной презентацией.",
    "В воображаемом симуляторе Mail.ru мелкие проекты слишком малы, чтобы их спасать, а крупные слишком велики, чтобы их содержать. В безопасности только презентация, объясняющая оба решения.",
    "Если бы финал переписывали в совете директоров Mail.ru, героя вывели бы из эксплуатации, а злодею дали бы премию за сокращение числа персонажей.",
    "В квест-комнате по мотивам Mail.ru за каждым выходом ждёт форма регистрации. За аварийным — восстановление пароля.",
    "Если бы этот ZIP пришёл на питч в Mail.ru, ему задали бы один вопрос: как сделать кнопку «Открыть комикс» платной?",
  ];
  var lastLine = -1, typeTimer = null, endHideTimer = null;

  function typeLine(text) {
    var box = $("end-quote"), quote = box.parentNode, i = 0;
    clearInterval(typeTimer);
    box.textContent = "";
    quote.classList.remove("typed");
    setTimeout(function () {
      typeTimer = setInterval(function () {
        box.textContent = text.slice(0, ++i);
        if (i >= text.length) { clearInterval(typeTimer); quote.classList.add("typed"); }
      }, 22);
    }, 650);                                   // start once the panel has slid in
  }

  function showEndCard() {
    if (!S) return;
    var next = nextEpisode(S.ep);
    var btn = $("e-next");
    btn.hidden = !next;
    if (next) btn.textContent = t("next", { title: episodeTitle(next) }) + " ›";
    btn.onclick = next ? function () { openEpisode(next, { section: 0 }); } : null;
    $("end-series").textContent = S.ep.series;
    $("end-number").textContent = S.ep.episode !== null ? pad2(S.ep.episode) : "";
    var lines = interfaceLang === "ru" ? END_LINES_RU : END_LINES;
    var n;
    do { n = Math.floor(Math.random() * lines.length); } while (n === lastLine && lines.length > 1);
    lastLine = n;
    clearTimeout(endHideTimer);
    var panel = $("endcard");
    panel.hidden = false;
    void panel.offsetWidth;                    // start the slide-in from the off-screen position
    player.classList.add("ended");
    typeLine(lines[n]);
    setTimeout(function () { if (!panel.hidden) (next ? btn : $("e-replay")).focus({ preventScroll: true }); }, 700);
  }

  function hideEndCard(immediate) {
    var panel = $("endcard");
    clearInterval(typeTimer);
    clearTimeout(endHideTimer);
    player.classList.remove("ended");
    if (immediate) { panel.hidden = true; return; }
    endHideTimer = setTimeout(function () { panel.hidden = true; }, 800);
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
      if (menuOpen) closeSheets(false);
      else if (!$("endcard").hidden && player.classList.contains("ended")) hideEndCard(false);
      else openMenu();
      e.preventDefault();
    } else if ((e.key.toLowerCase() === "f" || e.code === "KeyF") && !e.metaKey && !e.ctrlKey) {
      toggleFullscreen();
    } else if ((e.key.toLowerCase() === "c" || e.code === "KeyC") && !menuOpen && !e.metaKey && !e.ctrlKey) {
      openContents();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !menuOpen) {
      if (scrollToEpisode(e.key === "ArrowDown" ? 1 : -1)) e.preventDefault();
    }
  }

  // ------------------------------------------------------------------ cover -> next / previous episode
  // On an episode's first scene, scrolling down (wheel, ↓, swipe up) glides to the next episode and scrolling up
  // (wheel, ↑, swipe down) to the previous one: the current episode slides away while the other one's cover
  // slides in and covers the screen until that episode is ready.

  var peekUrl = null;

  function prevEpisode(ep) {
    var group = library.series.filter(function (g) { return g.name.toLowerCase() === ep.series.toLowerCase(); })[0];
    if (!group) return null;
    var i = group.episodes.indexOf(ep);
    return i > 0 ? group.episodes[i - 1] : null;
  }

  function scrollTarget(dir) {
    if (!S || !S.nav || S.switching || S.current !== 0) return null;
    if (!$("menu").hidden || !$("contents").hidden) return null;
    return dir < 0 ? prevEpisode(S.ep) : nextEpisode(S.ep);
  }

  function updateNextHint() {
    var hint = $("next-hint"), next = scrollTarget(1);
    if (next) {
      $("next-hint-text").textContent = t("next", { title: episodeTitle(next) });
      if (hint.hidden) {
        hint.hidden = false;
        requestAnimationFrame(function () { hint.classList.add("show"); });
      }
    } else {
      hint.classList.remove("show");
      hint.hidden = true;
    }
  }

  function scrollToEpisode(dir) {
    var next = scrollTarget(dir);
    if (!next) return false;
    S.switching = true;
    updateNextHint();
    pauseEngine();
    var peek = $("next-peek"), img = $("next-peek-img");
    if (peekUrl) { URL.revokeObjectURL(peekUrl); peekUrl = null; }
    var src = next.cover || (next.meta && next.meta.cover);
    if (src) { peekUrl = URL.createObjectURL(src); img.src = peekUrl; img.hidden = false; } else img.hidden = true;
    img.style.width = frame.style.width;
    img.style.height = frame.style.height;
    $("np-series").textContent = next.series;
    $("np-title").textContent = episodeTitle(next);
    peek.classList.remove("fade", "in", "from-top");
    if (dir < 0) peek.classList.add("from-top");
    peek.hidden = false;
    void peek.offsetWidth;
    peek.classList.add("in");
    player.classList.add(dir < 0 ? "to-prev" : "to-next");
    setTimeout(function () { openEpisode(next, { section: 0, viaScroll: true }); }, 800);
    return true;
  }

  function revealAfterScroll() {
    var peek = $("next-peek");
    if (peek.hidden) return;
    peek.classList.add("fade");
    setTimeout(hideNextPeek, 520);
  }

  function hideNextPeek() {
    var peek = $("next-peek");
    peek.hidden = true;
    peek.classList.remove("in", "fade", "from-top");
    player.classList.remove("to-next", "to-prev");
    if (peekUrl) { URL.revokeObjectURL(peekUrl); peekUrl = null; }
  }

  var wheelSum = 0, wheelTimer = null;
  function onWheel(e) {
    if (!S) return;
    var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (!dy) return;
    if ((dy > 0) !== (wheelSum > 0)) wheelSum = 0;   // direction changed
    wheelSum += dy;                      // trackpads send many small deltas: add them up
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(function () { wheelSum = 0; }, 250);
    if (Math.abs(wheelSum) > 60) { var dir = wheelSum > 0 ? 1 : -1; wheelSum = 0; scrollToEpisode(dir); }
  }

  function attachSwipeUp(target) {
    var sx, sy, st;
    target.addEventListener("touchstart", function (e) {
      var t = e.touches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now();
    }, { capture: true, passive: true });
    target.addEventListener("touchend", function (e) {
      if (sy === undefined) return;
      var t = e.changedTouches[0], dy = sy - t.clientY, dx = Math.abs(t.clientX - sx);
      sy = undefined;
      if (Math.abs(dy) > 60 && dx < Math.abs(dy) * 0.6 && Date.now() - st < 800) scrollToEpisode(dy > 0 ? 1 : -1);
    }, { capture: true, passive: true });
  }

  player.addEventListener("wheel", onWheel, { passive: true });
  attachSwipeUp(player);
  $("next-hint").addEventListener("click", function () { scrollToEpisode(1); });
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
  $("e-close").addEventListener("click", function () { hideEndCard(false); frame.focus(); });

  // Scriptable entry points (handy for debugging from the console and for automated tests).
  window.narr8 = {
    library: function () { return library; },
    loadFiles: function (rootName, list) { showState("loading"); return buildLibrary(rootName, list); },
    open: function (id, opts) { var ep = library.byId[id]; if (ep) openEpisode(ep, opts || {}); return !!ep; },
    session: function () { return S; }
  };

  // ================================================================== boot
  if (location.hash.indexOf("#play/") === 0) history.replaceState(null, "", location.pathname + location.search);
  applyTheme();
  applyInterfaceLanguage();
  restoreFolder();
})();
