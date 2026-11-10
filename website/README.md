# Sensoper public website — sensoper.in and shop.sensoper.in

Plain HTML, CSS and JavaScript — no framework, no build step — so it loads in about a second on a slow 4G phone
(about 130 KB compressed for the home page, including the animation library). Everything a visitor sends goes to the Sensoper ERP through two parts of
the API that nginx passes on from these domains: `/api/public/*` (leads, shop, pop-ups) and `/api/client/*`
(customer logins). Staff manage it all in the ERP under **Sales & projects → Website**.

| Page | File | What it does |
|---|---|---|
| sensoper.in | `index.html`, `assets/home.js` | A 3D film of a day on solar (dawn to night), five systems (on-grid, off-grid, hybrid, battery storage (BESS), solar pump) with live diagrams, a 24-hour chart, why the EB bill is high, the PM Surya Ghar subsidy, the savings calculator, customer videos, how it works, brands we deal with, why us, FAQ, contact. A mobile-number box in the hero and at the end, a 3-tap quiz behind every quote button, and a call / free-plan bar on phones. |
| shop.sensoper.in | `shop/index.html`, `assets/shop.js` | Products staff put live in the ERP, with search, categories, a cart and an order request (no payment online — staff confirm by phone). Delivery, or pick-up from a store: the ERP's locations with pick-up turned on, with “Find the nearest store”. Served at `/` on shop.sensoper.in and at `/shop/` on quote.sensoper.in — all its paths are absolute (`/assets/…`, `/api/…`), so both work. |
| sensoper.in/account | `account/index.html`, `assets/account.js` | Customer login made by staff: savings, units, CO₂, payments, project steps, service requests and offers. |
| all pages | `assets/core.js`, `assets/site.css` | Links, white header, WhatsApp button, live company details, the number box and quiz, pop-up notifications. |
| home page animation | `assets/vendor/gsap.min.js`, `assets/vendor/ScrollTrigger.min.js` | GSAP 3.12.5 (free "standard" licence, gsap.com/standard-license). Optional: without it, or with reduced motion, every section shows its finished state. |
| 3D hero | `assets/hero3d.js` (built from `src/hero3d.js`), `assets/img/hero-*.webp` | three.js scene, loaded after the page shows; the webp pictures stand in before it loads, without WebGL and with reduced motion. |

Footer on every page: **ERP login** → https://quote.sensoper.in/login (staff, partners, investors).

## Change the words or numbers
- Text is in the HTML files. Prices and the WhatsApp number come from the ERP (Website → Pop-ups & settings, Price list → Package slabs).
- The tariff slabs, 4.4 units/kW/day and the PM Surya Ghar amounts used by the calculator and the quiz are in
  `assets/core.js` ("solar sums"). The subsidy phase end date is `PSG_END` in `assets/home.js`.
- The 3D scene is `src/hero3d.js`. After editing it, rebuild once: `cd website && npm install && npm run build:hero`
  (writes `assets/hero3d.js`; the server needs nothing else). Its day (6.6 kW of panels, 10 kWh battery) uses the same
  formulas as `hourAt`/`energyAt` in `assets/home.js` and the 24-hour chart — keep them in step.
- The system diagrams and the 24-hour chart are inline SVG in `index.html`.
- The example bill in the film and the bill section is ₹4,500 (`homeEstimate(4500)`).
- **Brands we deal with** comes from the ERP's Brands (those shown on the website), with their logos and categories. The list
  in `index.html` only shows if the ERP can't be reached; the section hides when the ERP has no brands to show.
- **Customer videos** come from the ERP (Website → Testimonials): YouTube links or uploaded videos. The section hides when none are live.
- **Pick-up stores** in the shop come from the ERP's locations with pick-up turned on. With none, pick-up is "from our office" as before.

## Preview on a computer
    cd backend && …start the backend on :8001…
    cd website && node dev-server.mjs        # http://localhost:5100 — /shop/ is the shop, /account/ the login
On localhost the links to the shop, account and ERP point at the local copies automatically (the ERP at port 3000).
On any *.sensoper.in address the links follow the ERP's Website settings: "Main website address" and "Shop address"
(`urls` in /api/public/site). The ERP login is always quote.sensoper.in/login.

## Put it live
**For now, on quote.sensoper.in with the ERP.** `deploy/deploy-website.sh` copies the files, then
`deploy/enable-on-quote.sh` (once) gives the website quote.sensoper.in's front page, `/shop/` and `/account/`.
The ERP keeps `/login`, `/dashboard` and the rest. On that address the links stay on it — Shop is `/shop/` until the
ERP's Shop address is set (e.g. https://shop.sensoper.in) — and ERP login is `/login`. Undo with `deploy/enable-on-quote.sh --undo`. See `DEPLOY.md` → "This release".

**Later, on its own addresses.** DNS for sensoper.in, www and shop → the VPS; `deploy/nginx-sensoper-website.conf`
into nginx; certbot for https. Then set the ERP's Website settings (Main website address, Shop address) and every
link follows them.
See `DEPLOY.md` → "When sensoper.in is ready".
