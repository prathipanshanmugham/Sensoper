# Sensoper Controls & Renewables - Solar Project Cost Estimator

## Original Problem Statement
Build a production-ready Solar Project Cost Estimator web application for "Sensoper Controls and Renewables" with role-based auth (Admin, Manager, Staff), multi-step site visit data collection, dynamic cost estimation engine, project tracking dashboard, and professional PDF quotation generation.

## Tech Stack
- Frontend: React, Tailwind CSS, Shadcn UI, jsPDF, jspdf-autotable, qrcode
- Backend: FastAPI, MongoDB, JWT Authentication
- Storage: Emergent Object Storage, Google Drive (site images)
- AI: Emergent LLM Key for recommendations

## User Personas
- **Admin**: Full access, manage users, company branding, inventory, terms, margins, approvals, edit ref/status
- **Manager**: Project review, margin control, approvals, completion, edit ref/status
- **Staff**: Create projects, site visits, request deletions

## Core Features (All Implemented)
- [x] Role-based JWT Authentication (Admin, Manager, Staff)
- [x] Multi-step Site Visit Form (5 steps: Customer, Location, Electrical, Materials, Site Images)
- [x] Dynamic Cost Estimation Engine with per-item margins
- [x] Professional PDF Quotation with Sensoper logo, QR codes
- [x] Project Tracking Dashboard with status workflow
- [x] Company Branding (logo, colors, bank details, UPI ID)
- [x] Terms & Conditions Management
- [x] Inventory Management with categories and image uploads
- [x] Per-product margin control (Admin/Manager only)
- [x] Typeable dropdowns (ComboInput) for Service Type, System Type, Complexity
- [x] Add Category on-the-fly from Materials step
- [x] Mandatory completion photos/videos + customer feedback
- [x] Editable reference number and project status (Admin/Manager)
- [x] Site images as QR code in PDF (links to gallery page)
- [x] UPI QR code in PDF bank details section
- [x] Edit projects (draft = fully editable, approved = editable with re-approval)
- [x] Google Drive OAuth integration for site image uploads
- [x] Audit Logs, Deletion Approvals, Mobile Responsive, AI recommendations

## P1 - Upcoming
- [ ] Google Maps API integration for site location capture
- [ ] Project-level notes/comments for manager review feedback

## P2 - Future/Backlog
- [ ] Auto inventory deduction on project approval
- [ ] Offline PWA mode for field staff
- [ ] WhatsApp Business API for quote sharing
- [ ] Email PDF delivery
- [ ] Advanced analytics dashboard
- [ ] Export data to Excel

## Key API Endpoints
- Auth: POST /api/auth/login, /api/auth/register, GET /api/auth/me
- Projects: CRUD + /submit, /approve, /reject, /complete, /margin, /reference, /status, /gallery
- Inventory: /api/inventory/items, /api/inventory/categories
- Company: /api/company/active, /api/company/upload-logo
- Upload: /api/upload/image, /api/upload/media
- Drive: /api/drive/auth-url, /api/drive/callback, /api/drive/status, /api/drive/upload

## DB Schema
- **projects**: customer, location, electrical (service_type), solar_system (system_type), mounting, additional (installation_complexity), selected_items (per-item margin_percentage), manual_costs, cost_estimation, site_images, completion_media, customer_feedback, reference_number, status
- **inventory_items**: name, category, unit_price, gst_percentage, quantity, image_url
- **inventory_categories**: name, slug, description
- **company_profiles**: company_name, logo_url, colors, bank_details (including upi_id), contact info
