# Bread — Strategy Memo

*Canonical strategy document. Last updated 2026-06-05. Save location: `docs/strategy/`.*

*Produced from a multi-agent research pass (6 research streams + 3 adversarial
verifications against primary sources). Legal claims carry explicit confidence
levels — items marked **[verify yourself / lawyer]** need primary confirmation
before you rely on them.*

---

## 1. TL;DR

The single biggest risk is **licensing**: Bread is on free/dev-tier ESV and API.Bible keys whose terms explicitly forbid commercial/paid/freemium use, so charging money today means monetizing on text you don't have the rights to. The single biggest opportunity is **voice recitation + fair scoring** — the one feature the entire category (Bible Memory, Verses' "Speak Out") attempts and gets savaged for; Bread's Soniox + `align.ts` stack is purpose-built to own it. The recommended path: **(1) de-risk licensing by making the paid app stand on public-domain text — bundle the modern, CC0 Berean Standard Bible (BSB) as the default, keep KJV, and treat ESV/NLT/NKJV as separately-negotiated "licensed extras" that are never load-bearing for revenue;** **(2) close the table-stakes gap by shipping a legible scaling-interval review queue + reminders (the exact thing your power user wants);** **(3) monetize with a one-time ~$24.99 "lifetime unlock" via 15% IAP + RevenueCat, framed as paying for *your* toolkit, not Bible access;** **(4) grow through ASO + niche communities, not paid media.** Realistic outcome at this niche's economics is **low-thousands of dollars/year** unless installs push well past 10k — genuine side income, not a hockey stick. Do licensing first; everything else scales the exposure.

---

## 2. Licensing reality (the load-bearing section)

This section determines what Bread is *allowed* to sell. Read it before building any paywall. Confidence levels are explicit; legal claims marked **[verify yourself / lawyer]** need primary confirmation before you rely on them.

### ESV / Crossway — hardest to monetize. Do NOT build the paid tier on it.

