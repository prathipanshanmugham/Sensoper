import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL;

const api = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Auth API
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (userData) => api.post('/auth/register', userData),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  refresh: () => api.post('/auth/refresh')
};

// Projects API
export const projectsAPI = {
  getAll: (status = null) => api.get('/projects', { params: status ? { status } : {} }),
  getOne: (id) => api.get(`/projects/${id}`),
  create: (data) => api.post('/projects', data),
  update: (id, data) => api.put(`/projects/${id}`, data),
  delete: (id) => api.delete(`/projects/${id}`),
  submit: (id) => api.post(`/projects/${id}/submit`),
  approve: (id) => api.post(`/projects/${id}/approve`),
  reject: (id, reason) => api.post(`/projects/${id}/reject`, { reason }),
  complete: (id, payload) => api.post(`/projects/${id}/complete`, payload),
  requestDeletion: (id, reason) => api.post(`/projects/${id}/request-deletion`, { reason }),
  forceDelete: (id) => api.delete(`/projects/${id}/force`),
  updateReference: (id, refNumber) => api.put(`/projects/${id}/reference`, { reference_number: refNumber }),
  updateStatus: (id, status) => api.put(`/projects/${id}/status`, { status }),
  updateNotes: (id, notes) => api.put(`/projects/${id}`, { notes }),
  appendNote: (id, text) => api.post(`/projects/${id}/notes`, { text }),
  getReferenceCandidates: (q) => api.get('/projects/reference-candidates', { params: q ? { q } : {} }),
  getReferenceSummary: (id) => api.get(`/projects/${id}/reference-summary`),
  backfillLocations: (payload = {}) => api.post('/projects/backfill-locations', payload),
  galleryUrl: (id) => `${API_URL}/api/projects/${id}/gallery`
};

// Users API (Admin only)
export const usersAPI = {
  getAll: () => api.get('/users'),
  create: (userData) => api.post('/users', userData),
  update: (id, userData) => api.put(`/users/${id}`, userData),
  delete: (id) => api.delete(`/users/${id}`)
};

// Pricing API removed - costs come from inventory items

// Dashboard API
export const dashboardAPI = {
  getStats: () => api.get('/dashboard/stats'),
  getCeo: (params = {}) => api.get('/dashboard/ceo', { params })
};

// Reports API
export const reportsAPI = {
  get: (type, params = {}) => api.get(`/reports/${type}`, { params })
};

// Daily Updates API
export const dailyUpdatesAPI = {
  create: (data) => api.post('/daily-updates', data),
  list: (params = {}) => api.get('/daily-updates', { params }),
  getByProject: (projectId) => api.get(`/daily-updates/project/${projectId}`),
  update: (id, data) => api.put(`/daily-updates/${id}`, data),
  delete: (id) => api.delete(`/daily-updates/${id}`)
};

// Payments API
export const paymentsAPI = {
  create: (data) => api.post('/payments', data),
  getByProject: (projectId) => api.get(`/payments/project/${projectId}`)
};

// Material Usage API
export const materialUsageAPI = {
  create: (data) => api.post('/material-usage', data),
  getByProject: (projectId) => api.get(`/material-usage/project/${projectId}`)
};

// Project Report & Completeness
export const projectReportAPI = {
  getReport: (projectId) => api.get(`/projects/${projectId}/report`),
  getCompleteness: (projectId) => api.get(`/projects/${projectId}/completeness`)
};

// Alerts & Risk
export const alertsAPI = {
  getDashboard: () => api.get('/alerts/dashboard'),
  getProjectAlerts: (projectId) => api.get(`/alerts/project/${projectId}`)
};

// Thresholds
export const thresholdsAPI = {
  get: () => api.get('/settings/thresholds'),
  update: (data) => api.put('/settings/thresholds', data)
};

