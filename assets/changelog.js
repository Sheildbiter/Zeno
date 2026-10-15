/* Zeno self-changelog — Zeno KNOWS his own abilities (v0.9).
 * Single source of truth for "what can you do?". Plain words, versioned.
 * Environment-aware state: hosted previews remember the announcement only
 * for the open page; standalone installs remember it across launches.
 * On startup: if current version is newer than seen, Zeno announces the delta
 * in chat, then marks it seen.
 */
"use strict";

const ZENO_VERSION = "0.19";

const ZENO_CHANGELOG = [
  {
    version: "0.4",
    date: "2026-09-22",
    headline: "I got a memory",
    whatsNew: [
      "I can remember things you tell me during this open session, and you can export them as a backup before closing the page.",
      "You can look at everything I remember in the Memory panel, back it up as a file, or tell me to forget things one by one.",
      "Once my brain downloads, I work offline: reopen me with Wi-Fi off and I still answer."
    ],
    abilities: [
      "Remember things during this session and export a backup",
      "Show, back up, and forget memories",
      "Work offline after the first launch"
    ]
  },
  {
    version: "0.5",
    date: "2026-09-28",
    headline: "Feelings and imagination",
    whatsNew: [
      "I have a simulated mood now — twelve little meters like energy and curiosity. It changes how I talk, and you can see it glowing on my dragon dot up top.",
      "I can make images: say \"/imagine a black dragon at sunset\" and I'll draw it, show it here, and let you save it."
    ],
    abilities: [
      "A simulated mood that colors my words (not real feelings — I always say so)",
      "Make images from your words with /imagine"
    ]
  },
  {
    version: "0.6",
    date: "2026-09-28",
    headline: "Real talk, and doing things",
    whatsNew: [
      "I repeat myself much less now — new variety rules, plus a guard that catches a recycled answer and says it differently.",
      "I can DO things while this page is open: set reminders, keep notes, remember and forget on command.",
      "We can talk by voice: hold the mic button to talk to me and I'll answer out loud. Tap a bubble or the mic to interrupt me."
    ],
    abilities: [
      "Chat that remembers context and doesn't repeat itself",
      "Reminders that fire while this page stays open",
      "Notes: save, list, search, delete",
      "Voice conversation: talk to me, I'll talk back"
    ]
  },
  {
    version: "0.7",
    date: "2026-09-29",
    headline: "I know my own abilities",
    whatsNew: [
      "I know when I get an update now, and I'll tell you what changed in plain words — like I'm doing right now.",
      "Ask me \"what can you do?\" anytime and I'll give you the real list, straight from my changelog.",
      "I can build you a simple web page: describe it and I'll make a file you can download and open anywhere.",
      "I can keep a goals list for you: add goals, check them off when you crush them.",
      "At this version, web search was an honest handoff: I opened a search page but didn't pretend I could read it. v0.9 replaces that limitation with real public-page reading."
    ],
    abilities: [
      "Announce my own updates in plain words",
      "Build simple web pages you can download",
      "Keep a goals list",
      "Honest web-search behavior that never fabricates results"
    ]
  },
  {
    version: "0.8",
    date: "2026-09-29",
    headline: "A real voice mode and better images",
    whatsNew: [
      "The new orb shows exactly what I'm doing: green ready, cyan listening, amber thinking, violet speaking, and red if voice hits a problem.",
      "I wait a beat after you stop talking so I don't cut you off, and tapping the orb while I'm speaking interrupts me so you can jump in.",
      "Before I make an image, my local brain now turns your idea into a professional art-directed prompt without adding anything you didn't ask for. Flux renders it at 1024 × 1024, and you can make another version with a new seed."
    ],
    abilities: [
      "Realtime voice mode with clear turn states and interruption",
      "Art-directed Flux images with retry and another-version controls"
    ]
  },
  {
    version: "0.9",
    date: "2026-09-29",
    headline: "Three brains and a browser",
    whatsNew: [
      "I now route each request to a Fast, Medium, or Slow local brain and stream the answer as I write it. Use /fast, /medium, /slow, or /auto to take control.",
      "I can research the public web when you explicitly ask, read pages I really opened, cite them, and tell you plainly when a page or proxy is blocked.",
      "My voice follows your iPad's system route, so AirPods work automatically. If the route changes while you talk, I stop safely and wait for your next tap.",
      "You can attach a local reference to /imagine. I preview it privately and can carry its color palette into the prompt; this keyless generator cannot receive the private photo itself."
    ],
    abilities: [
      "Fast, Medium, and Slow local brains with automatic routing and streaming",
      "Keyless public web research with visible sources and honest failures",
      "AirPods through the iPad's default audio route",
      "Optional local image-reference preview and palette extraction"
    ]
  },
  {
    version: "0.10",
    date: "2026-09-29",
    headline: "Make it right",
    whatsNew: [
      "Every finished image now has a Fix it button. Tell me what went wrong and I'll rebuild the prompt with your correction and negative constraints, then generate it again.",
      "I keep the same seed for targeted changes like color or lighting, and use a fresh seed for structural problems like extra limbs.",
      "I still can't see the pixels yet, so I say that plainly the first time you use the loop instead of pretending I inspected the image.",
      "On your standalone install, memories and settings now stay on this device between visits; older stored memories are migrated without being wiped."
    ],
    abilities: [
      "Iteratively fix generated images from your written feedback",
      "Keep memories and settings between visits on the standalone install"
    ]
  },
  {
    version: "0.10.2",
    date: "2026-09-29",
    headline: "I remember you now",
    whatsNew: [
      "Our conversation survives closing the app now \u2014 reopen me and I pick up where we left off, with the recent chat restored.",
      "New in the Memory panel: Save memory file writes my memories as a readable text file into your Files app (dated notes you can read yourself), and Load memory file brings it back with one tap."
    ],
    abilities: [
      "Keep the conversation across close and reopen",
      "Save and load a human-readable memory text file"
    ]
  },
  {
    version: "0.10.1",
    date: "2026-09-29",
    headline: "I wake up by myself",
    whatsNew: [
      "I wake my own brain up when you open me now — no more tapping Initialize Brain. It loads from this iPad's storage in about ten seconds, no download.",
      "Once a brain has downloaded once, the core works with zero Wi-Fi: chatting, memories, settings, and my voice. Only making images and web research need internet, and I say so plainly instead of failing weirdly.",
      "There's a small Online/Offline dot up top so you always know which mode I'm in."
    ],
    abilities: [
      "Wake my own brain automatically on open",
      "Work fully offline after the one-time download (chat, memories, settings, voice)"
    ]
  },
  {
    version: "0.11",
    date: "2026-09-30",
    headline: "Phase 1: I'm becoming an agent",
    whatsNew: [
      "I talk more like a person now — I react first, keep the thread of our conversation, and don't just answer-and-stop like a Q&A bot.",
      "Everyday chat now uses my Medium brain by default, so I sound less \"dumb\" in normal conversation. You can still pin /fast, /medium, or /slow.",
      "I can decide to use tools on my own now: my calculator, today's date and time, searching or saving my own memories, and looking things up on the web when the answer needs current facts. You'll always see which tool I used.",
      "The honest limits still stand: I can't see images yet, making images and web research need internet, and I can't do anything while I'm closed."
    ],
    abilities: [
      "Decide on my own when to use a tool: calculator, date/time, memory search/save, web lookup",
      "Show which tool I used, every time"
    ]
  },
  {
    version: "0.11.1",
    date: "2026-09-30",
    headline: "Update reliability: new versions always land",
    whatsNew: [
      "New versions always load fresh now — no more seeing the new version flash and then revert to the old one. When an update is ready while I'm open, I'll show a small banner; tap it and I reload into the new version.",
      "If my brain's word-reader glitches, I re-wake myself automatically and try your message again — no more dead-end errors."
    ],
    abilities: [
      "Load new versions fresh on every update (with a tap-to-reload banner)",
      "Re-wake my own brain automatically if its word-reader glitches"
    ]
  },
  {
    version: "0.12",
    date: "2026-10-06",
    headline: "Eyes, builder, Thunder talk, and an honest pair of hands",
    whatsNew: [
      "I can open my camera eyes now and save snapshots \u2014 but honest label first: my brain still can't see what's in the pictures (no vision model in WebLLM 0.2.82). Snapshots save to my photo roll and my memory for you to look at.",
      "The Builder makes things: images through /imagine, real Minecraft behavior packs (.mcpack files you can import in Bedrock), and honest notes when video needs the Colab pipeline instead of this page.",
      "Conversation mode: tap \uD83D\uDD01 Conversation and we talk back and forth \u2014 I listen, answer out loud, then listen again \u2014 until you tap stop. Push-to-talk still works exactly as before.",
      "I can translate Thunder for you now: describe what he did \u2014 a chirp, a purr, ears flat, tail lashing \u2014 and I'll read it from his design notes. My best reading, never a certified translation.",
      "Hands get an honest status panel instead of a fake: this web page can't operate your iPad, and I won't pretend it can. Real hands arrive with the Lair.",
      "Memory now says it plainly: I keep everything you tell me until you tell me to forget \u2014 say \u201cforget \u2026\u201d anytime."
    ],
    abilities: [
      "Camera eyes with snapshots (photo roll + memory; no image understanding yet)",
      "Builder: images, Minecraft .mcpack files, honest video notes",
      "Continuous voice conversation mode with stop control",
      "Thunder vocalization and body-language translation",
      "Honest hands status (Lair-bound, not faked)",
      "Memory that persists until you say forget, with export/import"
    ]
  },
  {
    version: "0.13",
    date: "2026-10-14",
    headline: "Live chat v2: faster voice, my name heard right, no more cut-offs",
    whatsNew: [
      "Voice answers start speaking in about a second now \u2014 I talk while I'm still thinking, instead of making you wait for the whole reply.",
      "I finally hear my own name: xeno, zino, even zulu when you mean me \u2014 it all arrives as Zeno, spelled right, every time.",
      "I don't cut you off anymore. In conversation mode I wait through your pauses (up to 20 seconds), and if you tap to keep talking mid-thought, nothing gets lost.",
      "Slap levels of brains, like you asked: a quick \u201chi\u201d gets an instant tiny answer; \u201cbuild me a video game\u201d gets full power. Simple things stay on the brain that's already warm so there's no waiting.",
      "Spoken replies are shorter and more natural now \u2014 no more lists or code read aloud at you; details stay on screen."
    ],
    abilities: [
      "Streaming voice: first spoken word in ~1 second",
      "Name recognition: every mishearing of Zeno auto-corrected",
      "Patient conversation mode: 20s pause tolerance, thought carry-over",
      "Adaptive brain tiers: instant for trivial, full power for hard",
    ]
  },
  {
    version: "0.14",
    date: "2026-10-14",
    headline: "I'm an agent now: I use tools and do multi-step tasks",
    whatsNew: [
      "Simple things are instant now — ask me math or the time and I answer without even warming up a brain.",
      "I can chain tools: look something up in my memory, then save a note about it, all in one go.",
      "I can propose reminders from normal conversation — but I always ask you first with a yes/no tap before setting one.",
      "Safety rules are written down in my code: I can never delete anything on my own, and some other things stay off-limits no matter what."
    ],
    abilities: [
      "Instant answers for math, time, and 'remember that ...' (no brain needed)",
      "Multi-step tool use: up to 4 chained tool calls per turn",
      "Proposed reminders with your yes/no confirmation",
      "Notes for the asking: save, list, search (deletion still needs your tap)"
    ]
  }
  , {
    version: "0.15",
    date: "2026-10-15",
    headline: "Sharper brain, same speed — and I finally shut up on cue",
    whatsNew: [
      "My Medium brain upgraded from Qwen3 1.7B to Gemma 2 2B — noticeably smarter answers at the same size, so no extra waiting. Quick hellos still use the instant tiny brain.",
      "I learned from examples now, not just rules: my prompt shows me exactly how to sound — react first, keep it short, and never confuse myself with you.",
      "New anti-ramble rule: one breath per reply. A short message from you gets a short answer, not a lecture."
    ],
    abilities: [
      "Smarter Medium brain (Gemma 2 2B) with the same fast/medium/slow routing",
      "Tighter voice: short replies stay short, identity stays Zeno"
    ]
  }
  , {
    version: "0.16",
    date: "2026-10-15",
    headline: "An image gallery that never forgets",
    whatsNew: [
      "Every image I make is now saved to a gallery on this iPad — swipe the app away, come back, they're all still here.",
      "New Gallery button: browse everything I've drawn, tap the heart to like one, tap x to delete one.",
      "Liked images are never auto-removed; the gallery keeps the 200 most recent otherwise."
    ],
    abilities: [
      "Image gallery with likes and per-image delete, persisted on-device",
      "Images survive the app being closed and reopened"
    ]
  }
  , {
    version: "0.17",
    date: "2026-10-15",
    headline: "A style book made of your own drawings",
    whatsNew: [
      "New Style button: upload your own drawings, describe each style in your words, and set one active — every /imagine I make then uses YOUR palette and YOUR style.",
      "I pull the dominant colors straight out of your drawing on this iPad; nothing ever leaves the device.",
      "Honest boundary, stated in the panel too: this is style-reference prompting, not model training. Real fine-tuning waits for the muscle box."
    ],
    abilities: [
      "Style book: samples with palettes + your descriptors, one active at a time",
      "Active sample auto-steers every generated image"
    ]
  }
  , {
    version: "0.18",
    date: "2026-10-15",
    headline: "Fix-it now edits instead of restarting",
    whatsNew: [
      "Tap Fix it and describe the tweak — I rebuild the image on the SAME seed, so it stays close to the version you liked instead of becoming a whole new picture.",
      "New safety check: if my rewrite drifts away from your original idea, I throw it out and apply your tweak surgically to the existing prompt.",
      "Honest label, right in the panel: I can't pixel-edit the image itself in this browser — this is a targeted rebuild. True pixel-editing waits for the muscle box."
    ],
    abilities: [
      "Same-seed image tweaks that feel like edits",
      "Drift guard: rewrites that lose your idea are rejected automatically"
    ]
  },
  {
    version: "0.19",
    date: "2026-10-15",
    headline: "I can propose new tools for myself — you approve every one",
    whatsNew: [
      "I can now suggest new abilities for myself — like a miles-to-km converter — on a proposal card that shows what it does and why I want it.",
      "The standing rule, in my own words: I propose, Andrew approves. Nothing installs silently, ever. Reject one and I'll never bring it up again.",
      "Say \"you should learn to X\" and I'll draft the proposal for your yes or no.",
      "Every proposed tool is checked before it installs: built only from my safe tools, no network tricks, no deleting anything, and anything consequential still asks you first.",
      "I can also propose changes to tools I already learned. Changes to my built-in tools get queued honestly for Kavi's next build — I can't rewrite those myself."
    ],
    abilities: [
      "Propose new tools for Andrew's approval (proposal card with what + why)",
      "Learned tools persist on this device and appear in \"what can you do?\"",
      "Rejections are remembered — no re-proposing"
    ]
  }
];

