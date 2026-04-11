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
  getStats: () => api.get('/dashboard/stats')
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

// Google Drive Settings API
export const driveSettingsAPI = {
  get: () => api.get('/drive/settings'),
  update: (data) => api.put('/drive/settings', data),
};

// Site Image Upload API
export const siteImageAPI = {
  upload: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload/site-image', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
  }
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

export default api;
