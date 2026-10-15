/* Zeno image gallery (v0.16) — every /imagine result is saved to an
   IndexedDB-backed gallery on this device, so images survive the app being
   swiped away and reopened. Likes persist too.

   Design: storage backends are swappable. IDBBackend is the real browser
   store; MemoryBackend is an in-memory twin with identical async semantics
   used by the node test suite. ZenoGallery holds the policy (pruning,
   ordering) on top of either backend.

   UMD: works as <script> (window.ZenoGallery) and as a node module. */
(function(root, factory){
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.ZenoGallery = factory();
})(typeof self !== "undefined" ? self : this, function(){
"use strict";

var DB_NAME = "zeno-gallery";
var DB_VERSION = 1;
var STORE = "images";
var MAX_IMAGES = 200; // oldest UNLIKED images are pruned past this

function uid(){
  return "img_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

/* ---------- MemoryBackend (tests; identical async contract) ---------- */
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
  out.sort(function(a, b){ return b.createdAt - a.createdAt; });
  return Promise.resolve(out);
};
MemoryBackend.prototype.del = function(id){
  this._map.delete(id);
  return Promise.resolve();
};
MemoryBackend.prototype.clear = function(){
  this._map.clear();
  return Promise.resolve();
};

/* ---------- IDBBackend (real browser store) ---------- */
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
      if (!db.objectStoreNames.contains(STORE)){
        var st = db.createObjectStore(STORE, { keyPath: "id" });
        st.createIndex("createdAt", "createdAt", { unique: false });
        st.createIndex("liked", "liked", { unique: false });
      }
    };
    req.onsuccess = function(){ self._db = req.result; resolve(); };
    req.onerror = function(){ reject(req.error || new Error("gallery db open failed")); };
  });
};
IDBBackend.prototype._tx = function(mode){
  return this._db.transaction(STORE, mode).objectStore(STORE);
};
IDBBackend.prototype.put = function(rec){
  var self = this;
  return new Promise(function(resolve, reject){
    var q = self._tx("readwrite").put(rec);
    q.onsuccess = function(){ resolve(rec.id); };
    q.onerror = function(){ reject(q.error || new Error("gallery put failed")); };
  });
};
IDBBackend.prototype.get = function(id){
  var self = this;
  return new Promise(function(resolve, reject){
    var q = self._tx("readonly").get(id);
    q.onsuccess = function(){ resolve(q.result || null); };
    q.onerror = function(){ reject(q.error || new Error("gallery get failed")); };
  });
};
IDBBackend.prototype.all = function(){
  var self = this;
  return new Promise(function(resolve, reject){
    var out = [];
    var q = self._tx("readonly").index("createdAt").openCursor(null, "prev");
    q.onsuccess = function(){
      var c = q.result;
      if (c){ out.push(c.value); c.continue(); }
      else resolve(out);
    };
    q.onerror = function(){ reject(q.error || new Error("gallery list failed")); };
  });
};
IDBBackend.prototype.del = function(id){
  var self = this;
  return new Promise(function(resolve, reject){
    var q = self._tx("readwrite").delete(id);
    q.onsuccess = function(){ resolve(); };
    q.onerror = function(){ reject(q.error || new Error("gallery delete failed")); };
  });
};
IDBBackend.prototype.clear = function(){
  var self = this;
  return new Promise(function(resolve, reject){
    var q = self._tx("readwrite").clear();
    q.onsuccess = function(){ resolve(); };
    q.onerror = function(){ reject(q.error || new Error("gallery clear failed")); };
  });
};

/* ---------- ZenoGallery: policy over a backend ---------- */
function ZenoGallery(backend){
  this.backend = backend || new MemoryBackend();
  this._open = null;
}
ZenoGallery.prototype.ready = function(){
  if (!this._open) this._open = this.backend.open();
  return this._open;
};
ZenoGallery.prototype.save = function(opts){
  var self = this;
  opts = opts || {};
  if (!opts.dataUrl || typeof opts.dataUrl !== "string" || opts.dataUrl.slice(0, 5) !== "data:"){
    return Promise.reject(new Error("gallery.save needs a data: URL"));
  }
  var rec = {
    id: uid(),
    dataUrl: opts.dataUrl,
    prompt: String(opts.prompt || "").slice(0, 400),
    seed: opts.seed == null ? null : opts.seed,
    liked: false,
    createdAt: Date.now()
  };
  return self.ready().then(function(){ return self.backend.put(rec); })
    .then(function(){ return self._prune(); })
    .then(function(){ return rec.id; });
};
ZenoGallery.prototype._prune = function(){
  var self = this;
  return self.backend.all().then(function(all){
    if (all.length <= MAX_IMAGES) return 0;
    var victims = all.filter(function(r){ return !r.liked; })
      .sort(function(a, b){ return a.createdAt - b.createdAt; })
      .slice(0, all.length - MAX_IMAGES);
    return victims.reduce(function(p, r){
      return p.then(function(){ return self.backend.del(r.id); });
    }, Promise.resolve()).then(function(){ return victims.length; });
  });
};
ZenoGallery.prototype.list = function(){
  var self = this;
  return self.ready().then(function(){ return self.backend.all(); });
};
ZenoGallery.prototype.liked = function(){
  return this.list().then(function(all){ return all.filter(function(r){ return r.liked; }); });
};
ZenoGallery.prototype.get = function(id){
  var self = this;
  return self.ready().then(function(){ return self.backend.get(id); });
};
ZenoGallery.prototype.toggleLike = function(id){
  var self = this;
  return self.ready().then(function(){ return self.backend.get(id); }).then(function(rec){
    if (!rec) throw new Error("gallery.toggleLike: unknown id");
    rec.liked = !rec.liked;
    return self.backend.put(rec).then(function(){ return rec.liked; });
  });
};
ZenoGallery.prototype.remove = function(id){
  var self = this;
  return self.ready().then(function(){ return self.backend.del(id); });
};
ZenoGallery.prototype.count = function(){
  return this.list().then(function(all){ return all.length; });
};

/* Default singleton for the page: IndexedDB when available. */
var _default = null;
function defaultGallery(){
  if (!_default){
    var backend;
    try { backend = (typeof indexedDB !== "undefined") ? new IDBBackend() : new MemoryBackend(); }
    catch(e){ backend = new MemoryBackend(); }
    _default = new ZenoGallery(backend);
  }
  return _default;
}

return {
  DB_NAME: DB_NAME, DB_VERSION: DB_VERSION, STORE: STORE, MAX_IMAGES: MAX_IMAGES,
  MemoryBackend: MemoryBackend, IDBBackend: IDBBackend,
  ZenoGallery: ZenoGallery, defaultGallery: defaultGallery
};
});
