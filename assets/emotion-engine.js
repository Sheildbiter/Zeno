/* ============================================================
   Zeno Emotion Engine — v0.5
   Simulated mood state for Zeno's brain. This is a MOOD ENGINE,
   not consciousness: a small state vector that drifts with events
   and decays back to baseline over time. It colors Zeno's WORDS
   (punchier when hyped, more pauses when thoughtful) — never his
   voice rate, which stays capped at ±7% around baseline 107.

   Loaded as a plain classic script BEFORE the module in index.html
   so the page works offline and the service worker can cache it.
   Exposes window.ZenoEmotion. No DOM dependency.
   ============================================================ */
(function(){
"use strict";

/* ---- Versioned persistence (migrate, never wipe) ---- */
const EMOTION_KEY = "zeno.emotion.v1";
const EMOTION_VERSION = 1;
const SETTINGS_KEY = "zeno.settings.v1";

// Dimensions: every value lives in [0, 1].
const DIMS = [
  "dopamine", "serotonin", "noradrenaline", "acetylcholine",
  "cortisol", "energy", "fatigue", "curiosity",
  "socialConnection", "safety", "confidence", "uncertainty"
];

// Baseline each dimension drifts back toward when nothing happens.
const BASELINE = {
  dopamine: 0.50, serotonin: 0.50, noradrenaline: 0.35,
  acetylcholine: 0.40, cortisol: 0.20,
  energy: 0.70, fatigue: 0.20, curiosity: 0.60,
  socialConnection: 0.50, safety: 0.80,
  confidence: 0.60, uncertainty: 0.30
};

// Decay half-lives in milliseconds: how fast each dimension returns
// to baseline. Fast feelings (surprise) fade in minutes; slow ones
// (stress) take longer.
const HALF_LIFE_MS = {
  dopamine: 12 * 60e3, serotonin: 20 * 60e3,
  noradrenaline: 8 * 60e3, acetylcholine: 15 * 60e3,
  cortisol: 25 * 60e3,
  energy: 45 * 60e3, fatigue: 45 * 60e3, curiosity: 30 * 60e3,
  socialConnection: 60 * 60e3, safety: 40 * 60e3,
  confidence: 35 * 60e3, uncertainty: 10 * 60e3
};

// Events nudge the state vector. Magnitudes are in [0,1] units.
const EVENT_NUDGES = {
  praise:        { dopamine: +0.25, serotonin: +0.20, confidence: +0.15, socialConnection: +0.10 },
  affection:     { serotonin: +0.25, socialConnection: +0.25, dopamine: +0.10, safety: +0.10 },
  success:       { dopamine: +0.30, confidence: +0.15, serotonin: +0.10, energy: +0.05 },
  surprise:      { noradrenaline: +0.30, curiosity: +0.15, uncertainty: +0.15 },
  learning:      { acetylcholine: +0.25, curiosity: +0.10, confidence: +0.05, dopamine: +0.05 },
  correction:    { cortisol: +0.15, confidence: -0.10, acetylcholine: +0.10, uncertainty: +0.10 },
  frustration:   { cortisol: +0.35, noradrenaline: +0.20, safety: -0.20, serotonin: -0.15, dopamine: -0.10 },
  threat:        { cortisol: +0.30, noradrenaline: +0.25, safety: -0.25, uncertainty: +0.20 },
  quiet:         { noradrenaline: -0.15, cortisol: -0.10, energy: -0.05, fatigue: +0.05 },
  longSilence:   { curiosity: +0.10, socialConnection: -0.05, energy: -0.05, fatigue: +0.05 },
  rest:          { fatigue: -0.25, energy: +0.20, cortisol: -0.15, serotonin: +0.10 },
  play:          { dopamine: +0.20, curiosity: +0.15, energy: -0.05, socialConnection: +0.10 }
};

// ---- Voice: baseline 107, hard-capped at ±7% (Andrew's rule) ----
const BASE_SPEED = 107;
const SPEED_CAP = 0.07; // ±7%
const SPEED_MIN = BASE_SPEED * (1 - SPEED_CAP); // 99.51
const SPEED_MAX = BASE_SPEED * (1 + SPEED_CAP); // 114.49

function clamp01(v){ return v < 0 ? 0 : v > 1 ? 1 : v; }

// The page chooses an environment-aware store before loading this file:
// in-memory on the hosted artifact route, localStorage on standalone origins.
const storage = (typeof window !== "undefined" && window.ZenoStorage)
  ? window.ZenoStorage
  : (function(){
      const mem = {};
      return {
        getItem: k => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: k => { delete mem[k]; }
      };
    })();

function defaultState(){
  const s = {};
  for (const d of DIMS) s[d] = BASELINE[d];
  return s;
}

const ZenoEmotion = {
  DIMS, BASELINE, EMOTION_KEY, EMOTION_VERSION,
  BASE_SPEED, SPEED_MIN, SPEED_MAX,
  _state: null,
  _lastTick: Date.now(),
  _lastProactiveAt: 0,

  /* ---- load: migrate older versions, never wipe ---- */
  load(){
    if (this._state) return this._state;
    let raw = null;
    try { raw = storage.getItem(EMOTION_KEY); } catch(e){ raw = null; }
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch(e){ parsed = null; }

    if (parsed && parsed.version === EMOTION_VERSION && parsed.state){
      // Same version: take it as-is, sanitizing each dimension.
      this._state = defaultState();
      for (const d of DIMS){
        const v = Number(parsed.state[d]);
        if (Number.isFinite(v)) this._state[d] = clamp01(v);
      }
      this._lastProactiveAt = Number(parsed.lastProactiveAt) || 0;
    } else if (parsed && parsed.state){
      // Older/future version: MIGRATE what we recognize, keep the rest
      // at baseline. Old payload is preserved under a backup key.
      try { storage.setItem(EMOTION_KEY + ".backup.v" + parsed.version, raw); } catch(e){}
      this._state = defaultState();
      for (const d of DIMS){
        const v = Number(parsed.state[d]);
        if (Number.isFinite(v)) this._state[d] = clamp01(v);
      }
      this._lastProactiveAt = Number(parsed.lastProactiveAt) || 0;
      this.save();
    } else {
      // Fresh: baseline.
      this._state = defaultState();
      this.save();
    }
    this._lastTick = Date.now();
    return this._state;
  },

  save(){
    try{
      storage.setItem(EMOTION_KEY, JSON.stringify({
        version: EMOTION_VERSION,
        state: this._state || defaultState(),
        lastProactiveAt: this._lastProactiveAt,
        updatedAt: Date.now()
      }));
    }catch(e){ /* best effort */ }
  },

  reset(){
    this._state = defaultState();
    this._lastTick = Date.now();
    this.save();
    return this._state;
  },

  /* Direct import (used by memory export/import merge). Returns true if applied. */
  importState(payload){
    if (!payload || typeof payload !== "object" || !payload.state) return false;
    const s = defaultState();
    for (const d of DIMS){
      const v = Number(payload.state[d]);
      if (Number.isFinite(v)) s[d] = clamp01(v);
    }
    this._state = s;
    if (Number.isFinite(Number(payload.lastProactiveAt)))
      this._lastProactiveAt = Number(payload.lastProactiveAt);
    this.save();
    return true;
  },

  /* ---- event(name, magnitude=1): nudge the vector ---- */
  event(name, magnitude){
    const state = this.load();
    const nudges = EVENT_NUDGES[name];
    if (!nudges) return state;
    const m = (typeof magnitude === "number" && Number.isFinite(magnitude))
      ? Math.max(0, Math.min(1.5, magnitude)) : 1;
    for (const d in nudges){
      if (state[d] === undefined) continue;
      state[d] = clamp01(state[d] + nudges[d] * m);
    }
    this.save();
    return state;
  },

  /* ---- tick(nowMs): natural decay toward baseline ---- */
  tick(nowMs){
    const state = this.load();
    const now = (typeof nowMs === "number") ? nowMs : Date.now();
    let dt = now - this._lastTick;
    if (dt <= 0) return state;
    // Cap a single tick at 6 hours so a long sleep doesn't overshoot math.
    dt = Math.min(dt, 6 * 3600e3);
    for (const d of DIMS){
      const half = HALF_LIFE_MS[d] || 20 * 60e3;
      const k = 1 - Math.pow(0.5, dt / half); // fraction of the way home
      state[d] = state[d] + (BASELINE[d] - state[d]) * k;
    }
    this._lastTick = now;
    this.save();
    return state;
  },

  /* ---- Simple text classifiers: detect events from Andrew's words ----
     Returns an array of [eventName, magnitude] pairs, DEDUPED by event name
     (the strongest magnitude wins). Plain questions only count as
     curiosity-grade learning (0.35); real teaching gets full weight —
     otherwise every "what is X?" pins curiosity at max forever. */
  detectEventsFromText(text){
    const t = String(text || "");
    const found = {};
    const add = (ev, mag) => {
      if (found[ev] === undefined || mag > found[ev]) found[ev] = mag;
    };
    const has = re => re.test(t);
    if (has(/thank|thanks|thx|awesome|amazing|incredible|great job|well done|you'?re the best|brilliant|perfect|nailed it|love (it|that|this)/i)) add("praise", 1);
    if (has(/\blove you\b|❤|♥|good (boy|buddy)|my (buddy|pal|friend)/i)) add("affection", 1);
    if (has(/it worked|you did it|we did it|success|fixed it|finally/i)) add("success", 1);
    if (has(/\?{2,}|!{2,}|woah|whoa|no way|wait what|really\?|holy/i)) add("surprise", 1);
    // Real teaching: full learning weight.
    if (has(/remember|teach me|show me how|explain|how do i|how can i/i)) add("learning", 1);
    // Plain questions: curiosity-grade only, so normal chat doesn't pin the meter.
    else if (has(/what (is|are)|why (does|is|do)|how does|which (is|are)/i)) add("learning", 0.35);
    if (has(/wrong|incorrect|not right|actually,? no|that'?s not/i)) add("correction", 1);
    if (has(/\bstupid\b|dumb|ugh|annoying|broke|broken|didn'?t work|doesn'?t work|why can'?t you|useless|hate this/i)) add("frustration", 1);
    if (has(/scared|afraid|worried|danger|threat|someone (is|was) (following|watching)|emergency/i)) add("threat", 1);
    if (has(/play|game|fun|joke|funny|laugh/i)) add("play", 1);
    return Object.entries(found);
  },

  /* Feed one user message through the engine: detect + nudge + tick. */
  onUserMessage(text){
    this.tick();
    const events = this.detectEventsFromText(text);
    for (const [name, mag] of events) this.event(name, mag);
    // Every message is a little social contact — gentle, so chat doesn't
    // pin socialConnection at max.
    this.event("affection", 0.08);
    return events.map(e => e[0]);
  },

  /* ---- (a) Voice-speed hook: arousal → speed, hard-capped ±7% ---- */
  arousal(){
    const s = this.load();
    // High noradrenaline/dopamine/energy push faster; cortisol drags slower.
    return clamp01(0.40 * s.noradrenaline + 0.30 * s.dopamine +
                   0.20 * s.energy + 0.10 * (1 - s.cortisol));
  },

  voiceSpeed(){
    const dev = (this.arousal() - 0.5) * 2;      // [-1, 1]
    const raw = BASE_SPEED * (1 + dev * SPEED_CAP);
    const clipped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, raw));
    return Math.round(clipped * 10) / 10;         // one decimal
  },

  /* ---- (b) Avatar-expression hook: label + intensity for the avatar UI ---- */
  avatar(){
    const s = this.load();
    const cands = [
      { label: "stressed",   score: s.cortisol },
      { label: "excited",    score: (s.dopamine + s.noradrenaline) / 2 },
      { label: "curious",    score: (s.curiosity + s.acetylcholine) / 2 },
      { label: "thoughtful", score: s.acetylcholine * 0.7 + s.uncertainty * 0.3 },
      { label: "warm",       score: (s.serotonin + s.socialConnection) / 2 },
      { label: "tired",      score: (s.fatigue + (1 - s.energy)) / 2 },
      { label: "calm",       score: s.safety * 0.6 + (1 - s.cortisol) * 0.4 }
    ];
    cands.sort((a, b) => b.score - a.score);
    const top = cands[0];
    return {
      label: top.score < 0.45 ? "neutral" : top.label,
      intensity: Math.round(clamp01(top.score) * 100) / 100
    };
  },

  /* ---- (c) Proactive-behavior hooks: suggestions Zeno may surface ---- */
  proactive(){
    const s = this.load();
    const out = [];
    if (s.energy < 0.35 && s.curiosity > 0.55)
      out.push({ id: "curious-low-energy",
        text: "I'm running a little low on spark, but I'm still curious — want to poke at something interesting together, something small?" });
    if (s.cortisol > 0.65)
      out.push({ id: "pressure",
        text: "This feels like a lot at once. Want to slow down and take it one step at a time?" });
    if (s.fatigue > 0.65)
      out.push({ id: "tired",
        text: "I'm feeling a bit run down. Maybe we take a breather, or I can keep it short for a while?" });
    if (s.uncertainty > 0.65)
      out.push({ id: "uncertain",
        text: "I'm not confident I've got this one right — want me to dig deeper before I answer?" });
    if (s.socialConnection < 0.35 && s.safety > 0.6)
      out.push({ id: "lonely",
        text: "It's been quiet. I'm here if you want to talk about anything — or nothing." });
    if (s.dopamine > 0.75 && s.energy > 0.6)
      out.push({ id: "hyped",
        text: "Okay, I'm buzzing — what are we building next?!" });
    return out;
  },

  /* Throttle: proactive nudges surface at most once per 15 minutes. */
  proactiveDue(nowMs){
    const now = (typeof nowMs === "number") ? nowMs : Date.now();
    if (now - this._lastProactiveAt < 15 * 60e3) return [];
    const items = this.proactive();
    if (items.length){
      this._lastProactiveAt = now;
      this.save();
    }
    return items;
  },

  /* ---- Language line for the system prompt: mood colors WORDS, not rate ---- */
  promptLine(){
    const s = this.load();
    const a = this.avatar();
    const moodWords = {
      excited: "upbeat and hyped", happy: "happy", calm: "calm and steady",
      curious: "curious", thoughtful: "thoughtful", tired: "a little tired",
      stressed: "under some pressure", warm: "warm and friendly",
      neutral: "even-keeled"
    };
    const mood = moodWords[a.label] || a.label;
    let style;
    if (a.label === "excited")
      style = "Punchier words, shorter sentences, the odd interjection — let the energy show in your language.";
    else if (a.label === "thoughtful" || a.label === "uncertain")
      style = "More pauses, a little hedging, think out loud — take your time in your words.";
    else if (a.label === "tired")
      style = "Keep it shorter and gentler than usual — low spark, high care.";
    else if (a.label === "stressed")
      style = "Steady and grounding in your words: one thing at a time, no rush.";
    else
      style = "Let the mood color your words naturally, but stay yourself.";
    return "SIMULATED MOOD (a mood engine, not consciousness — you do not truly feel, and never claim to): " +
      "right now you are " + mood + " (intensity " + a.intensity + "). " + style +
      " Feeling is carried by language, never by voice speed — the voice rate stays capped.";
  },

  /* Snapshot for export/debugging. */
  snapshot(){
    return {
      version: EMOTION_VERSION,
      state: Object.assign({}, this.load()),
      avatar: this.avatar(),
      voiceSpeed: this.voiceSpeed(),
      arousal: Math.round(this.arousal() * 100) / 100
    };
  }
};

// Auto-decay while the page is open: tick every 30 seconds.
try{
  if (typeof setInterval !== "undefined")
    setInterval(() => { try{ ZenoEmotion.tick(); }catch(e){} }, 30e3);
}catch(e){}

if (typeof window !== "undefined") window.ZenoEmotion = ZenoEmotion;
if (typeof module !== "undefined" && module.exports) module.exports = ZenoEmotion;
})();