- **The free `api.esv.org` key is non-commercial only. CONFIRMED (high confidence).** Crossway's own terms define non-commercial as *"no charge is made for access to any part of the site"* and *"no charge … for access to the ESV text,"* and a commercial site as one *"primarily designed to motivate visitors to buy something, to pay for a service, or to give a donation."* A paid/subscription/freemium app fails this test. ([api.esv.org](https://api.esv.org/), [ESV terms](https://www.esv.org/about/terms/))
- **Crossway's stated policy is to license "to organizations, not to individuals or solo developers." CONFIRMED verbatim (high confidence)** — a *correction to the original research*, which wrongly flagged it as unconfirmed/secondary. The adversarial verification found it verbatim in api.esv.org's "What if I want to include the ESV in a mobile app?" section: *"For requests that exceed the above guidelines require a formal license. Our policy is to license to organizations, not to individuals or solo developers."* A solo dev's path is **explicitly disfavored by stated policy**, not merely "marginal." Individuals can still *submit* the digital form, but the granting policy is organizations-only. ([api.esv.org](https://api.esv.org/), [Crossway digital permissions](https://www.crossway.org/permissions/digital/))
- **Cost/royalty figures: UNKNOWN (uncertain).** No dollar, royalty, or revenue-share numbers exist on any Crossway primary source. The "$1,000/yr" figure floating around is from a *different* publisher — do not treat it as an ESV price. ([Selling Jesus](https://sellingjesus.org/articles/bible-publishers))
- **Cautionary history:** Crossway has revoked ESV access from open-source apps when it moved to recoup licensing fees, forcing them to drop ESV. ESV is a fragile foundation for revenue. ([Selling Jesus](https://sellingjesus.org/articles/bible-publishers))
- **Freemium gray area (ESV free, other features paid): genuinely ambiguous. UNCERTAIN [verify yourself].** The "no charge for access to any part of the site" wording may still be violated by a commercial app even if ESV itself isn't paywalled. Don't rely on this without written confirmation from `licensing@crossway.org`.

**ESV verdict:** Do not make the paid tier depend on ESV. At most, pursue an org-level license later as a separate negotiation; treat declination as the likely outcome.

### API.Bible (NLT / NIV / NKJV via American Bible Society) — also non-commercial today.

- **The free Starter tier is non-commercial only, and freemium/paid explicitly counts as commercial. CONFIRMED (high confidence).** API.Bible's definition: *"Commercial use includes any use … as part of a product or service that is monetized, including but not limited to … freemium models, and/or paid access."* A paid or freemium Bread is squarely commercial and not permitted on the free key. ([API.Bible common questions](https://docs.api.bible/common-questions/), [FAQ](https://api.bible/faq))
- **NIV: effectively off the table. CONFIRMED (high confidence).** API.Bible states *"NIV commercial use not available."* Direct Biblica/Zondervan licensing is the only route, and *"Biblica generally does not issue licenses for products or software that are still in development"* — closed to a solo indie. **Drop NIV from any monetized tier.** ([api.bible](https://api.bible/), [Biblica permissions](https://www.biblica.com/permissions/))
- **NLT: the most viable copyrighted option. CONFIRMED verbatim (high confidence on terms; cost uncertain).** Tyndale's terms: if content is *"substantially or exclusively NLT Bible content and is commercial/monetized, the creator may be required to pay a fee and to obtain a Permission Letter or a License."* A memorization app *is* substantially Bible content, so this applies. Path: API.Bible Pro (**$29+/mo**) + per-translation commercial license (**~$10/mo**) + manual email approval (`support@api.bible`) **and very likely a direct Tyndale Permission Letter** too. Exact Tyndale fee is case-by-case, unpublished. ([Tyndale permissions](https://www.tyndale.com/permissions))
- **NKJV: maybe. UNCERTAIN.** Same API.Bible commercial path *if* API.Bible can sub-license NKJV commercially — **unconfirmed by both research and verification.** Otherwise direct HarperCollins Christian permission. Verify with `support@api.bible`. ([HarperCollins Christian](https://www.harpercollinschristian.com/permissions/))
- **Caching window is genuinely ambiguous: 14 vs 30 days. CONFIRMED ambiguity.** API.Bible's own pages conflict. Assume the stricter **14 days** and confirm with support. Note: Bread does **not** currently enforce a time-based cache refresh — that's a compliance gap to close if you ever ship licensed translations. ([common questions](https://docs.api.bible/common-questions/))
- **Three corrections from verification to carry forward:** (a) the Starter quota is **"5,000 queries/day," not 5,000/month**; (b) the NKJV *"you cannot use a scripture verse … on items you sell"* line is a **paraphrase, not a verbatim publisher quote** (substance is right); (c) the *"do not alter Scripture"* clause is **unconfirmed primary-source** — so the "is verse-masking an altering violation?" question rests on an unverified quote. Read API.Bible's Terms & Conditions directly before treating masking as a compliance concern (it's almost certainly fine — a memorization aid, not a misrepresentation).

### Public-domain & CC0 options — the de-risking answer.

- **Berean Standard Bible (BSB): the key finding. CONFIRMED (high confidence).** A **modern, readable, 2022-era translation released to the public domain via CC0** (April 30, 2023). *"Used commercially without permission or royalties."* No fee, no revenue share, no attribution required, no verse cap, full-text bundling explicitly allowed. The only caveat is name protection — if you *alter* the text you can't call it "Berean," which doesn't constrain verbatim use. It is **the only option that is both modern English AND free to monetize.** ([berean.bible licensing](https://berean.bible/licensing.htm), [bsb.freely.giving](https://bsb.freely.giving/), [ebible.org BSB](https://ebible.org/find/details.php?id=engBSB))
- **KJV (1769): CONFIRMED public-domain in the US, already bundled.** Free to sell. Caveat: archaic "thee/thou" is a real UX liability for memorization. (UK Crown copyright exists but isn't enforceable against a US-based app.)
- **WEB (World English Bible): CONFIRMED public-domain, sellable.** *"copy, publish … distribute … sell … as much as you want."* Good secondary free option, but more formal/dated than BSB. Name is trademarked (verbatim use unrestricted). ([worldenglish.bible](https://worldenglish.bible/), [ebible.org WEB copyright](https://ebible.org/engwebp/copyright.htm))
- **NET Bible: usable but not clean.** Verses-only quotation is generous and permission-free, but **bundling the full data file requires express permission** and commercial inquiries route to HarperCollins. Not a clean public-domain situation — skip for the bundle. ([thebible.org NET notice](https://thebible.org/gt/notices/net.html))
- **ASV / BBE: public-domain but archaic/stilted.** Free but weak memorization UX. Skip.
- **CSB: NOT free.** Commercial use requires written Holman permission even under the 1,000-verse quotation cap. Skip unless you do paperwork. ([csbible.com/permissions](https://csbible.com/permissions/))

### RECOMMENDATION — which translations to feature in a paid app

**Lead with BSB as the default bundled translation.** Bundle it as a CC0 JSON exactly the way `kjv-1769.json` is bundled today, short-circuited inside `fetchVerse`/`fetchChapter` (per invariant #3). USFM/USFX→JSON is a trivial one-time conversion. This gives you a *modern, monetizable, offline* translation with **zero licensing exposure** — and it directly answers the KJV-is-archaic problem without touching a copyrighted publisher.

- **Paid-app core catalog (own outright): BSB (default, modern) + KJV (classic).** Both public-domain, both bundleable, both offline, both safe to charge for.
- **Treat ESV / NLT / NKJV as "licensed extras"** that are *never load-bearing for revenue.* Ship them only after you've done the specific commercial paperwork, and design the paywall so the app works fully without any of them. NIV: drop entirely.
- **The de-risk framing is the whole point:** you are selling *your memorization toolkit* (recite-and-score, review scheduling, collections), with public-domain text included — not selling access to copyrighted Scripture. That framing is both the safest legal posture and the cleanest product story.

---

## 3. Monetization plan

**Recommended model: a one-time "lifetime unlock" via IAP at ~$24.99 (US), with an optional $29.99/yr subscription as a secondary SKU. Enroll in the Small Business Program (15%). Use RevenueCat for the plumbing.**

**Why one-time over subscription:**
- **Churn kills subs on a tiny base.** Annual subs now see ~72% Year-1 cancellation; you'd spend more energy fighting cancellation than you'd earn. ([RevenueCat State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps/))
- **It matches the category and your shared audience.** Bible Memory sells **$19.99 one-time lifetime** for PRO, and your one power user came from there. **$24.99 one-time** is credible and slightly premium — justified by the unique recite-and-score feature — and removes the "why am I paying monthly for a tool I already own" objection. ([biblememory.com](https://biblememory.com/))
- **It's the safer licensing posture.** A subscription implies you're continuously reselling access to content you may not have rights to; a one-time *tool* unlock is easier to frame as paying for your software.
- **Bread is a tool, not a content feed.** The $70–100/yr faith apps (Hallow, Pray.com) justify price with *constant fresh audio/devotional content*. Bread won't feel that renewal pull. ([Hallow pricing](https://help.hallow.com/en/articles/2880438-how-much-does-the-subscription-cost), [Grand View spiritual-wellness market](https://www.grandviewresearch.com/industry-analysis/spiritual-wellness-apps-market-report))

**Store-billing facts (verified):**
- **IAP is mandatory** to unlock Bread's digital premium features; the "reader app" exemption does **not** apply (that's for books/music/video catalogs). CONFIRMED. ([App Store Review Guidelines 3.1.1](https://developer.apple.com/app-store/review/guidelines/))
- **You pay 15%, not 30%.** Apple Small Business Program: 15% for developers ≤$1M/yr proceeds; new devs qualify; **you must enroll manually.** Google: 15% on the first $1M (subscriptions 15% from day one). CONFIRMED. ([Apple SBP](https://developer.apple.com/app-store/small-business-program/), [Google Play fees](https://support.google.com/googleplay/android-developer/answer/112622))
- **External-payment links are NOT a fee-free escape hatch anymore. CORRECTION (verified).** The April 2025 zero-commission window closed: on **Dec 11, 2025 the Ninth Circuit vacated** the zero-commission ban. US external links are still *allowed*, but Apple may charge a "reasonable, non-prohibitive" commission (rate TBD on remand). Rest-of-world is still IAP-only. **Ship 15% IAP as the baseline and defer external-link experiments** — the savings are now uncertain and small. ([Fenwick analysis](https://www.fenwick.com/insights/publications/ninth-circuit-largely-upholds-ruling-in-epic-v-apple), [MacRumors](https://www.macrumors.com/2025/12/11/apple-app-store-fees-external-payment-links/))
- **RevenueCat: yes, use it.** Free up to $2,500 Monthly Tracked Revenue (then 1% of MTR) — you'll be free for a long time. It handles iOS+Android+web entitlements and receipt validation a solo dev should not hand-roll. ([RevenueCat pricing](https://www.revenuecat.com/pricing))

**Free vs paid split:** Keep a generous free tier (e.g. a handful of verses / one collection) so the funnel exists, then hard-gate unlimited verses + advanced review behind the unlock — mirroring Bible Memory's proven gate.

**Realistic revenue math** (freemium converts ~2% in this niche; one-time @ $24.99 net 15% ≈ $21.25/sale):

| Lifetime installs | Paying @ ~2% | One-time @ $24.99 (net 15%) | Annual sub @ $30/yr (net, Yr 1) |
|---|---|---|---|
| 1,000 | ~20 | ~$425 | ~$510/yr (then heavy churn) |
| 5,000 | ~100 | ~$2,125 | ~$2,550/yr |
| 10,000 | ~200 | ~$4,250 | ~$5,100/yr |

**Honest read:** "installs" ≠ your 10k *addressable*. ~2% conversion on a niche base is the binding constraint, and **80% of apps never clear $1,000/month**. If 10k is the total reachable audience and you capture a third over years, you're at **low-thousands/year**. Genuine side income requires pushing installs *well past* 10k, or adding a real premium tier (see below). ([RevenueCat benchmarks](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026/), [80%-under-$1k](https://www.start.io/blog/report-80-of-mobile-apps-fail-to-earn-1000-month-in-subscription-revenue/))

**The one credible premium lever:** Bible Memory's *only* premium-priced tier ($49.99/yr) is AI commentary — proof this audience *will* pay more for genuine added value. Bread's analog is **voice transcription (Soniox), which carries a real per-recitation cost** and is the most defensible premium feature in the niche. If you ever want a recurring tier, gate *heavy voice usage* behind it (the cost story justifies the recurrence) rather than gating Bible access.

---

## 4. Competitor & product gaps

**What Bible Memory (the leader: 2M+ users, 4.8★/~31K, $19.99 lifetime) does well:** first-letter typing for active recall; a **legible scaling-interval review system** (Daily→Annually, intervals auto-push-out on success and contract on failure, user-set "Max Review Time" cap, per-verse lock, daily "verses due" queue + reminders); a uniquely-loved **per-word heat map**; long-passage support; gamification + groups. ([biblememory.com](https://biblememory.com/), [User's Manual](https://biblememory.com/pages/users-manual))

**Where it bleeds (Bread's opening):** speech recognition is *bad* (correct recitations flagged wrong); reliability bugs (verses disappearing/duplicating, blank long passages, sync failures); aggressive paywall and à-la-carte translation pricing; typing is exclusionary (useless hands-free/driving/eyes-closed).

**The white space — confirmed across the whole field:** **voice recitation + accurate scoring is the one thing the entire category fails at.** Both leaders that attempt it (Bible Memory's speech recognition, Verses' "Speak Out" beta on Apple/Siri) get savaged for flagging correct recitations as wrong. This is an *unmet need with active demand* — and your power user came to you *specifically* for this angle. Bread's Soniox + `align.ts` (grace for word order, fillers, punctuation) is purpose-built to fix it.

**The 3-5 improvements that most move retention/conversion, ranked by impact-vs-effort:**

1. **Legible scaling-interval review queue + reminders — HIGHEST IMPACT, MEDIUM EFFORT.** This is *table stakes* (the price of entry) AND exactly what your power user asked for. Bread already has the SR engine (`passCount`/`nextDueAt`) — the gap is the *user-facing* experience: a clear daily "verses due today" queue, per-verse frequency that visibly scales out on success / contracts on failure, a user-set max interval, per-verse lock, and reminders tied to it. Mostly UI + scheduling on top of existing data. **Do this first.** (You already have the notification system: review reminders + in-progress nudges via Expo Push.)
2. **Voice-derived heat map — HIGH IMPACT, LOW-MEDIUM EFFORT.** Bible Memory's most-loved feature, and **Bread already has the data for free** — the alignment output knows exactly which words you missed. "Here are the words you keep stumbling on, per verse, over time" matches their best feature and beats it (voice-derived, not typing-derived). High leverage because the hard part (the alignment) is done.
3. **Lean hard into "recite out loud, fairly scored" as the identity — HIGH IMPACT, LOW EFFORT (positioning).** This is differentiation you already own; the work is surfacing it (onboarding, the killer "eyes-closed recitation" demo, App Store screenshots/video). Mostly marketing/UX, not new engineering — see §5.
4. **BSB as default translation — HIGH IMPACT (de-risk + UX), MEDIUM EFFORT.** Covered in §2; this is both a licensing fix and a real UX upgrade over archaic KJV. Counts as a product improvement, not just legal hygiene.
5. **Long-passage support + TTS/audio playback for hands-free review — MEDIUM IMPACT, MEDIUM-HIGH EFFORT.** Rounds out parity (chapters/books) and serves auditory/hands-free learners. Lower priority than 1-4; sequence after the differentiator is locked.

**Pricing anchor to respect:** the niche is cheap and one-time-friendly (~$5-10/yr or ~$15-20 lifetime). Your $24.99 one-time is justified *only* by the voice differentiator being real and visible — which is why #1-3 must ship before you charge.

---

## 5. Marketing plan

**This is a community-and-content game, not a paid-media game.** Bible Memory reached 2M+ users on organic + community + church word-of-mouth, *not* venture-scale ads. A solo dev's edge is the recite-and-score differentiator + grinding the exact niche communities — not outbidding anyone.

**Channel 1 — ASO + the "recite out loud, get scored" hook. ~$0, do this week. HIGHEST ROI.**
Rewrite title/subtitle around "Bible Memory / Memorize Scripture"; fill the 100-char keyword field (verse, scripture, KJV, recite, memorization, spaced repetition, review, devotional); **lead screenshots and the App Store video with the voice-recitation hook nobody else has.** A 20-second Reel of someone reciting a verse and getting scored is video-native and shareable in a way a typing app isn't. This is the foundation that makes every other channel convert. Cost: time only. ([HimFirst Christian ASO](https://himfirstmedia.com/app-store-optimization/), [AppTweak](https://www.apptweak.com/en/aso-blog/apple-ads-benchmarks))

**Channel 2 — Infiltrate the existing Bible-memory communities. ~$0–50. "Where the 10k people are."**
They're pre-aggregated and identifiable:
- **Bible Memory Goal** ([biblememorygoal.com](https://www.biblememorygoal.com/join/)) — a dedicated accountability community *and* the host of the "best Bible memory apps" roundup. **Get Bread listed on that roundup** — high leverage. ([roundup](https://www.biblememorygoal.com/memory-methods/best-bible-memory-apps/))
- **faith.tools** — free directory listing, audience is exactly people seeking faith software.
- **Facebook groups:** "Bible Memory Community," scripture-memory challenge groups, Christian homeschool curriculum groups. Participate genuinely; don't spam.
- **Seed free lifetime access to in-niche micro-creators** (Bible-memory / Christian-mom / homeschool TikTok/Reels) for honest demos. A 15k-engaged in-niche creator beats a 500k generalist. Near-zero cost. ([FrontGate faith creators](https://www.frontgatemedia.com/faith-based-creators-youtube-tiktok/))
- **Concentrated institutions to reach bottom-up:** National Bible Bee (12k+ intense memorizers/yr — note the competitor already hosts the official verse lists), Awana (10k+ US churches), Christian homeschool curricula. Reach *individual families* via the FB groups now; approach institutions only once you have testimonials. ([Bible Bee](https://biblebee.org/), [Awana](https://www.awana.org/for-your-church/awana-clubs/))

**Channel 3 — Apple Search Ads on intent keywords ONLY. ~$150–450/mo, capped.**
The one paid channel that can be ROI-positive because it captures *existing search intent* at ~$2–6 CPI with a 66% search conversion rate. Bid on "bible memory," "memorize scripture," "scripture memory," and competitor brand terms. Start at **$5–15/day**, cap it, measure install→activation, kill non-converting keywords. **Do NOT touch Meta/Google/TikTok broad UA** — at this niche's sub-$5 LTV, paying $5–13 to interrupt people who weren't looking is structurally ROI-negative. ([AppTweak](https://www.apptweak.com/en/aso-blog/apple-ads-benchmarks), [Business of Apps CPI](https://www.businessofapps.com/ads/cpi/research/cost-per-install/))

**Honest expectation:** this builds slowly — hundreds, then low-thousands of users over months — not a paid-acquisition hockey stick. And **don't pump a dollar into acquisition until licensing is resolved** — marketing scales the exposure.

---

## 6. Recommended sequence (≈90 days)

**Phase 0 — Licensing de-risk (Weeks 1-3). Do this first; it gates everything.**
- **Build BSB into the app as the default bundled CC0 translation** (USFM/USFX→JSON, short-circuited inside `fetchVerse`/`fetchChapter`). This alone makes a paid app legally clean and fixes the archaic-KJV UX problem.
- **Remove NIV** from any path that will be monetized; keep ESV/NLT/NKJV available but flagged as non-load-bearing "extras" (or gate them out of the paid build for now).
- **Send the emails** (low cost, long lead time — start the clock now): `licensing@crossway.org` for ESV written terms; `support@api.bible` to confirm (a) NKJV commercial availability, (b) the real cache window (14 vs 30 days), (c) any per-user/"user size" tier limits; Tyndale for an NLT Permission Letter quote. Treat all four as *optional future upsells*, not blockers.

**Phase 1 — Product: close the table-stakes gap (Weeks 3-7).**
- Ship the **legible scaling-interval review queue + reminders** (improvement #1) — the thing your power user wants and the daily-habit engine. Reuse the existing SR engine and notification system.
- Ship the **voice-derived heat map** (improvement #2) — cheap, data already exists, matches the competitor's best feature.

**Phase 2 — Monetization (Weeks 7-9).**
- Integrate **RevenueCat**, enroll in the **Small Business Program (15%)**, ship a **one-time $24.99 lifetime unlock** (+ optional $29.99/yr secondary SKU). Generous free tier, hard-gate unlimited verses + advanced review. Frame the purchase as "unlock the memorization toolkit," not "Bible access." Defer external-payment links.

**Phase 3 — Marketing (Weeks 9-13, ongoing).**
- **ASO rewrite + voice-hook screenshots/video** (week 1 of this phase — it's $0).
- **Community infiltration**: get listed on Bible Memory Goal + faith.tools; seed micro-creators; participate in the FB groups.
- **Apple Search Ads** on intent keywords, capped at $5-15/day, only after activation/retention look healthy.

**Why this order:** licensing makes revenue legal; product makes the app retain and justifies the price; monetization captures it; marketing scales it. Marketing last because it multiplies whatever the product+price already converts — and because every download made before licensing is resolved is added exposure.

---

## 7. Open questions / things to verify yourself

**Legal (primary confirmation / lawyer / publisher email required):**
1. **ESV freemium ambiguity [verify in writing].** Whether *any* commercial app can use the free ESV key even if ESV itself isn't paywalled is genuinely unresolved by the terms' wording. Get it in writing from `licensing@crossway.org` before relying on it. (Default assumption: no.)
2. **ESV org-level license for a solo dev [verify].** Stated policy is organizations-only, but individuals can submit the digital form. If you want ESV at all, submit and ask — expect slow (weeks-to-months) responses and a likely fee/decline. Cost figures are entirely unknown.
3. **NKJV commercial availability via API.Bible [verify with `support@api.bible`].** Unconfirmed whether they can sub-license it commercially. If not, it's direct HarperCollins Christian — likely impractical solo.
4. **NLT real cost [verify with Tyndale + `support@api.bible`].** API.Bible Pro $29/mo + ~$10/mo is known; the Tyndale Permission Letter/License fee is case-by-case and unpublished. Get a quote before committing.
5. **API.Bible cache-refresh window [verify].** Their own docs say 14 *and* 30 days. Assume 14; confirm. Bread doesn't currently enforce time-based cache refresh — a gap to close *only if* you ship licensed translations.
6. **"Do not alter Scripture" clause [verify by reading the T&C directly].** This clause was *not* primary-source-confirmed; the "is verse-masking a violation?" concern rests on an unverified quote. Almost certainly fine (memorization aid, not misrepresentation), but read [API.Bible Terms & Conditions](https://docs.api.bible/terms-and-conditions/) directly before treating it as a real risk.
7. **External-payment-link economics [monitor].** The Ninth Circuit remanded the commission rate; the "reasonable, non-prohibitive" fee is TBD. Don't build around it until the number exists. Ship 15% IAP now.

**Product / business assumptions to test on real users (don't over-index — you have ~5 inactive users today; ship reasonable defaults and tune later):**
8. **$24.99 one-time vs the niche's $15-20 anchor.** Your premium over Bible Memory's $19.99 is justified *only* if the voice differentiator lands. Validate that the recite-and-score experience actually feels worth the premium before locking price.
9. **Will the voice feature hold up at scale?** Your entire differentiation rests on Soniox + `align.ts` scoring *correctly* where competitors fail. Verify accuracy across accents, fast/slow speech, and noisy environments on real devices — the category's open wound is *bad* scoring, and shipping bad scoring would forfeit your one edge.
10. **Per-recitation Soniox cost vs. a one-time price.** A lifetime unlock means unbounded future transcription cost per user with no recurring revenue. Model the heaviest-user case; this is the strongest argument for eventually gating *heavy voice usage* behind a recurring tier.

---

## 8. Appendix — How paid apps actually commercialize ESV and API.Bible texts

*Added 2026-06-05 from a focused follow-up research pass (3 streams + adversarial verification, skeptical of dollar figures since Bible licensing pricing is almost entirely private).*

### The short answer

Real paid Bible apps don't "buy a commercial ESV API key" — **there is no such product.** They commercialize copyrighted translations one of three ways: by **being (or being owned by) a publisher/aggregator** (Olive Tree is owned by HarperCollins Christian Publishing; Tecarta holds direct deals with every major publisher), by **running an in-house licensing team** that negotiates publisher-by-publisher (Logos, Dwell), or — the only realistic route for a small shop — by **renting the publisher relationships from an aggregator**, principally **API.Bible's commercial tier** (~$29/mo Pro + ~$10/mo per translation at low user counts). Crossway licenses the ESV to *organizations, not individuals or solo developers*, so direct ESV is effectively closed to you unless you incorporate and negotiate. **Verdict for a ~5-user solo app: ship public-domain (BSB/WEB/KJV) under your paid app today — zero cost, zero risk — and only rent a modern copyrighted translation through API.Bible if it's a hard product requirement.** The moment Bread charges money, your current free ESV and free-tier API.Bible usage is out of compliance regardless of how few verses you fetch.

### ESV / Crossway: the real commercial path

**No published commercial tier, no public price** — every primary source resolves to "submit the form." Commercial ESV is pure case-by-case negotiation. ([api.esv.org](https://api.esv.org/), [crossway.org/permissions/digital](https://www.crossway.org/permissions/digital/))

**Process:** (1) register your app by emailing `licensing@crossway.org`; (2) submit the **ESV Digital Permission Request Form** ([crosswaygnp.formstack.com](https://crosswaygnp.formstack.com/forms/esv_digital_licensing_proposal)); (3) Crossway reviews and, if they engage, sends terms privately. The form asks individual-vs-company, **what % of your product is ESV text**, passage counts, and requires a **publisher name** — i.e. revenue-model fields, priced like print quotation permissions (royalty on net receipts or flat advance).

- **Real costs: none are public.** Genuine information gap. The "$10,000 up-front + $10/copy NIV" figure that circulates **could not be confirmed on its cited source — do not cite it.** No ESV commercial rate exists publicly anywhere.
- **Cautionary history:** Crossway once gave free ESV distribution to the open-source SWORD/AndBible ecosystem, then **revoked it** and forced those apps to remove the ESV. "We had it free before" is not durable. ([sellingjesus.org](https://sellingjesus.org/articles/bible-publishers), [ministrywatch.com](https://ministrywatch.com/amp/bible-publishers-stewards-or-gatekeepers/))
- **Does an LLC help?** Likely yes — it makes you *eligible* (the policy is about contracting with a legal entity, and the form has a "company" path). **But eligible ≠ they'll quote a 5-user app a viable rate, or quote it at all.** That risk is real and not public.
- **Real examples:** Logos/Faithlife, Olive Tree (HarperCollins-owned), Tecarta, Crossway's own app — all direct deals. **Dwell** (funded audio app, $9.99/mo–$59.99/yr) ships ESV: the canonical "you get ESV by being a funded organization, not a solo dev" case.

### API.Bible + publishers: the real commercial path

**API.Bible (American Bible Society) is the documented, near-self-serve commercial path.** The key insight: it grants commercial rights *and* gates access, **bundled** — it already holds the upstream publisher agreements, so your per-translation fee *is* your sublicense. For versions it carries commercially, **you do not separately chase the publisher.** (CONFIRMED from [api.bible](https://api.bible/))

| Plan | Price | Calls/mo | Commercial? |
|---|---|---|---|
| Starter | $0 | 5,000 | **"Strictly non-commercial. No ads, fees, freemium models or upsells."** |
| Pro | $29+ | 150,000 | Commercial, **+ per-translation licensing** |
| Enterprise | Contact | Custom | Beyond ~100K users |

Per-translation commercial license, **priced by monthly active users, on top of Pro:** 5K MAU → **$10/mo**, 20K → $25, 50K → $75, 100K → $150. At ~5 users you're in the bottom bucket: **~$29/mo Pro + ~$10/mo per copyrighted translation.** Public-domain versions (KJV, WEB, ASV) are **free for commercial use** at any tier.

- **Stacking question — does API.Bible alone cover you?** For versions it carries commercially, **yes — no separate publisher letter.** Catches: **no sublicensing** (*"not authorized to sublicense or distribute… the API Content without approval in writing"* — serving inside Bread's own UI/cache is fine; **re-exposing raw text through your own public Supabase edge function is not**); the grant is **revocable**; each publisher's **attribution line still applies**. ([api.bible/terms-and-conditions](https://api.bible/terms-and-conditions))
- **NLT (Tyndale):** carried, ~$10/mo via API.Bible — viable.
- **NKJV (HarperCollins):** carried commercially via API.Bible — viable. *(That ESV/NLT/NKJV specifically sit in the commercial catalog is partly inference — verify on the dashboard / with support.)*
- **NIV (Biblica/Zondervan):** **NOT available commercially via API.Bible** — confirmed verbatim *"NIV commercial use not available."* Only route is a direct Zondervan license (heavy, ~10-day response, case-by-case). **The one genuine "go direct or drop it" case — recommend dropping/deprioritizing NIV.**
- **The ESV gap:** whether **ESV specifically** is in API.Bible's *commercial* catalog is **NOT stated publicly and is UNCONFIRMED.** Email `support@api.bible` before assuming. If it is, that's plausibly your *only* legal ESV path as a solo dev; if not, ESV is effectively closed without incorporating.

### Aggregators / resellers — one deal instead of N

- **API.Bible** — 2,500+ versions; the only **clean self-serve commercial** reseller. Its commercial definition *explicitly includes* "freemium models… and/or paid access," so Bread's plan unambiguously triggers it.
- **Tecarta / "Life Bible"** — partners with **every major publisher** (Tyndale, Zondervan, Thomas Nelson, Crossway, Lockman…), 40+ translations. But it's a **partnership / white-label** play, not a self-serve developer API. ([tecarta.com](https://tecarta.com/))
- **YouVersion Platform** (Life.Church, launched late 2025) — free, 1,000+ versions, **has a React Native SDK**. **The trap:** widely understood to be **non-commercial-locked** — though the exact revocation mechanics come from a third-party dev blog, not official terms, so treat the directional warning as plausible but **verify against the terms you accept at registration.** ([platform.youversion.com](https://platform.youversion.com/))

### The freemium structure — NOT a loophole

The dominant pattern: app is free, copyrighted translations sold as **in-app purchases** (one-time unlock or subscription bundle) through Apple/Google IAP; money flows user → Apple/Google → developer → publisher royalty. **But putting text behind IAP does not by itself satisfy "no charge for the text"** — both free tiers forbid the *app* being commercial at all (API.Bible's definition explicitly names "freemium models"). IAP is *how you collect and remit the publisher's cut*, **not a way around needing the license.** The compliant shape: free public-domain core (needs no license) + copyrighted translations as paid add-ons *each backed by a commercial license.*

### Solo-dev decision tree

1. **Monetize today on public domain.** BSB (CC0, public domain since 2023-04-30, modern, no royalty/permission) + WEB + KJV. Your `fetchVerse()`/`fetchChapter()` adapter is *already* the provider abstraction this needs — monetize on public-domain text now, swap in a licensed provider later with no re-architecting. **Start here.**
2. **Is a specific modern copyrighted translation a hard requirement?** No → ship BSB/WEB/KJV, done. Yes → move to API.Bible Pro ($29/mo), email `support@api.bible` to confirm which of ESV/NLT/NKJV are in the *commercial* catalog and get the ~$10/mo/translation quote.
3. **Is ESV non-negotiable?** Confirm with API.Bible first (unconfirmed there). If not offered → incorporate (LLC) → `licensing@crossway.org` → Formstack proposal → private negotiation. High effort, unknown price, real chance they decline a small app.
4. **Is NIV non-negotiable?** Direct Zondervan only. **Likely out for now.**

**When is copyrighted text worth it?** At ~5 users, **not yet** (a product call, not a fact). Per-translation fees, attribution, revocation risk, the org-only ESV wall, and negotiation effort all dwarf the upside before real scale. Ship public-domain BSB now; revisit paid API.Bible translations when usage/revenue justify the recurring cost.
