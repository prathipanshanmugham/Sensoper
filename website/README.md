# Sensoper public website — sensoper.in and shop.sensoper.in

Plain HTML, CSS and JavaScript — no framework, no build step — so it loads in about a second on a slow 4G phone
(about 75 KB in total for the home page). Everything a visitor sends goes to the Sensoper ERP through two parts of
the API that nginx passes on from these domains: `/api/public/*` (leads, shop, pop-ups) and `/api/client/*`
(customer logins). Staff manage it all in the ERP under **Sales & projects → Website**.

| Page | File | What it does |
|---|---|---|
| sensoper.in | `index.html`, `assets/home.js` | Live sun over Perundurai (drag it through the day), savings calculator for homes, farm pumps and businesses, solutions, PM Surya Ghar subsidy with a countdown, steps, FAQ, contact. Every "quote" button opens the lead form. |
| shop.sensoper.in | `shop/index.html`, `assets/shop.js` | Products staff put live in the ERP, with search, categories, a cart and an order request (no payment online — staff confirm by phone). |
| sensoper.in/account | `account/index.html`, `assets/account.js` | Customer login made by staff: savings, units, CO₂, payments, project steps, service requests and offers. |
| all pages | `assets/core.js`, `assets/site.css` | Links, WhatsApp button, live company details, the lead form, pop-up notifications. |

Footer on every page: **ERP login** → https://quote.sensoper.in/login (staff, partners, investors).

## Change the words or numbers
- Text is in the HTML files. Prices and the WhatsApp number come from the ERP (Website → Pop-ups & settings, Price list → Package slabs).
- The calculator's tariff slabs, 4.4 units/kW/day and the PM Surya Ghar amounts are at the top of the calculator
  section in `assets/home.js`. The subsidy phase end date is `PSG_END` in the same file.
- Brand names in the "Brands we install and stock" strip are in `index.html` (twice, for the endless scroll).

## Preview on a computer
    cd backend && …start the backend on :8001…
    cd website && node dev-server.mjs        # http://localhost:5100 — /shop/ is the shop, /account/ the login
On localhost the links to the shop, account and ERP point at the local copies automatically.

## Put it live
See `DEPLOY.md` → "This release: the customer website". In short: DNS for sensoper.in, www and shop → the VPS;
`deploy/nginx-sensoper-website.conf` into nginx; certbot for https; `deploy/deploy-website.sh` copies the files.
