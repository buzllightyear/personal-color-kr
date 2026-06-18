# apps/web — landing page

Pre-launch marketing landing for **퍼스널 컬러** (personal-color-kr). A single
static page — no framework, no build step. On-brand with the app's editorial /
VSCO design system (`docs/DESIGN.md`): monochrome Pretendard chrome, season
colors used exactly once (the swatch row).

Not a pnpm workspace package (no `package.json`), so it has no effect on the TS
monorepo's install/CI.

## Preview locally

```bash
cd apps/web
python3 -m http.server 4321      # → http://localhost:4321
# or: npx serve .
```

## Wire the waitlist before deploy

The email form is inert until you point it at a collector. In `main.js`, set:

```js
const WAITLIST_ENDPOINT = 'https://formspree.io/f/<your-id>'; // or your own POST { email }
```

Until it's set, a valid submit shows an honest "사전 등록이 곧 열려요" message and
does **not** claim the address was saved.

## Deploy

Any static host works (the whole directory is the site):

- **Vercel:** `vercel deploy apps/web --prod` (or point a project at this dir, no build command).
- **GitHub Pages / Netlify / Fly static:** serve the directory as-is.

## Files

- `index.html` — content + structure (authentic Korean copy from the app funnel).
- `styles.css` — design tokens mirrored from `apps/mobile/src/theme/editorial.ts` + `docs/DESIGN.md`.
- `main.js` — progressive-enhancement waitlist form (validation + submit).
