import axios from 'axios'
import { getSocketId } from './websocket'

const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor - add auth token and socket ID
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    const sid = getSocketId()
    if (sid) {
      config.headers['X-Socket-Id'] = sid
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor - handle 401
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token')
      if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/register')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export const authApi = {
  register: (data) => apiClient.post('/auth/register', data).then(r => r.data),
  login: (data) => apiClient.post('/auth/login', data).then(r => r.data),
  me: () => apiClient.get('/auth/me').then(r => r.data),
  updateMapsKey: (key) => apiClient.put('/auth/me/maps-key', { maps_api_key: key }).then(r => r.data),
  updateApiKeys: (data) => apiClient.put('/auth/me/api-keys', data).then(r => r.data),
  updateSettings: (data) => apiClient.put('/auth/me/settings', data).then(r => r.data),
  getSettings: () => apiClient.get('/auth/me/settings').then(r => r.data),
  listUsers: () => apiClient.get('/auth/users').then(r => r.data),
  uploadAvatar: (formData) => apiClient.post('/auth/avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
  deleteAvatar: () => apiClient.delete('/auth/avatar').then(r => r.data),
  getAppConfig: () => apiClient.get('/auth/app-config').then(r => r.data),
  updateAppSettings: (data) => apiClient.put('/auth/app-settings', data).then(r => r.data),
  validateKeys: () => apiClient.get('/auth/validate-keys').then(r => r.data),
  travelStats: () => apiClient.get('/auth/travel-stats').then(r => r.data),
  changePassword: (data) => apiClient.put('/auth/me/password', data).then(r => r.data),
  deleteOwnAccount: () => apiClient.delete('/auth/me').then(r => r.data),
  demoLogin: () => apiClient.post('/auth/demo-login').then(r => r.data),
}

export const tripsApi = {
  list: (params) => apiClient.get('/trips', { params }).then(r => r.data),
  create: (data) => apiClient.post('/trips', data).then(r => r.data),
  get: (id) => apiClient.get(`/trips/${id}`).then(r => r.data),
  update: (id, data) => apiClient.put(`/trips/${id}`, data).then(r => r.data),
  delete: (id) => apiClient.delete(`/trips/${id}`).then(r => r.data),
  uploadCover: (id, formData) => apiClient.post(`/trips/${id}/cover`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
  archive: (id) => apiClient.put(`/trips/${id}`, { is_archived: true }).then(r => r.data),
  unarchive: (id) => apiClient.put(`/trips/${id}`, { is_archived: false }).then(r => r.data),
  getMembers: (id) => apiClient.get(`/trips/${id}/members`).then(r => r.data),
  addMember: (id, identifier) => apiClient.post(`/trips/${id}/members`, { identifier }).then(r => r.data),
  removeMember: (id, userId) => apiClient.delete(`/trips/${id}/members/${userId}`).then(r => r.data),
}

export const daysApi = {
  list: (tripId) => apiClient.get(`/trips/${tripId}/days`).then(r => r.data),
  create: (tripId, data) => apiClient.post(`/trips/${tripId}/days`, data).then(r => r.data),
  update: (tripId, dayId, data) => apiClient.put(`/trips/${tripId}/days/${dayId}`, data).then(r => r.data),
  delete: (tripId, dayId) => apiClient.delete(`/trips/${tripId}/days/${dayId}`).then(r => r.data),
}

export const placesApi = {
  list: (tripId, params) => apiClient.get(`/trips/${tripId}/places`, { params }).then(r => r.data),
  create: (tripId, data) => apiClient.post(`/trips/${tripId}/places`, data).then(r => r.data),
  get: (tripId, id) => apiClient.get(`/trips/${tripId}/places/${id}`).then(r => r.data),
  update: (tripId, id, data) => apiClient.put(`/trips/${tripId}/places/${id}`, data).then(r => r.data),
  delete: (tripId, id) => apiClient.delete(`/trips/${tripId}/places/${id}`).then(r => r.data),
  searchImage: (tripId, id) => apiClient.get(`/trips/${tripId}/places/${id}/image`).then(r => r.data),
}

export const assignmentsApi = {
  list: (tripId, dayId) => apiClient.get(`/trips/${tripId}/days/${dayId}/assignments`).then(r => r.data),
  create: (tripId, dayId, data) => apiClient.post(`/trips/${tripId}/days/${dayId}/assignments`, data).then(r => r.data),
  delete: (tripId, dayId, id) => apiClient.delete(`/trips/${tripId}/days/${dayId}/assignments/${id}`).then(r => r.data),
  reorder: (tripId, dayId, orderedIds) => apiClient.put(`/trips/${tripId}/days/${dayId}/assignments/reorder`, { orderedIds }).then(r => r.data),
  move: (tripId, assignmentId, newDayId, orderIndex) => apiClient.put(`/trips/${tripId}/assignments/${assignmentId}/move`, { new_day_id: newDayId, order_index: orderIndex }).then(r => r.data),
}

export const packingApi = {
  list: (tripId) => apiClient.get(`/trips/${tripId}/packing`).then(r => r.data),
  create: (tripId, data) => apiClient.post(`/trips/${tripId}/packing`, data).then(r => r.data),
  update: (tripId, id, data) => apiClient.put(`/trips/${tripId}/packing/${id}`, data).then(r => r.data),
  delete: (tripId, id) => apiClient.delete(`/trips/${tripId}/packing/${id}`).then(r => r.data),
  reorder: (tripId, orderedIds) => apiClient.put(`/trips/${tripId}/packing/reorder`, { orderedIds }).then(r => r.data),
}

export const tagsApi = {
  list: () => apiClient.get('/tags').then(r => r.data),
  create: (data) => apiClient.post('/tags', data).then(r => r.data),
  update: (id, data) => apiClient.put(`/tags/${id}`, data).then(r => r.data),
  delete: (id) => apiClient.delete(`/tags/${id}`).then(r => r.data),
}

export const categoriesApi = {
  list: () => apiClient.get('/categories').then(r => r.data),
  create: (data) => apiClient.post('/categories', data).then(r => r.data),
  update: (id, data) => apiClient.put(`/categories/${id}`, data).then(r => r.data),
  delete: (id) => apiClient.delete(`/categories/${id}`).then(r => r.data),
}

export const adminApi = {
  users: () => apiClient.get('/admin/users').then(r => r.data),
  createUser: (data) => apiClient.post('/admin/users', data).then(r => r.data),
  updateUser: (id, data) => apiClient.put(`/admin/users/${id}`, data).then(r => r.data),
  deleteUser: (id) => apiClient.delete(`/admin/users/${id}`).then(r => r.data),
  stats: () => apiClient.get('/admin/stats').then(r => r.data),
  saveDemoBaseline: () => apiClient.post('/admin/save-demo-baseline').then(r => r.data),
  getOidc: () => apiClient.get('/admin/oidc').then(r => r.data),
  updateOidc: (data) => apiClient.put('/admin/oidc', data).then(r => r.data),
  addons: () => apiClient.get('/admin/addons').then(r => r.data),
  updateAddon: (id, data) => apiClient.put(`/admin/addons/${id}`, data).then(r => r.data),
}

export const addonsApi = {
  enabled: () => apiClient.get('/addons').then(r => r.data),
}

export const mapsApi = {
  search: (query, lang) => apiClient.post(`/maps/search?lang=${lang || 'en'}`, { query }).then(r => r.data),
  details: (placeId, lang) => apiClient.get(`/maps/details/${placeId}`, { params: { lang } }).then(r => r.data),
  placePhoto: (placeId) => apiClient.get(`/maps/place-photo/${placeId}`).then(r => r.data),
}

export const budgetApi = {
  list: (tripId) => apiClient.get(`/trips/${tripId}/budget`).then(r => r.data),
  create: (tripId, data) => apiClient.post(`/trips/${tripId}/budget`, data).then(r => r.data),
  update: (tripId, id, data) => apiClient.put(`/trips/${tripId}/budget/${id}`, data).then(r => r.data),
  delete: (tripId, id) => apiClient.delete(`/trips/${tripId}/budget/${id}`).then(r => r.data),
}

export const filesApi = {
  list: (tripId) => apiClient.get(`/trips/${tripId}/files`).then(r => r.data),
  upload: (tripId, formData) => apiClient.post(`/trips/${tripId}/files`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }).then(r => r.data),
  update: (tripId, id, data) => apiClient.put(`/trips/${tripId}/files/${id}`, data).then(r => r.data),
  delete: (tripId, id) => apiClient.delete(`/trips/${tripId}/files/${id}`).then(r => r.data),
}

export const reservationsApi = {
  list: (tripId) => apiClient.get(`/trips/${tripId}/reservations`).then(r => r.data),
  create: (tripId, data) => apiClient.post(`/trips/${tripId}/reservations`, data).then(r => r.data),
  update: (tripId, id, data) => apiClient.put(`/trips/${tripId}/reservations/${id}`, data).then(r => r.data),
  delete: (tripId, id) => apiClient.delete(`/trips/${tripId}/reservations/${id}`).then(r => r.data),
}

export const weatherApi = {
  get: (lat, lng, date) => apiClient.get('/weather', { params: { lat, lng, date, units: 'metric' } }).then(r => r.data),
}

export const settingsApi = {
  get: () => apiClient.get('/settings').then(r => r.data),
  set: (key, value) => apiClient.put('/settings', { key, value }).then(r => r.data),
  setBulk: (settings) => apiClient.post('/settings/bulk', { settings }).then(r => r.data),
}

export const dayNotesApi = {
  list: (tripId, dayId) => apiClient.get(`/trips/${tripId}/days/${dayId}/notes`).then(r => r.data),
  create: (tripId, dayId, data) => apiClient.post(`/trips/${tripId}/days/${dayId}/notes`, data).then(r => r.data),
  update: (tripId, dayId, id, data) => apiClient.put(`/trips/${tripId}/days/${dayId}/notes/${id}`, data).then(r => r.data),
  delete: (tripId, dayId, id) => apiClient.delete(`/trips/${tripId}/days/${dayId}/notes/${id}`).then(r => r.data),
}

export const backupApi = {
  list: () => apiClient.get('/backup/list').then(r => r.data),
  create: () => apiClient.post('/backup/create').then(r => r.data),
  download: async (filename) => {
    const token = localStorage.getItem('auth_token')
    const res = await fetch(`/api/backup/download/${filename}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('Download fehlgeschlagen')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },
  delete: (filename) => apiClient.delete(`/backup/${filename}`).then(r => r.data),
  restore: (filename) => apiClient.post(`/backup/restore/${filename}`).then(r => r.data),
  uploadRestore: (file) => {
    const form = new FormData()
    form.append('backup', file)
    return apiClient.post('/backup/upload-restore', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
  },
  getAutoSettings: () => apiClient.get('/backup/auto-settings').then(r => r.data),
  setAutoSettings: (settings) => apiClient.put('/backup/auto-settings', settings).then(r => r.data),
}

export default apiClient
