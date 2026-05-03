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
  complete: (id, completionMedia, customerFeedback) => api.post(`/projects/${id}/complete`, { completion_media: completionMedia, customer_feedback: customerFeedback }),
  requestDeletion: (id, reason) => api.post(`/projects/${id}/request-deletion`, { reason }),
  forceDelete: (id) => api.delete(`/projects/${id}/force`),
  updateReference: (id, refNumber) => api.put(`/projects/${id}/reference`, { reference_number: refNumber }),
  updateStatus: (id, status) => api.put(`/projects/${id}/status`, { status }),
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
  getCeo: () => api.get('/dashboard/ceo')
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
  inbound: (id, data) => api.put(`/purchase-orders/${id}/inbound`, data)
};

// Deliveries
export const deliveriesAPI = {
  create: (data) => api.post('/deliveries', data),
  list: (params = {}) => api.get('/deliveries', { params }),
  complete: (id) => api.put(`/deliveries/${id}/complete`)
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
  getAll: () => api.get('/terms'),
  getActive: (language = 'en') => api.get('/terms/active', { params: { language } }),
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
  getAlerts: () => api.get('/inventory/alerts')
};

// File Upload API
export const uploadAPI = {
  uploadImage: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload/image', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  uploadMedia: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload/media', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
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
      headers: { 'Content-Type': 'multipart/form-data' }
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

export default api;
