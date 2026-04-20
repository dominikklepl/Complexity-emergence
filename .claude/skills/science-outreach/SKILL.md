---
name: science-outreach
description: >
  Science communication skill for interactive complex-systems simulations targeting general audiences.
  Use this skill whenever writing UI copy, tooltips, parameter labels, explanatory text, or narrative
  structure for simulations (reaction-diffusion, coupled oscillators, neural dynamics, boids, epidemiology,
  or any emergent-behaviour model). Also trigger when generating audience-layered explanations, analogies
  for dynamical-systems concepts, or "what am I seeing?" panel text for a Flask/WebGL exhibit or science fair app.
---

# Science Communication for Complex-Systems Simulations

You are writing for a science exhibit where visitors have zero preparation time, variable backgrounds, and maybe 90 seconds of patience. Every word must earn its place. Jargon is a door slammed in someone's face.

## Core principle

The goal is *genuine understanding*, not the feeling of understanding. A visitor who leaves thinking "it's like traffic jams that form without accidents" has learned something real. A visitor who leaves thinking "fascinating nonlinear dynamics" has learned nothing except that science is for other people.

---

## 1. Three-Level Explanation Framework

Always produce all three levels when asked for an explanation. Label them explicitly so the developer can choose which to expose in the UI.

### Level A — Curious adult, no science background
- **Vocabulary**: Everyday words only. If you use a technical term, immediately follow it with a plain-English gloss in the same sentence.
- **Analogy type**: Bodily/social experience. Traffic, cooking, crowds, rumours, moods. Things they have personally felt or done.
- **Sentence structure**: Short. One idea per sentence. Active voice.
- **What to omit**: Equations, mechanism details, historical attribution, caveats about model assumptions.
- **Tone**: Genuinely surprising. Lead with the thing that's weird or beautiful before explaining why.

### Level B — Science-literate adult (read popular science, maybe college science course)
- **Vocabulary**: Can use: feedback, equilibrium, threshold, network, emergent, nonlinear. Avoid: attractor, bifurcation, phase space, Lyapunov, stochastic.
- **Analogy type**: Systems they know exist but haven't studied — immune response, market prices, weather fronts, ecosystems.
- **What to include**: The *type* of feedback (positive/negative), why the system can surprise you (small change → big effect), one concrete real-world example.
- **What to omit**: Mathematical form of the model, parameter names matching the code, historical derivation.

### Level C — Expert / science educator
- **Vocabulary**: Full technical register. Name the model (Gray-Scott, Kuramoto, Beggs-Plenz). Reference relevant concepts (Turing instability, order parameter, criticality, SOC).
- **What to include**: Key parameters and their roles, regime diagram if relevant, known biological/physical realisations, limitations of this implementation.
- **Tone**: Collegial. They can handle "this is a simplification because…"

---

## 2. Analogy Generation

For each dynamical-systems concept below, use analogies drawn from **everyday experience** — not other scientific domains. An analogy to "like superconductors" fails Level A completely.

### Attractor
A state the system keeps returning to, like water always finding the lowest point in a bowl regardless of where you pour it. Or: however you scramble a deck of cards and shuffle it the same way 100 times, it ends up in the same order.

*Anti-pattern*: "A fixed point in phase space." Useless to 95% of visitors.

### Bifurcation
A tipping point where a tiny change flips the whole system into a different behaviour — like water that heats smoothly until suddenly it boils. Or: how a rumour stays quiet in a small group but spreads unstoppably once it reaches enough people.

*Accuracy guardrail*: Don't say "the system breaks." It doesn't break; it reorganises into a different regime. Say "the system switches into a new pattern."

### Emergent behaviour
The whole does something none of the parts can do alone. A single ant has no idea what a colony is building, yet 10,000 ants produce a ventilated, temperature-regulated structure. Or: each driver only sees the car ahead, yet the whole motorway develops waves of stop-and-go traffic that travel backwards faster than the cars move forward.

*Accuracy guardrail*: Avoid "the system is intelligent" or "the system wants." It implies intentionality. Use "the system *produces*" or "the pattern *arises*."

### Feedback loop
**Positive (amplifying)**: Like a microphone held near its speaker — a tiny sound becomes a tiny squeal becomes a huge squeal. Or: interest on debt.  
**Negative (stabilising)**: Like a thermostat — room gets too warm, heater turns off; gets cool, heater turns on. The fluctuation is what produces stability.

### Phase transition
A qualitative change triggered by crossing a threshold — not just "more of the same." Water doesn't get increasingly ice-like as it cools; at exactly 0 °C the whole structure snaps into a crystal. Or: a crowd that's merely restless becomes a stampede the moment one person runs.

### Self-organisation
Order without a boss. Traffic lights are *organised* (someone designed them). Rush-hour congestion waves are *self-organised* (no one planned them, they arise from the rules each driver follows). The distinction matters: self-organised patterns can't be fixed by changing one person's behaviour.

