/**
 * One map of the whole app: menu sections and the plain-language help shown by the "Help" button on every screen.
 *
 *  module  — the page's key in Settings → Permissions (backend/access_policy.py); the item shows when the
 *            role may "view" it (admins see everything)
 *  action  — an extra action the item needs (New project needs "create")
 *  badge   — key in /dashboard/stats used for the red count bubble
 *  help    — { what, steps[], tip }  shown in the Help panel
 */
import {
  Home, CalendarCheck, NotebookPen, Activity, ClipboardList, FolderPlus, FolderKanban, ClipboardCheck, ShoppingCart,
  ShoppingBag, RefreshCw, Package, Boxes, PackageOpen, Truck, Undo2, Store, Tags, HardHat, Users, Wrench,
  CreditCard, AlertTriangle, BarChart3, MapPin, Building2, UserCog, Shield, Map, SlidersHorizontal, ScrollText,
  Layers, History, KeyRound, LockKeyhole, FileText, UserRound, Clock, Network, Gift, Landmark,
} from 'lucide-react';

export const NAV_SECTIONS = [
  {
    id: 'home', label: 'Home', items: [
      {
        href: '/dashboard', label: 'Home', icon: Home, module: 'module_dashboard',
        help: {
          what: 'Your starting point: what needs doing today, quick buttons for common jobs, and how the business is doing.',
          steps: ['Use the big buttons at the top for everyday jobs (new project, daily report, site diary).',
            'Check "Needs attention" for approvals, low stock and missing reports.',
            'Admins and managers: open the "Business health" tab for revenue, profit, cash and the Company Health Score.'],
          tip: 'Tap any number or card to jump to the page behind it.',
        },
      },
    ],
  },
  {
    id: 'daily', label: 'Daily work', items: [
      {
        href: '/dashboard/attendance', label: 'Attendance', icon: Clock, module: 'module_attendance',
        keywords: 'check in check out punch time gps present absent register',
        help: {
          what: 'Check in when you start work and check out when you finish. The time and your phone’s location are saved.',
          steps: ['Tap "Check in" when you reach work or the site — allow location when the phone asks.',
            'Tap "Check out" when you leave. Your hours for the day appear straight away.',
            'Managers: the Team tab shows who is in today; the Monthly register downloads to Excel.'],
          tip: 'Forgot to check out? A manager can correct the time with the pencil button — the change is logged.',
        },
      },
      {
        href: '/dashboard/daily-report', label: 'Daily report', icon: CalendarCheck, module: 'module_daily_updates',
        keywords: 'end of day update eod',
        help: {
          what: 'One short report per person per day: the sites you worked on, leads, payments collected, service visits, problems and tomorrow’s plan.',
          steps: ['Fill only the sections that apply to your day — empty sections are skipped.',
            'Press "Save draft" any time; press "Submit report" before you leave for the day.',
            'Managers: the "Team" tab shows who has submitted, who is still in draft and who is missing.',
            'Use "Download PDF" for one day or a date range.'],
          tip: 'Payments and leads you enter here flow into Accounts and the Marketing report automatically.',
        },
      },
      {
        href: '/dashboard/site-diary', label: 'Site diary', icon: NotebookPen, module: 'module_site_diary',
        keywords: 'installation log progress crew',
        help: {
          what: 'A day-by-day log for each project site: who was on site, which stages were finished, progress %, materials used, safety, photos and next steps.',
          steps: ['Pick the project and the date.', 'Tick the stages finished today and set the progress %.',
            'Add the crew, materials used and any problems. Add photos if you have them.',
            'Save. Yesterday’s "next steps" appear at the top so the next team knows where to start.'],
          tip: '"Download diary PDF" gives the customer or DISCOM a complete installation record.',
        },
      },
      {
        href: '/dashboard/readings', label: 'Readings', icon: Activity, module: 'module_readings',
        keywords: 'generation meter',
        help: {
          what: 'Tracks finished sites during their reading period — expected vs actual generation.',
          steps: ['Add a site when it enters the reading phase.', 'Log generation readings with the lightning button on each row.',
            'Compare actual units with the estimate to catch under-performing systems early.'],
        },
      },
      {
        href: '/dashboard/audits', label: 'Weekly audits', icon: ClipboardList, module: 'module_audits',
        help: {
          what: 'A weekly checklist audit of operations, with issues, owners and deadlines.',
          steps: ['Start this week’s audit and go through the checklist.', 'Log each issue with an owner and a deadline.',
            'Close issues as they are fixed; export the audit as PDF from Reports.'],
        },
      },
    ],
  },
  {
    id: 'sales', label: 'Sales & projects', items: [
      {
        href: '/dashboard/projects/new', label: 'New project', icon: FolderPlus, module: 'module_projects', action: 'create',
        keywords: 'site visit quotation estimate photos gps location coordinates',
        help: {
          what: 'Record a site visit and build the quotation for a new customer, step by step.',
          steps: ['Customer: name, phone and address.', 'Location: at the site, tap "Use my location" — the GPS coordinates fill in by themselves.',
            'Site & electrical: roof, load, monthly units and tariff.',
            'Proposed solution: system type and size, then choose panels, inverter and other materials.',
            'Site photos: work down the checklist — each photo is copied to Google Drive automatically.'],
          tip: 'The form saves a draft as you go. Missing photos can be added later from the project page.',
        },
      },
      {
        href: '/dashboard/projects', label: 'Projects', icon: FolderKanban, module: 'module_projects',
        keywords: 'all projects customers quotation',
        help: {
          what: 'Every project and quotation, with its status from draft to completed.',
          steps: ['Search by customer name or phone, or filter by status.', 'Open a project to see costs, download the quotation PDF, generate the GST invoice or mark it complete.'],
          tip: 'Status flow: Draft → Submitted → Approved → Completed.',
        },
      },
      {
        href: '/dashboard/approvals', label: 'Approvals', icon: ClipboardCheck, module: 'module_approvals', badge: 'pending_approvals',
        help: {
          what: 'Everything waiting for a manager’s decision: project reviews, deletions, stock reversals and purchase orders.',
          steps: ['Open a request to see what changes.', 'Approve or reject it; the person who asked is updated straight away.'],
        },
      },
      {
        href: '/dashboard/customer-offers', label: 'Customer offers', icon: Gift, module: 'module_customer_offers',
        keywords: 'customer dashboard portal offers promotion amc battery referral interested',
        help: {
          what: 'Offers shown on customers’ own dashboards, and the customers who tapped “I’m interested”.',
          steps: ['Create an offer — AMC plan, battery add-on, cleaning, referral bonus.', 'Choose which customers see it, or leave it for everyone.',
            'Call back the people listed under “To call back” and tap “Called”.'],
          tip: 'Share a customer’s dashboard from their project page → Customer dashboard → Send on WhatsApp.',
        },
      },
      {
        href: '/dashboard/sales', label: 'Direct sales', icon: ShoppingCart, module: 'module_direct_sales',
        keywords: 'counter sale b2b invoice',
        help: {
          what: 'Counter, B2B and walk-in sales of materials, with GST invoices. Stock is reduced automatically.',
          steps: ['Add the customer and the items sold.', 'Save the sale and download the invoice.', 'Cancel a sale to return the stock.'],
        },
      },
      {
        href: '/dashboard/ecommerce', label: 'Online orders', icon: ShoppingBag, module: 'module_ecommerce',
        keywords: 'ecommerce amazon flipkart marketplace',
        help: {
          what: 'Products listed on Amazon, Flipkart and other marketplaces, and the orders they bring in.',
          steps: ['Products: link an inventory item to a platform and set its price and commission.', 'Orders: record or import orders; stock goes down automatically and comes back on returns.'],
        },
      },
      {
        href: '/dashboard/amc', label: 'AMC & service', icon: RefreshCw, module: 'module_amc',
        keywords: 'maintenance contract support ticket complaint',
        help: {
          what: 'Annual maintenance contracts and customer support tickets for installed systems.',
          steps: ['Contracts: create an AMC for a completed project and track visits and renewals.', 'Support tickets: log a customer complaint, assign a technician and close it with the customer’s rating.'],
          tip: 'Tickets show red when they are past their response or fix deadline.',
        },
      },
    ],
  },
  {
    id: 'stock', label: 'Stock & purchase', items: [
      {
        href: '/dashboard/inventory', label: 'Inventory', icon: Package, module: 'module_inventory', badge: 'low_stock_alerts',
        keywords: 'stock items materials sku',
        help: {
          what: 'All materials in stock: quantity, price, GST, location and reorder level.',
          steps: ['Add items one by one or import an Excel file.', 'Items below their reorder level are flagged as low stock.', 'Use the location fields (zone, rack, bin) so anyone can find an item.'],
        },
      },
      {
        href: '/dashboard/inventory/kits', label: 'Solution kits', icon: Boxes, module: 'module_kits',
        keywords: 'bundle package material kit',
        help: {
          what: 'Ready-made material bundles (for example a 3 kW on-grid kit) that fill a project’s material list in one tap.',
          steps: ['Create a kit and add its items and quantities.', 'Pick the kit while creating a project to load all its materials.'],
        },
      },
      {
        href: '/dashboard/purchase-inbound', label: 'Purchases', icon: PackageOpen, module: 'module_purchase_inbound',
        keywords: 'purchase order po inbound grn',
        help: {
          what: 'Purchase orders from order to arrival: create PO → approve → receive → quality check → into stock.',
          steps: ['Create a purchase order for a vendor.', 'When goods arrive, record the received quantity and QC result.', 'Accepted items are added to inventory automatically.'],
        },
      },
      {
        href: '/dashboard/delivery-outbound', label: 'Deliveries', icon: Truck, module: 'module_delivery_outbound',
        keywords: 'dispatch outbound',
        help: {
          what: 'Material dispatched from the store to a project or customer.',
          steps: ['Create a delivery for a project and pick the items.', 'Mark it delivered when it reaches site; stock is reduced.'],
        },
      },
      {
        href: '/dashboard/returns', label: 'Brand returns', icon: Undo2, module: 'module_returns',
        keywords: 'damaged defective return warranty',
        help: {
          what: 'Damaged, unused or defective material being returned to the brand or supplier.',
          steps: ['Log the item, quantity and reason.', 'Mark it complete when the supplier credits or replaces it.'],
        },
      },
      {
        href: '/dashboard/vendors', label: 'Vendors', icon: Store, module: 'module_vendors',
        keywords: 'supplier',
        help: {
          what: 'Your suppliers with GSTIN, contacts, payment terms and purchase history.',
          steps: ['Add a vendor once; pick it when you create purchase orders.', 'Open "PO history" to see everything bought from them.'],
        },
      },
      {
        href: '/dashboard/pricelist', label: 'Price list', icon: Tags, module: 'module_pricelist',
        keywords: 'pricelist margin selling price slab package rate service rates installation structure cabling benchmark subsidy',
        help: {
          what: 'Every rate quotes use: product prices, package slab rates and service rates. Changes save instantly and update the calculator and PDFs.',
          steps: ['Products: edit a margin % or price right in the table.', 'Package slabs and Service rates: change a rate and save the row.', 'Use "Price List PDF" to share prices with dealers or customers.'],
        },
      },
    ],
  },
  {
    id: 'people', label: 'People & field', items: [
      {
        href: '/dashboard/org-structure', label: 'Organisation', icon: Network, module: 'module_org',
        keywords: 'org chart structure hierarchy branch location managers staff team',
        help: {
          what: 'Who works where: every location with its managers, staff and field teams, and who has checked in today. Admins only.',
          steps: ['Use "Find a person" to jump to someone.', 'People without a location are listed at the bottom — assign them under Users.'],
          tip: 'Add branches under Settings → Locations.',
        },
      },
      {
        href: '/dashboard/partners', label: 'Subcontractors', icon: HardHat, module: 'module_partners',
        keywords: 'partners labour crew rate card retention',
        help: {
          what: 'Installation crews and subcontractors: rate cards, project assignments, retention and payments.',
          steps: ['Add a partner with their rate card.', 'Assign them to a project; the cost is worked out from the rate card.',
            'Retention is released after DISCOM commissioning; record payments as you make them.'],
        },
      },
      {
        href: '/dashboard/teams', label: 'Internal teams', icon: Users, module: 'module_teams',
        help: {
          what: 'Your own staff grouped into teams (Alpha, Beta…) that can be assigned to projects.',
          steps: ['Create a team and add members.', 'Assign teams on a project page to track how each team performs.'],
        },
      },
      {
        href: '/dashboard/assets', label: 'Assets & tools', icon: Wrench, module: 'module_assets',
        keywords: 'vehicle equipment safety gear',
        help: {
          what: 'Company vehicles, tools, test equipment and safety gear: who has what, condition and service dates.',
          steps: ['Add each asset with its category and location.', 'Assign it to a person or project and record returns.', 'Upload bills and warranty cards to keep everything in one place.'],
        },
      },
    ],
  },
  {
    id: 'money', label: 'Money & insights', items: [
      {
        href: '/dashboard/credits', label: 'Accounts', icon: CreditCard, module: 'module_credits',
        keywords: 'credits receivables payments expenses',
        help: {
          what: 'Money owed to you, payments received and business expenses.',
          steps: ['Add a customer credit when an invoice is not fully paid.', 'Record payments against it as they come in.', 'Log expenses so the profit reports are accurate.'],
        },
      },
      {
        href: '/dashboard/alerts', label: 'Profit alerts', icon: AlertTriangle, module: 'module_alerts',
        keywords: 'leakage risk margin',
        help: {
          what: 'Projects that are losing money: low margins, material over-use, late payments or projects running too long.',
          steps: ['Start with "High" risk projects.', 'Open a project to see exactly which alert fired and by how much.', 'Change the alert limits with the Thresholds button at the top of this page.'],
        },
      },
      {
        href: '/dashboard/reports', label: 'Reports', icon: BarChart3, module: 'module_reports',
        keywords: 'export excel pdf analysis',
        help: {
          what: 'Ready-made reports on sales, profit, stock, service, staff and more, downloadable as PDF or Excel.',
          steps: ['Pick a report card.', 'Set the date range and location.', 'Download as PDF or Excel.'],
        },
      },
      {
        href: '/dashboard/investors', label: 'Investors', icon: Landmark, module: 'module_investors',
        keywords: 'investor investors capital payout share dashboard charts business',
        help: {
          what: 'Charts of the whole business, and the investors’ own logins: what each one sees, the money they put in and the payouts made.',
          steps: ['Business tab: pick a period to see revenue, capacity, pipeline, branches, cash and service income.',
            'Investors tab: add an investor with a temporary password and tick what they may see.',
            'Record money in and payouts on their card; use “Preview” to see exactly what they see.'],
          tip: 'Investors sign in on the normal sign-in page. They see totals only — never customer names or phone numbers.',
        },
      },
      {
        href: '/dashboard/expansion', label: 'Expansion', icon: MapPin, module: 'module_expansion', badge: 'location_review_count',
        keywords: 'branch district market',
        help: {
          what: 'Which district to open the next branch in, ranked by demand, competition and distance from your crews.',
          steps: ['Read the ranked list from the top.', 'Open a district to see why it scored the way it did.'],
        },
      },
    ],
  },
  {
    id: 'settings', label: 'Settings', items: [
      {
        href: '/dashboard/company-profile', label: 'Company profile', icon: Building2, module: 'module_company',
        help: {
          what: 'Your company name, logo, address, GSTIN, bank details and invoice numbering — used on every PDF.',
          steps: ['Fill in every field once and save.', 'Upload a clear logo; it appears on quotations and invoices.'],
        },
      },
      {
        href: '/dashboard/users', label: 'Users', icon: UserCog, module: 'module_users',
        keywords: 'staff accounts employees',
        help: {
          what: 'Everyone who can sign in: add people, set their role (admin, manager, staff) and branch.',
          steps: ['Add a user with name, email, a temporary password and role.', 'Assign locations to limit what they see.', 'Use "Log performance" to record monthly scores.'],
          tip: 'Staff see a short menu with only their daily screens.',
        },
      },
      {
        href: '/dashboard/permissions', label: 'Permissions', icon: Shield, module: 'module_permissions',
        help: {
          what: 'Fine control over what each role can view, create, edit, delete and export.',
          steps: ['Choose a role.', 'Switch modules and actions on or off, then save.'],
        },
      },
      {
        href: '/dashboard/locations', label: 'Locations', icon: Map, module: 'module_locations',
        keywords: 'branch warehouse',
        help: {
          what: 'Branches and warehouses. Users assigned to a location only see that location’s data.',
          steps: ['Add each branch or store.', 'Assign users to it under Users.'],
        },
      },
      {
        href: '/dashboard/pricing-config', label: 'Settings', icon: SlidersHorizontal, module: 'module_settings',
        keywords: 'config pricing rounding cash round off interest target google drive connect',
        help: {
          what: 'A few company-wide basics: how totals are rounded, overdue interest, the monthly sales target, and the Google Drive connection.',
          steps: ['Tap a value, change it and press the tick.', 'Connect Google Drive once so site photos are copied there automatically.'],
          tip: 'Product prices, package slabs and service rates are in Price list.',
        },
      },
      {
        href: '/dashboard/terms', label: 'Terms & conditions', icon: ScrollText, module: 'module_terms',
        help: {
          what: 'The terms printed on quotations, invoices and AMC documents, with version history.',
          steps: ['Edit a template and save — a new version is kept.', 'Mark one template active per document type.'],
        },
      },
      {
        href: '/dashboard/form-tabs', label: 'Form builder', icon: Layers, module: 'module_form_builder',
        help: {
          what: 'Add your own tabs and fields to the New project form (for example "Finance details").',
          steps: ['Create a tab, add fields and choose which are required.', 'Choose which roles can see the tab.'],
        },
      },
      {
        href: '/dashboard/audit-logs', label: 'Activity log', icon: History, module: 'module_audit_logs',
        keywords: 'audit logs history changes',
        help: {
          what: 'Who changed what and when, across the whole app.',
          steps: ['Filter by person, action or date.', 'Export or archive old logs every quarter.'],
        },
      },
      {
        href: '/dashboard/vault', label: 'Company logins', icon: KeyRound, module: 'module_vault',
        keywords: 'vault passwords credentials account security',
        help: {
          what: 'A safe for the company’s logins to outside services (Google Workspace, hosting, domain, software).',
          steps: ['Add each service with its login and 2FA status.', 'Passwords are hidden until you press reveal; every reveal is logged.', 'You’re reminded when a password is due for change.'],
        },
      },
      {
        href: '/dashboard/security', label: 'My login & 2FA', icon: LockKeyhole, module: 'module_security',
        keywords: 'password two factor',
        help: {
          what: 'Change your password and turn on two-step sign-in for your own account.',
          steps: ['Change your password if asked to, or every few months.', 'Turn on two-factor sign-in with an authenticator app for extra safety.'],
        },
      },
    ],
  },
];

