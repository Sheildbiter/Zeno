/* Zeno Live Chat v2 (2026-10-14) — Andrew's live-test feedback, implemented.
 *
 * 1. SPEED: streaming TTS ("speak as it thinks") — sentence chunker feeds
 *    speechSynthesis while tokens are still arriving. First spoken word in
 *    ~1s instead of after the whole reply.
 * 2. NAME RECOGNITION: post-transcription name-mapping — every mangled
 *    hearing of "Zeno" (xeno, zino, zulu-in-context, ...) is corrected to
 *    "Zeno" before it reaches the input box or the brain.
 * 3. NO CUTOFF ON PAUSES: longer silence tolerance in conversation mode,
 *    longer end-of-thought grace, and carry-over text when Andrew taps to
 *    continue the same thought. Thinking out loud stays one turn.
 * 4. ADAPTIVE BRAIN TIERS ("slap levels of brains"): trivial pleasantries
 *    route to the tiny Fast tier for near-instant replies; light asks stay
 *    on the already-hot brain (no "warming up" reload penalty); code and
 *    complex asks still get the Slow tier.
 * 5. SMARTER: voice-style system hint for spoken replies (compact,
 *    conversational, no lists/code in speech) + name reinforcement.
 *
 * Pure logic lives here and is Node-testable (test seam at the bottom).
 * The page (index.html) wires it into ZenoVoice / generate() / BrainRouter.
 *
 * Honest ceiling (unchanged from the plan): no true duplex in a web page.
 * The mic would hear Zeno's own speaker output; a page has no echo
 * cancellation control. This is the best Stage-1 pipeline possible.
 */
"use strict";

