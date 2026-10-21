/* ============================================================
   Zeno ToolRouter — v0.14 (agent router, step 1 of Andrew's build order:
   agent router → ASCII eyes → live chat).

   What "agent" means here: Zeno can use tools and do multi-step tasks,
   not just chat. This module provides:

   1. PERMISSIONS — an explicit allowlist. Every tool is "auto"
      (runs freely), "confirm" (Andrew taps yes/no first), or anything
      else is "deny" (the model can never invoke it).
   2. route(text) — runs BEFORE BrainRouter.pick. Unambiguous safe-tool
      turns ("12*8+3", "what time is it", "remember that ...") skip the
      brain entirely: no model warmup, instant answer.
   3. agentLoop() — the multi-step tool-calling loop the model drives:
      TOOL call → run → result back in → TOOL call → … (max 4 calls),
      with permission enforcement on every step.

   Safety (non-negotiable — Andrew is 14, this runs on his iPad):
   - Tools are local, reversible, and safe. No purchases, no account
     creation, no network exfiltration, no publishing. Ever.
   - Consequential actions (scheduling a future reminder, deleting)
     ALWAYS need his explicit yes/no tap first.
   - Pure logic here — no DOM — so Node can test every path.

   Andrew's controlled self-upgrade rule: this tool was sandbox-tested;
   it ships only because the tests pass.
   ============================================================ */
