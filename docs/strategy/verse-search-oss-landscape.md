# Bible Verse Search & Discovery — Open-Source Landscape & Feasibility

*Research report for Bread (codebase: `biblemem`). Audience: solo eng/PM designing a topical + semantic verse-finding feature with pre-built playlists. Stack: React Native / Expo + Supabase (Postgres + Deno edge functions). All repo facts below come from a vetted dataset (30 repos, gh metadata + license inspection); where something is unknown it is marked as such.*

*Generated 2026-06-06 via a multi-agent research workflow (38 agents).*

---

## 1. TL;DR

- **Feasible, and the legal path is already proven.** Multiple working repos validate Bread's exact instinct: build the search index over **public-domain text (KJV/WEB/ASV/BSB/BBE)**, key everything by **verse reference**, and **display the user's licensed translation** at render time. References are not copyright-sensitive; text is. This sidesteps the entire ESV/NIV wall for search.
- **The cleanest first ship is curated, not AI.** A public-domain **topic→reference map** (Nave's / Torrey's, ~4,950 topics / ~92k rows) plus the **OpenBible.info cross-reference graph** (~340k vote-weighted, reference-only edges, CC-BY) gives you instant browsable topical playlists *and* "related verses" with **zero hallucination, zero LLM cost, zero licensing risk** — shippable in-bundle next to the KJV.
- **Reuse DATA and IDEAS, rarely CODE.** Almost every relevant codebase is Python/Streamlit/Rust/Flutter — nothing drops into RN/Expo + Deno. You'll port *algorithms*, not files. The genuinely liftable assets are reference-only datasets (with the right license) and architectural patterns.
- **Most exciting idea:** the "themes-as-query" shortcut (calebyhan/bible-rag) — a topical playlist needs **no hand-curated table**; feed a topic string ("anxiety") through semantic search over PD text once, **freeze the resulting reference list**, ship it as tiny refs-only JSON. Combine with cross-references to turn one saved verse into a themed cluster for free.
- **The market/sentiment verdict is unambiguous: retrieve, don't generate.** YouVersion (1B installs) deliberately ships no scripture chatbot; AI misquotes scripture at 15–60%. Users love *semantic retrieval with visible citations* and distrust *AI interpreting/summarizing scripture*. Bread's "display real licensed text, never invent it" architecture is a natural fit for the trusted zone.
- **Hybrid beats pure-vector.** Curated maps guarantee the famous proof-texts show up (pure embeddings infamously *miss* glaring verses); embeddings catch paraphrase and the long tail. Ship curated first, layer semantic on top.

---

## 2. Repo landscape (sorted by relevance)

