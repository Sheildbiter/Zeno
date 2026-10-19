/* ============================================================
   Zeno PromptBudget — v0.19.1 (Fast-brain prompt overflow fix).

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
      prompt tokens (chars/4 heuristic, documented below); over ~90% of
      the tier's window, escalate a tier; on Slow, the page trims oldest
      history first. One honest error only if even that can't fit — never
      a raw WebLLM "exceeds context window" throw at Andrew.

   Andrew's rule, unchanged: Zeno proposes, Andrew approves.
   ============================================================ */
(function(){
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;

  /* Token estimate heuristic: ~4 characters per token. English averages
     about 4 chars/token on the BPE tokenizers these models use. This is a
     documented ESTIMATE, not an exact count — the guard fires at 90% of
     the window, so estimation error has headroom and can never by itself
     cause a real overflow. */
  function estimateTokens(text){
    var s = String(text == null ? "" : text);
    return Math.ceil(s.length / 4);
  }

  /* Per-tier context windows. Must match ENGINE_OPTS.context_window_size
     in the page (2048 for every tier as of v0.19.1). */
  var TIER_CONTEXT = { fast: 2048, medium: 2048, slow: 2048 };

  /* Act at 90% of the window: headroom for estimate error plus the reply
     tokens the model still needs to generate. */
  var BUDGET_RATIO = 0.9;

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

  /* Budget decision for an estimated prompt size on a tier.
     Returns "ok" | "escalate" | "truncate":
     - "ok": fits within 90% of the window.
     - "escalate": over budget and a bigger tier exists — the page
       escalates, rebuilds the tier-scoped prompt, and re-estimates.
     - "truncate": over budget on Slow — the page trims chat history
       oldest-first (keeping the newest turn) and re-estimates. */
  function checkBudget(tier, estTokens){
    var win = TIER_CONTEXT[tier] || 2048;
    if (estTokens <= win * BUDGET_RATIO) return "ok";
    if (tier !== "slow") return "escalate";
    return "truncate";
  }

  var api = {
    VERSION: "promptbudget-20261015",
    TIER_CONTEXT: TIER_CONTEXT,
    BUDGET_RATIO: BUDGET_RATIO,
    TIER_ORDER: TIER_ORDER,
    FAST_LEARN_LINE: FAST_LEARN_LINE,
    estimateTokens: estimateTokens,
    toolBlockForTier: toolBlockForTier,
    nextTier: nextTier,
    escalateForLearnRequest: escalateForLearnRequest,
    checkBudget: checkBudget
  };

  root.ZenoPromptBudget = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
