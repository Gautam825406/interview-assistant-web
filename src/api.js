// IntervIQ SaaS — API client.
// Talks only to the SaaS backend (see ../interview-assistant-saas/API_CONTRACT.md).
// The backend holds all provider API keys; this client NEVER sees or sends one.
// Base URL: VITE_API_URL at build time, fallback to the Render default.

export const API_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ||
  'https://interview-assistant-api-s0sx.onrender.com'

const TOKEN_KEY = 'ia_token'
const USER_KEY = 'ia_user'

export function getToken() { return localStorage.getItem(TOKEN_KEY) || '' }
export function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)) || null } catch { return null } }
export function saveAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
export function isLoggedIn() { return !!getToken() }
export function isAdmin() { return getUser()?.role === 'admin' }

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message || `Request failed (${status})`)
    this.status = status
    this.body = body
  }
}

// Fired on any 401 so the app can return to the login screen.
export function onUnauthorized() {
  clearAuth()
  window.dispatchEvent(new CustomEvent('ia:unauthorized'))
}

async function request(path, { method = 'GET', body, formData, auth = true } = {}) {
  const headers = {}
  let payload
  if (formData) {
    payload = formData
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = 'Bearer ' + token
  }
  let res
  try {
    res = await fetch(API_BASE + path, { method, headers, body: payload })
  } catch (err) {
    throw new ApiError(0, 'Could not reach the service. Check your connection and try again. (' + err.message + ')')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    onUnauthorized()
    throw new ApiError(401, data?.detail || data?.error || 'Session expired — please log in again.')
  }
  if (!res.ok) {
    const msg = data?.detail || data?.error || data?.message || `Request failed (${res.status})`
    throw new ApiError(res.status, typeof msg === 'string' ? msg : `Request failed (${res.status})`, data)
  }
  return data
}

export const api = {
  // ---- public ----
  health: () => request('/api/health', { auth: false }),
  plans: () => request('/api/plans', { auth: false }),

  // ---- auth ----
  signup: (name, email, password) => request('/api/auth/signup', { method: 'POST', body: { name, email, password }, auth: false }),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => request('/api/auth/me'),
  updateMe: (body) => request('/api/auth/me', { method: 'PATCH', body }),

  // ---- subscription / Cashfree ----
  checkout: (plan_slug) => request('/api/subscriptions/checkout', { method: 'POST', body: { plan_slug } }),
  verify: (order_id) => request('/api/subscriptions/verify?order_id=' + encodeURIComponent(order_id)),
  mySubscription: () => request('/api/subscriptions/mine'),
  cancelSubscription: () => request('/api/subscriptions/cancel', { method: 'POST' }),

  // ---- plan gates ----
  sessionsStart: () => request('/api/sessions/start', { method: 'POST' }),
  mocksStart: () => request('/api/mocks/start', { method: 'POST' }),

  // ---- AI proxy ----
  aiStatus: () => request('/api/ai/status'),
  aiChat: (messages, opts = {}) => request('/api/ai/chat', { method: 'POST', body: { messages, ...opts } }),
  aiVision: (image, prompt) => request('/api/ai/vision', { method: 'POST', body: { image, ...(prompt ? { prompt } : {}) } }),
  aiTranscribe: (blob) => {
    const form = new FormData()
    form.append('audio', blob, 'chunk.' + ((blob.type || '').includes('mp4') ? 'mp4' : 'webm'))
    return request('/api/ai/transcribe', { method: 'POST', formData: form })
  },

  // ---- admin ----
  adminOverview: () => request('/api/admin/overview'),
  adminUsers: () => request('/api/admin/users'),
  adminPatchUser: (id, patch) => request('/api/admin/users/' + id, { method: 'PATCH', body: patch }),
  adminGrant: (id, plan_slug, days) => request('/api/admin/users/' + id + '/grant', { method: 'POST', body: { plan_slug, ...(days ? { days } : {}) } }),
  adminSubscriptions: () => request('/api/admin/subscriptions'),
  adminPayments: () => request('/api/admin/payments'),
  adminProviders: () => request('/api/admin/providers'),
  adminProvidersPut: (patch) => request('/api/admin/providers', { method: 'PUT', body: patch }),
  adminPlans: () => request('/api/admin/plans'),
  adminPlanPut: (slug, patch) => request('/api/admin/plans/' + encodeURIComponent(slug), { method: 'PUT', body: patch }),
  adminPlanCreate: (plan) => request('/api/admin/plans', { method: 'POST', body: plan }),
}
