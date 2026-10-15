/* Zeno style book (v0.17) — Andrew's own samples shape Zeno's art.
   Andrew uploads his drawings; each sample keeps a dominant-color palette
   (extracted on-device) plus Andrew's own written style descriptors. The
   ACTIVE sample is auto-injected into every /imagine art-direction prompt.

   Honest boundary (also stated in the UI): this is style-reference
   prompting, not model fine-tuning. The pixels never train anything; they
   steer the prompt. Real training waits for the muscle-box Jetson.

   UMD: <script> (window.ZenoStyleBook) and node module. Same swappable-
   backend pattern as zeno-gallery.js. */
(function(root, factory){
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.ZenoStyleBook = factory();
})(typeof self !== "undefined" ? self : this, function(){
"use strict";

var DB_NAME = "zeno-stylebook";
var DB_VERSION = 1;
var STORE = "samples";

var HONESTY_NOTE =
  "Style book = style-reference prompting, not model training. " +
  "Your samples steer my art direction; no pixels train any model. " +
  "Real fine-tuning waits for the muscle box.";

function uid(){
  return "sty_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}
function cleanHex(h){
  var m = String(h || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? "#" + m[1].toLowerCase() : null;
}

/* ---------- MemoryBackend (tests) ---------- */
function MemoryBackend(){
  this._map = new Map();
}
MemoryBackend.prototype.open = function(){ return Promise.resolve(); };
MemoryBackend.prototype.put = function(rec){
  this._map.set(rec.id, rec);
  return Promise.resolve(rec.id);
};
MemoryBackend.prototype.get = function(id){
  return Promise.resolve(this._map.get(id) || null);
};
MemoryBackend.prototype.all = function(){
  var out = Array.from(this._map.values());
  out.sort(function(a, b){ return a.createdAt - b.createdAt; });
  return Promise.resolve(out);
};
MemoryBackend.prototype.del = function(id){
  this._map.delete(id);
  return Promise.resolve();
};

/* ---------- IDBBackend (browser) ---------- */
function IDBBackend(){
  this._db = null;
}
IDBBackend.prototype.open = function(){
  var self = this;
  return new Promise(function(resolve, reject){
    if (typeof indexedDB === "undefined"){ reject(new Error("indexedDB unavailable")); return; }
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(){
      var db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = function(){ self._db = req.result; resolve(); };
    req.onerror = function(){ reject(req.error || new Error("stylebook db open failed")); };
  });
};
IDBBackend.prototype._st = function(mode){
  return this._db.transaction(STORE, mode).objectStore(STORE);
};
IDBBackend.prototype.put = function(rec){
  var self = this;
  return new Promise(function(resolve, reject){
    var q = self._st("readwrite").put(rec);
    q.onsuccess = function(){ resolve(rec.id); };
    q.onerror = function(){ reject(q.error || new Error("stylebook put failed")); };
  });
};
IDBBackend.prototype.get = function(id){
  var self = this;
  return new Promise(function(resolve, reject){
    var q = self._st("readonly").get(id);
    q.onsuccess = function(){ resolve(q.result || null); };
    q.onerror = function(){ reject(q.error || new Error("stylebook get failed")); };
  });
};
IDBBackend.prototype.all = function(){
  var self = this;
  return new Promise(function(resolve, reject){
    var q = self._st("readonly").getAll();
    q.onsuccess = function(){
      var out = q.result || [];
      out.sort(function(a, b){ return a.createdAt - b.createdAt; });
      resolve(out);
    };
    q.onerror = function(){ reject(q.error || new Error("stylebook list failed")); };
  });
};
IDBBackend.prototype.del = function(id){
  var self = this;
  return new Promise(function(resolve, reject){
    var q = self._st("readwrite").delete(id);
    q.onsuccess = function(){ resolve(); };
    q.onerror = function(){ reject(q.error || new Error("stylebook delete failed")); };
  });
};

/* ---------- pure: build the prompt-injection string ---------- */
function buildStyleNote(sample){
  if (!sample) return "";
  var bits = [];
  var pal = (sample.palette || []).map(cleanHex).filter(Boolean);
  if (pal.length) bits.push("use a color palette drawn from Andrew's own sample: " + pal.join(", "));
  var desc = String(sample.descriptors || "").trim().slice(0, 300);
  if (desc) bits.push("match this style in Andrew's own words: " + desc);
  if (!bits.length) return "";
  return "STYLE BOOK (Andrew's sample \"" + String(sample.name || "untitled").slice(0, 60) +
    "\"): " + bits.join("; ") +
    ". This is style reference only — do not copy any specific subject, character, or scene from the sample.";
}

/* ---------- ZenoStyleBook ---------- */
function ZenoStyleBook(backend){
  this.backend = backend || new MemoryBackend();
  this._open = null;
  this._activeCache = null; // last refreshed active sample (or null)
}
ZenoStyleBook.prototype.ready = function(){
  if (!this._open) this._open = this.backend.open();
  return this._open;
};
ZenoStyleBook.prototype.addSample = function(opts){
  var self = this;
  opts = opts || {};
  var pal = (opts.palette || []).map(cleanHex).filter(Boolean).slice(0, 6);
  var rec = {
    id: uid(),
    name: String(opts.name || "Untitled sample").slice(0, 80),
    palette: pal,
    descriptors: String(opts.descriptors || "").slice(0, 300),
    thumb: String(opts.thumb || ""),
    active: false,
    createdAt: Date.now()
  };
  return self.ready().then(function(){ return self.backend.put(rec); })
    .then(function(){ return rec.id; });
};
ZenoStyleBook.prototype.list = function(){
  var self = this;
  return self.ready().then(function(){ return self.backend.all(); });
};
ZenoStyleBook.prototype.get = function(id){
  var self = this;
  return self.ready().then(function(){ return self.backend.get(id); });
};
ZenoStyleBook.prototype.remove = function(id){
  var self = this;
  return self.ready().then(function(){ return self.backend.del(id); })
    .then(function(){
      if (self._activeCache && self._activeCache.id === id) self._activeCache = null;
    });
};
ZenoStyleBook.prototype.setActive = function(id){
  var self = this;
  return self.ready().then(function(){ return self.backend.all(); }).then(function(all){
    var found = null;
    var chain = Promise.resolve();
    all.forEach(function(r){
      var want = (r.id === id);
      if (r.active !== want){
        r.active = want;
        chain = chain.then(function(){ return self.backend.put(r); });
      }
      if (want) found = r;
    });
    return chain.then(function(){
      self._activeCache = found;
      return found ? found.id : null;
    });
  });
};
ZenoStyleBook.prototype.getActive = function(){
  var self = this;
  return self.ready().then(function(){ return self.backend.all(); }).then(function(all){
    var act = null;
    for (var i = 0; i < all.length; i++) if (all[i].active) act = all[i];
    self._activeCache = act;
    return act;
  });
};
/* refreshActive: call at startup and after mutations; keeps the sync cache fresh. */
ZenoStyleBook.prototype.refreshActive = function(){
  return this.getActive();
};
/* activeNote: synchronous prompt injection, from cache. Empty when none active. */
ZenoStyleBook.prototype.activeNote = function(){
  return buildStyleNote(this._activeCache);
};

var _default = null;
function defaultStyleBook(){
  if (!_default){
    var backend;
    try { backend = (typeof indexedDB !== "undefined") ? new IDBBackend() : new MemoryBackend(); }
    catch(e){ backend = new MemoryBackend(); }
    _default = new ZenoStyleBook(backend);
  }
  return _default;
}

return {
  DB_NAME: DB_NAME, DB_VERSION: DB_VERSION, STORE: STORE,
  HONESTY_NOTE: HONESTY_NOTE, buildStyleNote: buildStyleNote,
  MemoryBackend: MemoryBackend, IDBBackend: IDBBackend,
  ZenoStyleBook: ZenoStyleBook, defaultStyleBook: defaultStyleBook
};
});
