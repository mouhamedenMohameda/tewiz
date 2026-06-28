# Aloo — Facebook Launch Kit

> Everything to **stand up the Facebook page** so the first visitor takes you seriously: the page setup, the logo, the cover, and the **5 founding posts** that go up before the 14-day launch sprint kicks in.
>
> Why this exists separately from [`launch-14-day-sprint.md`](./launch-14-day-sprint.md): the sprint assumes a page that already looks alive. These 5 posts build that bed — *they go up first, the sprint runs on top*.

---

## 1. Page setup checklist (do this in order, ~30 min)

- [ ] **Create the page** → Pages → Create new Page
- [ ] **Page name:** `Aloo` (exact, with the space — matches the app)
- [ ] **Username:** `@AlooMR` *(this becomes `facebook.com/AlooMR` — claim it fast, can't be re-claimed)*
- [ ] **Category:** *Local Business* → **Taxi Service** (primary). Add secondary: *Software Company*.
- [ ] **Short description (255 char):** *L'app de course mauritanienne — Parle. On t'amène. Ta voix suffit, paie en cash, à Nouakchott. 🚗🧡 +222 …*
- [ ] **Long description (About):** see boilerplate at the bottom of this doc.
- [ ] **Profile picture:** the "A" monogram icon. Upload `apps/mobile/assets/icon.png` (1024×1024). Specs in §2.
- [ ] **Cover photo:** export from [`assets/creatives.html`](./assets/creatives.html#fb-cover-fr) — see §3.
- [ ] **Action button (the blue button on the page):** *Send Message* → connects directly to your WhatsApp Business via Click-to-WhatsApp. *(Backup: "Contact Us" → WhatsApp link.)*
- [ ] **Contact:** WhatsApp `+222 …`. No website yet (skip the website field until you have a `.mr`).
- [ ] **Location:** Nouakchott, Mauritania.
- [ ] **Hours:** 24/7 (rides) or your support hours if smaller.
- [ ] **Page roles:** add a second admin (yourself + co-founder) — never run a brand page with one admin only.
- [ ] **Auto-reply in Messenger:** instant greeting + menu (mirrors WhatsApp greeting, see brand kit §6).
- [ ] **Post the 5 founding posts in order** (see §4). PIN post #1.
- [ ] **Invite 50 friends** to like the page the day post #1 goes up — this is the only time FB lets you do this, and 0-likes pages look dead.

---

## 2. Logo / Profile picture

**Use the existing app icon — same "A" monogram, same ember gradient.** Consistency across the app icon, the Play / App Store icon, and Facebook avatar makes you instantly recognizable.

- **File:** `apps/mobile/assets/icon.png` (1024×1024 PNG, no alpha)
- **Upload size on Facebook:** 320×320 minimum; the source file is plenty.
- **Display:** Facebook crops avatars to a circle. The "A" monogram is centered with safe margin around it, so it survives the crop with no issue.
- **Never:** add a "1." badge, a launch banner overlay, a stock-photo background. The icon is the brand.

---

## 3. Cover photo

Four ready-to-export covers live in [`assets/creatives.html`](./assets/creatives.html). **The bilingual FR + AR version is the recommended default** for a national page — both languages at equal visual weight, no language feels like a sub-title. The mono-language variants exist for cases where you want a sharper single-language hit.

| Variant | DOM id | Best for |
|---|---|---|
| **Bilingual FR + AR** ⭐ | `#fb-cover-bi` | **Recommended default.** National page serving both audiences from day 1 — *Parle. On t'amène.* / *احكي... ونوصّلوك.* stacked, equal weight, dual wordmark. |
| French only | `#fb-cover-fr` | If your earliest audience is Francophone-leaning |
| Arabic / Hassaniya only | `#fb-cover-ar` | If your earliest audience is Hassanophone-first |
| Pulaar only | `#fb-cover-ff` | Halpulaar communities first (Pulaar copy still draft — see landing kit) |

### How to export

1. Open [`assets/creatives.html`](./assets/creatives.html) in **Chrome**.
2. Right-click on the cover → *Inspect* → in the Elements tab the `<div class="creative">` is highlighted.
3. Right-click on that div → **Capture node screenshot**. You get a clean PNG at native size.
4. **For retina (recommended):** before step 3, set Chrome's zoom to 200% (Cmd/Ctrl + +). The node screenshot then exports at 1640×624 — Facebook's preferred 2× size.

### Facebook cover specs (2026)

- **Display:** 820×312 on desktop, 640×360 on mobile (FB crops to a slightly taller aspect on phones).
- **Safe zone:** center 640×312 — keep the tagline + brand mark here. Everything else (chips, "Nouakchott" pill) sits in the outer zone and may crop on small phones.
- **Upload:** 820×312 minimum, 1640×624 recommended for retina.

### Rule for swapping cover

Refresh the cover for big moments: **public launch day**, **new zone**, **the voice-demo video**, **Ramadan / rentrée scolaire**. Keep the brand mark + tagline anchor; rotate the message.

---

## 4. The 5 founding posts

> Post these **over the first 3 days** (1 + 1 + 1 + 1 + 1, with ~6 hours between). PIN post #1.
> Visual for all: ember gradient or real Nouakchott. The "A" mark in the corner. WhatsApp CTA at the end.
> Each post is given in **French** and **Arabic / Hassaniya** — post both as separate updates (FB lets you do this), or pick one if your audience is mono-lingual. Don't mash them in one post — split them.

### Post 1 — Manifesto (PIN this) 📌

> **When:** Day 0, the moment the page goes live.
> **Visual:** the launch creative — *Parle. On t'amène.* feature graphic (or the Arabic version). Single image, ember gradient, big tagline.

**🇫🇷 French**
> Salam Nouakchott. 🚗🧡
>
> On lance **Aloo** — l'app de course mauritanienne, **faite ici, pour nous.**
>
> 🎙️ **Ta voix suffit.** Tu commandes à la voix, dans n'importe laquelle de tes 6 langues.
> 💵 Tu paies **cash**, à la fin, comme d'habitude.
> 📍 Tu suis ton chauffeur en direct.
>
> Pas une app étrangère adaptée à la va-vite. **La nôtre.**
>
> Suis cette page — le lancement est très proche. 👇
> *Parle. On t'amène.*

**🇲🇷 Arabic / Hassaniya**
> سلام نواكشوط. 🚗🧡
>
> أطلقنا **ألو** — تطبيق المشاوير الموريتاني، **صُمّم هنا، لأجلنا.**
>
> 🎙️ **صوتك يكفي.** اطلب بصوتك، بأي لغة من لغاتك الست.
> 💵 خلّص **كاش** في النهاية، كي بقيت.
> 📍 تابع سائقك مباشرة.
>
> ليس تطبيقاً أجنبياً مُكيّفاً على عجل. **تطبيقنا نحن.**
>
> تابع هاد الصفحة — الإطلاق قريب جداً. 👇
> *احكي... ونوصّلوك.*

---

### Post 2 — The voice promise (the differentiator) 🎙️

> **When:** Day 0, ~6 hours after post #1.
> **Visual:** a short video — even a 10-sec phone clip of someone saying *« ماشي سوق العاصمة »* and the destination appearing on screen. If no video yet, a static of the in-app voice screen + the phrase.

**🇫🇷 French**
> 🎙️ Tu dis **« Je vais au Marché Capitale »** — et la course part.
>
> Tu **n'écris rien**. Tu **parles** — en hassaniya, français, arabe, pulaar, wolof ou soninké. On comprend.
>
> C'est ça, **Aloo**. 🚗
>
> *Parle. On t'amène.*

**🇲🇷 Arabic / Hassaniya**
> 🎙️ تقول **« ماشي سوق العاصمة »** — والمشوار يبدا.
>
> ما تكتب **والو**. تحكي تان — بالحسانية، الفرنسية، العربية، البولارية، الولفية، السوننكية. احنا نفهمو.
>
> هذا هو **ألو**. 🚗
>
> *احكي... ونوصّلوك.*

---

### Post 3 — Made in Mauritania + cash 🇲🇷

> **When:** Day 1, morning.
> **Visual:** a real Nouakchott street photo, golden hour. Or a photo of cash + the app open on someone's hand. *No stock images.*

**🇫🇷 French**
> 🇲🇷 **Faite ici. Pour nous.**
>
> Aloo connaît tes quartiers, parle **tes langues** (les six), et se règle en **cash** — comme tu fais depuis toujours.
>
> Pas de carte bancaire. Pas de compte en ligne. Juste un trajet, ton chauffeur, ton billet.
>
> Marché Capitale, Ksar, Tevragh Zeina, Oum Tounsi… on parle le même langage. 🚗

**🇲🇷 Arabic / Hassaniya**
> 🇲🇷 **صُنع هنا. لأجلنا.**
>
> ألو تعرف أحياءك، تحكي **لغاتك** (الست)، وتخلّصو فيها **كاش** — كي بقيت ديما.
>
> لا بطاقة بنكية. لا حساب على الإنترنت. مشوار، سائقك، وفلوسك.
>
> سوق العاصمة، الكصر، تفرغ زينة، أم التونسي… نحكيو نفس اللغة. 🚗

---

### Post 4 — A ride for a loved one (the heart) 👵🧡

> **When:** Day 2, evening (highest emotional engagement).
> **Visual:** the "post-proche" creative (id `#post-proche` in `creatives.html`). Or a real photo: a mother getting into a car, son watching his phone.

**🇫🇷 French**
> 👵🧡 **Une course pour un proche — depuis ton tel.**
>
> Elle doit sortir. Tu n'es pas là. Elle n'a pas l'app.
>
> Pas grave. **Tu commandes pour elle.** Le chauffeur l'appelle, l'amène. Et toi, **tu paies depuis ton compte — elle n'a même pas à le savoir.**
>
> Parce que prendre soin des siens, ça commence par un appel.
>
> *Aloo.* 🧡

**🇲🇷 Arabic / Hassaniya**
> 👵🧡 **مشوار لشخص تحبّه — من تيلفونك.**
>
> هي لازم تخرج. انت بعيد. ما عندها التطبيق.
>
> ما عليه. **اطلب ليها انت.** السائق يكلّمها، يقلّها. وانت **تخلّص من حسابك — هي ما تعلم.**
>
> لأن العناية بأهلك تبدا بمكالمة.
>
> *ألو… مامَ.* 🧡

---

### Post 5 — Drivers, we're hiring 🚖

> **When:** Day 3.
> **Visual:** the "post-driver" creative (id `#post-driver` in `creatives.html`). Or a real photo of a Founding Captain by his car, in vest, smiling.
> **Where to also push it:** every Nouakchott driver Facebook group + the printable flyer ([driver-flyer.html](./assets/driver-flyer.html)).

**🇫🇷 French**
> 🚖 **Chauffeurs de Nouakchott — Aloo recrute.**
>
> **Gagne plus. Le reste, dans ta poche.**
>
> ✅ Commission basse — cash chaque jour
> ✅ Tes clients reviennent vers toi
> ✅ Mode « je rentre chez moi » — des courses sur ta route
> ✅ Heatmap : tu vois où sont les passagers, en direct
>
> Inscription en 2 minutes sur WhatsApp +222 … 👇
> *Les 50 premiers ont des avantages.*

**🇲🇷 Arabic / Hassaniya**
> 🚖 **سائقي نواكشوط — ألو تبحث عنكم.**
>
> **ربح أكثر. والباقي في جيبك.**
>
> ✅ عمولة منخفضة، كاش كل يوم
> ✅ زبائنك يرجعون ليك
> ✅ خاصية «أنا راجع للدار» — مشاوير في طريقك
> ✅ خريطة حرارية: تشوف وين الزبائن، مباشر
>
> سجّل في دقيقتين على واتساب +222 … 👇
> *الـ50 الأوائل عندهم امتيازات.*

---

## 5. After the 5 founding posts

You hand off to [`launch-14-day-sprint.md`](./launch-14-day-sprint.md). The sprint's Day 1 is now your **Day 4** on the page (P1 *Coming soon* slots in naturally after these 5). The page is already "live and credible" by then — visitors who land via the sprint's first ads see a real brand, not a blank shell.

---

## 6. About / Long description (paste into the page's About section)

**🇫🇷**
> Aloo est l'application de course (VTC) pensée et faite pour la Mauritanie. **Parle. On t'amène.** — tu commandes ton trajet à la voix, dans n'importe laquelle des six langues du pays (hassaniya, français, arabe, pulaar, wolof, soninké), tu suis ton chauffeur en direct sur la carte, et tu paies en cash à la fin de la course, comme tu as toujours fait.
>
> L'app propose aussi la commande pour un proche qui n'a pas l'application *(« Une course pour un proche »)*, les chauffeurs favoris, les courses récurrentes, et la livraison de colis.
>
> Lancée à Nouakchott. **Faite en Mauritanie. 🇲🇷**
>
> 📲 Crée ton compte en 2 minutes : WhatsApp +222 …

**🇲🇷 Arabic**
> ألو هو تطبيق المشاوير المُصمَّم هنا، لأجلنا، في موريتانيا. **احكي... ونوصّلوك.** — تطلب مشوارك بصوتك، بأي لغة من لغات البلد الست (الحسانية، الفرنسية، العربية، البولارية، الولفية، السوننكية)، تتابع سائقك مباشرة على الخريطة، وتخلّص كاش في النهاية كي بقيت ديما.
>
> التطبيق يوفّر كذلك خاصية «مشوار لشخص تحبّه، من تيلفونك» للأشخاص اللي ما عندهم التطبيق، السائقين المفضّلين، المشاوير المتكرّرة، وتوصيل الطرود.
>
> أُطلق في نواكشوط. **صُنع في موريتانيا. 🇲🇷**
>
> 📲 أنشئ حسابك في دقيقتين: واتساب +222 …

---

## 7. Quick do / don't on Facebook

✅ Reply to every comment and DM **under 1 hour** for the first 30 days. New pages live or die by perceived responsiveness.
✅ Post in **vertical or square** (1:1 or 4:5) — they take more feed real-estate than landscape.
✅ Pin Post #1 until launch day; then re-pin the launch announcement (P6 from the sprint).
✅ Boost the post that's already winning organically. Never boost blind.
✅ Use **the same handle (@AlooMR)** across Facebook, Instagram, TikTok, YouTube, X.
❌ Don't mash FR + AR in one post. Two posts read cleaner than one bilingual block.
❌ Don't share third-party links in the first 30 days — FB throttles them. Keep traffic on-platform.
❌ Don't post stock photos of foreign cities. Real Nouakchott or nothing.
❌ Don't use the "Inviter to like" repeatedly on the same friends — it annoys, and FB caps it anyway.
