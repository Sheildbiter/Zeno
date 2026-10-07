/* Zeno Builder (v0.12) — routes build requests to the right maker.
 *
 * Routes:
 *   image     -> the existing /imagine flow (caller runs the imagine toolAction)
 *   minecraft -> generates a minimal VALID Bedrock behavior pack (.mcpack)
 *                as a downloadable file (hand-rolled stored ZIP, no deps)
 *   video     -> honest note: video renders via the upcoming Colab pipeline,
 *                not inside this page
 *   page      -> the existing page-builder tool
 *
 * A .mcpack is a ZIP. This writer uses STORE (no compression) so it needs
 * no libraries: local file header + central directory + end record, with a
 * real CRC32. Minecraft accepts it.
 *
 * Node test seam at the bottom.
 */
"use strict";

(function(){

  /* ---------- CRC32 (IEEE 802.3) ---------- */
  var CRC_TABLE = (function(){
    var t = new Array(256), c, n, k;
    for (n = 0; n < 256; n++){
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes){
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++)
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str){
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    // minimal fallback for ASCII-only test environments
    var out = new Uint8Array(str.length), i;
    for (i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
    return out;
  }

  function u16(n){ return [n & 0xFF, (n >>> 8) & 0xFF]; }
  function u32(n){ return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

  /* Minimal stored ZIP with the given files: [{name, data:Uint8Array}] */
  function zipStore(files){
    var chunks = [], central = [], offset = 0, i, f, name, crc, size;
    function push(bytes){ for (var k = 0; k < bytes.length; k++) chunks.push(bytes[k] & 0xFF); }
    function pushU16(n){ push(u16(n)); }
    function pushU32(n){ push(u32(n)); }

    for (i = 0; i < files.length; i++){
      f = files[i];
      name = utf8(f.name);
      crc = crc32(f.data);
      size = f.data.length;
      // local file header
      pushU32(0x04034b50); pushU16(20); pushU16(0); pushU16(0);
      pushU16(0); pushU16(0); // mod time/date (zeroed; valid)
      pushU32(crc); pushU32(size); pushU32(size);
      pushU16(name.length); pushU16(0);
      push(name);
      central.push({ name: name, crc: crc, size: size, offset: offset });
      offset += 30 + name.length;
      push(f.data);
      offset += size;
    }
    var centralStart = offset, centralSize = 0;
    var centralBytes = [];
    function cpush(bytes){ for (var k = 0; k < bytes.length; k++) centralBytes.push(bytes[k] & 0xFF); }
    for (i = 0; i < central.length; i++){
      var e = central[i], before = centralBytes.length;
      cpush(u32(0x02014b50)); cpush(u16(20)); cpush(u16(20));
      cpush(u16(0)); cpush(u16(0)); cpush(u16(0)); cpush(u16(0));
      cpush(u32(e.crc)); cpush(u32(e.size)); cpush(u32(e.size));
      cpush(u16(e.name.length));
      cpush(u16(0)); cpush(u16(0)); cpush(u16(0)); cpush(u16(0));
      cpush(u32(0)); cpush(u32(e.offset)); cpush(e.name);
      centralSize += (centralBytes.length - before);
    }
    push(centralBytes);
    offset += centralSize;
    // end of central directory
    pushU32(0x06054b50); pushU16(0); pushU16(0);
    pushU16(central.length); pushU16(central.length);
    pushU32(centralSize); pushU32(centralStart); pushU16(0);
    return new Uint8Array(chunks);
  }

  function uuid4(){
    var b = new Array(16), i;
    if (typeof crypto !== "undefined" && crypto.getRandomValues){
      var r = new Uint8Array(16);
      crypto.getRandomValues(r);
      for (i = 0; i < 16; i++) b[i] = r[i];
    } else {
      for (i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    }
    b[6] = (b[6] & 0x0F) | 0x40;
    b[8] = (b[8] & 0x3F) | 0x80;
    function h(n){ return ("0" + n.toString(16)).slice(-2); }
    return h(b[0])+h(b[1])+h(b[2])+h(b[3])+"-"+h(b[4])+h(b[5])+"-"+h(b[6])+h(b[7])+"-"+
           h(b[8])+h(b[9])+"-"+h(b[10])+h(b[11])+h(b[12])+h(b[13])+h(b[14])+h(b[15]);
  }

  function slugify(name){
    return String(name || "zeno-pack").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "zeno-pack";
  }

  /* Minimal valid Bedrock BEHAVIOR pack: manifest.json only. */
  function buildMinecraftPack(name, description){
    var packName = String(name || "Zeno Pack").slice(0, 60) || "Zeno Pack";
    var desc = String(description || ("A behavior pack drafted by Zeno for Andrew. " +
      "Open it in Minecraft Bedrock: the manifest below is the pack's ID card. " +
      "Add your own functions, loot tables, and entities next.")).slice(0, 200);
    var manifest = {
      format_version: 2,
      header: {
        name: packName,
        description: desc,
        uuid: uuid4(),
        version: [1, 0, 0],
        min_engine_version: [1, 20, 0]
      },
      modules: [
        { type: "data", uuid: uuid4(), version: [1, 0, 0] }
      ]
    };
    var manifestText = JSON.stringify(manifest, null, 2);
    var bytes = zipStore([{ name: "manifest.json", data: utf8(manifestText) }]);
    return {
      kind: "minecraft",
      filename: slugify(packName) + ".mcpack",
      mime: "application/zip",
      bytes: bytes,
      manifest: manifest,
      text: "Done — I built \"" + packName + "\" as a real behavior pack " +
        "(" + slugify(packName) + ".mcpack). It's downloading now: import it in " +
        "Minecraft Bedrock (Settings → Storage → import the file, or just open " +
        "it on your iPad). Right now it's a valid starter shell — a proper " +
        "manifest with its own ID — ready for you to add functions, loot " +
        "tables, and entities. Tell me what the pack should DO and I'll draft " +
        "the next files with you."
    };
  }

  /* Classify a build request. Image requests stay with /imagine; this only
   * routes the Builder panel's explicit kinds plus plain-language asks. */
  function route(text){
    var t = String(text || "");
    if (/(minecraft|mcpack|behavior pack|behaviour pack|bedrock addon|bedrock add-on)/i.test(t)){
      var m = t.match(/(?:called|named)\s+["“]?([^"”\n]{1,60})/i)
           || t.match(/(?:pack|addon|add-on|mod)\s+(?:for|about)\s+([^.\n]{1,60})/i);
      return { kind: "minecraft", name: m ? m[1].trim() : "" };
    }
    if (/(video|clip|animation|movie|render (a |an )?video)/i.test(t) &&
        /(build|make|create|generate|render)/i.test(t)){
      return { kind: "video", name: "" };
    }
    if (/(web ?page|website|site)/i.test(t) && /(build|make|create)/i.test(t)){
      return { kind: "page", name: t };
    }
    if (/(image|picture|draw|photo|artwork)/i.test(t) && /(build|make|create|generate|draw)/i.test(t)){
      var im = t.match(/(?:image|picture|artwork)(?: of| about)?\s+([^.\n]{1,120})/i)
            || t.match(/draw\s+([^.\n]{1,120})/i);
      return { kind: "image", prompt: im ? im[1].trim() : t };
    }
    return { kind: "none" };
  }

  function videoNote(){
    return "Honest note on video: I can't render video inside this page — " +
      "there's no video model on this iPad. Video renders through the Colab " +
      "pipeline we're setting up (free GPU hours, WanGP + Wan 2.2): you give " +
      "me the character reference, the scene plate, and the action prompt, " +
      "and the pipeline does the frames. Tell me what clip you want and I'll " +
      "draft the shot list with you.";
  }

  var api = {
    route: route,
    buildMinecraftPack: buildMinecraftPack,
    videoNote: videoNote,
    uuid4: uuid4,
    _zipStore: zipStore, _crc32: crc32
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ZenoBuilder = api;
})();
