import { create } from 'zustand'
import apiClient from '../api/client'

const ax = apiClient
const api = {
  getPlan: () => ax.get('/addons/vacay/plan').then(r => r.data),
  updatePlan: (data) => ax.put('/addons/vacay/plan', data).then(r => r.data),
  updateColor: (color, targetUserId) => ax.put('/addons/vacay/color', { color, target_user_id: targetUserId }).then(r => r.data),
  invite: (userId) => ax.post('/addons/vacay/invite', { user_id: userId }).then(r => r.data),
  acceptInvite: (planId) => ax.post('/addons/vacay/invite/accept', { plan_id: planId }).then(r => r.data),
  declineInvite: (planId) => ax.post('/addons/vacay/invite/decline', { plan_id: planId }).then(r => r.data),
  cancelInvite: (userId) => ax.post('/addons/vacay/invite/cancel', { user_id: userId }).then(r => r.data),
  dissolve: () => ax.post('/addons/vacay/dissolve').then(r => r.data),
  availableUsers: () => ax.get('/addons/vacay/available-users').then(r => r.data),
  getYears: () => ax.get('/addons/vacay/years').then(r => r.data),
  addYear: (year) => ax.post('/addons/vacay/years', { year }).then(r => r.data),
  removeYear: (year) => ax.delete(`/addons/vacay/years/${year}`).then(r => r.data),
  getEntries: (year) => ax.get(`/addons/vacay/entries/${year}`).then(r => r.data),
  toggleEntry: (date, targetUserId) => ax.post('/addons/vacay/entries/toggle', { date, target_user_id: targetUserId }).then(r => r.data),
  toggleCompanyHoliday: (date) => ax.post('/addons/vacay/entries/company-holiday', { date }).then(r => r.data),
  getStats: (year) => ax.get(`/addons/vacay/stats/${year}`).then(r => r.data),
  updateStats: (year, days, targetUserId) => ax.put(`/addons/vacay/stats/${year}`, { vacation_days: days, target_user_id: targetUserId }).then(r => r.data),
  getCountries: () => ax.get('/addons/vacay/holidays/countries').then(r => r.data),
  getHolidays: (year, country) => ax.get(`/addons/vacay/holidays/${year}/${country}`).then(r => r.data),
}

export const useVacayStore = create((set, get) => ({
  plan: null,
  users: [],
  pendingInvites: [],
  incomingInvites: [],
  isOwner: true,
  isFused: false,
  years: [],
  entries: [],
  companyHolidays: [],
  stats: [],
  selectedYear: new Date().getFullYear(),
  selectedUserId: null,
  holidays: {},  // date -> { name, localName }
  loading: false,

  setSelectedYear: (year) => set({ selectedYear: year }),
  setSelectedUserId: (id) => set({ selectedUserId: id }),

  loadPlan: async () => {
    const data = await api.getPlan()
    set({
      plan: data.plan,
      users: data.users,
      pendingInvites: data.pendingInvites,
      incomingInvites: data.incomingInvites,
      isOwner: data.isOwner,
      isFused: data.isFused,
    })
  },

  updatePlan: async (updates) => {
    const data = await api.updatePlan(updates)
    set({ plan: data.plan })
    await get().loadEntries()
    await get().loadStats()
    await get().loadHolidays()
  },

  updateColor: async (color, targetUserId) => {
    await api.updateColor(color, targetUserId)
    await get().loadPlan()
    await get().loadEntries()
  },

  invite: async (userId) => {
    await api.invite(userId)
    await get().loadPlan()
  },

  acceptInvite: async (planId) => {
    await api.acceptInvite(planId)
    await get().loadAll()
  },

  declineInvite: async (planId) => {
    await api.declineInvite(planId)
    await get().loadPlan()
  },

  cancelInvite: async (userId) => {
    await api.cancelInvite(userId)
    await get().loadPlan()
  },

  dissolve: async () => {
    await api.dissolve()
    await get().loadAll()
  },

  loadYears: async () => {
    const data = await api.getYears()
    set({ years: data.years })
    if (data.years.length > 0) {
      set({ selectedYear: data.years[data.years.length - 1] })
    }
  },

  addYear: async (year) => {
    const data = await api.addYear(year)
    set({ years: data.years })
    await get().loadStats(year)
  },

  removeYear: async (year) => {
    const data = await api.removeYear(year)
    set({ years: data.years })
  },

  loadEntries: async (year) => {
    const y = year || get().selectedYear
    const data = await api.getEntries(y)
    set({ entries: data.entries, companyHolidays: data.companyHolidays })
  },

  toggleEntry: async (date, targetUserId) => {
    await api.toggleEntry(date, targetUserId)
    await get().loadEntries()
    await get().loadStats()
  },

  toggleCompanyHoliday: async (date) => {
    await api.toggleCompanyHoliday(date)
    await get().loadEntries()
  },

  loadStats: async (year) => {
    const y = year || get().selectedYear
    const data = await api.getStats(y)
    set({ stats: data.stats })
  },

  updateVacationDays: async (year, days, targetUserId) => {
    await api.updateStats(year, days, targetUserId)
    await get().loadStats(year)
  },

  loadHolidays: async (year) => {
    const y = year || get().selectedYear
    const plan = get().plan
    if (!plan?.holidays_enabled || !plan?.holidays_region) {
      set({ holidays: {} })
      return
    }
    const country = plan.holidays_region.split('-')[0]
    const region = plan.holidays_region.includes('-') ? plan.holidays_region : null
    try {
      const data = await api.getHolidays(y, country)
      // Check if this country HAS regional holidays
      const hasRegions = data.some(h => h.counties && h.counties.length > 0)
      // If country has regions but no region selected yet, only show global ones
      // Actually: don't show ANY holidays until region is selected
      if (hasRegions && !region) {
        set({ holidays: {} })
        return
      }
      const map = {}
      data.forEach(h => {
        if (h.global || !h.counties || (region && h.counties.includes(region))) {
          map[h.date] = { name: h.name, localName: h.localName }
        }
      })
      set({ holidays: map })
    } catch {
      set({ holidays: {} })
    }
  },

  loadAll: async () => {
    set({ loading: true })
    try {
      await get().loadPlan()
      await get().loadYears()
      const year = get().selectedYear
      await get().loadEntries(year)
      await get().loadStats(year)
      await get().loadHolidays(year)
    } finally {
      set({ loading: false })
    }
  },
}))
