# Aloo — ASO & Store Optimization

> An optimization layer on top of your existing [`store-listing.md`](../store/store-listing.md) (which is solid). This sharpens **discoverability** (how people *find* you when searching "taxi", "course", "Yango") and **conversion** (how many installs once they land), plus a plan to earn your first reviews.

---

## 0. Fix these first (from the brand kit)
Your current listing still has the old contacts. Before submitting:
- [ ] WhatsApp **+222** (not +33) everywhere in the listing
- [ ] **No domain** in the listing yet — Apple's Marketing URL field can stay blank, or point it at a Facebook page until a `.mr` domain is registered. Strip any old domain placeholders.
- [ ] Support contact = **WhatsApp +222 …** (no email until a domain ships)
- [ ] No "Tewiz"/"Radar" anywhere user-visible

---

## 1. Title & subtitle (highest ASO weight)
The store **indexes your title and subtitle most heavily.** Put your top search words there — not just the brand name.

**Apple**
- App name (30): `Aloo : Course & Taxi` *(brand + your two biggest keywords)*
- Subtitle (30): `Parle. On t'amène. Nouakchott` *(or alt: `Course à la voix, Nouakchott`)*

**Google Play**
- Title (30): `Aloo: Course & Taxi VTC`
- Short description (80): `Course en Mauritanie : ta voix suffit, paie cash. Taxi à Nouakchott.`

> Don't keyword-stuff the name into nonsense — `Aloo : Course & Taxi` stays clean *and* ranks. Keep the brand first.

## 2. Keyword field (Apple, 100 chars, comma-separated, no spaces)
Don't repeat words already in your name/subtitle (Apple auto-indexes those). Fill the rest:
```
vtc,Captain,trajet,voiture,yango,voix,hassaniya,pulaar,wolof,soninke,colis,livraison,nouadhibou,mauritanie
```
*(Apple also indexes your locale. Submit a separate Arabic keyword set — see §4.)*

## 3. Long description = your Google ranking text
Google indexes the **full long description**, so weave keywords in *naturally* (Apple ignores it for ranking but users read it). Make sure these phrases appear once or twice, in real sentences: **taxi Nouakchott · course en Mauritanie · VTC · commande vocale · hassaniya, français, arabe, pulaar, wolof, soninké · livraison de colis · paiement en espèces · Captain**. Your existing long description already covers most — just confirm "taxi", "Nouakchott", and the 6-language line all appear in the first 2 lines (the part shown before "read more"), and that the lead sentence is *« Parle. On t'amène. — l'app de course mauritanienne où ta voix suffit. »*

---

## 4. Add an Arabic listing (big win, low effort)
Both stores let you localize the listing per language. **Add an Arabic (`ar`) listing** — most of your market searches in Arabic. Mirror the listing:
- Name: `ألو: مشاوير وتاكسي`
- Subtitle: `احكي... ونوصّلوك — نواكشوط`
- Short desc: `تطبيق المشاوير الموريتاني: صوتك يكفي، خلّص كاش. تاكسي في نواكشوط.`
- Keywords: `تاكسي,مشوار,كابتن,نواكشوط,موريتانيا,صوت,حساني,بولاري,ولفي,سوننكي,توصيل,طرد,يانغو`
- Long desc: the Arabic translation of your FR long description (the app already ships full Arabic — reuse that tone). Lead with *« احكي... ونوصّلوك. تطبيق المشاوير الموريتاني — صوتك يكفي. »* and list all 6 languages.

Also keep French as primary and consider an English listing later for completeness.

---

## 5. Screenshot captions (the #1 conversion lever)
Most installs are decided by the **first 2–3 screenshots**, not the text. You have 5 ([docs/store/assets/screenshots](../store/assets/screenshots)). Put a short, bold caption on each (Sora, white on ember, like the brand). Order matters — lead with the magic:

| # | Screen | Caption FR | Caption AR / Hassaniya |
|---|---|---|---|
| 1 | Voice command | **Parle. On t'amène. — Ta voix suffit.** | **احكي... ونوصّلوك — صوتك يكفي** |
| 2 | Rider home | Une course en 10 secondes | مشوار في 10 ثوانٍ |
| 3 | Map / tracking | Suis ton Captain en direct | تابع كابتنك مباشرة |
| 4 | Multilingue | Hassaniya, français, arabe, pulaar, wolof, soninké | بكل لغاتك — 6 لغات |
| 5 | Captain wallet | Captain ? **Gagne plus. Le reste, dans ta poche.** | كابتن؟ ربح أكثر، والباقي في جيبك |

> Lead with the **voice screen**, not the home screen — it's what makes you different. (Your store-listing.md currently leads with the home screen; swap them.)

## 6. App icon
Already strong (the "A" on ember — high contrast, legible at thumbnail size). Don't change it for launch — consistency across stores, ads, and the app matters more than iteration right now.

---

## 7. Ratings & reviews — your first 50
New apps with **0 reviews convert badly and rank lower.** Plan to earn 20–50 in the first two weeks, while you control quality:

1. **In-app prompt** — trigger the native rating prompt **after a 5-star ride** (rider) and after a paid-out week (captain). Never on app open. (Use `StoreReview` / in-app review API.)
2. **The WhatsApp ask** — after a rider's good first ride, send: *« Content de ton trajet ? 🙏 Mets-nous 5 ⭐ ici, ça nous aide énormément : [lien direct] »* with the **direct review deep link** (App Store: `?action=write-review`; Play: the listing link).
3. **Founding users** — your first happy drivers and friends-and-family riders are your easiest 20 reviews. Ask them directly, in person.
4. **Respond to every review** — especially the bad ones. A calm, helpful public reply turns a 1-star into trust for the next reader.
5. **Never buy reviews** — both stores detect and punish it; one removal can tank the listing.

---

## 8. After launch — iterate with the data
- Watch **App Store Connect** and **Play Console** conversion (impressions → product page → install). Low product-page conversion = fix screenshots/captions. Low impressions = fix keywords.
- Re-order screenshots and test a new caption if conversion is weak; change one thing at a time.
- Re-submit the keyword field every update — it's free real estate.

## TL;DR
Title/subtitle carry your keywords · primary tagline is **Parle. On t'amène. / احكي... ونوصّلوك.** · always list **all 6 languages** (hassaniya, français, arabe, pulaar, wolof, soninké) · add an **Arabic listing** · lead screenshots with the **voice** screen · earn **20–50 reviews** fast via in-app prompt + the WhatsApp ask · then iterate on store analytics.