// Catalogue (Iter 44 Phase 1) — product-level pricing across panels / inverters / batteries / pumps / structure / services / fuels
export const catalogueAPI = {
  list: (cat, active_only = false) => api.get(`/catalogue/products/${cat}`, { params: { active_only } }),
  create: (cat, data) => api.post(`/catalogue/products/${cat}`, data),
  update: (cat, pid, data) => api.put(`/catalogue/products/${cat}/${pid}`, data),
  delete: (cat, pid) => api.delete(`/catalogue/products/${cat}/${pid}`),
  history: (cat, pid) => api.get(`/catalogue/products/${cat}/${pid}/history`),
  importCsv: (cat, file) => { const fd = new FormData(); fd.append('file', file); return api.post(`/catalogue/products/${cat}/import`, fd, { headers: { 'Content-Type': undefined } }); },
  getConfig: () => api.get('/catalogue/config'),
  updateConfig: (data) => api.put('/catalogue/config', data),
  seed: () => api.post('/catalogue/seed'),
  addonGroups: () => api.get('/catalogue/addon-groups'),
};

// Customer Credits
export const creditsAPI = {
  create: (data) => api.post('/credits', data),
  list: (params = {}) => api.get('/credits', { params }),
  pay: (id, data) => api.post(`/credits/${id}/pay`, data),
  getPayments: (id) => api.get(`/credits/${id}/payments`),
  delete: (id) => api.delete(`/credits/${id}`)
};

// Purchase Orders
export const purchaseOrdersAPI = {
  create: (data) => api.post('/purchase-orders', data),
  list: (params = {}) => api.get('/purchase-orders', { params }),
  approve: (id) => api.put(`/purchase-orders/${id}/approve`),
  arrival: (id, data) => api.put(`/purchase-orders/${id}/arrival`, data),
  qc: (id, data) => api.put(`/purchase-orders/${id}/qc`, data),
  inbound: (id, data) => api.put(`/purchase-orders/${id}/inbound`, data),
  editInbound: (id, data) => api.put(`/purchase-orders/${id}/inbound/edit`, data),
  reverseInbound: (id) => api.delete(`/purchase-orders/${id}/inbound`),
  remove: (id) => api.delete(`/purchase-orders/${id}`)
};

// Generic action-request queue (delivery cancel / asset archive / sale cancel — location-scoped)
export const actionRequestsAPI = {
  list: (params = {}) => api.get('/action-requests', { params }),
  approve: (id) => api.post(`/action-requests/${id}/approve`),
  reject: (id) => api.post(`/action-requests/${id}/reject`)
};

// GST Tax Invoice + Profit Calculator (Iter 44 Batch A)
export const invoicingAPI = {
  getSettings: () => api.get('/invoice-settings'),
  updateSettings: (data) => api.put('/invoice-settings', data),
  getInvoice: (projectId) => api.get(`/projects/${projectId}/invoice`),
  generateInvoice: (projectId, data = {}) => api.post(`/projects/${projectId}/invoice`, data),
  getProfit: (projectId) => api.get(`/projects/${projectId}/profit`)
};

// Inbound reversal approval queue (managers without delete rights → admin)
export const inboundApprovalsAPI = {
  list: (status = null) => api.get('/inbound-action-requests', { params: status ? { status } : {} }),
  approve: (id) => api.post(`/inbound-action-requests/${id}/approve`),
  reject: (id) => api.post(`/inbound-action-requests/${id}/reject`)
};

// Deliveries
export const deliveriesAPI = {
  create: (data) => api.post('/deliveries', data),
  list: (params = {}) => api.get('/deliveries', { params }),
  complete: (id) => api.put(`/deliveries/${id}/complete`),
  edit: (id, data) => api.put(`/deliveries/${id}`, data),
  cancel: (id) => api.delete(`/deliveries/${id}`)
};

// Brand Returns
export const returnsAPI = {
  create: (data) => api.post('/returns', data),
  list: (params = {}) => api.get('/returns', { params }),
  complete: (id) => api.put(`/returns/${id}/complete`)
};

// Audits
export const auditsAPI = {
  create: (data) => api.post('/audits', data),
  list: (params = {}) => api.get('/audits', { params }),
  update: (id, data) => api.put(`/audits/${id}`, data),
  addIssue: (id, data) => api.put(`/audits/${id}/issue`, data)
};

// AI API
export const aiAPI = {
  getRecommendations: (data) => api.post('/ai/recommendations', data)
};

// Terms & Conditions API
export const termsAPI = {
  getAll: (category) => api.get('/terms', { params: category ? { category } : {} }),
  getActive: (language = 'en', category = 'quotation') => api.get('/terms/active', { params: { language, category } }),
  getById: (id) => api.get(`/terms/${id}`),
  create: (data) => api.post('/terms', data),
  update: (id, data) => api.put(`/terms/${id}`, data),
  delete: (id) => api.delete(`/terms/${id}`)
};

