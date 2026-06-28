# Aloo — Landing page

The public marketing site for **Aloo**. One self-contained `index.html` — no build step, no framework. French primary at `/`, Arabic mirror at `/ar/`. Primary tagline: **Parle. On t'amène. / احكي... ونوصّلوك. / tkellem · wnwasslouk.**

## ✏️ Before you publish — edit 4 values

Open [`index.html`](./index.html), find the `SITE` block near the bottom (in `<script>`), and set:

```js
const SITE = {
  whatsapp:   '2220000000',   // your +222 WhatsApp Business number, digits only
  waMessage:  'Salam ! ...',  // pre-filled rider signup message
  waDriver:   'Salam ! ...',  // pre-filled driver signup message
  iosUrl:     '',             // App Store URL once live (empty = badges route to WhatsApp)
  androidUrl: '',             // Google Play URL once live
};
```

Every WhatsApp button, the footer number, and the store badges update themselves from these. While `iosUrl`/`androidUrl` are empty, the store badges show a "Bientôt" ribbon and route to WhatsApp signup — which matches how onboarding actually works today. **No email is used** — WhatsApp is the only contact channel until a domain ships. Mirror the same edit in [`ar/index.html`](./ar/index.html).

## 🖼️ Add a share image (recommended)

The page already has the favicon. For rich WhatsApp/Facebook link previews (important — sharing is your main channel), add:

- `assets/og-image.png` — **1200×630**, the ember-gradient launch creative (the one in the brand board). Without it, shared links show no image.

## 🚀 Deploy — 3 options

1. **Static host (recommended, ~5 min):** drag the `apps/landing/` folder into **Netlify Drop**, **Vercel**, or **Cloudflare Pages**. Point your domain's DNS at it once you have one. Free, fast, HTTPS included.
2. **Serve from your API** (same pattern as the `/legal` pages in `apps/api/src/index.ts`):
   ```js
   app.use('/', express.static(resolve(__dirname, '../../../apps/landing')));
   ```
3. **Preview locally:** the `aloo-landing` config in `.claude/launch.json` serves it on `http://localhost:4321` via `preview-server.js`.

## Notes

- `preview-server.js` is a tiny local-only static server. **Not used in production** — don't deploy it.
- Internal links (`/legal/support.html`, `/legal/privacy-policy.html`) assume those pages are served on the same domain. Update the support page's WhatsApp number to your +222 line too (it still shows the old +33).
- Brand, copy, and tone come from [`../../docs/marketing/brand-kit.md`](../../docs/marketing/brand-kit.md). Keep them in sync.