// Screens that aren't in the menu but still get a title and help.
const EXTRA_ROUTES = [
  {
    match: /^\/dashboard\/projects\/[^/]+\/edit$/, label: 'Edit project', icon: FileText, section: 'Sales & projects',
    help: { what: 'Change a project’s details, materials or costs.', steps: ['Move through the steps and update what changed.', 'Save to keep a draft or submit it for approval.'] },
  },
  {
    match: /^\/dashboard\/projects\/[^/]+$/, label: 'Project', icon: FileText, section: 'Sales & projects',
    help: {
      what: 'Everything about one project: customer, site, materials, cost, documents and progress.',
      steps: ['Use "Documents" to download the quotation PDF, kit quotation, Excel or share on WhatsApp.',
        'Generate the GST invoice once the project is approved.', 'The site diary section shows day-by-day installation progress.',
        'Mark it completed when the installation is handed over.'],
    },
  },
  {
    match: /^\/dashboard\/partners\/[^/]+$/, label: 'Subcontractor', icon: UserRound, section: 'People & field',
    help: { what: 'One partner’s rate card, assignments, retention and payments.', steps: ['Assign them to a project.', 'Record payments and release retention after commissioning.'] },
  },
];

export const ALL_ITEMS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label, sectionId: s.id })));

/** Is this menu item visible? Settings → Permissions decides (admins see everything). */
export function canSee(item, role, perms) {
  if (role === 'admin') return true;
  if (!perms) return false;
  if (!item.module) return true;
  const m = perms[item.module];
  return !!(m && typeof m === 'object' && m.view && (!item.action || m[item.action]));
}

/** Title, section and help for the current path (most specific match wins). */
export function routeInfo(pathname) {
  const exact = ALL_ITEMS.find((i) => i.href === pathname);
  if (exact) return exact;
  for (const r of EXTRA_ROUTES) if (r.match.test(pathname)) return r;
  const prefix = ALL_ITEMS.filter((i) => i.href !== '/dashboard' && pathname.startsWith(i.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return prefix || ALL_ITEMS[0];
}

/** The single menu item that should be highlighted for a path (fixes double highlights). */
export function activeHref(pathname, visibleItems) {
  if (pathname === '/dashboard') return '/dashboard';
  const hit = visibleItems.filter((i) => i.href !== '/dashboard' && (pathname === i.href || pathname.startsWith(i.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!hit) return null;
  // /dashboard/projects/new is its own item; /dashboard/projects/<id> belongs to Projects
  return hit.href;
}