// Inventory API
export const inventoryAPI = {
  // Categories
  getCategories: () => api.get('/inventory/categories'),
  createCategory: (data) => api.post('/inventory/categories', data),
  deleteCategory: (id) => api.delete(`/inventory/categories/${id}`),
  
  // Items
  getItems: (params = {}) => api.get('/inventory/items', { params }),
  getItem: (id) => api.get(`/inventory/items/${id}`),
  createItem: (data) => api.post('/inventory/items', data),
  updateItem: (id, data) => api.put(`/inventory/items/${id}`, data),
  deleteItem: (id) => api.delete(`/inventory/items/${id}`),
  
  // Alerts
  getAlerts: () => api.get('/inventory/alerts'),

  // Import / Export
  downloadTemplate: () => api.get('/inventory/template', { responseType: 'blob' }),
  importItems: (file, options = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    if (options.dryRun) fd.append('dry_run', 'true');
    if (options.columnMap) fd.append('column_map', JSON.stringify(options.columnMap));
    return api.post('/inventory/import', fd, { headers: { 'Content-Type': undefined } });
  },
  previewImport: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/inventory/import/preview', fd, { headers: { 'Content-Type': undefined } });
  },
  exportItems: (format = 'xlsx') => api.get('/inventory/export', { params: { format }, responseType: 'blob' })
};

// Material Kits API (Solution Kits)
export const materialKitsAPI = {
  getAll: (params = {}) => api.get('/material-kits', { params }),
  getOne: (id) => api.get(`/material-kits/${id}`),
  match: (system_type, capacity_kw) => api.get('/material-kits/match', { params: { system_type, capacity_kw } }),
  create: (data) => api.post('/material-kits', data),
  update: (id, data) => api.put(`/material-kits/${id}`, data),
  remove: (id) => api.delete(`/material-kits/${id}`),
  seedStarter: () => api.post('/material-kits/seed-starter')
};

// Solar Calculator API (server-side calculation engine + PIN/DISCOM lookup)
export const calcAPI = {
  lookupPincode: (pin) => api.get(`/calculate/lookup/${pin}`),
  solution: (payload) => api.post('/calculate/solution', payload),
  billSavings: (payload) => api.post('/calculate/bill-savings', payload),
  getConfig: () => api.get('/calculate/config'),
  updateConfig: (payload) => api.put('/calculate/config', payload),
  listDiscoms: (params = {}) => api.get('/calculate/discoms', { params }),
  getDiscom: (id) => api.get(`/calculate/discoms/${id}`),
  listPincodes: (params = {}) => api.get('/calculate/pincodes', { params }),
  seedDefaults: () => api.post('/calculate/seed-defaults'),
  validatePumpStringVoltage: (payload) => api.post('/calculate/pump/string-voltage', payload)
};

// Direct Sales API (Iter 39 Change 1)
export const salesAPI = {
  list: (params = {}) => api.get('/sales', { params }),
  get: (id) => api.get(`/sales/${id}`),
  create: (data) => api.post('/sales', data),
  update: (id, data) => api.put(`/sales/${id}`, data),
  edit: (id, data) => api.put(`/sales/${id}/edit`, data),
  remove: (id) => api.delete(`/sales/${id}`),
  addPayment: (id, data) => api.post(`/sales/${id}/payment`, data),
  return: (id, data) => api.post(`/sales/${id}/return`, data),
  invoice: (id) => api.get(`/sales/${id}/invoice`),
  summary: (params = {}) => api.get('/sales/summary', { params })
};

// Subsidy tracking + analytics (Iter 39 Change 2c)
export const subsidyAPI = {
  get: (project_id) => api.get(`/subsidy/tracking/${project_id}`),
  upsert: (data) => api.post('/subsidy/tracking', data),
  analytics: () => api.get('/subsidy/analytics')
};

