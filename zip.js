// Minimal streaming-friendly ZIP reader for the browser (no dependencies).
// Reads the central directory from a File/Blob and inflates entries with the native DecompressionStream,
// so an 80+ MB episode never has to be held in memory as one ArrayBuffer.
(function (global) {
  function readBytes(blob, start, end) {
    return blob.slice(start, end).arrayBuffer().then(function (b) { return new DataView(b); });
  }

  function u64(dv, off) { // good up to 2^53
    return dv.getUint32(off, true) + dv.getUint32(off + 4, true) * 4294967296;
  }

  var utf8 = new TextDecoder("utf-8");
  var CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
  function decodeName(bytes, isUtf8) {
    if (isUtf8) return utf8.decode(bytes);
    var ascii = true;
    for (var i = 0; i < bytes.length; i++) if (bytes[i] > 127) { ascii = false; break; }
    if (ascii) return utf8.decode(bytes);
    var s = "";
    for (i = 0; i < bytes.length; i++) s += bytes[i] < 128 ? String.fromCharCode(bytes[i]) : CP437[bytes[i] - 128];
    return s;
  }

  // Returns [{ name, method, compressedSize, size, localOffset, isDir }]
  function listEntries(blob) {
    var tailLen = Math.min(blob.size, 65536 + 22);
    return readBytes(blob, blob.size - tailLen, blob.size).then(function (dv) {
      var eocd = -1;
      for (var i = dv.byteLength - 22; i >= 0; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error("Not a ZIP file (no end-of-central-directory record).");
      var count = dv.getUint16(eocd + 10, true);
      var cdSize = dv.getUint32(eocd + 12, true);
      var cdOffset = dv.getUint32(eocd + 16, true);
      var zip64 = count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
      if (!zip64) return { count: count, cdSize: cdSize, cdOffset: cdOffset };
      // ZIP64 end of central directory locator sits 20 bytes before EOCD
      var loc = eocd - 20;
      if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) throw new Error("Broken ZIP64 archive.");
      var z64Offset = u64(dv, loc + 8);
      return readBytes(blob, z64Offset, z64Offset + 56).then(function (z) {
        if (z.getUint32(0, true) !== 0x06064b50) throw new Error("Broken ZIP64 record.");
        return { count: u64(z, 32), cdSize: u64(z, 40), cdOffset: u64(z, 48) };
      });
    }).then(function (cd) {
      return readBytes(blob, cd.cdOffset, cd.cdOffset + cd.cdSize).then(function (dv) {
        var entries = [];
        var p = 0;
        var bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        for (var n = 0; n < cd.count; n++) {
          if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt ZIP central directory.");
          var flags = dv.getUint16(p + 8, true);
          var method = dv.getUint16(p + 10, true);
          var compressedSize = dv.getUint32(p + 20, true);
          var size = dv.getUint32(p + 24, true);
          var nameLen = dv.getUint16(p + 28, true);
          var extraLen = dv.getUint16(p + 30, true);
          var commentLen = dv.getUint16(p + 32, true);
          var localOffset = dv.getUint32(p + 42, true);
          var name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
          // ZIP64 extended information extra field
          var e = p + 46 + nameLen, eEnd = e + extraLen;
          while (e + 4 <= eEnd) {
            var id = dv.getUint16(e, true), len = dv.getUint16(e + 2, true), q = e + 4;
            if (id === 0x0001) {
              if (size === 0xffffffff) { size = u64(dv, q); q += 8; }
              if (compressedSize === 0xffffffff) { compressedSize = u64(dv, q); q += 8; }
              if (localOffset === 0xffffffff) { localOffset = u64(dv, q); q += 8; }
            }
            e += 4 + len;
          }
          entries.push({
            name: name.replace(/\\/g, "/").replace(/^(\.?\/)+/, ""),   // some episodes store "/video/…"
            method: method,
            encrypted: (flags & 1) !== 0,
            compressedSize: compressedSize,
            size: size,
            localOffset: localOffset,
            isDir: /\/$/.test(name)
          });
          p += 46 + nameLen + extraLen + commentLen;
        }
        return entries;
      });
    });
  }

  // Returns a Promise<Blob> with the uncompressed contents of one entry.
  function extract(blob, entry) {
    if (entry.encrypted) return Promise.reject(new Error("Encrypted ZIP entries are not supported: " + entry.name));
    return readBytes(blob, entry.localOffset, entry.localOffset + 30).then(function (dv) {
      if (dv.getUint32(0, true) !== 0x04034b50) throw new Error("Corrupt local header for " + entry.name);
      var start = entry.localOffset + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
      var raw = blob.slice(start, start + entry.compressedSize);
      if (entry.method === 0) return raw;
      if (entry.method === 8) {
        return new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
      }
      throw new Error("Unsupported compression method " + entry.method + " for " + entry.name);
    });
  }

  global.NarrZip = { listEntries: listEntries, extract: extract };
})(window);
