// Service worker: makes an episode zip on the user's disk look like a web folder to the episode's engine.
//
//   <scope>comic/<episodeId>/<path>      -> asks the player page (which holds the File handles) for that zip entry,
//                                          then answers with HTTP Range support for video/audio
//   <scope>comic/<episodeId>/foreditor/* -> host shim from <scope>shim/* (replaces the lost NARR8 web-player files)
//
// The page answers "narr8-file" messages (see app.js). Keeping the File handles in the page, not here, means the
// browser can stop this worker whenever it likes without losing anything.
var SHELL_CACHE = "narr8-shell-v2";
var SHELL_FILES = ["./", "index.html", "app.js", "zip.js", "db.js", "style.css",
  "shim/navigation.js", "shim/foreditor.js", "shim/video.js", "shim/mouse.js"];

var MIME = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8", xml: "application/xml", plist: "application/xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav", aac: "audio/aac",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2"
};

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL_FILES); }).catch(function () {}));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// A page opened with a hard reload is not controlled; it asks to be claimed.
self.addEventListener("message", function (e) {
  if (e.data === "claim") self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  var comicBase = new URL("comic/", self.registration.scope);
  if (url.origin === comicBase.origin && url.pathname.indexOf(comicBase.pathname) === 0) {
    e.respondWith(serveComicFile(e.request, url.pathname.slice(comicBase.pathname.length)));
    return;
  }
  if (e.request.method === "GET" && url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        if (res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(e.request, { ignoreSearch: true });
      })
    );
  }
});

function extOf(path) {
  var m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

function notFound(path) {
  return new Response("Not found: " + path, { status: 404, headers: { "Content-Type": "text/plain" } });
}

// Ask every open player window; the one that has this episode's folder answers with a Blob.
function askPages(id, path) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    var pages = list.filter(function (c) { return c.frameType !== "nested"; });
    if (!pages.length) return null;
    return new Promise(function (resolve) {
      var pending = pages.length, done = false;
      var timer = setTimeout(function () { finish(null); }, 30000);
      function finish(v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } }
      pages.forEach(function (client) {
        var ch = new MessageChannel();
        ch.port1.onmessage = function (m) {
          if (m.data && m.data.blob) finish(m.data.blob);
          else if (--pending === 0) finish(null);
        };
        client.postMessage({ type: "narr8-file", id: id, path: path }, [ch.port2]);
      });
    });
  });
}

function serveComicFile(request, rest) {
  var slash = rest.indexOf("/");
  if (slash < 0) return Promise.resolve(notFound(rest));
  var id = decodeURIComponent(rest.slice(0, slash));
  var path = decodeURIComponent(rest.slice(slash + 1));

  // The NARR8 web player's own files were never shipped inside episodes; substitute our shim.
  if (path.indexOf("foreditor/") === 0) {
    var shimUrl = new URL("shim/" + path.slice("foreditor/".length), self.registration.scope);
    return fetch(shimUrl).then(function (r) { return r.ok ? r : caches.match(shimUrl.href); })
      .catch(function () { return caches.match(shimUrl.href); })
      .then(function (r) { return r || notFound(path); });
  }

  return askPages(id, path).then(function (blob) {
    if (blob) return blob;
    // Firefox/Opera builds of the engine ask for .webm/.ogg; episodes only ship .mp4/.mp3.
    var alt = path.replace(/\.webm$/i, ".mp4").replace(/\.ogg$/i, ".mp3");
    if (alt === path) return null;
    return askPages(id, alt).then(function (b) { if (b) path = alt; return b; });
  }).then(function (blob) {
    if (!blob) return notFound(path);
    return blobResponse(request, blob, MIME[extOf(path)] || "application/octet-stream");
  });
}

function blobResponse(request, blob, type) {
  var size = blob.size;
  var range = request.headers.get("Range");
  var headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  if (range) {
    var m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      var start, end;
      if (m[1] === "" && m[2] !== "") { // suffix range: last N bytes
        start = Math.max(0, size - parseInt(m[2], 10));
        end = size - 1;
      } else {
        start = parseInt(m[1] || "0", 10);
        end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
      }
      if (start >= size || start > end) {
        headers["Content-Range"] = "bytes */" + size;
        return new Response(null, { status: 416, headers: headers });
      }
      headers["Content-Range"] = "bytes " + start + "-" + end + "/" + size;
      headers["Content-Length"] = String(end - start + 1);
      return new Response(blob.slice(start, end + 1), { status: 206, statusText: "Partial Content", headers: headers });
    }
  }
  headers["Content-Length"] = String(size);
  return new Response(blob, { status: 200, headers: headers });
}
