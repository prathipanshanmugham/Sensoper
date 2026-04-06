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
  complete: (id) => api.post(`/projects/${id}/complete`),
  requestDeletion: (id, reason) => api.post(`/projects/${id}/request-deletion`, { reason }),
  forceDelete: (id) => api.delete(`/projects/${id}/force`)
};

// Users API (Admin only)
export const usersAPI = {
  getAll: () => api.get('/users'),
  create: (userData) => api.post('/users', userData),
  update: (id, userData) => api.put(`/users/${id}`, userData),
  delete: (id) => api.delete(`/users/${id}`)
};

// Pricing API
export const pricingAPI = {
  get: () => api.get('/pricing'),
  update: (pricing) => api.put('/pricing', pricing)
};

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
  // Locations
  getLocations: () => api.get('/inventory/locations'),
  createLocation: (data) => api.post('/inventory/locations', data),
  deleteLocation: (id) => api.delete(`/inventory/locations/${id}`),
  
  // Items
  getItems: (params = {}) => api.get('/inventory/items', { params }),
  getItem: (id) => api.get(`/inventory/items/${id}`),
  createItem: (data) => api.post('/inventory/items', data),
  updateItem: (id, data) => api.put(`/inventory/items/${id}`, data),
  deleteItem: (id) => api.delete(`/inventory/items/${id}`),
  
  // Alerts
  getAlerts: () => api.get('/inventory/alerts')
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
  delete: (id) => api.delete(`/company/${id}`)
};

export default api;