// Marketing + CAC (Iter 39 Change 3)
export const marketingAPI = {
  summary: (params = {}) => api.get('/accounts/marketing-summary', { params }),
  cac: (params = {}) => api.get('/reports/cac', { params })
};
export const healthAPI = {
  getConfig: () => api.get('/dashboard/health/config'),
  updateConfig: (payload) => api.put('/dashboard/health/config', payload),
  snapshot: () => api.post('/dashboard/health/snapshot'),
  getHistory: (months = 12) => api.get('/dashboard/health/history', { params: { months } })
};

// Expansion Module API
export const expansionAPI = {
  overview: (params = {}) => api.get('/expansion/overview', { params }),
  district: (name) => api.get(`/expansion/district/${name}`),
  simulate: (payload) => api.post('/expansion/simulate', payload),
  getConfig: () => api.get('/expansion/config'),
  updateConfig: (payload) => api.put('/expansion/config', payload),
  listBranches: () => api.get('/expansion/branches'),
  createBranch: (payload) => api.post('/expansion/branches', payload),
  updateBranch: (id, payload) => api.put(`/expansion/branches/${id}`, payload),
  deleteBranch: (id) => api.delete(`/expansion/branches/${id}`)
};

// File Upload API
export const uploadAPI = {
  uploadImage: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload/image', formData, { headers: { 'Content-Type': undefined } });
  },
  uploadMedia: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload/media', formData, { headers: { 'Content-Type': undefined }, timeout: 120000 });
  },
  getFileUrl: (path) => `${API_URL}/api/files/${path}`
};

// Margin API
export const marginAPI = {
  update: (projectId, itemMargins) => api.put(`/projects/${projectId}/margin`, { item_margins: itemMargins })
};

// Deletion Requests API
export const deletionRequestsAPI = {
  getAll: (status = null) => api.get('/deletion-requests', { params: status ? { status } : {} }),
  approve: (id) => api.post(`/deletion-requests/${id}/approve`),
  reject: (id) => api.post(`/deletion-requests/${id}/reject`)
};

// Audit Logs API
export const auditLogsAPI = {
  getAll: (params = {}) => api.get('/audit-logs', { params })
};

// Company Profile API
export const companyAPI = {
  getAll: () => api.get('/company'),
  getActive: () => api.get('/company/active'),
  create: (data) => api.post('/company', data),
  update: (id, data) => api.put(`/company/${id}`, data),
  delete: (id) => api.delete(`/company/${id}`),
  uploadLogo: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/company/upload-logo', formData, {
      headers: { 'Content-Type': undefined }
    });
  }
};

// Approvals API
export const approvalsAPI = {
  getAll: (params = {}) => api.get('/approvals', { params }),
  getPendingCount: () => api.get('/approvals/pending-count'),
  create: (data) => api.post('/approvals', data),
  approve: (id) => api.put(`/approvals/${id}/approve`),
  reject: (id, reason) => api.put(`/approvals/${id}/reject`, { reason })
};

// Permissions API
export const permissionsAPI = {
  getAll: () => api.get('/permissions'),
  getRole: (role) => api.get(`/permissions/${role}`),
  updateRole: (role, permissions) => api.put(`/permissions/${role}`, { permissions })
};

// Form Tabs API (Dynamic Form Engine)
export const formTabsAPI = {
  getAll: () => api.get('/form-tabs'),
  create: (data) => api.post('/form-tabs', data),
  update: (id, data) => api.put(`/form-tabs/${id}`, data),
  delete: (id) => api.delete(`/form-tabs/${id}`),
  reorder: (order) => api.put('/form-tabs/reorder', { order })
};

// Accounts API (Cash on Hand, Meter Readings, Account Balance) — used by Credits page sub-tab + CEO Dashboard
export const accountsAPI = {
  list: (params = {}) => api.get('/accounts', { params }),
  create: (data) => api.post('/accounts', data),
  update: (id, data) => api.put(`/accounts/${id}`, data),
  delete: (id) => api.delete(`/accounts/${id}`),
  summary: () => api.get('/accounts/summary')
};

// Readings API (Site reading-phase tracker)
export const readingsAPI = {
  list: (params = {}) => api.get('/readings', { params }),
  summary: () => api.get('/readings/summary'),
  create: (data) => api.post('/readings', data),
  update: (id, data) => api.put(`/readings/${id}`, data),
  delete: (id) => api.delete(`/readings/${id}`),
  logGeneration: (id, data) => api.post(`/readings/${id}/generation`, data)
};