| Repo | Stars | Last activity | Language | License | Rel | One-line value |
|---|---|---|---|---|---|---|
| [calebyhan/bible-rag](https://github.com/calebyhan/bible-rag) | 7 | 2026-03-05 | Python + TS/Next | MIT (code) | 5 | Full hybrid pipeline (vector+FTS+RRF+rerank) + "themes = query" shortcut |
| [BradyStephenson/bible-data](https://github.com/BradyStephenson/bible-data) | 71 | 2026-05-31 | Data (CSV) | CC-BY-4.0 | 5 | PD parallel texts + Nave's topical / person-place→verse indexes |
| [openbezal/rhema](https://github.com/openbezal/rhema) | 320 | 2026-05-13 | TS + Rust + Py | MIT (code) | 5 | KJV-only flat-file embeddings, brute-force cosine over 31k vectors |
| [Remember Me (remem.me)](https://gitlab.com/remem-me/app) | 3 | 2026-06-06 | Dart/Flutter + Django | MIT (code) | 5 | Community "Decks" marketplace: search/subscribe topical collections, sync |
| [dssjon/biblos](https://github.com/dssjon/biblos) | 231 | 2024-08-28 | Python | **CC-BY-NC-4.0** | 4 | Semantic search over WEB; chapter-grouped chunking; HN-vetted UX lessons |
| [spragginsdesigns/bible-ai-explorer](https://github.com/spragginsdesigns/bible-ai-explorer) | 10 | 2026-02-16 | TypeScript | **none** | 4 | Reference-only embedding index ({b,c,v}+vector), text hydrated separately |
| [LetsChurch/bible-embeddings](https://huggingface.co/datasets/LetsChurch/bible-embeddings) | 4 | unknown | Python | **none** | 4 | 35+ models benchmarked; `queries.yaml` (fuzzy query→ref eval set) |
| [theonize/KJV…MetaV](https://github.com/theonize/KJV-bible-database-with-metadata-MetaV-) | 6 | 2016 (dead) | Data (CSV) | **CC-BY-SA-3.0** | 4 | Topic/Subtopic catalog + 92k topic→ref join (Torrey's/Nave's) |
| [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases) | 1615 | 2025-02-23 | Python | MIT code; data varies | 4 | PD translations pre-parsed + OpenBible xrefs **with vote weights** |
| [josephilipraja/bible-cross-reference-json](https://github.com/josephilipraja/bible-cross-reference-json) | 43 | 2014 (dead) | Data (JSON) | **GPL-2.0** | 4 | TSK xrefs for all 31,102 verses, references-only JSON shape |
| [theonize/bible_database](https://github.com/theonize/bible_database) | 16 | 2017 (dead) | Data | **GPL-3.0 + bundled ESV/NIV ⚠️** | 4 | Topic index + OpenBible xrefs — but ships copyrighted bibles (do not use folder) |
| [ashrielbrian/bible_semsearch](https://github.com/ashrielbrian/bible_semsearch) | 4 | 2023 (dead) | Python | none; **bundles NIV/NKJV ⚠️** | 3 | Single-matmul cosine top-k pattern (data is tainted) |
| [rcdilorenzo/ecce](https://github.com/rcdilorenzo/ecce) | 55 | 2022 | Py + JS | **GPL-3.0; ESV-trained ⚠️** | 3 | Cautionary: from-scratch net got 13.6%/1.3% acc — use embeddings instead |
| [theographic-bible-metadata](https://github.com/robertrouse/theographic-bible-metadata) | 324 | 2026-04-21 | JS (data) | **CC-BY-SA-4.0** | 3 | Entity/event knowledge graph: 450 named events = narrative playlists |
| [jcuenod/awesome-bible-data](https://github.com/jcuenod/awesome-bible-data) | 70 | 2024-09-12 | README | none | 3 | Bibliography/map of the open Bible-data ecosystem |
| [Freely-Given-org/OpenBibleData](https://github.com/Freely-Given-org/OpenBibleData) | 6 | 2026-06-06 | Python | **CC0-1.0** | 3 | `sentenceImportance.tsv`: refs-only "vital/important" memorability ratings |
| [neuml/txtai](https://github.com/neuml/txtai) | 12636 | 2026-06-04 | Python | Apache-2.0 | 3 | General embeddings-DB engine; the canonical pipeline pattern |
| [seven1m/open-bibles](https://github.com/seven1m/open-bibles) | 504 | 2026-06-05 | Data (XML) | per-translation | 3 | Source of PD alt-translations (WEB/ASV/**BBE**) for search corpus |
| [alronlam/bible-search](https://github.com/alronlam/bible-search) | 2 | 2023 | Python | MIT code; **NIV data ⚠️** | 3 | Chapter-density reranker (boost passages with multiple on-topic verses) |
| [shreydan/bible-verse-search-app](https://github.com/shreydan/bible-verse-search-app) | 8 | 2022 | Python | none | 2 | Minimal "half-remembered verse" MiniLM demo |
| [jacobweiss2305/bible-rag](https://github.com/jacobweiss2305/bible-rag) | 2 | 2025-07-31 | Python | Apache-2.0 | 2 | KMeans cluster + LLM auto-label = auto-generated playlists |
| [tim-hub/bible-vector-search](https://github.com/tim-hub/bible-vector-search) | 30 | 2025-11-22 | TypeScript | MIT (code) | 2 | "Search by meaning not words" framing; thin UI only |
| [casperdcl/brace](https://github.com/casperdcl/brace) | 3 | 2026-05-22 | Python | none | 2 | Two-stage retrieve→refine funnel idea (UI shell only) |
| [thiagobodruk/bible](https://github.com/thiagobodruk/bible) | 709 | 2024-08-25 | Data | **conflicting MIT/CC-BY-NC ⚠️** | 2 | PD subset incl. BBE; rest scraped/copyrighted |
| [miking7/biblememory](https://github.com/miking7/biblememory) | 0 | 2026-01-25 | Vue + PHP | none | 2 | LLM-as-reference-resolver; dot-notation tag taxonomy |
| [31Carlton7/elisha](https://github.com/31Carlton7/elisha) | 146 | 2023 | Dart | GPL-3.0 | 2 | Outsourced curated VOTD feed (refs) re-resolved to local text |
| [ortegaalfredo/ChristGPT](https://github.com/ortegaalfredo/ChristGPT) | 90 | 2023 | Shell | BSD-2 + **LLaMA/Alpaca NC ⚠️** | 1 | Cautionary: ungrounded generative chat hallucinates verses |
| [aruljohn/Bible-kjv](https://github.com/aruljohn/Bible-kjv) | 304 | 2021 | Data (JSON) | MIT | 1 | Redundant KJV dump (Bread already bundles KJV) |
| [jadenzaleski/bible-translations](https://github.com/jadenzaleski/bible-translations) | 195 | 2025-12-29 | Python | MIT code; **scraped data ⚠️** | 1 | BibleGateway scraper — do not use for licensed text |
| [Alleny244/Word_Of_God](https://github.com/Alleny244/Word_Of_God) | 0 | 2021 | Dart | none | 1 | Throwaway tutorial; curated-shortlist VOTD seed only |

---

## 3. Deep dives (the 4–6 most useful)

### 3.1 calebyhan/bible-rag — the reference architecture (relevance 5)

**What it does.** Full-stack semantic Bible study tool. Backend (Python/FastAPI + pgvector) embeds ~31k verses with `multilingual-e5-large` and serves a **hybrid retrieval pipeline**: query-embedding vector search + Postgres full-text (tsvector), optional LLM query expansion, merged via **weighted Reciprocal Rank Fusion**, then **cross-encoder rerank** (`bge-reranker-v2-m3`) on top candidates, plus "gap-filling" of verses between hits. Surfaces OpenBible.info typed cross-references (63,779 connections) and Strong's interlinear. Licensed text is fetched at runtime, never bundled.

**Reusable — code vs idea.** *Idea: high. Code: low (stack mismatch).* The pipeline is Python + a heavy ML stack that won't run in Expo or Deno. You port the **algorithms** (RRF merge weighting, rerank ordering, gap-fill), not the files.

**Licensing verdict.** **Code: YES, copy into closed-source commercial app** — MIT, retain the notice, no copyleft. The valuable *data* (cross-refs, verse text) is not committed; it's fetched/downloaded at runtime from externally-licensed sources (OpenBible CC-BY, Strong's PD). No committed topical-map or embeddings to lift.

**What to steal.** (1) Hybrid vector+FTS retrieval fused with RRF then cross-encoder rerank. (2) LLM **query expansion** to boost recall on natural-language/topical queries — LLM on the *query side only*, never generating scripture. (3) **The "themes" shortcut** (the standout): `search_by_theme` is just a thin wrapper feeding the theme word as a natural-language query into the same pipeline. **Implication for Bread:** pre-built topical playlists can be generated **offline** — run ~50 topic strings through semantic search over bundled KJV/WEB once, freeze the reference lists, ship as a tiny refs-only JSON. Curated-feeling playlists, zero hand-curation, zero licensed text stored.

### 3.2 BradyStephenson/bible-data — the cleanest reusable DATA (relevance 5)

**What it does.** Pure data repo (no code). `AlamoPolyglot.csv` = 10 parallel **public-domain** texts (WEB, KJV, Hebrew, JPS 1917, Brenton LXX, etc.). Plus refs-only reference datasets: **Nave's Topical**, Hitchcock's Names, Hebrew Strong's, and **Person/Place→Verse** indexes — all derived from PD 19th/early-20th-c. reference works.

**Reusable — code vs idea.** No code. **The data is the asset, and it's the best-licensed topical source in the set.**

**Licensing verdict.** **DATA: YES into closed-source commercial app, with attribution.** CC-BY-4.0 — explicitly permits commercial use and adaptation, **not** share-alike, so it does **not** contaminate Bread's proprietary code or force open-sourcing. Only obligation: an attribution line (author + license; README also requests a Zenodo citation) on an Acknowledgements screen. You may bundle a trimmed subset (e.g. just Nave's topic→reference index). No copyrighted modern translations anywhere.

**What to steal.** Model verse-finding as a **join over a PD topic/person/place → reference index**, display the licensed translation at render. This is the deterministic backbone for v1 playlists. (You could also re-derive the same from original Nave's/Strong's PD sources and skip the repo — the repo just saves the cleaning work.)

### 3.3 openbezal/rhema — validates the offline reference-only index (relevance 5)

**What it does.** Tauri desktop app that detects spoken verse references in real time. For our purposes the gold is its **search substrate**: it embeds **only KJV** text (Qwen3-0.6B ONNX, L2-normalized) and writes two flat binary files — vectors + parallel verse-IDs — that the runtime **memory-maps and brute-force cosine-scans over ~31k vectors** (trivially fast, no vector DB). Also ensembles cheap lexical matching (Aho-Corasick, FTS5 BM25) alongside semantic.

**Reusable — code vs idea.** *Idea: high (architecturally identical to Bread's plan). Code: low (Rust/Tauri).*

**Licensing verdict.** **Code: YES (MIT).** ⚠️ **But do NOT touch the bundled copyrighted-translation zip** (NIV/ESV/NASB/NLT/AMP scraped from BibleGateway, redistributed via Google Drive — a copyright violation; it also mislabels NKJV as "public domain"). The **KJV-derived embeddings .bin and the cross-reference data are the only safe data assets**, and you'd regenerate KJV vectors anyway if you want your own model.

**What to steal.** The load-bearing pattern, **validated by a working implementation**: embed PD KJV, key by reference/ID, return references, display the user's licensed translation. Plus: **flat fp32 .bin + parallel id .bin + brute-force cosine** (no vector DB needed at 31k scale — could ship in-bundle or run in an edge function), and the **lexical + semantic ensemble** rather than embeddings-only (directly fixes the "misses obvious verses" complaint).

### 3.4 scrollmapper/bible_databases + the cross-reference graph (relevance 4)

**What it does.** Data-distribution repo (1,615 stars). PD translations pre-parsed into SQLite/JSON, **and** the **OpenBible.info cross-reference graph** (~340k verse→verse edges) exported with a crowd-sourced **`votes`** relevance score per edge.

**Reusable — code vs idea.** Take the **data**, skip the Python ETL (irrelevant to RN).

**Licensing verdict.** **DATA: YES into closed-source commercial app, with attribution.** MIT covers code/compilation; **no copyrighted modern translations are bundled** (verified: NIV/ESV/NLT/NKJV/NASB/CSB/MSG/AMP absent). The cross-ref data is **CC-BY — commercial use allowed *with* a one-line OpenBible.info credit**. No GPL/AGPL anywhere. You can drop the SQLite/JSON cross-reference file + a PD translation straight into Bread.

**What to steal.** The **vote-weighted, reference-only relevance graph** is the single most reusable discovery asset in the whole landscape. It enables, with **no embeddings/LLM**: (1) "Related verses" quick-add when a user saves a verse (rank by votes); (2) bootstrap topical playlists by seeding a few anchor verses and **expanding along top-voted edges**; (3) all reference-based, so it ships in-bundle next to KJV with zero licensing risk. *(Same graph appears across josephilipraja, theonize/bible_database, ecce, awesome-bible-data — but get it from a CC-BY source like OpenBible/scrollmapper, not the GPL or copyrighted-bible-bundling mirrors.)*

### 3.5 Remember Me (remem.me) — the playlist *marketplace* model (relevance 5)

**What it does.** Open-source stack (Flutter + Django) for a Bible-memory app claiming 2.2M downloads. Key feature: **community "Decks"** discovered via keyword REST search (`search=&language=&ordering=-featured,-downloads`); **subscribing copies a deck's verses into your account as a live-syncing label** that updates when the publisher edits. Verse text is proxied on-demand, not the thing you search.

**Reusable — code vs idea.** *Idea: high. Code: low (Dart/Django).* The **collection-search REST contract** and **publish/subscribe-with-sync** model port cleanly to Supabase.

**Licensing verdict.** **Code: YES (MIT), with care.** ⚠️ **Do NOT ingest their collection corpus** — community decks store verse passage text in 300+ translations incl. copyrighted ones (violates Bread invariant #2). Mine **references + topic tags only**, never passage text.

**What to steal.** The **two-tier model that maps onto Bread's licensing posture**: references + topic tags are the searchable/rankable/shareable layer; text is fetched separately and never searched. Plus the UX: **browsable topical "Decks" sorted by featured/downloads, quick-add a whole set, publisher-edits-propagate.** This is the concrete shape of "pre-built playlists you can quick-add." Concrete named sets to seed (the Navigators TMS 60-verse set, anxiety/anger/wisdom/identity themes).

### 3.6 LetsChurch/bible-embeddings — the benchmark, and the "half-remembered" insight (relevance 4)

**What it does.** HF dataset + eval harness. Precomputed BSB embeddings across 35–40 models, scored against a **hand-curated `queries.yaml`** of natural-language-query → expected-verse-reference pairs, ranked by top-3 accuracy.

**Licensing verdict.** **Code & vectors: risky — no license grant (all-rights-reserved by default); commercial-API vectors carry provider ToS.** Reimplement the (trivial) CLI yourself; generate your own vectors from PD text with a model whose license you control. BSB text itself is PD-dedicated and clean.

**What to steal (data points, not files).** (1) Embedding **verse text alone already hits ~80–89% top-3** on fuzzy queries — a low-effort semantic path needs **no manual topical curation**. (2) **Model guidance:** `text-embedding-3-large` best (~89%); on-device `Qwen3-Embedding-0.6B` (~74%) and BGE/GTE viable for offline/no-API-cost. (3) **Build-a-benchmark-first methodology** — assemble realistic phrasings (including misquotes) and measure before committing. (4) The killer UX insight from `queries.yaml`: real users search by **half-remembered paraphrase** ("isn't there a verse about god is love?"), not topic words — argues for an **"I half-remember a verse" search mode**. *(Consider embedding **BBE** instead of KJV — its ~1000-word modern vocabulary matches plain-language queries far better than KJV's archaic diction, per seven1m/open-bibles.)*

---

## 4. Licensing matrix & gotchas

### The CODE-vs-DATA distinction (the central trap)

A repo's LICENSE file covers its **code/compilation**, **not** the Bible text or third-party data inside it. You must clear **each asset by its true upstream license**, never trust the repo's blanket stamp. Examples of this exact trap in the set:
- **theonize/bible_database** stamps GPL-3.0 over a folder that **bundles real ESV/NIV/NLT/MSG** — a copyright violation regardless of the GPL label. Take only `Verses.csv` (KJV) + refs-only tables; never the `bibles/` folder.
- **thiagobodruk/bible** has an MIT LICENSE file but a README saying CC-BY-NC + "all rights reserved to owners" — and bundles copyrighted pt_nvi/zh_ncv/pt_acf. Treat as ambiguous; cherry-pick only the genuine PD versions.
- **ashrielbrian / alronlam** ship NIV/NKJV CSVs (scraped) under MIT *code* — the **data is tainted and so are embeddings derived from it.**

### Code-license contamination

| License | Copy code into Bread (closed commercial)? | Notes |
|---|---|---|
| **MIT / Apache-2.0 / BSD-2 / CC0** | **YES** | Retain notice (Apache also = patent grant). calebyhan, rhema, scrollmapper(code), txtai, remem.me, OpenBibleData. |
| **No license** | **NO** | Default all-rights-reserved. Reimplement from scratch (most are trivial). spragginsdesigns, LetsChurch, shreydan, miking7, brace, bible_semsearch. |
| **GPL-2.0 / GPL-3.0** | **NO** | Copyleft — would force Bread open-source. josephilipraja, ecce, elisha, theonize/bible_database. Re-derive the *data* from PD/CC-BY sources instead. |
| **CC-BY-NC-4.0** | **NO** | NonCommercial bars a paid App Store app. dssjon/biblos — look, don't paste. |

### Data-license contamination (refs-only datasets)

| License | Bundle data into Bread? | Obligation |
|---|---|---|
| **CC0 / Public Domain** | YES | None. OpenBibleData `sentenceImportance`, PD translations. |
| **CC-BY-4.0** | YES | One-line attribution. BradyStephenson Nave's, OpenBible cross-refs. |
| **CC-BY-SA-3.0/4.0** | **AVOID for proprietary** | **ShareAlike** would force your derived dataset to be CC-BY-SA. MetaV, theographic. **Mitigation:** topic→reference mappings are largely *uncopyrightable facts* — re-derive the same topic→ref index from the underlying PD source (Torrey's/Nave's) and skip the SA wrapper. |

### Which Bible *translations* are safe to embed/bundle

- **Safe (Public Domain):** KJV (already bundled), **WEB**, **ASV**, **BSB** (PD-dedicated 2023), **BBE** (Basic English — best for plain-language semantic matching), YLT, Darby, Douay-Rheims, Geneva, Webster, JPS 1917, Hebrew Leningrad Codex, SBLGNT (CC-BY).
- **Landmines (copyrighted — never bundle, fetch-only):** ESV, NIV, NLT, NKJV, NASB, CSB, MSG, AMP, NET, RSVCE. Several repos illegally bundle these — do not inherit.
- **Watch:** LEB (free w/ attribution + verse-count limits), 3 CC-BY-SA Spanish texts in open-bibles (share-alike — isolate or skip), Korean KBS (irrelevant unless Bread adds Korean).

### How this maps to "search PD text, display licensed translation"

Every relevant repo independently converges on it: **embed/index PD text → return verse references → render the user's licensed translation via `fetchVerse()`.** Because the same reference resolves across all translations, you **never need embeddings of copyrighted text**, and references are not legally sensitive. This *is* Bread invariant #2, validated by working code. A topical "playlist" is then simply a **saved list of references** — semantic results and curated lists become the same data type behind one quick-add UI.

---

## 5. Idea bank

**Buildable now (deterministic, refs-only, no AI, ships in-bundle):**
- **Curated topic→reference playlists** from Nave's/Torrey's (~4,950 topics, ~92k rows). *[BradyStephenson, MetaV]*
- **"Related verses" / "More like this"** from the OpenBible/TSK **vote-weighted cross-reference graph** — quick-add suggestions seeded by a verse the user already saved. *[scrollmapper, josephilipraja, awesome-bible-data]*
- **Auto-grow a playlist** by expanding a few anchor verses along top-voted cross-ref edges. *[scrollmapper, ecce idea]*
- **Mood/emotion entry point** (pick how you feel → tailored verse set) as the *primary* UX — the most-loved consumer pattern (Bible Mood, Gen Z Bible). Map moods → curated reference sets.
- **Community/curated "Decks" marketplace** — browse topical collections sorted by popularity, quick-add the whole set as a synced label. *[remem.me]*
- **Entity/event "story playlists"** — "every verse about Aaron," "the Creation event," "David & Goliath arc" — from entity-anchored reference metadata. *[theographic — but re-derive due to CC-BY-SA]*
- **"Vital/Important" memorability weighting** — auto-generate a "most-memorized verses" starter playlist; weight any search toward important verses. *[OpenBibleData `sentenceImportance`, CC0; treat as preliminary seed]*
- **Outsourced/seasonal curated feeds** delivered as references, re-resolved to the licensed translation. *[elisha pattern]*

**Needs-AI (embeddings/LLM):**
- **Semantic topic search** ("verses about feeling abandoned") over PD text → ranked references. *[rhema, biblos, bible_semsearch, shreydan]*
- **"I half-remember a verse" search** — misquote-tolerant semantic lookup over **BBE/WEB** (plain-language corpora beat KJV diction). *[LetsChurch queries.yaml, open-bibles BBE]*
- **"Themes = query" auto-playlists** — generate playlist reference-lists offline by running topic strings through semantic search; freeze and ship. *[calebyhan]*
- **Hybrid retrieval** — vector + full-text fused with RRF, then cross-encoder rerank; ensures recall + precision. *[calebyhan, rhema lexical+semantic ensemble]*
- **Chapter-density reranker** — boost passages where the theme runs through *several* verses (great playlist material, e.g. Philippians 4 for "anxiety"). *[alronlam]*
- **Unsupervised cluster → LLM auto-label** — discover latent themes, name each cluster as a playlist. *[jacobweiss2305]*
- **LLM-as-reference-resolver** — fuzzy/topical query → structured *references* (never text), then `fetchVerse()`. *[miking7, brace, calebyhan query expansion]*
- **Synthetic query augmentation** — pre-generate paraphrased natural-language queries per verse, embed those (not archaic text) to improve recall. *[ChristGPT idea, inverted & grounded]*

**Needs-data (acquire/curate a dataset first):**
- A vetted **topic→reference table** (clear the CC-BY-SA provenance or re-derive from PD Torrey's/Nave's).
- A **benchmark `queries.yaml`** of realistic phrasings (incl. misquotes) to pick a model and measure top-3 accuracy before committing. *[LetsChurch methodology]*
- A **mood→reference** mapping (curate ~30–50 emotions to seed sets).

---

## 6. Recommended approaches (RN/Expo + Supabase)

### Option A — Curated topical-reference dataset *(lowest effort, highest trust, ship first)*

Bundle (or host in Postgres) a refs-only **topic→reference** table (Nave's, CC-BY) + the **OpenBible cross-reference graph** (CC-BY). Topical playlists = `SELECT` over the topic table; "related verses" = cross-ref neighbors ranked by `votes`. Render the user's licensed translation via existing `fetchVerse()`.
- **Effort:** Low. No ML, no embeddings, no new infra. A migration + a tiny JSON in-bundle, or a `topics`/`cross_refs` table.
- **Payoff:** High and immediate. **Zero hallucination, zero licensing risk**, guarantees famous proof-texts appear (the #1 distrust fix). Directly powers mood/playlist/quick-add UX.
- **Seeds:** BradyStephenson (Nave's, CC-BY), scrollmapper (xrefs, CC-BY). Attribution line required.
- **Caveat:** misses paraphrase / long-tail queries — that's what Option B adds.

### Option B — Precomputed verse embeddings + pgvector in Supabase *(medium effort, big UX payoff)*

Offline: embed **all ~31k PD verses once** (KJV, or better **BBE/WEB** for plain-language match) with a chosen model; store `{book,chapter,verse}` + vector in a `pgvector` table. Query: embed the user's text in a **Deno edge function** (call an embedding API), cosine top-k, return references, hydrate via `fetchVerse()`. Generate **offline topical playlists** by freezing the top results for ~50 topic/mood strings ("themes = query").
- **Effort:** Medium. One-time embedding job + a pgvector table + one edge function. At 31k vectors even **brute-force cosine** is trivial (rhema proves it); pgvector is comfortable.
- **Payoff:** High. Unlocks "verses about feeling abandoned" + "I half-remember a verse" — the praised meaning-over-keywords aha.
- **Decisions:** model choice (3-large ~89% via API vs Qwen3-0.6B ~74% on-device/offline); which PD corpus to embed. Benchmark with a `queries.yaml` first.
- **Seeds:** calebyhan (pipeline, MIT), rhema (flat-file/cosine, MIT), txtai (canonical pattern), LetsChurch (model benchmark + corpus choice).
- **On-device alt:** Apple `NLContextualEmbedding`, `react-native-executorch`, ObjectBox vector search, Transformers.js (web) are viable if you want offline/private — a genuine praise magnet with this audience.

### Option C — Hosted LLM/RAG at query time *(highest effort/risk, use sparingly)*

LLM **query expansion / topic tagging / reference resolution** in an edge function — fuzzy query → expanded query or candidate **references**, fed into Option B's retrieval, then hybrid RRF + rerank.
- **Effort:** High; adds per-query LLM cost/latency and a hosted dependency.
- **Payoff:** Marginal recall gains on hard paraphrases — **only worth it once A+B exist.**
- **Hard constraint from sentiment research:** keep the **LLM strictly on the query side. Never generate, summarize, or interpret scripture.** YouVersion ships no chatbot; misquote rates 15–60%; AI skews "very Protestant, very American"; users distrust generation and refusals. Bread's "display real licensed text" model stays in the trusted zone *only if* the LLM never writes scripture. If used, have it emit references; resolve text yourself.
- **Seeds:** calebyhan (RRF/rerank/query-expansion, MIT), brace (two-stage retrieve→refine), miking7 (LLM→references).

**Recommended sequence:** **A → B → (maybe) C.** Ship the curated map + cross-references first (trust, speed, no infra). Layer pgvector semantic search for paraphrase/long-tail. Treat any LLM as query-side sugar, never a scripture generator. This is the "**hybrid retrieval, verifiable citations, mood/playlist UX, no generation**" design the whole sentiment briefing points to.

---

## 7. Open product questions for Caelan

1. **Curated-first or semantic-first?** Recommendation is curated (Option A) for v1 to nail trust and ship fast — confirm that matches your roadmap appetite.
2. **Search corpus:** embed KJV (already bundled, consistent) or add **BBE/WEB** for better plain-language matching? BBE materially improves recall on casual queries but adds a bundle.
3. **On-device vs server embeddings:** offline/private (Qwen3-0.6B / Apple NLContextualEmbedding, ~74% quality, no API cost, a praise magnet) vs server pgvector + API model (~89%, needs network, per-query cost)?
4. **Mood/emotion as primary entry point?** It's the most-loved consumer pattern — does it fit Bread's collections-centric model, or stay a secondary surface?
5. **Playlists: curated-by-you, community-published (remem.me Decks), or both?** Community publishing adds a sync/marketplace surface (and moderation).
6. **CC-BY attribution:** are you OK adding an Acknowledgements/licenses screen line (required for Nave's + OpenBible cross-refs)? Cheapest compliance path.
7. **Any LLM at all in v1?** Sentiment research strongly says retrieve-don't-generate; confirm we keep AI off the scripture-text path entirely.
8. **CC-BY-SA handling:** for MetaV/theographic data, re-derive from PD originals (more work, clean) vs accept the share-alike (incompatible with proprietary). Recommendation: re-derive or use the CC-BY BradyStephenson source instead.

---

## 8. Sources

**Repositories (vetted dataset):**
calebyhan/bible-rag · BradyStephenson/bible-data · openbezal/rhema · gitlab.com/remem-me/app · dssjon/biblos · spragginsdesigns/bible-ai-explorer · huggingface.co/datasets/LetsChurch/bible-embeddings · theonize/KJV-bible-database-with-metadata-MetaV- · scrollmapper/bible_databases · josephilipraja/bible-cross-reference-json · theonize/bible_database · ashrielbrian/bible_semsearch · rcdilorenzo/ecce · robertrouse/theographic-bible-metadata · jcuenod/awesome-bible-data · Freely-Given-org/OpenBibleData · neuml/txtai · seven1m/open-bibles · alronlam/bible-search · shreydan/bible-verse-search-app · jacobweiss2305/bible-rag · tim-hub/bible-vector-search · casperdcl/brace · thiagobodruk/bible · miking7/biblememory · 31Carlton7/elisha · ortegaalfredo/ChristGPT · aruljohn/Bible-kjv · jadenzaleski/bible-translations · Alleny244/Word_Of_God

**Web / sentiment sources:**
- HN: [Show HN Biblos](https://news.ycombinator.com/item?id=38040591) · [Bible search client-side w/ Transformers.js](https://news.ycombinator.com/item?id=45543912) · [Bible Semantic Search 2022](https://news.ycombinator.com/item?id=31733673)
- [Christian Today — theological bias in AI Bible chatbots](https://www.christiantoday.com/news/concerns-raised-over-theological-bias-in-ai-bible-chatbots) · [Bible Society — AI/Theological Bias report](https://www.biblesociety.org.uk/research/ai-bible-apps-and-theological-bias-report) · [NPR — AI Bible content](https://www.npr.org/2025/09/07/nx-s1-5518263/ai-bible-christianity-content) · [Christian Daily — misquotes 15–60%](https://www.christiandaily.com/news/ais-scripture-problem-misquotes-range-from-15-to-60-says-youversion-ceo) · [Christian Post — YouVersion founder](https://www.christianpost.com/news/youversion-founder-talks-concerns-about-pastors-embrace-of-ai.html) · [FSSPX — American Evangelical bias](https://fsspx.news/en/news/bible-and-ai-american-evangelical-bias-57051)
- [SaaSHub Logos vs YouVersion](https://www.saashub.com/compare-logos-bible-app-vs-youversion-bible-app) · [Bible Mood](https://biblemood.com/) · [Gen Z Bible](https://apps.apple.com/us/app/gen-z-bible/id6742156726)
- On-device RN: [Callstack — Apple embeddings in RN](https://www.callstack.com/blog/on-device-ai-introducing-apple-embeddings-in-react-native) · [react-native-executorch text embeddings](https://software-mansion-react-native-executorch.mintlify.app/text-embeddings/overview) · [ObjectBox on-device vector search](https://docs.objectbox.io/on-device-vector-search)
