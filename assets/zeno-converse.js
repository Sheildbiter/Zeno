/* Zeno Converse (v0.12) — continuous conversation mode.
 *
 * listen -> generate -> speak -> listen -> ... with a stop control.
 * Drives the EXISTING ZenoVoice API (startListening/stopListening/speak/stop)
 * — no changes to push-to-talk behavior. ZenoVoice calls back into
 * window.ZenoConverse.onSpeechDone() when an utterance finishes and
 * window.ZenoConverse.onQuietTurn() when a listening turn ends with no text.
 * Both hooks are defensive: if this module isn't loaded, ZenoVoice behaves
 * exactly as before.
 *
 * States: idle -> listening -> thinking -> speaking -> listening ...
 * Any error or the stop control returns to idle.
 *
 * Node test seam at the bottom.
 */
"use strict";

(function(){
  var STATES = ["idle", "listening", "thinking", "speaking"];

  var api = {
    _state: "idle",
    _beats: 0,

    get state(){ return this._state; },
    get active(){ return this._state !== "idle"; },

    _voice: function(){
      /* ZenoVoice is a top-level const in the page (classic scripts share one
         global lexical scope), so it is NOT on window. Check both. */
      try {
        if (typeof window !== "undefined" && window.ZenoVoice) return window.ZenoVoice;
      } catch(e){}
      try {
        if (typeof ZenoVoice !== "undefined" && ZenoVoice) return ZenoVoice;
      } catch(e){}
      return null;
    },

    _set: function(s){
      if (STATES.indexOf(s) === -1) s = "idle";
      this._state = s;
      this._render();
    },

    canStart: function(){
      var v = this._voice();
      return !!(v && v.inputSupported);
    },

    /* Begin the loop. Must be called from a user gesture on iOS. */
    start: function(){
      var v = this._voice();
      if (!v) return { ok: false, reason: "Voice module isn't loaded." };
      if (!v.inputSupported)
        return { ok: false, reason: "Voice input isn't available in this browser — conversation mode needs the Safari tab, internet, and Siri on." };
      if (this.active) return { ok: true, already: true };
      this._beats = 0;
      this._set("listening");
      try { v.stop(); } catch(e){}
      v.startListening();
      return { ok: true };
    },

    stop: function(quiet){
      var v = this._voice();
      this._set("idle");
      try { if (v){ v.stopListening(); v.stop(); } } catch(e){}
      if (!quiet){
        try {
          if (typeof window !== "undefined" && window.setStatus)
            window.setStatus("Conversation mode off.");
        } catch(e){}
      }
      return { ok: true };
    },

    /* ZenoVoice hook: a spoken reply just finished. */
    onSpeechDone: function(){
      if (!this.active) return;
      this._beats++;
      this._set("listening");
      var v = this._voice();
      var self = this;
      setTimeout(function(){
        if (!self.active) return;
        try { v.startListening(); } catch(e){ self.stop(true); }
      }, 600);
    },

    /* ZenoVoice hook: a listening turn ended with no usable text. */
    onQuietTurn: function(){
      if (!this.active) return;
      var v = this._voice();
      var self = this;
      this._set("listening");
      setTimeout(function(){
        if (!self.active) return;
        try { v.startListening(); } catch(e){ self.stop(true); }
      }, 400);
    },

    /* ZenoVoice hook: recognition failed hard (denied/network). */
    onVoiceError: function(){
      if (!this.active) return;
      this.stop(true);
    },

    /* Called when a voice turn's text is about to generate. */
    onThinking: function(){
      if (this.active) this._set("thinking");
    },

    /* Called when Zeno starts speaking a reply inside the loop. */
    onSpeaking: function(){
      if (this.active) this._set("speaking");
    },

    _render: function(){
      if (typeof document === "undefined") return;
      try {
        var btn = document.getElementById("converseBtn");
        if (btn){
          btn.classList.toggle("live", this.active);
          btn.textContent = this.active ? "⏹ Stop conversation" : "🔁 Conversation";
          btn.title = this.active
            ? "Stop continuous conversation mode"
            : "Continuous conversation: listen → answer → listen (tap to stop)";
        }
        var st = document.getElementById("converseState");
        if (st){
          st.textContent = this.active ? ("conversation mode · " + this._state) : "";
        }
      } catch(e){}
    },

    init: function(){ this._render(); }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ZenoConverse = api;
})();