// Solar Report API (TNEB fetch + sizing calc + PDF merge)
export const solarReportAPI = {
  fetchTneb: (service_number, phone) => api.post('/tneb/fetch', { service_number, phone }),
  irradiation: (lat, lng) => api.get('/solar/irradiation', { params: { lat, lng } }),
  sizing: (data) => api.post('/solar/sizing', data),
  mergePdf: (generatedBlob, uploadedFile, position = 'prepend') => {
    const fd = new FormData();
    fd.append('generated_pdf', generatedBlob, 'sensoper_report.pdf');
    fd.append('uploaded_pdf', uploadedFile);
    fd.append('position', position);
    return api.post('/solar/merge-pdf', fd, {
      headers: { 'Content-Type': undefined },
      responseType: 'blob'
    });
  }
};

// Excess Material Reconciliation (Iter 42 Change 4)
export const reconciliationAPI = {
  get: (projectId) => api.get(`/material-reconciliation/${projectId}`),
  submit: (projectId, data) => api.put(`/material-reconciliation/${projectId}`, data),
  report: (params = {}) => api.get('/material-reconciliation-report', { params }),
  alerts: (days = 7) => api.get('/material-reconciliation-alerts', { params: { days } })
};

// Assets & Tools (Iter 42 Change 6)
export const assetsAPI = {
  list: (params = {}) => api.get('/assets', { params }),
  get: (id) => api.get(`/assets/${id}`),
  create: (data) => api.post('/assets', data),
  update: (id, data) => api.put(`/assets/${id}`, data),
  remove: (id) => api.delete(`/assets/${id}`),
  issue: (id, data) => api.post(`/assets/${id}/issue`, data),
  returnAsset: (id, data) => api.post(`/assets/${id}/return`, data),
  logMaintenance: (id, data) => api.post(`/assets/${id}/maintenance`, data),
  compliance: (days = 90) => api.get('/assets/compliance', { params: { days } }),
  categories: () => api.get('/assets/categories'),
  report: (type, params = {}) => api.get(`/assets/reports/${type}`, { params })
};

// AMC Contracts (Iter 42 Change 5)
export const amcAPI = {
  list: (params = {}) => api.get('/amc/contracts', { params }),
  get: (id) => api.get(`/amc/contracts/${id}`),
  create: (data) => api.post('/amc/contracts', data),
  createFromProject: (projectId) => api.post(`/amc/contracts/from-project/${projectId}`),
  update: (id, data) => api.put(`/amc/contracts/${id}`, data),
  renew: (id) => api.post(`/amc/contracts/${id}/renew`),
  bulkRenew: (ids) => api.post('/amc/contracts/bulk-renew', { contract_ids: ids }),
  cancel: (id, reason) => api.post(`/amc/contracts/${id}/cancel`, { reason }),
  scheduleVisit: (id, data) => api.post(`/amc/contracts/${id}/visits`, data),
  completeVisit: (id, data) => api.put(`/amc/visits/${id}/complete`, data),
  listVisits: (params = {}) => api.get('/amc/visits', { params }),
  dashboard: (params = {}) => api.get('/amc/dashboard', { params }),
  recurringRevenueReport: (params = {}) => api.get('/amc/recurring-revenue-report', { params })
};

// Multi-location (Iter 42 Change 8)
export const locationsAPI = {
  list: () => api.get('/locations'),
  create: (data) => api.post('/locations', data),
  update: (id, data) => api.put(`/locations/${id}`, data),
  remove: (id) => api.delete(`/locations/${id}`),
  assignUser: (userId, data) => api.put(`/users/${userId}/locations`, data)
};

// Vendors / Suppliers (Iter 44 Batch C)
export const vendorsAPI = {
  list: (params = {}) => api.get('/vendors', { params }),
  create: (data) => api.post('/vendors', data),
  update: (id, data) => api.put(`/vendors/${id}`, data),
  remove: (id) => api.delete(`/vendors/${id}`),
  purchaseOrders: (id) => api.get(`/vendors/${id}/purchase-orders`)
};

// Employee Performance manual scores (Iter 44 Batch C)
export const employeeScoresAPI = {
  list: (params = {}) => api.get('/employee-scores', { params }),
  create: (data) => api.post('/employee-scores', data)
};

