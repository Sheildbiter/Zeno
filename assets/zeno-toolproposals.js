/* ============================================================
   Zeno ToolProposals — v0.19 ("Zeno proposes, Andrew approves").

   First of Andrew's three self-upgrade paths (tools → prompts →
   brain). Zeno can now PROPOSE new tools for himself. Andrew
   approves or rejects each one on a proposal card. NOTHING
   self-installs silently. Ever.

   Design (deliberately boring, on purpose):
   - A proposed tool is DATA, not code: a trigger regex plus an
     ordered list of steps. Each step names one allowlisted safe
     primitive and an input template where $1..$9 are filled from
     the trigger's capture groups. There is no eval, no
     `new Function`, no function body anywhere in a proposal.
   - Install-time validator rejects: unknown primitives, bad
     regexes, catch-all triggers, forbidden tokens (fetch, eval,
     document, window, storage access, …), and any destructive
     intent (delete/forget/remove/clear/wipe) in the name,
     description, or trigger. The model path could never delete
     before (v0.14 invariant); proposals can't either.
   - Permission inheritance: a proposed tool that touches a
     confirm-class primitive (reminder proposals) is confirm-first
     as a whole. Everything else validated is auto.
   - Rejection memory: rejected proposals are remembered by name
     so Zeno never re-proposes the same thing.
   - Amendments: learned tools can be amended at the data level
     (new trigger / new steps) through the same card + validator.
     Amendments to BUILT-IN tools can't rewrite shipped code, so an
     approved one is recorded as a queued request for Kavi's next
     build — stated honestly in the UI, never faked.
   - Pure logic here — no DOM — so Node can test every path. The
     page wires persistence (IndexedDB) and the card UI around it.

   Andrew's rule, in Zeno's own words: "I propose. Andrew approves."
   ============================================================ */
