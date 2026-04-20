# Science-outreach text review — Veletrh Vědy 2026 exhibit

## Context

Exhibit copy lives in `config.toml` + per-sim `translations` blocks in `static/js/sims/*.js`. Visitors ≤90s, mixed backgrounds, CS/EN. Reviewed vs `science-outreach` skill. This plan = concrete edits for implementation by simpler model. Keep changes minimal, surgical, do NOT touch code structure — only text values.

---

## Critical bugs (fix first)

### B1. Kuramoto explain_a references slider that doesn't exist
- File: `static/js/sims/kuramoto.js` (line 326), `config.toml` line 230
- Issue: explain_a tells user to "Posuvník 'Kolik naslouchají' ovládá..." / "The slider controls..." but actual slider label = "Síla propojení (K)" / "Connection strength (K)". Broken instruction.
- Fix: either rename slider OR update explain_a. **Choose: update explain_a** (keep K badge visible for Level C).
  - CS replace `Posuvník 'Kolik naslouchají' ovládá, jak moc každé světlo kopíruje sousedy.` → `Posuvník 'Síla propojení' určuje, jak moc každé světlo kopíruje sousedy.`
  - EN replace `The slider controls how much each light copies its neighbours.` → `The 'Connection strength' slider controls how much each light copies its neighbours.`

### B2. Grammar — RD fallback desc_cs
- File: `static/js/sims/reaction-diffusion.js` line 298
- `Dvě jednoduché chemické pravidla` → `Dvě jednoduchá chemická pravidla` (neuter plural)
- `config.toml` override already correct; fallback only triggers if config missing. Still fix.

### B3. Boids explain_a EN slider name mismatch
- File: `static/js/sims/boids.js` line 630, `config.toml` line 329
- EN says `Drag 'Perception range' left` but actual label = `Perception` (lbl_perception_en = "Perception"). 
- Fix: either EN label → `Perception range` (preferred, clearer) OR explain_a → `'Perception'`. **Choose: change label to `Perception range`** in `config.toml` line 279 + JS line 615. CS label `Vnímání` — also rename to `Dosah vnímání` for parity. Update explain_a_cs reference `'Vnímání'` → `'Dosah vnímání'`.

---

## Accuracy guardrail violations

### A1. Neural — "where the brain works best" = value judgement
Skill explicitly flags `Critical = best / optimal`. Appears in:
- `config.toml` line 351, 354, 380, 384 (CS+EN) and JS lines 548, 551, 574.
- Replace in taglines/desc/explain:
  - CS `právě tam pracuje nejlépe` / `tam mozek pracuje nejlépe` → `právě tam zvládne zpracovat jak šepot, tak bouři`
  - EN `where it works best` / `where the brain works best` → `where it can process both a whisper and a thunderclap`
- Rationale: frames criticality as *dynamic range / flexibility*, not optimality.

### A2. Neural — "Too much: seizure" oversimplifies
Skill: avoid misleading causal claims. True SOC supercritical regime ≠ clinical seizure.
- Keep word `záchvat/seizure` as preset name (punchy, recognisable) but in desc/explain soften:
  - CS `Příliš mnoho: záchvat` → `Příliš mnoho: lavina se nezastaví — mozek „hoří" jako při záchvatu`
  - EN `Too much: seizure` → `Too much: the avalanche never stops — the brain 'runs away' like in a seizure`

### A3. RD — "spiral that spins endlessly" is regime-specific
Gray-Scott at default params often produces spots, not spirals. Over-promise.
- File: JS line 316/317, `config.toml` line 154/155.
  - CS `disturbance se neroztratí, ale rozroste se do spirály, která se točí donekonečna` → `tvá stopa se neroztratí — rozroste se do nového vzoru, někdy do vlny, někdy do spirály`
  - EN `it doesn't fade, it grows into a spinning spiral` → `your trace doesn't fade — it grows into a new pattern, sometimes a wave, sometimes a spiral`