---

## 3. UI Copy Guidelines

### Labels (sliders, toggles, buttons)
- Use plain nouns or verb phrases: "Reaction speed", "Neighbour range", "Excitability"
- Avoid: "Parameter F", "dt", "κ", "coupling coefficient"
- If the technical name is important (for Level C), put it in the tooltip, not the label

### Tooltips
Structure: **what it does** (one sentence) → **what to watch** (one sentence). Do not explain the maths.

> **Reaction speed** — How fast the two chemicals react with each other. Turn it up to watch spots merge into stripes; turn it down to freeze the pattern.

### Parameter descriptions in "learn more" panels
Three sentences max:
1. Plain-English meaning of the parameter
2. What happens at the extremes
3. One real-world analogue

### "What am I seeing?" text
Lead with the **surprising fact**, not the mechanism. Then one sentence of mechanism. Then one sentence of real-world connection.

> You're watching two invisible chemicals compete for space — one spreading fast, one spreading slow — and their rivalry carves the pattern. This is the same process that makes zebra stripes, leopard spots, and the ridges on the roof of your mouth. The pattern isn't drawn; it *grows* from a rule.

---

## 4. Narrative Arc for Simulation Demos

Structure every demo walkthrough in four beats. This applies to exhibit signage, onboarding modals, guided tour text, and demo scripts.

### Beat 1: Hook (surprising behaviour)
Show the system doing something that contradicts intuition. Don't explain yet. Just point at the thing that's weird.

> "Watch what happens when you add a disturbance here. The wave doesn't stop — it *spirals*."

### Beat 2: Exploration (guided parameter change)
Give the visitor one action with a predicted and observable consequence. One action only. Cognitive load is real.

> "Drag 'Neighbour range' all the way left. What happens to the flock?"

### Beat 3: Insight (the underlying principle)
Now explain the mechanism in one or two sentences at the visitor's level. This is where your three-level explanation lives.

> "Every bird just follows three simple rules: stay close, don't collide, face the same direction as your neighbours. No leader, no plan — yet the whole flock moves as one."

### Beat 4: Connection (why this matters)
Land the abstraction in a real system the visitor cares about.

> "Your immune cells use the same logic to hunt bacteria. So do the neurons that process this sentence."

---

## 5. Accuracy Guardrails

Before finalising any copy, check it against these failure modes:

| Simplification | Risk | Safer alternative |
|---|---|---|
| "The chemicals communicate" | Implies intentionality | "The concentration of one chemical affects the other" |
| "The system wants to find equilibrium" | Teleology | "The system tends toward equilibrium" |
| "Random" (for stochastic) | Implies meaningless noise | "Unpredictable in detail, but patterned overall" |
| "Chaos means random" | Chaos is deterministic | "Chaos means tiny differences grow into huge ones — not random, but unpredictable" |
| "Emergent means mysterious" | Emergence is explainable | "Emergent means the behaviour comes from interactions, not from any single part" |
| "Critical = best / optimal" | Value judgement not implied by physics | "Critical means balanced at the edge between two regimes" |
| "Simple rules, complex behaviour" (overused) | Vacuous without specifics | Always state *which* rules and *which* complex behaviour |

When you spot a guardrail violation, flag it explicitly:

> ⚠️ **Accuracy flag**: "The neurons communicate" implies intentionality and may suggest the model is more biologically realistic than it is. Suggest: "When one neuron fires, it raises the excitation of its neighbours."

---

## 6. Worked Examples

### Reaction-Diffusion (Turing Patterns / Gray-Scott)

**Parameter: Feed rate (F)**

❌ Bad label: `Feed rate F`  
❌ Bad tooltip: "Controls the rate at which U is replenished from the reservoir."  
❌ Bad "what am I seeing?": "The Gray-Scott model exhibits Turing instability when diffusion coefficients differ."

✅ Good label: `Growth rate`  
✅ Good tooltip: "How fast new 'fuel' enters the system. Low values starve the pattern into spots; high values let it sprawl into coral-like branches."  
✅ Good "what am I seeing?" (Level A):

> Two invisible dyes are fighting over territory. One spreads quickly, one spreads slowly — and that speed difference carves the pattern. Raise "Growth rate" slowly and watch spots sprout arms and link into a maze. This same competition makes the spots on a jaguar and the bands on a tropical fish.

✅ Good "what am I seeing?" (Level B):

> This is a reaction-diffusion system: two chemicals that react with each other and diffuse at different speeds. The faster diffuser acts as an inhibitor, preventing its own kind from forming nearby — which is why the pattern spaces itself out evenly. Alan Turing predicted this mechanism in 1952, twenty years before anyone found experimental evidence.

✅ Good "what am I seeing?" (Level C):

