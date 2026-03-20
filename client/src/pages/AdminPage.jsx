import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApi, authApi } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useSettingsStore } from '../store/settingsStore'
import { useTranslation } from '../i18n'
import Navbar from '../components/Layout/Navbar'
import Modal from '../components/shared/Modal'
import { useToast } from '../components/shared/Toast'
import CategoryManager from '../components/Admin/CategoryManager'
import BackupPanel from '../components/Admin/BackupPanel'
import AddonManager from '../components/Admin/AddonManager'
import { Users, Map, Briefcase, Shield, Trash2, Edit2, Camera, FileText, Eye, EyeOff, Save, CheckCircle, XCircle, Loader2, UserPlus } from 'lucide-react'
import CustomSelect from '../components/shared/CustomSelect'

export default function AdminPage() {
  const { demoMode } = useAuthStore()
  const { t, locale } = useTranslation()
  const hour12 = useSettingsStore(s => s.settings.time_format) === '12h'
  const TABS = [
    { id: 'users', label: t('admin.tabs.users') },
    { id: 'categories', label: t('admin.tabs.categories') },
    { id: 'addons', label: t('admin.tabs.addons') },
    { id: 'settings', label: t('admin.tabs.settings') },
    { id: 'backup', label: t('admin.tabs.backup') },
  ]

  const [activeTab, setActiveTab] = useState('users')
  const [users, setUsers] = useState([])
  const [stats, setStats] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [editingUser, setEditingUser] = useState(null)
  const [editForm, setEditForm] = useState({ username: '', email: '', role: 'user', password: '' })
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [createForm, setCreateForm] = useState({ username: '', email: '', password: '', role: 'user' })

  // OIDC config
  const [oidcConfig, setOidcConfig] = useState({ issuer: '', client_id: '', client_secret: '', display_name: '' })
  const [savingOidc, setSavingOidc] = useState(false)

  // Registration toggle
  const [allowRegistration, setAllowRegistration] = useState(true)

  // API Keys
  const [mapsKey, setMapsKey] = useState('')
  const [weatherKey, setWeatherKey] = useState('')
  const [showKeys, setShowKeys] = useState({})
  const [savingKeys, setSavingKeys] = useState(false)
  const [validating, setValidating] = useState({})
  const [validation, setValidation] = useState({})

  const { user: currentUser, updateApiKeys } = useAuthStore()
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    loadData()
    loadAppConfig()
    loadApiKeys()
    adminApi.getOidc().then(setOidcConfig).catch(() => {})
  }, [])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [usersData, statsData] = await Promise.all([
        adminApi.users(),
        adminApi.stats(),
      ])
      setUsers(usersData.users)
      setStats(statsData)
    } catch (err) {
      toast.error(t('admin.toast.loadError'))
    } finally {
      setIsLoading(false)
    }
  }

  const loadAppConfig = async () => {
    try {
      const config = await authApi.getAppConfig()
      setAllowRegistration(config.allow_registration)
    } catch (err) {
      // ignore
    }
  }

  const loadApiKeys = async () => {
    try {
      const data = await authApi.getSettings()
      setMapsKey(data.settings?.maps_api_key || '')
      setWeatherKey(data.settings?.openweather_api_key || '')
    } catch (err) {
      // ignore
    }
  }

  const handleToggleRegistration = async (value) => {
    setAllowRegistration(value)
    try {
      await authApi.updateAppSettings({ allow_registration: value })
    } catch (err) {
      setAllowRegistration(!value)
      toast.error(err.response?.data?.error || t('common.error'))
    }
  }

  const toggleKey = (key) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSaveApiKeys = async () => {
    setSavingKeys(true)
    try {
      await updateApiKeys({
        maps_api_key: mapsKey,
        openweather_api_key: weatherKey,
      })
      toast.success(t('admin.keySaved'))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingKeys(false)
    }
  }

  const handleValidateKeys = async () => {
    setValidating({ maps: true, weather: true })
    try {
      // Save first so validation uses the current values
      await updateApiKeys({ maps_api_key: mapsKey, openweather_api_key: weatherKey })
      const result = await authApi.validateKeys()
      setValidation(result)
    } catch (err) {
      toast.error(t('common.error'))
    } finally {
      setValidating({})
    }
  }

  const handleValidateKey = async (keyType) => {
    setValidating(prev => ({ ...prev, [keyType]: true }))
    try {
      // Save first so validation uses the current values
      await updateApiKeys({ maps_api_key: mapsKey, openweather_api_key: weatherKey })
      const result = await authApi.validateKeys()
      setValidation(prev => ({ ...prev, [keyType]: result[keyType] }))
    } catch (err) {
      toast.error(t('common.error'))
    } finally {
      setValidating(prev => ({ ...prev, [keyType]: false }))
    }
  }

  const handleCreateUser = async () => {
    if (!createForm.username.trim() || !createForm.email.trim() || !createForm.password.trim()) {
      toast.error(t('admin.toast.fieldsRequired'))
      return
    }
    try {
      const data = await adminApi.createUser(createForm)
      setUsers(prev => [data.user, ...prev])
      setShowCreateUser(false)
      setCreateForm({ username: '', email: '', password: '', role: 'user' })
      toast.success(t('admin.toast.userCreated'))
    } catch (err) {
      toast.error(err.response?.data?.error || t('admin.toast.createError'))
    }
  }

  const handleEditUser = (user) => {
    setEditingUser(user)
    setEditForm({ username: user.username, email: user.email, role: user.role, password: '' })
  }

  const handleSaveUser = async () => {
    try {
      const payload = {
        username: editForm.username.trim() || undefined,
        email: editForm.email.trim() || undefined,
        role: editForm.role,
      }
      if (editForm.password.trim()) payload.password = editForm.password.trim()
      const data = await adminApi.updateUser(editingUser.id, payload)
      setUsers(prev => prev.map(u => u.id === editingUser.id ? data.user : u))
      setEditingUser(null)
      toast.success(t('admin.toast.userUpdated'))
    } catch (err) {
      toast.error(err.response?.data?.error || t('admin.toast.updateError'))
    }
  }

  const handleDeleteUser = async (user) => {
    if (user.id === currentUser?.id) {
      toast.error(t('admin.toast.cannotDeleteSelf'))
      return
    }
    if (!confirm(t('admin.deleteUser', { name: user.username }))) return
    try {
      await adminApi.deleteUser(user.id)
      setUsers(prev => prev.filter(u => u.id !== user.id))
      toast.success(t('admin.toast.userDeleted'))
    } catch (err) {
      toast.error(err.response?.data?.error || t('admin.toast.deleteError'))
    }
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-secondary)' }}>
      <Navbar />

      <div className="pt-14">
        <div className="max-w-6xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
              <Shield className="w-5 h-5 text-slate-700" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Administration</h1>
              <p className="text-slate-500 text-sm">{t('admin.subtitle')}</p>
            </div>
          </div>

          {/* Demo Baseline Button */}
          {demoMode && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-900">Demo Baseline</p>
                <p className="text-xs text-amber-700">Save current state as the hourly reset point. All admin trips and settings will be preserved.</p>
              </div>
              <button
                onClick={async () => {
                  try {
                    await adminApi.saveDemoBaseline()
                    toast.success('Baseline saved! Resets will restore to this state.')
                  } catch (e) {
                    toast.error(e.response?.data?.error || 'Failed to save baseline')
                  }
                }}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 transition-colors flex-shrink-0 ml-4"
              >
                Save Baseline
              </button>
            </div>
          )}

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { label: t('admin.stats.users'), value: stats.totalUsers, icon: Users },
                { label: t('admin.stats.trips'), value: stats.totalTrips, icon: Briefcase },
                { label: t('admin.stats.places'), value: stats.totalPlaces, icon: Map },
                { label: t('admin.stats.files'), value: stats.totalFiles || 0, icon: FileText },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                  <div className="flex items-center gap-4">
                    <Icon className="w-5 h-5" style={{ color: 'var(--text-primary)' }} />
                    <div>
                      <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="grid grid-cols-3 sm:flex gap-1 mb-6 rounded-xl p-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)' }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'users' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">{t('admin.tabs.users')}</h2>
                  <p className="text-xs text-slate-400 mt-1">{users.length} {t('admin.stats.users')}</p>
                </div>
                <button
                  onClick={() => setShowCreateUser(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  {t('admin.createUser')}
                </button>
              </div>

              {isLoading ? (
                <div className="p-8 text-center">
                  <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin mx-auto"></div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider border-b border-slate-100 bg-slate-50">
                        <th className="px-5 py-3">{t('admin.table.user')}</th>
                        <th className="px-5 py-3">{t('admin.table.email')}</th>
                        <th className="px-5 py-3">{t('admin.table.role')}</th>
                        <th className="px-5 py-3">{t('admin.table.created')}</th>
                        <th className="px-5 py-3">{t('admin.table.lastLogin')}</th>
                        <th className="px-5 py-3 text-right">{t('admin.table.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {users.map(u => (
                        <tr key={u.id} className={`hover:bg-slate-50 transition-colors ${u.id === currentUser?.id ? 'bg-slate-50/60' : ''}`}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="relative">
                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-medium text-slate-700">
                                  {u.username.charAt(0).toUpperCase()}
                                </div>
                                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2" style={{ borderColor: 'var(--bg-card)', background: u.online ? '#22c55e' : '#94a3b8' }} />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-slate-900">{u.username}</p>
                                {u.id === currentUser?.id && (
                                  <span className="text-xs text-slate-500">{t('admin.you')}</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-600">{u.email}</td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${
                              u.role === 'admin'
                                ? 'bg-slate-900 text-white'
                                : 'bg-slate-100 text-slate-600'
                            }`}>
                              {u.role === 'admin' && <Shield className="w-3 h-3" />}
                              {u.role === 'admin' ? t('settings.roleAdmin') : t('settings.roleUser')}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-500">
                            {new Date(u.created_at).toLocaleDateString(locale)}
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-500">
                            {u.last_login ? new Date(u.last_login).toLocaleDateString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12 }) : '—'}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={() => handleEditUser(u)}
                                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                                title={t('admin.editUser')}
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteUser(u)}
                                disabled={u.id === currentUser?.id}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                title={t('admin.deleteUserTitle')}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'categories' && <CategoryManager />}

          {activeTab === 'addons' && <AddonManager />}

          {activeTab === 'settings' && (
            <div className="space-y-6">
              {/* Registration Toggle */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-900">{t('admin.allowRegistration')}</h2>
                </div>
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{t('admin.allowRegistration')}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{t('admin.allowRegistrationHint')}</p>
                    </div>
                    <button
                      onClick={() => handleToggleRegistration(!allowRegistration)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        allowRegistration ? 'bg-slate-900' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          allowRegistration ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* API Keys */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-900">{t('admin.apiKeys')}</h2>
                  <p className="text-xs text-slate-400 mt-1">{t('admin.apiKeysHint')}</p>
                </div>
                <div className="p-6 space-y-4">
                  {/* Google Maps Key */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-1.5">
                      {t('admin.mapsKey')}
                      <span style={{ fontSize: 10, fontWeight: 500, padding: '1px 7px', borderRadius: 99, background: '#dbeafe', color: '#1d4ed8' }}>{t('admin.recommended')}</span>
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showKeys.maps ? 'text' : 'password'}
                          value={mapsKey}
                          onChange={e => setMapsKey(e.target.value)}
                          placeholder={t('settings.keyPlaceholder')}
                          className="w-full pr-10 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
                        />
                        <button
                          type="button"
                          onClick={() => toggleKey('maps')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showKeys.maps ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button
                        onClick={() => handleValidateKey('maps')}
                        disabled={!mapsKey || validating.maps}
                        className="px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        {validating.maps ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : validation.maps === true ? (
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                        ) : validation.maps === false ? (
                          <XCircle className="w-4 h-4 text-red-500" />
                        ) : null}
                        {t('admin.validateKey')}
                      </button>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{t('admin.mapsKeyHintLong')}</p>
                    {validation.maps === true && (
                      <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full inline-block"></span>
                        {t('admin.keyValid')}
                      </p>
                    )}
                    {validation.maps === false && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <span className="w-2 h-2 bg-red-500 rounded-full inline-block"></span>
                        {t('admin.keyInvalid')}
                      </p>
                    )}
                  </div>

                  {/* OpenWeatherMap Key */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('admin.weatherKey')}</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showKeys.weather ? 'text' : 'password'}
                          value={weatherKey}
                          onChange={e => setWeatherKey(e.target.value)}
                          placeholder={t('settings.keyPlaceholder')}
                          className="w-full pr-10 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
                        />
                        <button
                          type="button"
                          onClick={() => toggleKey('weather')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showKeys.weather ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button
                        onClick={() => handleValidateKey('weather')}
                        disabled={!weatherKey || validating.weather}
                        className="px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        {validating.weather ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : validation.weather === true ? (
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                        ) : validation.weather === false ? (
                          <XCircle className="w-4 h-4 text-red-500" />
                        ) : null}
                        {t('admin.validateKey')}
                      </button>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{t('admin.weatherKeyHint')}</p>
                    {validation.weather === true && (
                      <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full inline-block"></span>
                        {t('admin.keyValid')}
                      </p>
                    )}
                    {validation.weather === false && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <span className="w-2 h-2 bg-red-500 rounded-full inline-block"></span>
                        {t('admin.keyInvalid')}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={handleSaveApiKeys}
                    disabled={savingKeys}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 disabled:bg-slate-400"
                  >
                    {savingKeys ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                    {t('common.save')}
                  </button>
                </div>
              </div>

              {/* OIDC / SSO Configuration */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-900">{t('admin.oidcTitle')}</h2>
                  <p className="text-xs text-slate-400 mt-1">{t('admin.oidcSubtitle')}</p>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('admin.oidcDisplayName')}</label>
                    <input
                      type="text"
                      value={oidcConfig.display_name}
                      onChange={e => setOidcConfig(c => ({ ...c, display_name: e.target.value }))}
                      placeholder='z.B. Google, Authentik, Keycloak'
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('admin.oidcIssuer')}</label>
                    <input
                      type="url"
                      value={oidcConfig.issuer}
                      onChange={e => setOidcConfig(c => ({ ...c, issuer: e.target.value }))}
                      placeholder='https://accounts.google.com'
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">{t('admin.oidcIssuerHint')}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Client ID</label>
                    <input
                      type="text"
                      value={oidcConfig.client_id}
                      onChange={e => setOidcConfig(c => ({ ...c, client_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Client Secret</label>
                    <input
                      type="password"
                      value={oidcConfig.client_secret}
                      onChange={e => setOidcConfig(c => ({ ...c, client_secret: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
                    />
                  </div>
                  <button
                    onClick={async () => {
                      setSavingOidc(true)
                      try {
                        await adminApi.updateOidc(oidcConfig)
                        toast.success(t('admin.oidcSaved'))
                      } catch (err) {
                        toast.error(err.response?.data?.error || t('common.error'))
                      } finally {
                        setSavingOidc(false)
                      }
                    }}
                    disabled={savingOidc}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 disabled:bg-slate-400"
                  >
                    {savingOidc ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                    {t('common.save')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'backup' && <BackupPanel />}
        </div>
      </div>

      {/* Create user modal */}
      <Modal
        isOpen={showCreateUser}
        onClose={() => setShowCreateUser(false)}
        title={t('admin.createUser')}
        size="sm"
        footer={
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowCreateUser(false)}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleCreateUser}
              className="px-4 py-2 text-sm bg-slate-900 hover:bg-slate-700 text-white rounded-lg"
            >
              {t('admin.createUser')}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('settings.username')} *</label>
            <input
              type="text"
              value={createForm.username}
              onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))}
              placeholder={t('settings.username')}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-slate-400 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.email')} *</label>
            <input
              type="email"
              value={createForm.email}
              onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
              placeholder={t('common.email')}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-slate-400 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.password')} *</label>
            <input
              type="password"
              value={createForm.password}
              onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
              placeholder={t('common.password')}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-slate-400 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('settings.role')}</label>
            <CustomSelect
              value={createForm.role}
              onChange={value => setCreateForm(f => ({ ...f, role: value }))}
              options={[
                { value: 'user', label: t('settings.roleUser') },
                { value: 'admin', label: t('settings.roleAdmin') },
              ]}
            />
          </div>
        </div>
      </Modal>

      {/* Edit user modal */}
      <Modal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={t('admin.editUser')}
        size="sm"
        footer={
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setEditingUser(null)}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSaveUser}
              className="px-4 py-2 text-sm bg-slate-900 hover:bg-slate-700 text-white rounded-lg"
            >
              {t('common.save')}
            </button>
          </div>
        }
      >
        {editingUser && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('settings.username')}</label>
              <input
                type="text"
                value={editForm.username}
                onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-slate-400 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.email')}</label>
              <input
                type="email"
                value={editForm.email}
                onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-slate-400 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('admin.newPassword')} <span className="text-slate-400 font-normal">({t('admin.newPasswordHint')})</span></label>
              <input
                type="password"
                value={editForm.password}
                onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
                placeholder={t('admin.newPasswordPlaceholder')}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-slate-400 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('settings.role')}</label>
              <CustomSelect
                value={editForm.role}
                onChange={value => setEditForm(f => ({ ...f, role: value }))}
                options={[
                  { value: 'user', label: t('settings.roleUser') },
                  { value: 'admin', label: t('settings.roleAdmin') },
                ]}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