### A4. RD — "This exact chemical competition makes zebra stripes"
Same *type* of mechanism ≠ this exact model.
- CS `Přesně takový souboj chemikálií tvoří` → `Stejný typ chemického souboje tvoří`
- EN `This exact chemical competition makes` → `This same type of competition makes`

---

## Register inconsistency (tykání vs. vykání)

Skill: informal tykání appropriate. Current state is mixed: `desc_*` uses vykání (`Posuňte`, `Klikněte`, `Zvyšte`), `explain_a_*` uses tykání (`Přidej`, `Posuň`, `Přetáhni`, `Tvůj mozek`). Unify to **tykání everywhere** (exhibit audience, warmer).

Files + replacements (CS only):
- `config.toml` desc_cs entries:
  - rd line 100: `Posuňte posuvníky a sledujte` → `Posuň posuvníky a sleduj`
  - osc line 183: `Zvyšte propojení a sledujte, jak se sladí` → `Zvyš propojení a sleduj, jak se sladí`
  - boids line 256: `Klikněte levým tlačítkem pro přitahování, pravým pro odpuzování` → `Klikni levým tlačítkem pro přitahování, pravým pro odpuzování`
  - neural line 354: `Posuňte propojení a sledujte přechod` → `Posuň propojení a sleduj přechod`
- Same edits in JS fallback `desc.cs` (rd:298, osc:309, boids:605, neural:551)
- Neural desc_cs line 354: `Váš mozek žije na hraně` → `Tvůj mozek žije na hraně` (match explain_a). Same in JS 551 + snap_sub line 380 `Váš mozek` → `Tvůj mozek`.
- Touch hint (`i18n.js` line 27): `Klikněte na plátno a přidejte nové vzory` → `Klikni na plátno a přidej nové vzory`.

EN: already consistent imperative. No change.

---

## Tooltip structure (what it does → what to watch)

Current tooltips give analogy but no *observation prompt*. Skill pattern: one sentence mechanism + one sentence "what to watch". Edit parameter tooltips in `config.toml`.