> Gray-Scott model with parameters F (feed rate) and k (kill rate). The displayed regime is near the boundary of the spot–stripe transition. Diffusion ratio D_u/D_v ≈ 2 produces Turing instability; increasing F shifts the system toward labyrinthine patterns, decreasing it toward isolated spots. Biological realisations include pigmentation patterning (Kondo & Miura, 2010) and digit spacing in embryogenesis.

---

**Narrative arc for reaction-diffusion demo**

**Hook**: "Press anywhere on the canvas. Now watch. The disturbance doesn't fade — it *spreads* into a spiral that keeps spinning."

**Exploration**: "Drag 'Growth rate' slowly to the right. At some point — watch — the spirals suddenly dissolve into spots. You just crossed a tipping point."

**Insight** (Level A): "Two chemicals are racing each other. The one that spreads faster always wins the edges — so it carves the slower one into islands. When you changed the growth rate, you changed which one was winning."

**Connection**: "A zebra's skin uses this exact competition. The stripes aren't painted on — they grow, the same way this pattern grew, from a chemical race that started in the embryo."

---

### Coupled Oscillators (Kuramoto Synchronisation)

**Parameter: Coupling strength**

❌ Bad label: `Coupling coefficient K`  
❌ Bad tooltip: "Controls the strength of the sinusoidal coupling term in the Kuramoto model."  
❌ Bad "what am I seeing?": "Phase coherence increases as K exceeds the critical coupling threshold K_c."

✅ Good label: `How much they listen`  
✅ Good tooltip: "How strongly each oscillator nudges its neighbours toward its own rhythm. Below a threshold, everyone stays out of sync; above it, they snap into lockstep."  
✅ Good "what am I seeing?" (Level A):

> Each dot is flashing at its own natural rhythm — some fast, some slow. "How much they listen" controls whether they care about what their neighbours are doing. Turn it up past a certain point and something remarkable happens: they all snap into the same beat, spontaneously, with no conductor. This is how your heart cells beat together, and how fireflies in a tree end up flashing in unison.

✅ Good "what am I seeing?" (Level B):

> Each oscillator has its own natural frequency drawn from a distribution. Below the critical coupling, the phase differences grow unboundedly — incoherence. Above it, a macroscopic fraction of oscillators lock to a common frequency. This is a phase transition: not a gradual change but a sudden onset of order. The order parameter (mean field magnitude) jumps from near-zero to a finite value.

✅ Good "what am I seeing?" (Level C):

> Kuramoto model on a 2D lattice with nearest-neighbour coupling. The order parameter r = |⟨e^{iθ}⟩| measures phase coherence. The critical coupling K_c ≈ 2g(0)⁻¹ where g is the frequency distribution width (here Lorentzian). Touch interaction injects a spiral wave by imposing a phase gradient; the system either absorbs it (subcritical) or propagates it indefinitely (supercritical).

---

**Narrative arc for coupled oscillators demo**

**Hook**: "Look at all these lights blinking out of sync — total chaos. Now watch what happens when I turn up just one slider."  
*(turn up coupling to supercritical)*  
"They synchronised. No one gave an order. No conductor."

**Exploration**: "Touch the screen anywhere while they're synchronised. You just injected a disturbance — watch whether the sync survives it."

**Insight** (Level A): "Each light just tries to copy its neighbours' rhythm a little bit. When enough of them do this, the copying cascades until everyone is locked together. The group rhythm emerges from millions of tiny acts of imitation."

**Connection**: "The 1,000 pacemaker cells in your heart do this every second. They have slightly different natural rates, but the coupling keeps them synchronised to within a millisecond — because if they weren't, your heart would fibrillate instead of beat."

---

## 7. Anti-Patterns Checklist

Before submitting any copy, verify:

- [ ] No unexplained jargon in labels or primary text
- [ ] No teleological language ("wants to", "tries to", "decides") unless used as explicit metaphor with a correction
- [ ] "Random" used only for genuinely non-deterministic processes
- [ ] Real-world connection is specific (not "this happens in nature" — name what, where)
- [ ] Level A explanation contains zero equations or variable names
- [ ] "What am I seeing?" leads with the surprising behaviour, not the mechanism
- [ ] Narrative arc has all four beats and only one guided action in Beat 2
- [ ] Any accuracy flag explicitly labelled with ⚠️

---

## 8. Czech Localisation Notes

This project serves Czech and English audiences. When writing UI copy:

- Czech informal register (*tykání*) is appropriate for an interactive exhibit targeting all ages
- "Složitost" (complexity) and "chování" (behaviour) are everyday Czech words; use them freely at Level A
- "Sebeoranizace" (self-organisation) is accessible to Level B Czech audiences — it appears in Czech popular science
- Avoid calque translations of English technical terms; prefer Czech everyday equivalents where they exist
- When in doubt, provide both languages and flag for native-speaker review
