/* ============================================================
   Zeno PromptBudget — v0.19.1 (Fast-brain prompt overflow fix),
   v0.19.2 (hard token cap, calibrated measurement).

   Root cause (real user-facing bug, reported 2026-10-15): Andrew typed
   "you should learn to roll a twenty-sided die." and the Fast brain
   (SmolLM2-360M, 2048-token context window) threw "Prompt tokens exceed
   context window size: 2114 > 2048". The v0.19 TOOL_PROTOCOL/PROPOSE
   teaching blocks, on top of v0.15's prompt growth, pushed the Fast-tier
   system prompt past the tiny brain's whole window — it literally could
   not hold its own instructions.

   Three fixes, all in this module (pure logic, Node-testable; the page
   wires them into BrainRouter.pick and WebLLMBrainRuntime.respond):

   1. TIER-SCOPED PROMPTS — toolBlockForTier(): Fast gets ONE line
      (FAST_LEARN_LINE) instead of the full TOOL_PROTOCOL teaching block.
      Medium/Slow keep the full protocol. Fast never needed to emit TOOL
      lines anyway: pattern-matched tools run before the LLM.

   2. LEARN-REQUEST ESCALATION — escalateForLearnRequest(): a detected
      "you should learn to X" never runs on Fast. A learning conversation
      needs the bigger brain anyway, and the appended learn prompt is what
      overflowed the window.

   3. PROMPT-BUDGET GUARD — checkBudget(): before generation, estimate
      prompt tokens; over the cap, escalate a tier; on Slow, the page
      trims chat history oldest-first. One honest error only if even that
      can't fit — never a raw WebLLM "exceeds context window" throw.

   ------------------------------------------------------------
   v0.19.2 — why the v0.19.1 guard still leaked (2026-10-20, twice in
   one morning: 2106 and 2305 REAL tokens vs the 2048 window):

   - The guard estimated chars/4. The real prompt is not average prose:
     memory lines carry date prefixes and punctuation and tokenize at
     ~0.33-0.35 tokens/char on these models, so a memory-heavy prompt
     ran ~14%+ hotter than the estimate. The guard said "ok" (its
     estimate was <= 1843); WebLLM counted 2106 and threw — raw — at
     Andrew. The second throw (2305) came from invoking an installed
     tool by name, which routed into full generation (fixed in the
     tool router: learned tools now fire before the brain, v0.19.2).
   - The guard loop also stopped after 3 rounds and sent anyway, and
     trimming only ever touched history — never the memory block, the
     callbacks, or the tool block.

   What v0.19.2 does instead:

   a) MEASURE WITH CALIBRATED FACTORS, not chars/4. WebLLM 0.2.82's
      MLCEngine exposes NO public tokenizer (verified 2026-10-20: the
      Tokenizer object lives inside the internal pipeline class; the
      engine object returned by CreateMLCEngine has no accessor and no
      encode()). So the factors below were measured in the sandbox
      against the REAL tokenizers of all three tier models (pulled from
      the mlc-ai HuggingFace repos, 2026-10-20), over the page's actual
      prompt components (BASE_SYSTEM_PROMPT, TOOL_PROTOCOL, memory
      blocks, history, learn block) and full assembled scenarios. On
      every measured assembly the estimate came out 4.6%-8.0% ABOVE the
      real count — biased high on purpose: an over-estimate costs a
      little trimming; an under-estimate costs a raw throw.

        tokens/char (measured real range -> shipped factor)
        component          fast        medium      slow
        system text        .226-.247   .229-.240   .226-.233 -> .25 / .245 / .24
        memory lines       .329-.347   .342        .329      -> .36 / .355 / .34
        chat + learn text  .207-.263   .207-.257   .219-.243 -> .28 / .27 / .26
        chat template      ~5.9/msg    ~5.5/msg    ~5.4/msg  -> 6/msg + 8 fixed

   b) TWO CAPS. Soft cap = window - 256 (the largest reply any chat
      request asks for): the trim ladder targets it, so a fitted prompt
      always leaves the full reply room. Hard cap = window - 64: if the
      ladder is exhausted but the bare prompt still fits under the hard
      cap, generation proceeds with a short reply rather than an error.
      Only a prompt that can't fit under the HARD cap produces the one
      honest error (makeTooLongError) — still never a raw throw.

   c) THE TRIM LADDER (advanceTrim) — fixed order, no round cap:
      history oldest-first (newest turn always kept) -> memory
      callbacks -> emotion line -> relevant memories oldest-first ->
      facts oldest-first (facts are the most valuable, so they go
      last) -> shortened tool block. The loop ends when the measured
      count fits or nothing trimmable remains.

   d) A LAST-RESORT NET in the page's _complete/_streamComplete: any
      other generation path (research, imagine helpers) is measured
      with the same counter before the engine is touched; over the
      hard cap it throws the honest error, never WebLLM's raw text.

   Andrew's rule, unchanged: Zeno proposes, Andrew approves.
   ============================================================ */
