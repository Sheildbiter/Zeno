/* ============================================================
   Zeno SelfReview — v0.19.2 + Trick 5 (the Upgrader's night shift).
   Proposal: ~/workspace/zeno/self-reviewing-zeno-proposal.md (2026-11-05).
   Bench-approved settings (Andrew, 2026-11-05): one card per morning
   (hard cap), morning card arrives as a CHAT message when Andrew opens
   Zeno, Andrew can read the raw daily log, 7-day live trial after the
   sandbox passes.

   What this module is: once a day, Zeno reads his own yesterday —
   errors and corrections, ranked by MEASURED pain — and drafts ONE
   proposal card in the Upgrader's exact shape (what broke, measured;
   what the bench would prove; what needs Andrew's word). A fix Andrew
   refused is never re-proposed: the refusal log is checked first.

   What it is NOT:
   - Not weight training. WebLLM is inference-only.
   - Not a live-answer loop. That is Trick 1 (double-check); this
     module never runs while Andrew is waiting for an answer.
   - Not a judge of narration. Only claims a deterministic checker
     can verify count as evidence.
   - Not self-pushing. Every card stops at Andrew's gate.

   Design notes (measured, from the v0.19.2 build — see bench report):
   - There is NO dream/housekeeping cycle in v0.19.2 (the proposal
     assumed one; the build has only a roadmap comment). The pass
     therefore runs at FIRST OPEN of the day, gated on no open
     conversation, and hands the engine back to the normal tier flow
     afterwards. It never runs while Andrew is chatting.
   - Ranking is deterministic arithmetic (count x severity, earliest
     first-seen breaks ties). The Fast tier WRITES the card prose;
     the measurement is never left to the model's vibes — a draft
     that lacks the measured numbers or a bench proof fails the
     shape check and escalates to Medium, then to the deterministic
     template. Slow never reviews.
   - Token cost is measured with the same chars/4 estimator the
     prompt-budget guard uses (see measurePass); on-device LLM
     latency can only be measured live, during the trial.

   Pure logic, Node-testable; the page wires it into the send-handler
   catch (logError), the brain-init catch (logError), and a guarded
   morning hook after restoreChatHistory().
   ============================================================ */