(function(){
  var root = (typeof window !== "undefined") ? window : globalThis;

  /* ============================================================
     2. NAME RECOGNITION — ZenoName.normalize(text)
     Returns { text, corrected, heard[] }.
     ============================================================ */
  var NAME_ALWAYS = [
    "xeno", "zino", "zeeno", "zenno", "seno", "zena",
    "xenno", "zzno"
  ];
  // Multi-word mishearings.
  var NAME_PHRASES = ["seen o", "see no", "see know", "say no", "zen no"];
  // Ambiguous alone ("zulu" is a real word) — only corrected as an address.
  var NAME_CONTEXTUAL = ["zulu", "zulu's", "zulus"];

  function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  var ZenoName = {
    variants: NAME_ALWAYS.concat(NAME_PHRASES, NAME_CONTEXTUAL),

    normalize: function(input){
      var text = String(input || "");
      var heard = [];
      var corrected = false;

      // Multi-word phrases first ("seen o" -> "Zeno").
      NAME_PHRASES.forEach(function(p){
        var re = new RegExp("\\b" + escRe(p) + "\\b", "gi");
        text = text.replace(re, function(m){
          corrected = true; heard.push(m);
          return "Zeno";
        });
      });

      // Whole-word variants, with optional possessive ('s).
      NAME_ALWAYS.forEach(function(v){
        var re = new RegExp("\\b" + escRe(v) + "('s)?\\b", "gi");
        text = text.replace(re, function(m, poss){
          corrected = true; heard.push(m);
          return poss ? "Zeno's" : "Zeno";
        });
      });

      // Contextual: "zulu" only when used as an address —
      // at the start of the utterance, or right after hey/hi/hello/yo/ok.
      var addrRe = /(^|[\s]+)(hey|hi|hello|yo|ok|okay|thanks|thank\s+you)\s+(zulu)('s)?\b|^(\s*)(zulu)('s)?\b/gi;
      text = text.replace(addrRe, function(m, sp1, greet, z1, p1, sp2, z2, p2){
        corrected = true; heard.push(m.trim());
        if (z2 !== undefined) return (sp2 || "") + "Zeno" + (p2 || "");
        return (sp1 || "") + greet + " Zeno" + (p1 || "");
      });

      return { text: text, corrected: corrected, heard: heard };
    }
  };

  /* ============================================================
     4. ADAPTIVE BRAIN TIERS — ZenoTiers.pick(text, activeBrain)
     Returns { tier, maxTokens, reason }.
     ============================================================ */
  var CODE_RE = /\b(code|coding|script|function|program|debug|javascript|typescript|python|html|css|swift|sql|algorithm|refactor|implement)\b|\b(write|build|make|create)\b[\s\S]{0,40}?\b(website|webpage|app|game|program|function|script|bot|minecraft)\b/i;
  var COMPLEX_RE = null; // built per-call (length-dependent)
  var TRIVIAL_RE = /^(hi|hey|hello|yo|sup|good\s+(morning|afternoon|evening)|thanks|thank\s+you|bye|ok|okay|cool|nice|lol|haha)[!.?,\s…]*$/i;
  var GREETING_RE = /^(hi|hey|hello|yo|sup|good\s+(morning|afternoon|evening)|how\s+are\s+you|what'?s\s+up|thanks|thank\s+you|bye)[!.?\s]*$/i;
  var QUICKFACT_RE = /^(who|what|when|where|how many|define|is|are|can|does|do)\b/i;
  var QUICKFACT_EXCLUDE = /\b(explain|why|how does|how do)\b/i;

  var ZenoTiers = {
    // max tokens per tier decision — trivial answers stay tiny and fast.
    TOKENS: { fast: 96, medium: 256, slow: 384 },

    pick: function(text, activeBrain){
      var t = String(text || "").trim();
      var low = t.toLowerCase();

      // Hard tasks always get full power — Andrew's rule.
      var complex = t.length > 300 ||
        (t.length > 170 && (((t.match(/[?]/g) || []).length > 1) ||
          /\b(compare|analyze|design|architecture|step[- ]by[- ]step|tradeoffs?)\b/i.test(t)));
      if (CODE_RE.test(t) || complex)
        return { tier: "slow", maxTokens: this.TOKENS.slow, reason: "code/complex" };

      // Trivial pleasantries: tiny + instant. Andrew's explicit override
      // (2026-10-14): for "hi", speed beats smarts — the 360M Fast tier is
      // fine for a one-line hello.
      if (t.length <= 28 && TRIVIAL_RE.test(t))
        return { tier: "fast", maxTokens: this.TOKENS.fast, reason: "trivial" };

      // Light asks stay on the already-hot brain: switching models costs a
      // "warming up" reload of several seconds — worse than any tier gap.
      var light = t.length <= 120 && !CODE_RE.test(t);
      if (light && activeBrain && /^(fast|medium|slow)$/.test(activeBrain))
        return { tier: activeBrain, maxTokens: this.TOKENS[activeBrain], reason: "stay-hot" };

      if (GREETING_RE.test(t) || (t.length <= 90 && QUICKFACT_RE.test(t) && !QUICKFACT_EXCLUDE.test(low)))
        return { tier: "medium", maxTokens: this.TOKENS.medium, reason: "greeting/quickfact" };
      return { tier: "medium", maxTokens: this.TOKENS.medium, reason: "default" };
    }
  };

  /* ============================================================
     1. STREAMING TTS — createChunker()
     Feed cumulative streamed text; get back complete sentences.
     ============================================================ */
  // A sentence ends at . ! ? … or a newline, when followed by whitespace/end
  // and the sentence is long enough to be worth speaking.
  var SENTENCE_END = /[.!?…\n]+(\s+|$)/;

  function createChunker(){
    var buf = "";
    var seen = ""; // full cumulative text consumed so far
    return {
      // Feed the CUMULATIVE streamed text (WebLLM onToken sends it all).
      // Returns an array of complete, speakable sentences.
      push: function(cumulativeText){
        var full = String(cumulativeText || "");
        if (full.length < seen.length || full.slice(0, seen.length) !== seen){
          // Stream restarted or replaced mid-flight (e.g. the
          // anti-repetition retry regenerates a different reply).
          seen = ""; buf = "";
        }
        buf += full.slice(seen.length);
        seen = full;
        var out = [];
        var m;
        while ((m = SENTENCE_END.exec(buf))){
          var end = m.index + m[0].length;
          var sentence = buf.slice(0, end).trim();
          buf = buf.slice(end);
          if (sentence.length >= 2) out.push(sentence);
        }
        // Safety: never let an unsplittable buffer grow forever (a model
        // mid-ramble). Flush long buffers as-is.
        if (buf.length > 400){
          out.push(buf.trim());
          buf = "";
        }
        return out;
      },
      flush: function(){
        var rest = buf.trim();
        buf = "";
        return rest.length >= 2 ? [rest] : [];
      },
      pending: function(){ return buf; }
    };
  }

  /* ============================================================
     3. PAUSE TOLERANCE — config + helpers
     ============================================================ */
  var PAUSE = {
    // Tap-to-talk single shots: still snappy.
    single:   { silenceMs: 9000,  graceMs: 800 },
    // Conversation mode: thinking out loud stays one turn.
    converse: { silenceMs: 20000, graceMs: 2500 }
  };

  function pauseConfig(converseActive){
    return converseActive ? PAUSE.converse : PAUSE.single;
  }

  /* ============================================================
     5. VOICE STYLE — system-prompt addition for spoken replies.
     ============================================================ */
  var VOICE_STYLE =
    "VOICE REPLY STYLE (hard): this reply will be SPOKEN ALOUD to Andrew. Keep it conversational and compact — " +
    "one to three short sentences for a simple turn. NEVER use bullet lists, numbered lists, tables, headings, or " +
    "code blocks in a spoken reply; if details matter, speak the short summary and put the details in the chat text " +
    "using plain sentences. Spell out anything the speech engine would mangle (no URLs, no /commands, no file paths).";

  var NAME_REINFORCE =
    "NAME NOTE: Andrew calls you Zeno. If he says a name that sounds like Zeno (xeno, zino, zulu, seen-o), he means you — " +
    "never ask who that is.";

  var api = {
    ZenoName: ZenoName,
    ZenoTiers: ZenoTiers,
    createChunker: createChunker,
    pauseConfig: pauseConfig,
    PAUSE: PAUSE,
    VOICE_STYLE: VOICE_STYLE,
    NAME_REINFORCE: NAME_REINFORCE,
    VERSION: "livechat2-20261014"
  };

  root.ZenoLiveChat2 = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