(function(){
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;

  /* LEGACY heuristic (v0.19.1): ~4 characters per token. Retained only
     for compatibility — the guard no longer uses it. It undercounts
     memory-heavy prompts by ~14%+; that is exactly how the 2026-10-20
     overflows leaked. New code must use measureText/measureMessages. */
  function estimateTokens(text){
    var s = String(text == null ? "" : text);
    return Math.ceil(s.length / 4);
  }

  /* Per-tier context windows. Must match ENGINE_OPTS.context_window_size
     in the page (2048 for every tier as of v0.19.2). */
  var TIER_CONTEXT = { fast: 2048, medium: 2048, slow: 2048 };

  /* Calibrated tokens-per-char factors (sandbox-measured 2026-10-20
     against the real model tokenizers — see header). Kinds:
     "sys"  — system-prompt prose (BASE_SYSTEM_PROMPT, TOOL_PROTOCOL)
     "mem"  — memory lines + callbacks (date prefixes, punctuation)
     "chat" — history turns, the user's message, the learn block */
  var CALIBRATION = {
    fast:   { sys: 0.25,  mem: 0.36,  chat: 0.28 },
    medium: { sys: 0.245, mem: 0.355, chat: 0.27 },
    slow:   { sys: 0.24,  mem: 0.34,  chat: 0.26 },
    perMessage: 6,   // chat-template role markers per message (measured 5.4-5.9)
    fixed: 8         // BOS + generation-prompt scaffolding
  };

  /* Reply space: the soft cap reserves the full max reply (256 =
     GEN_OPTS.max_tokens, the most any chat request asks for); the hard
     cap still guarantees a minimal 64-token reply. */
  var OUTPUT_RESERVE = 256;
  var HARD_RESERVE = 64;

  function softCap(tier, reserve){
    var win = TIER_CONTEXT[tier] || 2048;
    var r = (typeof reserve === "number" && reserve > 0) ? Math.min(reserve, win - HARD_RESERVE) : OUTPUT_RESERVE;
    return win - r;
  }
  function hardCap(tier){
    return (TIER_CONTEXT[tier] || 2048) - HARD_RESERVE;
  }

  /* The historical guard threshold, kept as a derived constant:
     soft cap at the default reserve = (2048 - 256) / 2048. */
  var BUDGET_RATIO = (2048 - OUTPUT_RESERVE) / 2048; // 0.875

  var TIER_ORDER = ["fast", "medium", "slow"];

  /* Fast keeps this single line instead of the whole TOOL_PROTOCOL block.
     If a learn request ever slips past the detector onto Fast, the model
     replies exactly LEARNREQUEST and the page re-runs it on Medium. */
  var FAST_LEARN_LINE =
    "LEARN LINE: if Andrew asks you to learn something new (\"you should learn to X\"), " +
    "reply with exactly LEARNREQUEST and nothing else — the bigger brain takes it from there.";

  function toolBlockForTier(tier, fullBlock){
    return tier === "fast" ? FAST_LEARN_LINE : String(fullBlock || "");
  }

  function nextTier(tier){
    var i = TIER_ORDER.indexOf(tier);
    if (i < 0) return "medium";
    return i >= TIER_ORDER.length - 1 ? "slow" : TIER_ORDER[i + 1];
  }

  /* Learn requests must never run on Fast — the 2048-token window cannot
     hold the learn prompt (the exact 2026-10-15 overflow). Returns the tier
     to actually use: "medium" when a learn request would have run on Fast,
     otherwise the input tier unchanged. `detector` defaults to the v0.19
     ZenoToolProposals detector; tests inject a stub. */
  function escalateForLearnRequest(text, tier, detector){
    if (tier !== "fast") return tier;
    var det = detector || function(t){
      try { return !!(root.ZenoToolProposals && root.ZenoToolProposals.draftFromLearnRequest(t)); }
      catch (e){ return false; }
    };
    var hit = false;
    try { hit = !!det(text); } catch (e){ hit = false; }
    return hit ? "medium" : tier;
  }

  /* Calibrated token measurement. measureText counts one string;
     measureMessages counts a full [{role, content}] array the way the
     engine will see it (contents + template overhead). `meter` is an
     optional hint from the page's prompt builder: { memChars } = how
     many of the system message's chars are memory/callback text, so
     those chars get the (hotter) memory factor instead of the system
     factor. Without it the whole system message counts at "sys" — the
     net in _complete uses that simpler form and relies on the hard cap. */
  function measureText(text, tier, kind){
    var cal = CALIBRATION[tier] || CALIBRATION.medium;
    var f = cal[kind] || cal.chat;
    return Math.ceil(String(text == null ? "" : text).length * f);
  }

  function measureMessages(messages, tier, meter){
    var cal = CALIBRATION[tier] || CALIBRATION.medium;
    var total = CALIBRATION.fixed;
    var list = messages || [];
    for (var i = 0; i < list.length; i++){
      var m = list[i] || {};
      var content = String(m.content == null ? "" : m.content);
      total += CALIBRATION.perMessage;
      if (m.role === "system" && meter && meter.memChars){
        var memChars = Math.min(content.length, meter.memChars);
        total += Math.ceil((content.length - memChars) * cal.sys) +
                 Math.ceil(memChars * cal.mem);
      } else if (m.role === "system"){
        total += Math.ceil(content.length * cal.sys);
      } else {
        total += Math.ceil(content.length * cal.chat);
      }
    }
    return total;
  }

  function fitsSoft(tier, estTokens, reserve){
    return estTokens <= softCap(tier, reserve);
  }

  /* Budget decision for a measured prompt size on a tier.
     Returns "ok" | "escalate" | "truncate":
     - "ok": fits under the soft cap (reply space reserved).
     - "escalate": over the soft cap and a bigger tier exists — the page
       escalates, rebuilds the tier-scoped prompt, and re-measures.
     - "truncate": over the soft cap on Slow — the page runs the trim
       ladder (advanceTrim) and re-measures after every step. */
  function checkBudget(tier, estTokens){
    if (estTokens <= softCap(tier)) return "ok";
    if (tier !== "slow") return "escalate";
    return "truncate";
  }

  /* ------------------------------------------------------------
     THE TRIM LADDER — pure state machine (the page assembles, the
     ladder decides what goes next). State is a plain object; the
     page rebuilds the prompt from it after every step:
       historyDrop   — drop this many OLDEST history turns (the
                       newest turn is never dropped)
       dropCallbacks — omit the memory-callback block
       dropEmotion   — omit the emotion-engine line
       relDrop       — drop this many OLDEST relevant memories
       factDrop      — drop this many OLDEST user facts (facts last)
       shortTools    — swap the full tool block for FAST_LEARN_LINE
     ctx: { historyLen, relCount, factCount } — sizes BEFORE trimming.
     Returns the next state, or null when nothing trimmable remains.
     ------------------------------------------------------------ */
  function newTrimState(){
    return { historyDrop: 0, dropCallbacks: false, dropEmotion: false,
             relDrop: 0, factDrop: 0, shortTools: false };
  }

  function advanceTrim(state, ctx){
    var s = Object.assign({}, state);
    ctx = ctx || {};
    var maxHistDrop = Math.max(0, (ctx.historyLen || 0) - 1);
    if (s.historyDrop < maxHistDrop){ s.historyDrop++; return s; }
    if (!s.dropCallbacks){ s.dropCallbacks = true; return s; }
    if (!s.dropEmotion){ s.dropEmotion = true; return s; }
    if (s.relDrop < (ctx.relCount || 0)){ s.relDrop++; return s; }
    if (s.factDrop < (ctx.factCount || 0)){ s.factDrop++; return s; }
    if (!s.shortTools){ s.shortTools = true; return s; }
    return null;
  }

  /* The ONE honest error for a prompt that cannot fit even bare.
     Carries code "ZENO_PROMPT_TOO_LONG" so the friendly-error
     classifier in the page recognizes it without string-matching. */
  var TOO_LONG_TEXT =
    "That message was too long for my current brain — that's on my end, not yours. " +
    "Try Clear chat to shrink what I'm holding onto, or ask me in two parts.";
  function makeTooLongError(){
    var err = new Error(TOO_LONG_TEXT);
    err.code = "ZENO_PROMPT_TOO_LONG";
    return err;
  }

  var api = {
    VERSION: "promptbudget-20261020",
    TIER_CONTEXT: TIER_CONTEXT,
    BUDGET_RATIO: BUDGET_RATIO,
    TIER_ORDER: TIER_ORDER,
    FAST_LEARN_LINE: FAST_LEARN_LINE,
    CALIBRATION: CALIBRATION,
    OUTPUT_RESERVE: OUTPUT_RESERVE,
    HARD_RESERVE: HARD_RESERVE,
    TOO_LONG_TEXT: TOO_LONG_TEXT,
    estimateTokens: estimateTokens,
    measureText: measureText,
    measureMessages: measureMessages,
    softCap: softCap,
    hardCap: hardCap,
    fitsSoft: fitsSoft,
    toolBlockForTier: toolBlockForTier,
    nextTier: nextTier,
    escalateForLearnRequest: escalateForLearnRequest,
    checkBudget: checkBudget,
    newTrimState: newTrimState,
    advanceTrim: advanceTrim,
    makeTooLongError: makeTooLongError
  };

  root.ZenoPromptBudget = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