(function(){
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;

  /* ------------------------------------------------------------
     1. PERMISSION MODEL
     auto    — safe, local, instantly reversible. Runs freely.
     confirm — consequential (a future interruption, a deletion).
               Andrew taps yes/no via the existing pending flow.
     deny    — anything not listed. The model can never call it.
     ------------------------------------------------------------ */
  var PERMISSIONS = {
    calc:          "auto",    // arithmetic — pure function, no side effects
    datetime:      "auto",    // reads the device clock
    memory_search: "auto",    // reads his own memory store
    memory_save:   "auto",    // appends to his memory (reversible via "forget")
    notes:         "auto",    // save/list/search notes — local, reversible
    web_lookup:    "auto",    // existing visible research flow (sources shown)
    reminder_set:  "confirm"  // schedules a FUTURE interruption — his tap first
    // note: note deletion and memory forgetting stay on the regex path
    // (ZenoTools), which already confirms. The model path never deletes.
  };

  function permissionOf(name){
    return PERMISSIONS[String(name || "")] || "deny";
  }

  /* ------------------------------------------------------------
     2. route(text) — BEFORE BrainRouter.pick.
     Returns { mode: "tool-only", call: { name, args } } for turns a
     safe local tool answers completely (no brain needed — instant),
     or { mode: "chat" } for everything else (existing pipeline).

     Conservative on purpose: only unambiguous patterns skip the
     brain. A miss just means the normal (slower) path handles it.
     ------------------------------------------------------------ */
  var ARITH_RE = /^[\d\s+\-*/().%^]+$/;
  var HAS_DIGIT = /\d/;
  var HAS_OP = /[+\-*/%^]/;
  var DATETIME_RE = /^(what time is it|what's the time|whats the time|what day is it|what's today's date|whats todays date|today's date|what is the date)\??$/i;
  var REMEMBER_RE = /^(?:please\s+)?remember\s+(that\s+)?(.{2,400})$/i;
  var RECALL_GUARD_RE = /^remember\s+(what|which|when|who|how|where)\b/i; // "remember what I told you" = recall, not save

  function route(text, opts){
    var t = String(text || "").trim();
    if (!t) return { mode: "chat" };

    // Pure arithmetic: "12*8+3" — the safe parser runs it, no eval ever.
    if (ARITH_RE.test(t) && HAS_DIGIT.test(t) && HAS_OP.test(t) && t.length <= 120){
      return { mode: "tool-only", call: { name: "calc", args: { expression: t } } };
    }
    // Clock questions.
    if (DATETIME_RE.test(t)){
      return { mode: "tool-only", call: { name: "datetime", args: {} } };
    }
    // "remember that my sword is 24 inches" — but never recall phrasing.
    if (!RECALL_GUARD_RE.test(t)){
      var m = t.match(REMEMBER_RE);
      if (m && m[2] && m[2].trim().length > 1){
        return { mode: "tool-only", call: { name: "memory_save", args: { text: m[2].trim() } } };
      }
    }
    // v0.19.2: learned tools (installed via propose -> approve) route
    // BEFORE the brain too — see routeLearned below. Callers pass the
    // installed defs in opts; without them this stays a no-op.
    if (opts && opts.learnedDefs && opts.learnedDefs.length){
      var lr = routeLearned(t, opts.learnedDefs, opts.learnedMatcher);
      if (lr.mode === "tool-only") return lr;
    }
    return { mode: "chat" };
  }

  /* ------------------------------------------------------------
     2b. routeLearned(text, defs, matcher) — v0.19.2.

     Why this exists (2026-10-20): Andrew invoked his installed tool
     by name — "D20roll." — and because nothing matched learned tools
     before generation, the turn fell into full Slow generation and
     died on a prompt overflow (2305 tokens). A learned tool is
     deterministic, data-only, and already approved: it must fire
     instantly, with NO brain — even if the brain engine is down.

     Matching, in order:
       1. trigger regex (ZenoToolProposals.matchLearned) — the
          primary path; it also captures the groups the tool's
          templates substitute from.
       2. the tool's NAME as a whole word ("D20roll.", "use
          d20roll") — naming an installed tool IS invoking it. If
          the trigger then can't run on that text, the page answers
          with learnedGuidance() instead of the brain.
     matcher is injectable for tests; the default uses the real
     ZenoToolProposals matcher when present.
     ------------------------------------------------------------ */
  function defaultLearnedMatcher(def, text){
    try { return !!(root.ZenoToolProposals && root.ZenoToolProposals.matchLearned(def, text)); }
    catch (e){ return false; }
  }

  function containsWord(hay, needle){
    var idx = hay.indexOf(needle);
    while (idx !== -1){
      var before = idx === 0 ? "" : hay.charAt(idx - 1);
      var after = idx + needle.length >= hay.length ? "" : hay.charAt(idx + needle.length);
      if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)) return true;
      idx = hay.indexOf(needle, idx + 1);
    }
    return false;
  }

  function routeLearned(text, defs, matcher){
    var t = String(text || "").trim();
    if (!t || !defs || !defs.length) return { mode: "chat" };
    var match = typeof matcher === "function" ? matcher : defaultLearnedMatcher;
    var i, def;
    for (i = 0; i < defs.length; i++){
      def = defs[i];
      var hit = false;
      try { hit = !!match(def, t); } catch (e){ hit = false; }
      if (hit) return { mode: "tool-only", learned: def, via: "trigger" };
    }
    var low = t.toLowerCase();
    for (i = 0; i < defs.length; i++){
      def = defs[i];
      var name = String(def.name || "").toLowerCase();
      if (name.length >= 3 && containsWord(low, name)){
        return { mode: "tool-only", learned: def, via: "name" };
      }
    }
    return { mode: "chat" };
  }

  /* What the page says when a tool was invoked by name but its
     trigger needs the pattern form to actually run. */
  function learnedGuidance(def){
    return "That's my learned tool \"" + def.name + "\" — it kicks in when you say things " +
      "matching " + def.trigger + ". Try it in that shape and it fires instantly.";
  }

  /* Human-readable summary for the yes/no confirmation prompt. */
  function describeConfirm(name, args){
    args = args || {};
    if (name === "reminder_set"){
      var mins = Math.max(1, parseInt(args.inMinutes, 10) || 0);
      var when = mins >= 60
        ? ("in " + (Math.round(mins / 60 * 10) / 10) + " hours")
        : ("in " + mins + " minutes");
      return "set a reminder \"" + String(args.what || "…").slice(0, 120) + "\" " + when;
    }
    return "do that";
  }

  /* ------------------------------------------------------------
     3. agentLoop(opts) — the multi-step tool-calling loop.
     opts: { brain, request, parse, strip, tools, webLookup }
       brain    — { respond(req) } (WebLLMBrainRuntime or a test stub)
       request  — { text, conversation, ... } (onToken = streaming paint)
       parse    — text -> { name, args } | null  (ZenoAgent.parseToolCall)
       strip    — removes TOOL lines from displayed text
       tools    — { name: { run(args)->{ok,text,chip,memoriesSaved?}, label } }
       webLookup(query, pass) -> result  (existing visible research flow)

     Each iteration: model emits TOOL line → permission check →
     run → result fed back → model continues. Stops at a non-tool
     answer, a denied tool, a confirmation gate, or MAX_TOOL_CALLS.
     ------------------------------------------------------------ */
  var MAX_TOOL_CALLS = 4;

  async function agentLoop(opts){
    var brain = opts.brain, request = opts.request || {};
    var parse = opts.parse, strip = opts.strip, tools = opts.tools;

    // Pass 1: normal generation with the tool protocol active. TOOL lines
    // are filtered from the live-painted bubble so the draft never flashes.
    var paint = request.onToken;
    var pass = await brain.respond(Object.assign({}, request, {
      toolProtocol: true,
      onToken: paint ? (function(t){ paint(strip(t)); }) : undefined
    }));

    var chips = [];
    var memoriesSaved = 0;
    var calls = 0;

    for (;;){
      var call = null;
      try { call = parse(pass.text || ""); } catch(e){ call = null; }
      if (!call || calls >= MAX_TOOL_CALLS) break;

      // web_lookup reuses the visible research flow (own bubble + sources),
      // exactly as before — checked before the permission table.
      if (call.name === "web_lookup"){
        return opts.webLookup(call.args.query, pass);
      }
      var perm = permissionOf(call.name);
      if (perm === "deny" || !tools[call.name] || typeof tools[call.name].run !== "function"){
        break; // unknown tool: never invent, just answer from what we have
      }
      if (perm === "confirm"){
        var summary = describeConfirm(call.name, call.args);
        return {
          text: "Just to be safe — you want me to " + summary +
                "? Say yes to go ahead, or no to cancel.",
          toolNote: chips.length ? chips.join(" ") : null,
          memoriesSaved: memoriesSaved,
          brainTier: pass.brainTier, retried: pass.retried,
          pendingConfirm: { summary: summary, name: call.name, args: call.args }
        };
      }

      // auto: run it.
      var res;
      try { res = await tools[call.name].run(call.args || {}); }
      catch(e){ res = { ok: false, text: "That didn't work (" + (e && e.message || e) + "). Nothing changed." }; }
      calls++;
      if (res && res.chip) chips.push(res.chip);
      if (res && res.memoriesSaved) memoriesSaved += res.memoriesSaved;

      // Feed the result back; the model continues in its own words.
      // toolProtocol stays true so it can chain another tool if needed.
      var history2 = (request.conversation || []).concat([
        { role: "zeno", text: "[used tool: " + call.name + "]" },
        { role: "user", text: "TOOL RESULT (" + (tools[call.name].label || call.name) + "): " + (res ? res.text : "") }
      ]);
      pass = await brain.respond(Object.assign({}, request, {
        conversation: history2, toolProtocol: true, onToken: undefined
      }));
    }

    return {
      text: strip(pass.text || ""),
      toolNote: chips.length ? chips.join(" ") : null,
      memoriesSaved: memoriesSaved,
      brainTier: pass.brainTier, retried: pass.retried
    };
  }

  var api = {
    PERMISSIONS: PERMISSIONS,
    permissionOf: permissionOf,
    route: route,
    routeLearned: routeLearned,
    learnedGuidance: learnedGuidance,
    describeConfirm: describeConfirm,
    agentLoop: agentLoop,
    MAX_TOOL_CALLS: MAX_TOOL_CALLS,
    VERSION: "toolrouter-20261020"
  };

  root.ZenoToolRouter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
