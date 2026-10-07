/* Zeno Eyes (v0.12) — camera via getUserMedia.
 *
 * HONEST SCOPE (shown in the UI, not buried here): the camera opens and
 * Zeno can save snapshots, but WebLLM 0.2.82 has no vision model, so Zeno
 * CANNOT interpret what the camera sees. The UI label reads
 * "eyes open — brain still learning to see". Snapshots are saved as photos
 * Andrew can look at, export, and delete. Never claim image understanding.
 *
 * Photos live in their own ZenoStorage roll (cap 20, newest first); each
 * snapshot also drops a normal memory entry so it shows in the Memory panel.
 * Node test seam at the bottom.
 */
"use strict";

(function(){
  var PHOTO_KEY = "zeno.eyes.photos.v1";
  var PHOTO_CAP = 20;

  var api = {
    _stream: null,
    _videoEl: null,
    _open: false,
    _lastPhoto: null,

    HONEST_LABEL: "eyes open \u2014 brain still learning to see",
    HONEST_NOTE: "The camera is live and I can save snapshots, but my brain " +
      "(WebLLM 0.2.82) has no vision model — I can't see or understand what's " +
      "in the pictures yet. Snapshots are saved as photos for you to look at, " +
      "export, or delete.",

    supported: function(){
      try {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      } catch(e){ return false; }
    },

    isOpen: function(){ return this._open; },

    _store: function(){
      try {
        if (typeof window !== "undefined" && window.ZenoStorage) return window.ZenoStorage;
      } catch(e){}
      return null;
    },

    async open(){
      if (this._open) return { ok: true, already: true };
      if (!this.supported())
        return { ok: false, reason: "This browser doesn't offer camera access (getUserMedia missing)." };
      var video = (typeof document !== "undefined") ? document.getElementById("eyesVideo") : null;
      try {
        var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        this._stream = stream;
        this._videoEl = video;
        if (video){
          video.srcObject = stream;
          try { await video.play(); } catch(e){}
        }
        this._open = true;
        this._render();
        return { ok: true };
      } catch(err){
        var reason = "Camera unavailable.";
        var name = String((err && err.name) || "");
        if (/NotAllowedError|PermissionDeniedError/i.test(name))
          reason = "Camera permission was denied — allow it in Safari's site settings (the aA button \u2192 Website Settings) and try again.";
        else if (/NotFoundError|OverconstrainedError/i.test(name))
          reason = "No camera found on this device.";
        else if (/NotReadableError|TrackStartError/i.test(name))
          reason = "The camera is busy in another app or tab.";
        return { ok: false, reason: reason };
      }
    },

    close(){
      try {
        if (this._stream){
          this._stream.getTracks().forEach(function(t){ try { t.stop(); } catch(e){} });
        }
      } catch(e){}
      this._stream = null;
      if (this._videoEl){ try { this._videoEl.srcObject = null; } catch(e){} }
      this._videoEl = null;
      this._open = false;
      this._render();
    },

    roll(){
      var store = this._store();
      if (!store) return [];
      try {
        var raw = store.getItem(PHOTO_KEY);
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch(e){ return []; }
    },

    _saveRoll(arr){
      var store = this._store();
      if (!store) return false;
      try { store.setItem(PHOTO_KEY, JSON.stringify(arr.slice(0, PHOTO_CAP))); }
      catch(e){ return false; } // quota exceeded or storage unavailable
      return true;
    },

    async snapshot(label){
      if (!this._open || !this._stream)
        return { ok: false, reason: "Eyes aren't open — open them first." };
      var video = this._videoEl;
      if (!video || !video.videoWidth)
        return { ok: false, reason: "The camera isn't delivering frames yet — give it a second." };
      var canvas = (typeof document !== "undefined") ? document.createElement("canvas") : null;
      if (!canvas) return { ok: false, reason: "No canvas available to capture the frame." };
      // Downscale big camera frames (12MP+ blows the ~5MB localStorage quota
      // in a handful of shots). 1280px on the long side is plenty for review.
      var w = video.videoWidth, h = video.videoHeight;
      var scale = Math.min(1, 1280 / Math.max(w, h));
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var dataUrl;
      try { dataUrl = canvas.toDataURL("image/jpeg", 0.82); }
      catch(e){ return { ok: false, reason: "Couldn't encode the snapshot." }; }
      var photo = {
        id: "p" + Date.now().toString(36),
        ts: Date.now(),
        label: String(label || "snapshot").slice(0, 80),
        dataUrl: dataUrl
      };
      var roll = this.roll();
      roll.unshift(photo);
      // Fail CLOSED: never report a saved snapshot that didn't persist.
      // Storage can silently refuse (quota), so verify the round-trip.
      var persisted = this._saveRoll(roll) &&
        this.roll().some(function(p){ return p && p.id === photo.id; });
      if (!persisted){
        this._lastPhoto = null;
        this._render();
        return { ok: false,
          reason: "The iPad's storage is full — delete some snapshots from the " +
                  "photo roll, then try again. Nothing was saved." };
      }
      this._lastPhoto = photo;
      try {
        var MS = null;
        try { MS = (typeof window !== "undefined" && window.MemoryStore) || null; } catch(e){}
        try { if (!MS && typeof MemoryStore !== "undefined") MS = MemoryStore; } catch(e){}
        if (MS) MS.add("episodic", "Eyes snapshot saved (" + photo.label + ") \u2014 photo id " + photo.id + ". I can't see what's in it yet; it's saved for Andrew to look at.");
      } catch(e){}
      this._render();
      return { ok: true, photo: photo };
    },

    deletePhoto(id){
      var roll = this.roll().filter(function(p){ return p.id !== id; });
      this._saveRoll(roll);
      if (this._lastPhoto && this._lastPhoto.id === id) this._lastPhoto = roll[0] || null;
      this._render();
      return roll.length;
    },

    exportRoll(){
      var roll = this.roll();
      var payload = {
        exportedAt: new Date().toISOString(),
        count: roll.length,
        note: "Zeno eyes photo roll. Photos are JPEG data URLs.",
        photos: roll
      };
      return {
        filename: "zeno-eyes-photos.json",
        mime: "application/json",
        content: JSON.stringify(payload, null, 2)
      };
    },

    downloadPhoto(id){
      var photo = this.roll().find(function(p){ return p.id === id; }) || this._lastPhoto;
      if (!photo) return null;
      return { filename: "zeno-eyes-" + photo.id + ".jpg", dataUrl: photo.dataUrl };
    },

    _render(){
      if (typeof document === "undefined") return;
      try {
        var st = document.getElementById("eyesState");
        if (st){
          st.textContent = this._open ? this.HONEST_LABEL : "eyes closed";
          st.dataset.open = this._open ? "1" : "0";
        }
        var openBtn = document.getElementById("eyesOpenBtn");
        var closeBtn = document.getElementById("eyesCloseBtn");
        var snapBtn = document.getElementById("eyesSnapBtn");
        if (openBtn) openBtn.disabled = this._open;
        if (closeBtn) closeBtn.disabled = !this._open;
        if (snapBtn) snapBtn.disabled = !this._open;
        var rollEl = document.getElementById("eyesRoll");
        if (rollEl){
          var roll = this.roll();
          rollEl.innerHTML = "";
          roll.forEach(function(p){
            var fig = document.createElement("figure");
            fig.className = "eyes-thumb";
            var img = document.createElement("img");
            img.src = p.dataUrl;
            img.alt = "Eyes snapshot: " + p.label;
            img.loading = "lazy";
            var cap = document.createElement("figcaption");
            cap.textContent = p.label;
            var del = document.createElement("button");
            del.className = "secondary eyes-del";
            del.textContent = "Delete";
            del.addEventListener("click", function(){ api.deletePhoto(p.id); });
            fig.appendChild(img); fig.appendChild(cap); fig.appendChild(del);
            rollEl.appendChild(fig);
          });
          if (!roll.length){
            var empty = document.createElement("div");
            empty.className = "small";
            empty.textContent = "No snapshots yet.";
            rollEl.appendChild(empty);
          }
        }
      } catch(e){}
    },

    init(){
      this._render();
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ZenoEyes = api;
})();
