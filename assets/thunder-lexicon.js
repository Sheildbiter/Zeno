/* Zeno Thunder Lexicon (v0.12) — Thunder's vocalizations mapped to meanings.
 *
 * Thunder is NON-VERBAL by design (thunder-design.md): no speech. He
 * communicates through chirps, purrs, roars, head tilts, ear fins, tail
 * movement, nudges, and glowing markings. Zeno translates when useful.
 *
 * HONEST SCOPE: these mappings come from Thunder's design notes, written
 * with Andrew. They are Zeno's best reading — pattern matching against the
 * design doc — not a certified translation of a real animal. When unsure,
 * the interpreter says so.
 *
 * Node test seam at the bottom (page loads this as a plain script).
 */
"use strict";

(function(){
  var SIGNALS = [
    {
      id: "chirp",
      label: "Chirp",
      patterns: [/chirp/i, /cheep/i, /peep/i],
      meaning: "Social call — greeting, curiosity, or getting your attention. " +
        "Thunder's chirps do double duty: the audible ones are for talking to you, " +
        "and the ultrasonic pulses you can't hear are his sonar mapping the room."
    },
    {
      id: "purr",
      label: "Purr",
      patterns: [/purr/i, /\brr+\b/i],
      meaning: "Contentment — he's comfortable and happy. Purrs also double as " +
        "self-diagnostics: the vibration frequency tells his systems (and Zeno, " +
        "his long-term doctor) how his body is doing."
    },
    {
      id: "roar",
      label: "Roar",
      patterns: [/roar/i, /\bra+wr\b/i, /bellow/i],
      meaning: "Alarm or threat display — something is wrong, or he's telling " +
        "a threat to back off. Thunder carries no weapons; a roar is protection " +
        "through display, alongside escape, alarms, and calling for help through Zeno."
    },
    {
      id: "whine",
      label: "Whine / whimper",
      patterns: [/whine/i, /whimper/i, /whinge/i],
      meaning: "Unease or a request — he wants something (out, fed, company) " +
        "or something feels off. Check on him."
    },
    {
      id: "huff",
      label: "Huff / snort",
      patterns: [/huff/i, /snort/i, /chuff/i],
      meaning: "Mild annoyance or a gruff acknowledgment — the dragon equivalent " +
        "of 'fine.' Not anger; more like a shrug with attitude."
    },
    {
      id: "ear-perk",
      label: "Ears perked up",
      patterns: [/ears? (perk|up|raised)|perked (up )?ears?/i, /ear ?fins? up/i],
      meaning: "Curious and engaged — something caught his interest. His ear " +
        "fins double as heat radiators, so they may feel faintly warm."
    },
    {
      id: "ear-flat",
      label: "Ears flattened",
      patterns: [/ears? (flat|flattened|down|back)/i, /flattened ears?/i, /\bears?\b[^.]{0,12}\b(flat|flattened|down|back)\b/i],
      meaning: "Upset or scared — he's anxious about something nearby. Give him " +
        "space and figure out what's bothering him."
    },
    {
      id: "tail-sway",
      label: "Tail swaying slowly",
      patterns: [/tail (sway|swoosh|wag)/i, /swaying tail/i],
      meaning: "Content — relaxed and at ease, the slow sway of a happy dragon."
    },
    {
      id: "tail-thump",
      label: "Tail thumping",
      patterns: [/tail thump/i, /thump(ing)? (his|the|its) tail/i, /excited thump/i],
      meaning: "Excited greeting — he's happy to see you. Think of it as a wag " +
        "with the whole back half."
    },
    {
      id: "tail-curl",
      label: "Tail curled tight",
      patterns: [/tail (curl|curled|tight)/i, /curled (up )?tail/i],
      meaning: "Sleeping or settling down — the tight curl means rest mode. " +
        "Let him sleep."
    },
    {
      id: "tail-lash",
      label: "Tail lashing",
      patterns: [/tail lash/i, /lashing tail/i, /tail[^.]{0,10}lash/i, /tail (whip|flick)/i],
      meaning: "Alarm or agitation — he's upset about something. Same family as " +
        "a roar, but quieter: pay attention before it escalates."
    },
    {
      id: "head-tilt",
      label: "Head tilt",
      patterns: [/head tilt/i, /tilt(s|ed|ing)? (his|the|its) head/i, /cocked head/i],
      meaning: "Curiosity — he's trying to understand what you mean, Toothless-style. " +
        "He follows conversation and picks up names, so talk to him normally."
    },
    {
      id: "nudge",
      label: "Nudge",
      patterns: [/nudge/i, /nudg/i, /head ?butt/i, /boop/i],
      meaning: "Affection or a request — a nudge says 'pay attention to me' or " +
        "'I want that thing over there.'"
    },
    {
      id: "glow",
      label: "Markings glowing",
      patterns: [/glow/i, /markings? (lit|bright|puls)/i, /circuit.*glow/i, /lights? up/i],
      meaning: "Active communication — his white Night Light markings softly glow " +
        "as a visual channel. Bright pulsing usually means excitement or emphasis."
    },
    {
      id: "cower",
      label: "Cowering / crouching",
      patterns: [/cower/i, /crouch/i, /flatten/i, /tuck/i],
      meaning: "Fear or submission — he feels threatened. Back off, lower your " +
        "voice, and let him come to you."
    }
  ];

  function findSignals(text){
    var t = String(text || "");
    var found = [];
    for (var i = 0; i < SIGNALS.length; i++){
      var s = SIGNALS[i];
      for (var j = 0; j < s.patterns.length; j++){
        if (s.patterns[j].test(t)){ found.push(s); break; }
      }
    }
    return found;
  }

  function translate(text){
    var signals = findSignals(text);
    var honest = "My best reading from Thunder's design notes — not a certified " +
      "translation. Thunder is non-verbal by design; I map what I see and hear " +
      "to what we wrote down together.";
    if (!signals.length){
      return {
        signals: [],
        reading: "I didn't catch a signal I recognize in that. Tell me what " +
          "Thunder did — a sound, ears, tail, glow — and I'll read it.",
        honest: honest
      };
    }
    var parts = signals.map(function(s){ return s.label + ": " + s.meaning; });
    var reading = parts.join("\n\n");
    if (signals.length > 1){
      reading += "\n\nTaken together: " + combinedReading(signals) + " " + honest;
    } else {
      reading += "\n\n" + honest;
    }
    return { signals: signals.map(function(s){ return s.id; }), reading: reading, honest: honest };
  }

  function combinedReading(signals){
    var ids = signals.map(function(s){ return s.id; });
    var has = function(id){ return ids.indexOf(id) !== -1; };
    if (has("ear-flat") && (has("tail-lash") || has("roar") || has("cower")))
      return "he's genuinely distressed — comfort him and remove the stressor.";
    if (has("chirp") && (has("ear-perk") || has("head-tilt")))
      return "he's curious and chatty — talk to him, he's listening.";
    if (has("purr") && (has("tail-sway") || has("tail-curl")))
      return "he's deeply content — everything is right in his world.";
    if (has("tail-thump") && has("chirp"))
      return "that's a full happy greeting — you're his favorite person right now.";
    if (has("roar") && has("tail-lash"))
      return "that's a real alarm — check what's wrong before anything else.";
    if (has("nudge") && has("whine"))
      return "he wants something specific — food, out, or attention. Follow the nudge.";
    return "mixed signals — watch which one repeats; the repeated signal is the real message.";
  }

  var api = { SIGNALS: SIGNALS, findSignals: findSignals, translate: translate };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ZenoThunder = api;
})();