(function(root, factory){
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.ZenoSelfReview = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  "use strict";

  var DAILY_LOG_KEY = "zeno.selfreview.dailylog.v1";
  var REJECTION_LOG_KEY = "zeno.selfreview.rejections.v1";
  var LAST_PASS_KEY = "zeno.selfreview.lastpass.v1";
  var MAX_LOG_ENTRIES = 500;          // bounded by the day, not by history
  var ONE_CARD_PER_MORNING = 1;       // hard cap — Andrew's setting
  var IDLE_HOURS = 6;                 // "no open conversation" = last turn older than this
  var MAX_DRAFT_CHARS = 1200;         // a morning card stays short

  /* Severity = how bad it was when it reached Andrew. Measured pain
     is count x severity; a crash that reached Andrew outranks a
     quiet retry. Severities are fixed constants, never vibes. */
  var SEVERITY = {
    prompt_overflow: 5,     // answer died on a too-long prompt
    webgpu_init: 5,         // brain could not start at all
    tool_misfire: 4,        // an installed tool could not fire as code
    generic_generation: 3,  // generation failed, friendly error shown
    correction: 3,          // Andrew corrected Zeno
    version_drift: 2,       // cosmetic: version strings disagreed
    unknown: 2
  };

  /* Measured cause + bench proof per failure kind. The numbers come
     from the entry itself; the bench proof names the test that must
     pass. A kind with no entry here falls back to the generic proof —
     never a vibe. */
  var KIND_KNOWLEDGE = {
    prompt_overflow: {
      cause: function(e){
        return "Prompt measured " + (e.tokens || "?") + " tokens against a " +
          (e.window || 2048) + "-token window. The chars/4 estimate undercounted it" +
          " (2106 actual vs at most 1843 estimated on 2026-10-20), and the guard let" +
          " a still-too-fat prompt through.";
      },
      bench: function(e){
        return "A synthetic " + (e.tokens || "2106") + "-token Slow prompt must trim to fit" +
          " (test-promptbudget.js); a base-prompt-only overflow must produce the honest" +
          " error, never the raw throw.";
      }
    },
    tool_misfire: {
      cause: function(e){
        return "An installed, approved tool (" + (e.detail || "d20roll") + ") was invoked" +
          " by name and did not fire as code — the turn fell into full generation instead.";
      },
      bench: function(e){
        return "The named tool must fire as code with no brain (test-toolrouter-learned.js);" +
          " a \"" + (e.detail || "D20roll.") + "\" turn must never reach generation.";
      }
    },
    webgpu_init: {
      cause: function(e){
        return "The brain could not start: Safari could not reach the iPad's graphics chip" +
          (e.detail ? " (" + e.detail + ")" : "") + ".";
      },
      bench: function(e){
        return "Brain fails to initialize → friendly steps (close tabs → quit Safari → retry" +
          " → restart iPad → real Safari), never the raw throw (test-friendlyerrors-ui.js).";
      }
    },
    version_drift: {
      cause: function(e){
        return "Version strings disagreed on one page" +
          (e.detail ? " (" + e.detail + ")" : "") + " — one home for the version number was broken.";
      },
      bench: function(e){
        return "Title, header, changelog and manifest must agree on one version constant" +
          " (test-version-ui.js).";
      }
    },
    generic_generation: {
      cause: function(e){
        return "Generation failed and Andrew got the friendly error instead of an answer" +
          (e.detail ? " (" + e.detail + ")" : "") + ".";
      },
      bench: function(e){
        return "Reproduce the failing turn in the sandbox; the friendly error must carry a" +
          " next action, never the raw throw.";
      }
    },
    correction: {
      cause: function(e){
        return "Andrew corrected Zeno: " + (e.detail || "(no detail recorded)") + ".";
      },
      bench: function(e){
        return "Zeno must go 7 days without repeating the corrected mistake (arsenal Trick 3 bar).";
      }
    }
  };

  /* Correction detector — narrow on purpose. A false positive only
     adds a log entry; it never changes an answer. The page calls it
     once per user message; the full message is kept as the correction
     (what Andrew said IS the correction). */
  var CORRECTION_RES = [
    /^\s*(no|nope|wrong|incorrect)[,!.]?\s+\S/i,
    /^\s*(that's|that is|thats)\s+(wrong|not right|incorrect)\b/i,
    /\byou('re| are) wrong\b/i,
    /^\s*i meant\b/i,
    /\bshould have (said|been|done|told)\b/i
  ];
  function looksLikeCorrection(text){
    var t = String(text || "");
    for (var i = 0; i < CORRECTION_RES.length; i++) if (CORRECTION_RES[i].test(t)) return true;
    return false;
  }

  /* ---------- storage (injected for tests; window.ZenoStorage live) ---------- */
  function defaultStore(){
    try {
      if (typeof window !== "undefined" && window.ZenoStorage) return window.ZenoStorage;
      if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    } catch(e){}
    return null;
  }
  function memoryStore(){
    var m = Object.create(null);
    return {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function(k, v){ m[k] = String(v); },
      removeItem: function(k){ delete m[k]; }
    };
  }
  function loadEntries(store, key){
    var raw = null, data = null;
    try { raw = store.getItem(key); } catch(e){ raw = null; }
    try { data = raw ? JSON.parse(raw) : null; } catch(e){ data = null; }
    if (data && typeof data === "object" && Array.isArray(data.entries)) return data.entries;
    return [];
  }
  function saveEntries(store, key, entries){
    try { store.setItem(key, JSON.stringify({ version: 1, entries: entries })); }
    catch(e){ /* a failed save never breaks chat; the pass just has less to read */ }
  }

  function todayStr(d){
    var t = d instanceof Date ? d : new Date();
    function p(n){ return (n < 10 ? "0" : "") + n; }
    return t.getFullYear() + "-" + p(t.getMonth() + 1) + "-" + p(t.getDate());
  }
  function slug(s){
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "unnamed";
  }
  /* Same calibrated estimator the prompt-budget guard uses (chars/4).
     A measurement, not a guess — and labelled as an estimate. */
  function estimateTokens(s){ return Math.ceil(String(s || "").length / 4); }

  function classifyError(err){
    var msg = "", code = "";
    try {
      if (err && typeof err === "object"){
        msg = String(err.message || err.text || "");
        code = String(err.code || "");
      } else { msg = String(err || ""); }
    } catch(e){ msg = ""; }
    var m = msg.match(/(\d{3,})\s*(?:tokens?)?\s*(?:>|exceed|over)/i) ||
            msg.match(/(\d{3,})\s*>\s*(\d{3,4})/);
    var tokens = m ? Number(m[1]) : null;
    var window = (m && m[2]) ? Number(m[2]) : 2048;
    if (code === "ZENO_PROMPT_TOO_LONG" || /prompt|context|exceed|too long|token/i.test(msg) && !/tokenizer/i.test(msg))
      return { kind: "prompt_overflow", tokens: tokens, window: window, detail: msg.slice(0, 120) || "prompt overflow" };
    if (/webgpu|compatible gpu|adapter|requestdevice|initialization failed/i.test(msg))
      return { kind: "webgpu_init", detail: msg.slice(0, 120) || "brain init failure" };
    if (/tool|d20roll|learned/i.test(msg))
      return { kind: "tool_misfire", detail: msg.slice(0, 120) || "tool misfire" };
    return { kind: "generic_generation", detail: msg.slice(0, 120) || "generation failure" };
  }

  function makeApi(store){
    store = store || defaultStore() || memoryStore();

    function readLog(key){ return loadEntries(store, key); }

    /* Collect: append-only for the day; same kind+detail aggregates
       (count++, lastSeen) so a repeated failure ranks by measured pain.
       Bounded at MAX_LOG_ENTRIES aggregated entries — the day is the bound. */
    function logEntry(kind, detail, extra){
      kind = SEVERITY.hasOwnProperty(kind) ? kind : "unknown";
      var entries = readLog(DAILY_LOG_KEY);
      var now = Date.now();
      var found = null;
      for (var i = 0; i < entries.length; i++){
        if (entries[i].kind === kind && entries[i].detail === String(detail || "")){ found = entries[i]; break; }
      }
      if (found){
        found.count = (found.count || 1) + 1;
        found.lastSeen = now;
        if (extra && extra.tokens) found.tokens = extra.tokens;
      } else {
        entries.push({
          id: "e" + now.toString(36) + entries.length,
          kind: kind,
          detail: String(detail || ""),
          tokens: (extra && extra.tokens) || null,
          window: (extra && extra.window) || null,
          count: 1,
          firstSeen: now,
          lastSeen: now
        });
        if (entries.length > MAX_LOG_ENTRIES) entries.splice(0, entries.length - MAX_LOG_ENTRIES);
      }
      saveEntries(store, DAILY_LOG_KEY, entries);
      return entries.length;
    }
    function logError(c){
      c = c || {};
      return logEntry(c.kind || "unknown", c.detail || "", { tokens: c.tokens, window: c.window });
    }
    function logCorrection(what, rightBehavior){
      return logEntry("correction", String(what || "") + " → right behavior: " + String(rightBehavior || ""));
    }
    /* Refusal log: append-only, never auto-pruned. A refused fix is
       never re-proposed — checked before every draft. */
    function logRefusal(fixId, reason){
      var entries = readLog(REJECTION_LOG_KEY);
      entries.push({ fixId: String(fixId), reason: String(reason || ""), at: Date.now() });
      saveEntries(store, REJECTION_LOG_KEY, entries);
      return entries.length;
    }
    function isRefused(fixId){
      var entries = readLog(REJECTION_LOG_KEY);
      for (var i = 0; i < entries.length; i++) if (entries[i].fixId === String(fixId)) return true;
      return false;
    }
    function fixIdFor(entry){
      return entry.kind + "-" + slug(entry.detail).slice(0, 40);
    }

    /* Rank: measured pain = count x severity; ties break by earliest
       first-seen (the first failure of the day outranks a later twin). */
    function rankFailures(entries){
      return entries.slice().map(function(e){
        var pain = (e.count || 1) * (SEVERITY[e.kind] || SEVERITY.unknown);
        return { entry: e, pain: pain, fixId: fixIdFor(e) };
      }).sort(function(a, b){
        if (b.pain !== a.pain) return b.pain - a.pain;
        return (a.entry.firstSeen || 0) - (b.entry.firstSeen || 0);
      });
    }

    /* Draft: the Upgrader's exact card shape, from measured numbers.
       The LLM writes prose; this template is the deterministic
       fallback and the shape the LLM draft is checked against. */
    function draftCard(ranked){
      var e = ranked.entry;
      var k = KIND_KNOWLEDGE[e.kind] || KIND_KNOWLEDGE.generic_generation;
      var cause = k.cause(e);
      var bench = k.bench(e);
      return {
        fixId: ranked.fixId,
        kind: e.kind,
        count: e.count || 1,
        pain: ranked.pain,
        whatBroke: "What broke (measured): " + cause +
          " It happened " + (e.count || 1) + " time" + ((e.count || 1) === 1 ? "" : "s") +
          " yesterday" + (e.tokens ? " (" + e.tokens + " tokens measured)." : "."),
        benchProof: "What the bench would prove: " + bench,
        needsWord: "What needs Andrew's word: approve this fix and I will build it in the sandbox" +
          " and prove it with the test above — or say no and I will log the refusal and never ask again.",
        tierUsed: "template"
      };
    }
    /* Shape check: all three Upgrader sections present, a measurement
       (a number) present, bench proof present, fix id present. */
    function shapeCheck(card){
      if (!card || typeof card !== "object") return false;
      if (!card.whatBroke || !card.benchProof || !card.needsWord) return false;
      if (!card.fixId) return false;
      if (!/\d/.test(card.whatBroke)) return false;   // no measurement = a vibe, not a card
      if (!/test-|bench|prove/i.test(card.benchProof)) return false;
      return true;
    }
    function formatCardMessage(card){
      return "☀️ Morning self-review — one thing from yesterday:\n\n" +
        card.whatBroke + "\n\n" + card.benchProof + "\n\n" + card.needsWord;
    }

    /* A string draft is split on the three Upgrader section markers.
       If any section is missing, the draft fails and escalates — the
       template fallback guarantees a valid card, never a half-card. */
    function parseDraftString(s){
      var text = String(s || "");
      function section(re, nextRes){
        var m = text.match(re);
        if (!m) return null;
        var start = m.index + m[0].length;
        var end = text.length;
        for (var i = 0; i < nextRes.length; i++){
          var nm = text.slice(start).match(nextRes[i]);
          if (nm) end = Math.min(end, start + nm.index);
        }
        return text.slice(start, end).trim();
      }
      var brokeRe = /what broke/i, benchRe = /bench|prove/i, wordRe = /andrew'?s word|needs andrew/i;
      var whatBroke = section(brokeRe, [benchRe, wordRe]);
      var benchProof = section(benchRe, [wordRe]);
      var needsWord = section(wordRe, []);
      if (!whatBroke || !benchProof || !needsWord) return null;
      return { whatBroke: whatBroke, benchProof: benchProof, needsWord: needsWord };
    }

    /* Should the pass run at this open? Never while Andrew is chatting
       (generating, or a turn in the last IDLE_HOURS), never twice in
       one day. */
    function shouldRunMorningPass(opts){
      opts = opts || {};
      if (opts.generating) return { run: false, reason: "generation in flight" };
      var conv = opts.conversation || [];
      if (conv.length){
        var last = conv[conv.length - 1];
        var lastTs = (last && Number(last.ts)) || 0;
        if (Date.now() - lastTs < IDLE_HOURS * 3600 * 1000)
          return { run: false, reason: "conversation open (last turn < " + IDLE_HOURS + "h ago)" };
      }
      var lastPass = null;
      try { lastPass = store.getItem(LAST_PASS_KEY); } catch(e){}
      if (lastPass === todayStr(opts.now)) return { run: false, reason: "already ran today" };
      return { run: true, reason: "first open of the day, no open conversation" };
    }

    /* The morning pass. generate(tier, prompt) is injected: the page
       passes the real engine call (Fast, then Medium on shape failure);
       the sandbox passes a stub or nothing (deterministic template).
       Slow is never requested — enforced here, not by convention. */
    async function runMorningPass(opts){
      opts = opts || {};
      var started = Date.now();
      var entries = readLog(DAILY_LOG_KEY);
      if (!entries.length) return { card: null, reason: "no failures logged yesterday", tierUsed: "none", tokens: 0, wallMs: Date.now() - started };
      var ranked = rankFailures(entries);
      var picked = null;
      for (var i = 0; i < ranked.length; i++){
        if (!isRefused(ranked[i].fixId)){ picked = ranked[i]; break; }
      }
      if (!picked) return { card: null, reason: "every failure already refused — nothing to propose", tierUsed: "none", tokens: 0, wallMs: Date.now() - started };

      var prompt = "You are Zeno's self-review. Yesterday's worst failure, measured:\n" +
        "kind=" + picked.entry.kind + ", count=" + (picked.entry.count || 1) +
        ", pain=" + picked.pain + ", detail=" + picked.entry.detail +
        (picked.entry.tokens ? ", tokens=" + picked.entry.tokens : "") + ".\n" +
        "Draft ONE proposal card in exactly three sections: (1) what broke, with the measured numbers;" +
        " (2) what the bench would prove, naming the test; (3) what needs Andrew's word." +
        " Keep it under " + MAX_DRAFT_CHARS + " characters. No vibes, no new features.";
      var generate = opts.generate;
      var card = null, tierUsed = "template", tokens = 0;
      tokens += estimateTokens(prompt);
      if (typeof generate === "function"){
        var tiers = ["fast", "medium"];   // Slow never reviews — not in this list
        for (var t = 0; t < tiers.length; t++){
          try {
            var draft = await generate(tiers[t], prompt);
            tokens += estimateTokens(typeof draft === "string" ? draft : JSON.stringify(draft));
            var cand = null;
            if (typeof draft === "string"){
              var parsed = parseDraftString(draft);
              if (parsed) cand = { fixId: picked.fixId, kind: picked.entry.kind, count: picked.entry.count || 1,
                pain: picked.pain, whatBroke: parsed.whatBroke, benchProof: parsed.benchProof,
                needsWord: parsed.needsWord, tierUsed: tiers[t] };
            } else if (draft && typeof draft === "object"){
              cand = { fixId: picked.fixId, kind: picked.entry.kind, count: picked.entry.count || 1,
                pain: picked.pain, whatBroke: draft.whatBroke, benchProof: draft.benchProof,
                needsWord: draft.needsWord, tierUsed: tiers[t] };
            }
            if (cand && shapeCheck(cand)){ card = cand; tierUsed = tiers[t]; break; }
          } catch(e){ /* a failed tier escalates; a failed Medium falls through to template */ }
        }
      }
      if (!card){
        card = draftCard(picked);
        tokens += estimateTokens(card.whatBroke + card.benchProof + card.needsWord);
      }
      try { store.setItem(LAST_PASS_KEY, todayStr(opts.now)); } catch(e){}
      return { card: card, reason: "card drafted", tierUsed: tierUsed,
        tokens: tokens, wallMs: Date.now() - started };
    }

    /* Andrew-readable raw logs — his data, same standing as memory. */
    function readDailyLog(){ return readLog(DAILY_LOG_KEY); }
    function readRejectionLog(){ return readLog(REJECTION_LOG_KEY); }

    return {
      DAILY_LOG_KEY: DAILY_LOG_KEY, REJECTION_LOG_KEY: REJECTION_LOG_KEY,
      LAST_PASS_KEY: LAST_PASS_KEY, MAX_LOG_ENTRIES: MAX_LOG_ENTRIES,
      ONE_CARD_PER_MORNING: ONE_CARD_PER_MORNING, SEVERITY: SEVERITY,
      estimateTokens: estimateTokens, classifyError: classifyError,
      looksLikeCorrection: looksLikeCorrection,
      logError: logError, logCorrection: logCorrection,
      logRefusal: logRefusal, isRefused: isRefused, fixIdFor: fixIdFor,
      rankFailures: rankFailures, draftCard: draftCard, shapeCheck: shapeCheck,
      parseDraftString: parseDraftString, formatCardMessage: formatCardMessage,
      shouldRunMorningPass: shouldRunMorningPass, runMorningPass: runMorningPass,
      readDailyLog: readDailyLog, readRejectionLog: readRejectionLog,
      todayStr: todayStr
    };
  }

  var api = makeApi();
  api._makeApi = makeApi;   // tests build isolated instances with a fresh store
  return api;
});
