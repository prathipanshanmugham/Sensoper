# Sensoper Controls & Renewables - Solar Project Cost Estimator

## Original Problem Statement
Build a production-ready web app for Sensoper Controls & Renewables — a Solar Project Cost Estimator for field staff, managers, and admins to collect site data, estimate costs, and generate professional PDF quotations.

## Architecture & Tech Stack
- **Frontend**: React.js + Tailwind CSS + Shadcn UI (Light Theme)
- **Backend**: FastAPI (Python) + MongoDB
- **Auth**: JWT with role-based access (Admin, Manager, Staff)
- **PDF**: jsPDF + jspdf-autotable (light theme, no margin, no signature)
- **Storage**: Emergent Object Storage for images
- **AI**: OpenAI GPT-5.2 via Emergent LLM Key

## User Personas
1. **Admin** — Full access: users, inventory, terms, audit, company profile, margin control
2. **Manager** — Projects review, approve/reject, inventory, terms, margin control
3. **Staff** — Create site visits, view own projects, request deletions. NO margin visibility.

## Implemented Features (All Complete)

### Core
- [x] JWT auth + brute force protection
- [x] Multi-step site visit form (Customer, Location/What3Words, Electrical, Materials & Cost)
- [x] Inventory-based cost estimation (dropdown item selection + manual costs)
- [x] Project workflow (Draft > Submitted > Approved/Rejected > Completed)
- [x] Dashboard with stats, alerts, and recent projects
- [x] User management (Admin)
- [x] AI solar recommendations

### Enterprise
- [x] Terms & Conditions with version control + HTML editor
- [x] Inventory Management — dynamic categories, warehouse hierarchy (Zone/Aisle/Shelf/Rack/Bin), image upload
- [x] Deletion approval workflow with manager approval
- [x] Audit logging system
- [x] Company Profile Management (Basic Info, Branding, Bank Details)

### Margin Control (NEW)
- [x] Role-based: visible only to Manager/Admin, hidden from Staff
- [x] Manager/Admin can set margin % per project
- [x] Auto-recalculates total cost
- [x] Margin NEVER appears in customer PDF

### PDF & Branding
- [x] Multi-page PDF with jspdf-autotable
- [x] Light/white theme only (no dark backgrounds)
- [x] Sensoper logo only — no signature, no seal
- [x] Dynamic company branding, bank details
- [x] Grid borders, right-aligned currency
- [x] No margin displayed to customer

### UI/UX (NEW)
- [x] Light theme across entire app (login, register, sidebar, dashboard)
- [x] Roof type as free text input (not dropdown)
- [x] What3Words simple text input for site location
- [x] Mobile responsive: card layouts, h-11 touch inputs, sticky navigation
- [x] "Made with Emergent" badge hidden
- [x] Image upload for inventory items via object storage

### Database (MongoDB)
Collections: users, projects, terms_conditions, inventory_items, inventory_categories, inventory_transactions, deletion_requests, audit_logs, company_profiles

### Key API Endpoints
- Auth: POST /api/auth/login, /api/auth/register
- Projects: CRUD /api/projects, PUT /api/projects/{id}/margin
- Inventory: CRUD /api/inventory/items, /api/inventory/categories
- Upload: POST /api/upload/image, GET /api/files/{path}
- Company: CRUD /api/company, GET /api/company/active
- Others: /api/terms, /api/users, /api/audit-logs, /api/deletion-requests, /api/dashboard/stats

## Test Credentials
- Admin: admin@sensoper.com / Admin@123

## Backlog

### P1 — Pending (User Action Required)
- [ ] Google Maps integration (requires user API key)
- [ ] Google Drive for image uploads (requires user OAuth)

### P2 — Future
- [ ] Auto inventory deduction on project approval
- [ ] Offline PWA mode for field staff
- [ ] WhatsApp Business API for quote sharing
- [ ] Email delivery of PDF quotes
- [ ] Advanced analytics dashboard
- [ ] Export data to Excel
