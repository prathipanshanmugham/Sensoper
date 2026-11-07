# Sensoper public website — sensoper.in and shop.sensoper.in

Plain HTML, CSS and JavaScript — no framework, no build step — so it loads in about a second on a slow 4G phone
(about 130 KB compressed for the home page, including the animation library). Everything a visitor sends goes to the Sensoper ERP through two parts of
the API that nginx passes on from these domains: `/api/public/*` (leads, shop, pop-ups) and `/api/client/*`
(customer logins). Staff manage it all in the ERP under **Sales & projects → Website**.

| Page | File | What it does |
|---|---|---|
| sensoper.in | `index.html`, `assets/home.js` | A scroll story: sunrise over a house (panels go on, the bill drops to ₹0), why the EB bill is high, the PM Surya Ghar subsidy, the savings calculator, how it works, solutions, a night with a battery, why us, FAQ, contact. A mobile-number box in the hero and at the end, a 3-tap quiz behind every quote button, and a call / free-plan bar on phones. |
| shop.sensoper.in | `shop/index.html`, `assets/shop.js` | Products staff put live in the ERP, with search, categories, a cart and an order request (no payment online — staff confirm by phone). |
| sensoper.in/account | `account/index.html`, `assets/account.js` | Customer login made by staff: savings, units, CO₂, payments, project steps, service requests and offers. |
| all pages | `assets/core.js`, `assets/site.css` | Links, white header, WhatsApp button, live company details, the number box and quiz, pop-up notifications. |
| home page animation | `assets/vendor/gsap.min.js`, `assets/vendor/ScrollTrigger.min.js` | GSAP 3.12.5 (free "standard" licence, gsap.com/standard-license). Optional: without it, or with reduced motion, every section shows its finished state. |

Footer on every page: **ERP login** → https://quote.sensoper.in/login (staff, partners, investors).

## Change the words or numbers
- Text is in the HTML files. Prices and the WhatsApp number come from the ERP (Website → Pop-ups & settings, Price list → Package slabs).
- The tariff slabs, 4.4 units/kW/day and the PM Surya Ghar amounts used by the calculator and the quiz are in
  `assets/core.js` ("solar sums"). The subsidy phase end date is `PSG_END` in `assets/home.js`.
- The hero illustration is the `<svg id="scene">` in `index.html`; `film()` in `assets/home.js` animates it.
  The example bill in the film and the bill section is ₹4,500 (`homeEstimate(4500)`).
- Brand names in the "Brands we install and stock" strip are in `index.html` (twice, for the endless scroll).

## Preview on a computer
    cd backend && …start the backend on :8001…
    cd website && node dev-server.mjs        # http://localhost:5100 — /shop/ is the shop, /account/ the login
On localhost the links to the shop, account and ERP point at the local copies automatically.

## Put it live
See `DEPLOY.md` → "This release: the customer website". In short: DNS for sensoper.in, www and shop → the VPS;
`deploy/nginx-sensoper-website.conf` into nginx; certbot for https; `deploy/deploy-website.sh` copies the files.
