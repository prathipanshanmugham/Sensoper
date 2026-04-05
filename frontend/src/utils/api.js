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
  complete: (id) => api.post(`/projects/${id}/complete`)
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

export default api;