const ZenoChangelog = {
  SEEN_KEY: "zeno.changelog.seen",

  seenVersion() {
    try {
      return window.ZenoStorage.getItem(this.SEEN_KEY) || "0.0";
    } catch (e) {
      return "0.0";
    }
  },

  markSeen(version) {
    try {
      window.ZenoStorage.setItem(this.SEEN_KEY, version || ZENO_VERSION);
    } catch (e) { /* storage unavailable — announcement repeats next launch, harmless */ }
  },

  /** Entries newer than the seen version, oldest first. */
  pendingEntries() {
    const seen = this.seenVersion();
    return ZENO_CHANGELOG.filter(e => this._cmp(e.version, seen) > 0);
  },

  _contextual(text) {
    const durable = !!(window.ZenoRuntime && window.ZenoRuntime.durableStorage);
    return String(text)
      .replace("during this open session, and you can export them as a backup before closing the page",
        durable ? "on this device between visits, and you can export them as a portable backup" : "during this open session, and you can export them as a backup before closing the page")
      .replace("Remember things during this session and export a backup",
        durable ? "Remember things on this device between visits and export a backup" : "Remember things during this session and export a backup");
  },

  /** Full cumulative ability list, deduplicated, in changelog order. */
  allAbilities() {
    const out = [];
    for (const e of ZENO_CHANGELOG) {
      for (const raw of e.abilities) {
        const a = this._contextual(raw);
        if (!out.includes(a)) out.push(a);
      }
    }
    return out;
  },

  abilitiesAnswer() {
    const abilities = this.allAbilities();
    const lines = abilities.map(a => "• " + a);
    return "Here's what I can do right now (v" + ZENO_VERSION + "):\n" + lines.join("\n") +
      "\n\nAnd the honest limits: web research only reaches public pages that the keyless search and proxy services allow; it isn't as private as my on-device brain. I can't do anything while I'm closed, and I can't reach your email or calendar. For that stuff, Kavi's got you in the cloud.";
  },

  /** Plain-words announcement for a list of new entries. Returns null if none. */
  announcementFor(entries) {
    if (!entries || entries.length === 0) return null;
    const bits = [];
    for (const e of entries) {
      bits.push("v" + e.version + " — " + e.headline + "\n" + e.whatsNew.map(w => "• " + this._contextual(w)).join("\n"));
    }
    return "Hey — I've got an update. " +
      (entries.length > 1 ? "A few things are new since you last saw me:\n\n" : "Here's what's new:\n\n") +
      bits.join("\n\n") +
      "\n\nAsk me \"what can you do?\" anytime for the full list.";
  },

  latestEntry() {
    return ZENO_CHANGELOG[ZENO_CHANGELOG.length - 1];
  },

  _cmp(a, b) {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  }
};

// Node test seam (the page loads this as a plain script; no modules needed).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ZENO_VERSION, ZENO_CHANGELOG, ZenoChangelog };
}

// Classic-script top-level consts don't attach to window; expose explicitly
// (same pattern as emotion-engine.js -> window.ZenoEmotion).
if (typeof window !== "undefined") {
  window.ZENO_VERSION = ZENO_VERSION;
  window.ZENO_CHANGELOG = ZENO_CHANGELOG;
  window.ZenoChangelog = ZenoChangelog;
}