(function(){
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;

  /* ------------------------------------------------------------
     1. SAFE PRIMITIVES — the only things a proposed tool may do.
     Mirrors the v0.14 permission model. reminder_propose feeds the
     existing yes/no confirmation flow; it never sets silently.
     ------------------------------------------------------------ */
  var SAFE_PRIMITIVES = {
    calc:             "auto",   // arithmetic on the substituted input
    datetime:         "auto",   // current device date/time (input ignored)
    memory_search:    "auto",   // searches Zeno's stored memories
    memory_save:      "auto",   // appends a memory (reversible via "forget")
    notes:            "auto",   // saves a note on this device
    web_lookup:       "auto",   // visible public-web research flow
    reminder_propose: "confirm" // PROPOSES a reminder — Andrew taps yes/no
  };

  var MAX_STEPS = 6;
  var MAX_TRIGGER_LEN = 300;
  var MAX_TEMPLATE_LEN = 500;
  var MAX_TEXT_LEN = 400;

  /* Tokens that must never appear anywhere in a proposal, serialized
     or otherwise. Scanned at install time, before anything is stored. */
  var FORBIDDEN_RE = /fetch|XMLHttpRequest|WebSocket|EventSource|eval|new\s+Function|document|window|localStorage|sessionStorage|indexedDB|postMessage|import\s*\(|require\s*\(|__proto__|constructor|prototype|\.call\s*\(|\.apply\s*\(|setTimeout|setInterval|Function\s*\(/i;

  /* Destructive intent: the model path could never delete (v0.14), and
     neither can a proposal. Checked in name/description/why/trigger. */
  var DESTRUCTIVE_RE = /\b(delet\w*|forget\w*|remov\w*|clear\w*|wip\w*|eras\w*|destroy\w*)\b/i;

  var NAME_RE = /^[a-z][a-z0-9_]{2,39}$/;

  /* Built-in ids a proposal may never shadow. The page passes its own
     list at install; these are the ones the module knows about. */
  var KNOWN_RESERVED = [
    "calc","datetime","memory_search","memory_save","notes","web_lookup",
    "reminder_set","reminder_propose","abilities","whatsnew","websearch",
    "goals","imagine","eyes","builder","hands","voice","memory","browse"
  ];

  function isStr(s){ return typeof s === "string"; }

  function scanForbidden(s){
    return isStr(s) && FORBIDDEN_RE.test(s);
  }

  /* ------------------------------------------------------------
     2. VALIDATION — validateProposal(p, reservedNames)
     p: { kind:"tool"|"amend", name, description, trigger, why,
          steps:[{primitive, template}], target? (amend only) }
     Returns { ok:true, def } or { ok:false, errors:[...] }.
     ------------------------------------------------------------ */
  function validateProposal(p, reservedNames){
    var errors = [];
    var reserved = KNOWN_RESERVED.concat(reservedNames || []);

    if (!p || typeof p !== "object"){ return { ok:false, errors:["not an object"] }; }
    if (p.kind !== "tool" && p.kind !== "amend") errors.push("kind must be 'tool' or 'amend'");

    if (!isStr(p.name) || !NAME_RE.test(p.name)){
      errors.push("name must be 3-40 chars: lowercase letters, digits, underscores");
    } else if (reserved.indexOf(p.name) !== -1){
      errors.push("name '" + p.name + "' is already taken");
    }

    if (!isStr(p.description) || p.description.trim().length < 10 || p.description.length > MAX_TEXT_LEN){
      errors.push("description must be 10-400 chars of plain words");
    }
    if (!isStr(p.why) || p.why.trim().length < 10 || p.why.length > MAX_TEXT_LEN){
      errors.push("tell Andrew why you want it (10-400 chars)");
    }

    // Destructive intent is never proposable.
    for (var k = 0; k < 3; k++){
      var field = ["name","description","why"][k];
      if (isStr(p[field]) && DESTRUCTIVE_RE.test(p[field])){
        errors.push(field + " must never mention deleting/forgetting/removing anything");
      }
    }

    // Trigger: must compile, must not be a catch-all.
    var re = null;
    if (!isStr(p.trigger) || p.trigger.length === 0 || p.trigger.length > MAX_TRIGGER_LEN){
      errors.push("trigger must be a regex of 1-300 chars");
    } else {
      try { re = new RegExp(p.trigger, "i"); }
      catch(e){ errors.push("trigger is not a valid regex: " + (e && e.message || e)); }
      if (re){
        var probe = null;
        try { probe = re.test(""); } catch(e){ probe = null; }
        if (probe) errors.push("trigger must not match everything (it matched the empty string)");
      }
      if (DESTRUCTIVE_RE.test(p.trigger)) errors.push("trigger must never target deleting/forgetting");
    }

    // Steps: data only, allowlisted primitives, scanned templates.
    if (!Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > MAX_STEPS){
      errors.push("steps must be a list of 1-" + MAX_STEPS + " primitive steps");
    } else {
      for (var i = 0; i < p.steps.length; i++){
        var s = p.steps[i];
        if (!s || typeof s !== "object"){ errors.push("step " + (i+1) + " is not an object"); continue; }
        if (!SAFE_PRIMITIVES.hasOwnProperty(s.primitive)){
          errors.push("step " + (i+1) + ": '" + s.primitive + "' is not a safe primitive");
        }
        if (!isStr(s.template) || s.template.length === 0 || s.template.length > MAX_TEMPLATE_LEN){
          errors.push("step " + (i+1) + ": template must be 1-500 chars");
        } else if (scanForbidden(s.template)){
          errors.push("step " + (i+1) + ": template contains a forbidden token");
        }
      }
    }

    // Amendments name their target; tools must not.
    if (p.kind === "amend"){
      if (!isStr(p.target) || !p.target){
        errors.push("amendments must name their target tool");
      } else if (reserved.indexOf(p.target) === -1 && KNOWN_RESERVED.indexOf(p.target) === -1){
        // Unknown targets are allowed only if the page knows them as learned.
        // The page re-checks; here we just require a plausible name shape.
        if (!NAME_RE.test(p.target)) errors.push("amendment target has a bad name");
      }
    }

    // Whole-definition forbidden-token scan (belt and suspenders).
    var serialized = "";
    try { serialized = JSON.stringify(p); } catch(e){ serialized = ""; }
    if (scanForbidden(serialized)) errors.push("proposal contains a forbidden token");

    if (errors.length) return { ok:false, errors:errors };

    var def = {
      kind: p.kind, name: p.name,
      description: p.description.trim(), why: p.why.trim(),
      trigger: p.trigger, steps: p.steps.map(function(s){
        return { primitive: s.primitive, template: s.template };
      })
    };
    if (p.kind === "amend") def.target = p.target;
    def.permission = permissionFor(def);
    return { ok:true, def:def };
  }

  /* ------------------------------------------------------------
     3. PERMISSION INHERITANCE — a proposed tool is only as free
     as its most consequential step. reminder_propose (confirm)
     anywhere in the chain makes the whole tool confirm-first.
     ------------------------------------------------------------ */
  function permissionFor(def){
    var steps = (def && def.steps) || [];
    for (var i = 0; i < steps.length; i++){
      if (SAFE_PRIMITIVES[steps[i].primitive] === "confirm") return "confirm";
    }
    return "auto";
  }

  /* ------------------------------------------------------------
     4. TEMPLATE SUBSTITUTION — $1..$9 from the trigger's groups.
     $$ is a literal dollar. Anything else is left as-is.
     ------------------------------------------------------------ */
  function substitute(template, groups){
    return String(template).replace(/\$(\$|\d)/g, function(m, c){
      if (c === "$") return "$";
      var n = parseInt(c, 10);
      return (n >= 1 && n < groups.length && groups[n] != null) ? String(groups[n]) : m;
    });
  }

  /* ------------------------------------------------------------
     5. EXECUTION — runLearned(def, text, primitives)
     primitives: { name: async (input)->string }. The page injects
     the real safe implementations; tests inject stubs.
     Returns { ok, text } — never throws.
     ------------------------------------------------------------ */
  async function runLearned(def, text, primitives){
    try {
      var re = new RegExp(def.trigger, "i");
      var m = String(text == null ? "" : text).match(re);
      if (!m) return { ok:false, text:"" };
      var outputs = [];
      for (var i = 0; i < def.steps.length; i++){
        var st = def.steps[i];
        var fn = primitives && primitives[st.primitive];
        if (typeof fn !== "function"){
          return { ok:false, text:"That didn't work (primitive '" + st.primitive + "' unavailable). Nothing changed." };
        }
        var input = substitute(st.template, m);
        var out = await fn(input);
        outputs.push(out == null ? "" : String(out));
      }
      return { ok:true, text: outputs.join("\n") };
    } catch(e){
      return { ok:false, text:"That didn't work (" + (e && e.message || e) + "). Nothing changed." };
    }
  }

  function matchLearned(def, text){
    try { return new RegExp(def.trigger, "i").test(String(text == null ? "" : text)); }
    catch(e){ return false; }
  }

  /* ------------------------------------------------------------
     6. PROPOSAL CARD DATA — plain data for the page's card UI.
     ------------------------------------------------------------ */
  function proposalCard(def){
    var lines = [
      "I want to learn: " + def.name,
      def.description,
      "It would kick in when you say things matching: " + def.trigger,
      "Why: " + def.why,
      def.permission === "confirm"
        ? "Because it can propose reminders, it will ALWAYS ask you first before doing anything."
        : "It's built only from my safe tools, so it runs freely — like mental math.",
      "Nothing installs until you approve it. I propose; you approve."
    ];
    if (def.kind === "amend"){
      lines[0] = "I want to change: " + def.target + " → " + def.name;
    }
    return {
      title: def.kind === "amend" ? "Proposed change" : "Proposed new tool",
      lines: lines,
      approveLabel: "Approve",
      rejectLabel: "Reject"
    };
  }

  /* "what can you do?" must include learned tools. */
  function describeAll(learned){
    if (!learned || !learned.length) return "";
    return learned.map(function(d){
      return "• " + d.name + " — " + d.description +
        (d.permission === "confirm" ? " (asks you first)" : "");
    }).join("\n");
  }

  /* ------------------------------------------------------------
     7. BRAIN PROTOCOL — extractProposalBlock / parseProposalBlock
     The model may emit one PROPOSE block per reply (the page's
     prompt teaches it the shape). Balanced-brace extraction handles
     the nested step objects; parsed + validated like any other
     proposal; the page shows the card, never raw JSON.
     ------------------------------------------------------------ */
  function extractProposalBlock(text){
    var s = String(text || "");
    var i = s.indexOf("PROPOSE");
    if (i === -1) return null;
    var j = s.indexOf("{", i);
    if (j === -1) return null;
    var depth = 0, inStr = false, esc = false;
    for (var k = j; k < s.length; k++){
      var c = s[k];
      if (inStr){
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}"){
          depth--;
          if (depth === 0) return { start: i, end: k + 1 };
        }
      }
    }
    return null; // unbalanced: never propose half a block
  }

  function parseProposalBlock(text){
    var s = String(text || "");
    var blk = extractProposalBlock(s);
    if (!blk) return null;
    try {
      var obj = JSON.parse(s.slice(s.indexOf("{", blk.start), blk.end));
      if (!obj || typeof obj !== "object") return null;
      return obj;
    } catch(e){ return null; }
  }

  function stripProposalBlock(text){
    var s = String(text || "");
    var blk = extractProposalBlock(s);
    if (!blk) return s;
    return (s.slice(0, blk.start) + s.slice(blk.end)).replace(/\n{3,}/g, "\n\n").trim();
  }

  /* "Zeno, you should learn to X" — Andrew-initiated path. Returns
     the skill phrase, or null. The page then asks what it should do. */
  var LEARN_RE = /(?:you should learn(?: how)? to|learn how to|learn to)\s+(.{3,200})/i;
  function draftFromLearnRequest(text){
    var m = String(text || "").match(LEARN_RE);
    if (!m) return null;
    var skill = m[1].trim().replace(/[.?!\s]+$/, "");
    if (skill.length < 3) return null;
    return { skill: skill };
  }

  /* ------------------------------------------------------------
     8. REJECTION MEMORY — so Zeno never re-proposes the same
     thing. Backed by an injected plain object; the page persists
     it in IndexedDB.
     ------------------------------------------------------------ */
  function createRejectionMemory(backing){
    var store = backing || {};
    return {
      note: function(name, reason){
        store["rejected:" + String(name)] = {
          name: String(name), reason: String(reason || ""),
          at: new Date().toISOString()
        };
      },
      has: function(name){
        return !!store["rejected:" + String(name)];
      },
      list: function(){
        var out = [];
        for (var k in store){
          if (Object.prototype.hasOwnProperty.call(store, k) && k.indexOf("rejected:") === 0)
            out.push(store[k]);
        }
        return out;
      },
      _backing: store
    };
  }

  var api = {
    VERSION: "toolproposals-20261015",
    SAFE_PRIMITIVES: SAFE_PRIMITIVES,
    MAX_STEPS: MAX_STEPS,
    validateProposal: validateProposal,
    permissionFor: permissionFor,
    substitute: substitute,
    runLearned: runLearned,
    matchLearned: matchLearned,
    proposalCard: proposalCard,
    describeAll: describeAll,
    parseProposalBlock: parseProposalBlock,
    stripProposalBlock: stripProposalBlock,
    draftFromLearnRequest: draftFromLearnRequest,
    createRejectionMemory: createRejectionMemory
  };

  root.ZenoToolProposals = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