### RD (lines 113–129)
- `tip_f_cs` append: ` Zvyš → vzor se rozrůstá. Sniž → vzor se tenčí na tečky.`
- `tip_f_en` append: ` Raise → pattern grows. Lower → pattern thins into spots.`
- `tip_k_cs` append: ` Zvyš → tečky se rozpouští. Sniž → tečky splývají do pruhů.`
- `tip_k_en` append: ` Raise → dots dissolve. Lower → dots merge into stripes.`
- Du/Dv (fixed): keep current text (no watch-prompt needed since user can't move).

### Kuramoto (lines 198–209)
- `tip_K_cs` append: ` Posuň doprava → všechna světla se sladí do jednoho rytmu.`
- `tip_K_en` append: ` Slide right → all lights lock into one rhythm.`
- `tip_omega_*`: append `Zvyš → bliká rychleji (globálně). / Raise → everything flashes faster.`
- `tip_spread_*`: append `Víc rozdílů = těžší synchronizace. / More spread = harder to synchronise.`

### Neural — add missing tips
No parameter tooltips exist in config.toml for σ/ε/λ. Add after line 363:
```toml
# σ (connectivity)
tip_sigma_name_cs = "= propojení"
tip_sigma_name_en = "= connectivity"
tip_sigma_cs = "Jak silně neuron nabudí své sousedy, když sám vystřelí. Zvyš → vlny se rozrůstají. Sniž → ticho."
tip_sigma_en = "How strongly a firing neuron excites its neighbours. Raise → cascades grow. Lower → silence."
# ε (background noise)
tip_eps_name_cs = "= pozadí"
tip_eps_name_en = "= background"
tip_eps_cs = "Kolik spontánních výbojů vzniká samo od sebe. Zvyš → víc lavin začíná."
tip_eps_en = "How many spontaneous sparks arise. Raise → more avalanches start."
# λ (memory / leak)
tip_lambda_name_cs = "= paměť"
tip_lambda_name_en = "= memory"
tip_lambda_cs = "Jak dlouho si neuron pamatuje předchozí nabuzení. Vyšší paměť → delší dozvuky."
tip_lambda_en = "How long a neuron remembers past charge. Higher memory → longer echoes."
```
(Implementer note: wiring PARAM_TIPS into `neural-criticality.js` equation panel is out of scope unless trivial. If equation panel already lacks tip rendering, just add strings to config so they're available for future use — don't add new render code.)

---

## Level-B / Level-C panels (optional add, flag as P2)

Skill says produce **all three levels**. Currently only Level A (`explain_a`) rendered. Proposal: add `explain_b_cs/en` + `explain_c_cs/en` to `config.toml` per sim. Render behind "Hloubka / Deeper" toggle in "Co vidím?" panel.

**Scope decision:** Simpler model should **add config strings only** (content below). Do NOT add UI toggle or render wiring — existing render code shows only `explain_a`; extending render is a separate task.

Draft Level B/C text per sim (add to `config.toml`):

### RD
```
explain_b_cs = "Systém reakce a difúze: dvě chemikálie reagují a šíří se různou rychlostí. Rychlejší hraje roli inhibitoru — brání vzniku svých sousedů. Proto se vzor pravidelně rozmisťuje. Alan Turing popsal tento mechanismus v roce 1952, dvacet let před prvním experimentálním důkazem."
explain_b_en = "A reaction–diffusion system: two chemicals react and diffuse at different speeds. The faster one acts as an inhibitor, suppressing its own kind nearby. That's why the pattern spaces itself evenly. Alan Turing described this in 1952, twenty years before experimental confirmation."
explain_c_cs = "Gray-Scottův model s parametry f (přísun) a k (odbourávání). Poměr difuzivit D_u/D_v = 2 vyvolává Turingovu nestabilitu. Zobrazený režim leží blízko hranice přechod tečky-labyrint. Biologické realizace: pigmentace kůže (Kondo & Miura 2010), rozestup prstů v embryogenezi."
explain_c_en = "Gray-Scott model with parameters f (feed) and k (kill). Diffusivity ratio D_u/D_v = 2 triggers Turing instability. The shown regime sits near the spot–labyrinth transition. Biological realisations: skin pigmentation (Kondo & Miura 2010), digit spacing in embryogenesis."
```

### Kuramoto
```
explain_b_cs = "Každý oscilátor má vlastní přirozenou frekvenci z rozdělení. Pod kritickou silou vazby: fázové rozdíly rostou — nesoudržnost. Nad ní: makroskopická část oscilátorů se uzamkne do společné frekvence. Jedná se o fázový přechod: není to plynulý přechod, ale náhlý vznik řádu."
explain_b_en = "Each oscillator has its own natural frequency from a distribution. Below critical coupling: phase differences grow — incoherence. Above it: a macroscopic fraction locks to a shared frequency. This is a phase transition: not gradual, but a sudden onset of order."
explain_c_cs = "Kuramotův model na 2D mřížce s vazbou jen k nejbližším sousedům. Parametr řádu r = |⟨e^{iθ}⟩| měří fázovou koherenci. Kritická vazba K_c ≈ 2/(π·g(0)), kde g je rozdělení frekvencí. Dotyk injektuje spirálovou vlnu (fázový gradient); supercritický režim ji udrží, subkritický absorbuje."
explain_c_en = "Kuramoto model on a 2D lattice, nearest-neighbour coupling. Order parameter r = |⟨e^{iθ}⟩| measures phase coherence. Critical coupling K_c ≈ 2/(π·g(0)) where g is the frequency distribution. Touch injects a spiral via phase gradient; supercritical holds it, subcritical absorbs it."
```

### Boids
```
explain_b_cs = "Reynoldsův model z roku 1987: tři místní pravidla (separace, zarovnání, soudržnost) produkují globální koordinaci bez centrálního řízení. Klíčový rys emergence: žádná ze složek nemá mapu celku. Podobné modely popisují pohyb hejn špačků, hejn sardinek i mraveniště."
explain_b_en = "Reynolds' 1987 model: three local rules (separation, alignment, cohesion) produce global coordination without central control. A textbook case of emergence: no component holds the global picture. Similar models describe starling murmurations, sardine schools, ant colonies."
explain_c_cs = "1024 agentů na GPU (32×32 textura). Každý krok: N² skenování sousedů s váženými vektory tří sil, omezení na maximální rychlost a sílu. Predátor-režim přidá antagonistu s jinou cílovou funkcí. Model je prototyp skupinové robotiky a davové simulace."
explain_c_en = "1024 GPU agents (32×32 texture). Each step: N² neighbour scan with weighted vectors from the three forces, clamped to max speed and force. Predator mode adds an antagonist with a different objective. The model is a prototype for swarm robotics and crowd simulation."
```

### Neural
```
explain_b_cs = "Samoorganizovaná kritičnost (SOC): síť neuronů naladěná na přechod mezi útlumem a explozí. Na kritickém bodě se velikosti lavin řídí mocninným rozdělením — žádná typická velikost. Takový stav maximalizuje rozsah reakcí, které mozek zvládne: jemné i hrubé podněty."
explain_b_en = "Self-organised criticality (SOC): a neural network tuned to the edge between quiescence and runaway activity. At the critical point, avalanche sizes follow a power law — no typical scale. This maximises the range of responses the brain can produce: subtle to dramatic."
explain_c_cs = "Beggs & Plenz (2003) model neuronové lavinové dynamiky. Stav: R=náboj, G=refrakterní fáze, B=stopa. Deterministický hash generuje dalekodosahová spojení — topologie malého světa. Při σ ≈ 1 (subkritická vazba upravená pro síť) leží systém na hranici; exponent velikostí lavin α ≈ −3/2 je univerzální."
explain_c_en = "Beggs & Plenz (2003) neuronal avalanche model. State: R=charge, G=refractory, B=trail. Deterministic hash seeds long-range links — small-world topology. Near σ ≈ 1 (network-adjusted coupling) the system sits at criticality; avalanche size exponent α ≈ −3/2 is universal."
```

---

## Minor improvements (P3)

- **Global equation panel title**: `i18n.js` line 28 `eq_title`: `"Jak to funguje? 🔍"` → `"Rovnice za tím 🔍"` / `"The equations behind this 🔍"`. Signals "deeper / optional" so Level A user doesn't expect plain-language here.
- **RD tagline EN**: `The same math as a leopard's coat.` — good, keep.
- **Neural preset `sleep`**: no description. Add tooltip later (out of scope).
- **Touch hint is global but boids needs right-click hint**: consider per-sim override. P3.

---

## Files to modify

Primary (text only, no code changes):
- `config.toml` — most edits (taglines, desc, explain_a, tooltips, new explain_b/c)
- `static/js/sims/reaction-diffusion.js` — fallback desc_cs grammar fix + explain_a
- `static/js/sims/kuramoto.js` — explain_a slider reference fix
- `static/js/sims/boids.js` — explain_a slider reference (+label rename)
- `static/js/sims/neural-criticality.js` — desc_cs register fix + explain_a softening
- `static/js/core/i18n.js` — touch_hint register, eq_title rename

No shader, no render code, no CSS.

## Verification

After edits:
1. `uv run server.py` → `http://localhost:5000`
2. For each sim: click through, open "Co vidím?" panel, verify:
   - explain_a references a slider/label that exists (B1, B3)
   - no vykání in CS text (register unification)
   - no "works best" in neural (A1)
   - RD explain doesn't over-promise spirals (A3)
3. Toggle EN, repeat.
4. Open equation panel — title reads "The equations behind this".
5. Confirm Playwright tests still pass (no structural changes expected):
   `/home/dominikklepl/.local/share/uv/tools/playwright/bin/python tests/<existing>.py`

## Priority

- **P0**: B1, B2, B3, A1, A3 (broken instructions + guardrail violations)
- **P1**: register unification (tykání), A2, A4, tooltip watch-prompts
- **P2**: Level B/C strings (add to config only, no render wiring)
- **P3**: eq_title rename, per-sim touch_hint
