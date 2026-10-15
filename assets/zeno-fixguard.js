/* Zeno fix-it guard (v0.18) — "apply just this tweak".
   The Fix-it loop rebuilds the image from a rewritten prompt; this module
   guarantees the rewrite actually behaves like an EDIT, not a new image:

   1. fixKeepsEssence(): the model's revised prompt must preserve >=60% of
      the original request's content words. If the rewrite drifts (drops the
      subject, swaps the scene), we discard it and use surgicalFixPrompt().
   2. surgicalFixPrompt(): appends the correction to the CURRENT prompt
      verbatim — the minimal possible change.
   3. fixSeedFor(): non-structural tweaks ALWAYS keep the seed (same
      composition family); structural flaws get a fresh seed so the flaw
      doesn't repeat (v0.10 policy, now explicit and tested).

   UMD: <script> (window.ZenoFixGuard) and node module. */
(function(root, factory){
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.ZenoFixGuard = factory();
})(typeof self !== "undefined" ? self : this, function(){
"use strict";

var ESSENCE_KEEP_RATIO = 0.6;

function contentTokens(text){
  return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(function(t){ return t.length > 3; });
}

/* True when the revised prompt still carries the original request's essence. */
function fixKeepsEssence(originalRequest, revisedPrompt){
  var orig = {};
  var count = 0;
  contentTokens(originalRequest).forEach(function(t){ if (!orig[t]){ orig[t] = 1; count++; } });
  if (!count) return true;
  var kept = 0;
  var seen = {};
  contentTokens(revisedPrompt).forEach(function(t){
    if (orig[t] && !seen[t]){ seen[t] = 1; kept++; }
  });
  return (kept / count) >= ESSENCE_KEEP_RATIO;
}

/* Minimal-diff fallback: keep the whole current prompt, append the fix. */
function surgicalFixPrompt(currentPrompt, flaw){
  return String(currentPrompt || "") +
    ". Apply this correction exactly: " + String(flaw || "") +
    ". Preserve every other requested detail.";
}

/* Seed policy: tweaks keep the seed; structural rebuilds get a fresh one. */
function fixSeedFor(structural, activeSeed, newSeedFn){
  if (structural){
    return (typeof newSeedFn === "function") ? newSeedFn() : Math.floor(Math.random() * 2147483646) + 1;
  }
  return activeSeed;
}

/* Full decision: given the model's revised prompt (may be empty on failure),
   return the prompt to actually render. */
function decideFixPrompt(originalRequest, currentPrompt, revisedPrompt, flaw){
  if (revisedPrompt && fixKeepsEssence(originalRequest, revisedPrompt)) return revisedPrompt;
  return surgicalFixPrompt(currentPrompt, flaw);
}

return {
  ESSENCE_KEEP_RATIO: ESSENCE_KEEP_RATIO,
  contentTokens: contentTokens,
  fixKeepsEssence: fixKeepsEssence,
  surgicalFixPrompt: surgicalFixPrompt,
  fixSeedFor: fixSeedFor,
  decideFixPrompt: decideFixPrompt
};
});
