# Sensoper Controls & Renewables - Solar Project Cost Estimator

## Original Problem Statement
Build a production-ready Solar Project Cost Estimator web application for "Sensoper Controls and Renewables" with role-based auth (Admin, Manager, Staff), multi-step site visit data collection, dynamic cost estimation engine, project tracking dashboard, and professional PDF quotation generation.

## Tech Stack
- Frontend: React, Tailwind CSS, Shadcn UI, jsPDF, jspdf-autotable
- Backend: FastAPI, MongoDB, JWT Authentication
- Storage: Emergent Object Storage, Google Drive (site images)
- AI: Emergent LLM Key for recommendations

## User Personas
- **Admin**: Full access, manage users, company branding, inventory, terms, margins, approvals
- **Manager**: Project review, margin control, approvals, completion
- **Staff**: Create projects, site visits, request deletions

## Core Features

### Implemented (Complete)
- [x] Role-based JWT Authentication (Admin, Manager, Staff)
- [x] Multi-step Site Visit Form (5 steps: Customer, Location, Electrical, Materials, Site Images)
- [x] Dynamic Cost Estimation Engine with per-item margins
- [x] Professional PDF Quotation with Sensoper logo
- [x] Project Tracking Dashboard with status workflow (draft -> submitted -> approved/rejected -> completed)
- [x] Company Branding (logo, colors, bank details)
- [x] Terms & Conditions Management
- [x] Inventory Management with categories and image uploads
- [x] Per-product margin control (Admin/Manager only, never shown in PDF)
- [x] Type of Service field in Electrical details (Single Phase, Three Phase, HT Service)
- [x] Add Category on-the-fly from Materials step
- [x] Mandatory completion photos/videos when marking project as Completed
- [x] PDF includes uploaded Sensoper logo in header
- [x] Google Drive OAuth integration for site image uploads
- [x] Audit Logs
- [x] Deletion Approvals workflow
- [x] Mobile Responsive design
- [x] AI-powered system recommendations

### P1 - Upcoming
- [ ] Google Maps API integration for site location capture
- [ ] Project-level notes/comments for manager review feedback

### P2 - Future/Backlog
- [ ] Auto inventory deduction on project approval
- [ ] Offline PWA mode for field staff
- [ ] WhatsApp Business API for quote sharing
- [ ] Email PDF delivery
- [ ] Advanced analytics dashboard
- [ ] Export data to Excel

## DB Schema (Key Collections)
- **projects**: customer, location, electrical (incl. service_type), solar_system, mounting, additional, selected_items (incl. per-item margin_percentage), manual_costs, cost_estimation, site_images, completion_media, status
- **inventory_items**: name, category, unit_price, gst_percentage, quantity, image_url
- **inventory_categories**: name, slug, description
- **company_profiles**: company_name, logo_url, colors, bank_details, contact info
- **terms_conditions**: title, content, is_active

## Key API Endpoints
- Auth: POST /api/auth/login, /api/auth/register, GET /api/auth/me
- Projects: CRUD + /api/projects/{id}/submit, /approve, /reject, /complete, /margin
- Inventory: /api/inventory/items, /api/inventory/categories
- Company: /api/company/active, /api/company/upload-logo
- Upload: /api/upload/image, /api/upload/media
- Drive: /api/drive/auth-url, /api/drive/callback, /api/drive/status, /api/drive/upload
