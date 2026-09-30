// Tiny IndexedDB wrapper.
//   kv:    small settings, e.g. the remembered comics folder handle (Chrome/Edge)
//   scans: cached per-episode scan results, keyed by "<relative path>|<size>|<lastModified>", so reopening the
//          library does not re-read every zip
// Episode files themselves are never copied: they are read straight from the user's folder.
(function (global) {
  var DB_NAME = "narr8-player";
  var DB_VERSION = 2;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        // v1 copied whole episodes into the browser; drop those stores to give the space back
        ["comics", "files"].forEach(function (n) { if (db.objectStoreNames.contains(n)) db.deleteObjectStore(n); });
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("scans")) db.createObjectStore("scans");
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  function run(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var out;
        t.oncomplete = function () { resolve(out && "result" in out ? out.result : undefined); };
        t.onerror = t.onabort = function () { reject(t.error); };
        var r = fn(t.objectStore(store));
        if (r && "onsuccess" in r) { out = r; }
      });
    });
  }

  global.NarrDB = {
    get: function (store, key) { return run(store, "readonly", function (s) { return s.get(key); }); },
    set: function (store, key, value) { return run(store, "readwrite", function (s) { s.put(value, key); }); },
    del: function (store, key) { return run(store, "readwrite", function (s) { s.delete(key); }); },
    getMany: function (store, keys) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(store, "readonly"), s = t.objectStore(store), out = {};
          keys.forEach(function (k) { var r = s.get(k); r.onsuccess = function () { if (r.result !== undefined) out[k] = r.result; }; });
          t.oncomplete = function () { resolve(out); };
          t.onerror = t.onabort = function () { reject(t.error); };
        });
      });
    },
    setMany: function (store, map) {
      return run(store, "readwrite", function (s) { Object.keys(map).forEach(function (k) { s.put(map[k], k); }); });
    }
  };
})(typeof self !== "undefined" ? self : window);