// Labour & Subcontractor / Internal Teams (Iter 46 Change 1)
export const partnersAPI = {
  list: (params = {}) => api.get('/partners', { params }),
  create: (data) => api.post('/partners', data),
  get: (id) => api.get(`/partners/${id}`),
  update: (id, data) => api.put(`/partners/${id}`, data),
  addRateCard: (id, data) => api.post(`/partners/${id}/rate-card`, data),
  editRateCard: (id, data) => api.put(`/partners/${id}/rate-card`, data),
  remove: (id) => api.delete(`/partners/${id}`),
  projectScope: (projectId) => api.get(`/partners/project-scope/${projectId}`),
  assignmentsByProject: (projectId) => api.get(`/partners/assignments/by-project/${projectId}`),
  createAssignment: (partnerId, data) => api.post(`/partners/${partnerId}/assignments`, data),
  getAssignment: (id) => api.get(`/partners/assignments/${id}`),
  updateAssignment: (id, data) => api.put(`/partners/assignments/${id}`, data),
  releaseRetention: (id) => api.post(`/partners/assignments/${id}/release-retention`),
  recordPayment: (partnerId, data) => api.post(`/partners/${partnerId}/payments`, data),
  listPayments: (partnerId, params = {}) => api.get(`/partners/${partnerId}/payments`, { params }),
  scorecard: (partnerId) => api.get(`/partners/${partnerId}/scorecard`),
  tags: {
    list: () => api.get('/partners/tags/all'),
    create: (tag) => api.post('/partners/tags', { tag }),
    rename: (id, tag) => api.put(`/partners/tags/${id}`, { tag }),
    remove: (id) => api.delete(`/partners/tags/${id}`)
  }
};

// Ecommerce marketplaces (Iter 46 Change 2)
export const ecommerceAPI = {
  platforms: {
    list: () => api.get('/ecommerce/platforms'),
    create: (data) => api.post('/ecommerce/platforms', data),
    update: (id, data) => api.put(`/ecommerce/platforms/${id}`, data),
    remove: (id) => api.delete(`/ecommerce/platforms/${id}`)
  },
  listings: {
    list: (params = {}) => api.get('/ecommerce/listings', { params }),
    create: (data) => api.post('/ecommerce/listings', data),
    update: (id, data) => api.put(`/ecommerce/listings/${id}`, data),
    bulkStatus: (data) => api.post('/ecommerce/listings/bulk-status', data),
    remove: (id) => api.delete(`/ecommerce/listings/${id}`)
  },
  orders: {
    list: (params = {}) => api.get('/ecommerce/orders', { params }),
    create: (data) => api.post('/ecommerce/orders', data),
    update: (id, data) => api.put(`/ecommerce/orders/${id}`, data),
    remove: (id) => api.delete(`/ecommerce/orders/${id}`),
    importPreview: (platformId, file) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/ecommerce/orders/import-preview?platform_id=${platformId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    importCommit: (data) => api.post('/ecommerce/orders/import-commit', data)
  },
  reconciliation: (params = {}) => api.get('/ecommerce/reconciliation', { params })
};

// Customer Support (Iter 47) — AMC support tickets
export const supportAPI = {
  slaConfig: {
    get: () => api.get('/support/sla-config'),
    update: (data) => api.put('/support/sla-config', data)
  },
  tickets: {
    list: (params = {}) => api.get('/support/tickets', { params }),
    get: (id) => api.get(`/support/tickets/${id}`),
    create: (data) => api.post('/support/tickets', data),
    update: (id, data) => api.put(`/support/tickets/${id}`, data),
    transitionStatus: (id, data) => api.post(`/support/tickets/${id}/status`, data),
    close: (id, data) => api.post(`/support/tickets/${id}/close`, data)
  },
  dashboard: () => api.get('/support/dashboard')
};

// Hard delete (Iter 47) — admin only
export const hardDeleteAPI = {
  sale: (id, data) => api.delete(`/hard-delete/sale/${id}`, { data }),
  purchaseOrder: (id, data) => api.delete(`/hard-delete/purchase-order/${id}`, { data }),
  delivery: (id, data) => api.delete(`/hard-delete/delivery/${id}`, { data })
};

export default api;