import React, { useState, useEffect, useRef } from 'react'
import { backupApi } from '../../api/client'
import { useToast } from '../shared/Toast'
import { Download, Trash2, Plus, RefreshCw, RotateCcw, Upload, Clock, Check, HardDrive } from 'lucide-react'
import { useTranslation } from '../../i18n'

const INTERVAL_OPTIONS = [
  { value: 'hourly',  labelKey: 'backup.interval.hourly' },
  { value: 'daily',   labelKey: 'backup.interval.daily' },
  { value: 'weekly',  labelKey: 'backup.interval.weekly' },
  { value: 'monthly', labelKey: 'backup.interval.monthly' },
]

const KEEP_OPTIONS = [
  { value: 1,  labelKey: 'backup.keep.1day' },
  { value: 3,  labelKey: 'backup.keep.3days' },
  { value: 7,  labelKey: 'backup.keep.7days' },
  { value: 14, labelKey: 'backup.keep.14days' },
  { value: 30, labelKey: 'backup.keep.30days' },
  { value: 0,  labelKey: 'backup.keep.forever' },
]

export default function BackupPanel() {
  const [backups, setBackups] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [restoringFile, setRestoringFile] = useState(null)
  const [isUploading, setIsUploading] = useState(false)
  const [autoSettings, setAutoSettings] = useState({ enabled: false, interval: 'daily', keep_days: 7 })
  const [autoSettingsSaving, setAutoSettingsSaving] = useState(false)
  const [autoSettingsDirty, setAutoSettingsDirty] = useState(false)
  const fileInputRef = useRef(null)
  const toast = useToast()
  const { t, locale } = useTranslation()

  const loadBackups = async () => {
    setIsLoading(true)
    try {
      const data = await backupApi.list()
      setBackups(data.backups || [])
    } catch {
      toast.error(t('backup.toast.loadError'))
    } finally {
      setIsLoading(false)
    }
  }

  const loadAutoSettings = async () => {
    try {
      const data = await backupApi.getAutoSettings()
      setAutoSettings(data.settings)
    } catch {}
  }

  useEffect(() => { loadBackups(); loadAutoSettings() }, [])

  const handleCreate = async () => {
    setIsCreating(true)
    try {
      await backupApi.create()
      toast.success(t('backup.toast.created'))
      await loadBackups()
    } catch {
      toast.error(t('backup.toast.createError'))
    } finally {
      setIsCreating(false)
    }
  }

  const handleRestore = async (filename) => {
    if (!confirm(t('backup.confirm.restore', { name: filename }))) return
    setRestoringFile(filename)
    try {
      await backupApi.restore(filename)
      toast.success(t('backup.toast.restored'))
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      toast.error(err.response?.data?.error || t('backup.toast.restoreError'))
      setRestoringFile(null)
    }
  }

  const handleUploadRestore = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!confirm(t('backup.confirm.uploadRestore', { name: file.name }))) return
    setIsUploading(true)
    try {
      await backupApi.uploadRestore(file)
      toast.success(t('backup.toast.restored'))
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      toast.error(err.response?.data?.error || t('backup.toast.uploadError'))
      setIsUploading(false)
    }
  }

  const handleDelete = async (filename) => {
    if (!confirm(t('backup.confirm.delete', { name: filename }))) return
    try {
      await backupApi.delete(filename)
      toast.success(t('backup.toast.deleted'))
      setBackups(prev => prev.filter(b => b.filename !== filename))
    } catch {
      toast.error(t('backup.toast.deleteError'))
    }
  }

  const handleAutoSettingsChange = (key, value) => {
    setAutoSettings(prev => ({ ...prev, [key]: value }))
    setAutoSettingsDirty(true)
  }

  const handleSaveAutoSettings = async () => {
    setAutoSettingsSaving(true)
    try {
      const data = await backupApi.setAutoSettings(autoSettings)
      setAutoSettings(data.settings)
      setAutoSettingsDirty(false)
      toast.success(t('backup.toast.settingsSaved'))
    } catch {
      toast.error(t('backup.toast.settingsError'))
    } finally {
      setAutoSettingsSaving(false)
    }
  }

  const formatSize = (bytes) => {
    if (!bytes) return '-'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '-'
    try {
      return new Date(dateStr).toLocaleString(locale, {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return dateStr }
  }

  const isAuto = (filename) => filename.startsWith('auto-backup-')

  return (
    <div className="flex flex-col gap-6">

      {/* Manual Backups */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <HardDrive className="w-5 h-5 text-gray-400" />
            <div>
              <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{t('backup.title')}</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('backup.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadBackups}
              disabled={isLoading}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('backup.refresh')}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            {/* Upload & Restore */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleUploadRestore}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-2 border border-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm font-medium disabled:opacity-60"
              title={isUploading ? t('backup.uploading') : t('backup.upload')}
            >
              {isUploading ? (
                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">{isUploading ? t('backup.uploading') : t('backup.upload')}</span>
            </button>

            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="flex items-center gap-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-3 sm:px-4 py-2 rounded-lg hover:bg-slate-900 text-sm font-medium disabled:opacity-60"
              title={isCreating ? t('backup.creating') : t('backup.create')}
            >
              {isCreating ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">{isCreating ? t('backup.creating') : t('backup.create')}</span>
            </button>
          </div>
        </div>

        {isLoading && backups.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-slate-700 rounded-full animate-spin mr-2" />
            {t('common.loading')}
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <HardDrive className="w-10 h-10 mb-3 mx-auto opacity-40" />
            <p className="text-sm">{t('backup.empty')}</p>
            <button onClick={handleCreate} className="mt-4 text-slate-700 text-sm hover:underline">
              {t('backup.createFirst')}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {backups.map(backup => (
              <div key={backup.filename} className="flex items-center gap-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  {isAuto(backup.filename)
                    ? <RefreshCw className="w-4 h-4 text-blue-500" />
                    : <HardDrive className="w-4 h-4 text-gray-500" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm text-gray-900 truncate">{backup.filename}</p>
                    {isAuto(backup.filename) && (
                      <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 rounded-full px-2 py-0.5 whitespace-nowrap">Auto</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-gray-400">{formatDate(backup.created_at)}</span>
                    <span className="text-xs text-gray-400">{formatSize(backup.size)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => backupApi.download(backup.filename).catch(() => toast.error(t('backup.toast.downloadError')))}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t('backup.download')}
                  </button>
                  <button
                    onClick={() => handleRestore(backup.filename)}
                    disabled={restoringFile === backup.filename}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 disabled:opacity-60"
                  >
                    {restoringFile === backup.filename
                      ? <div className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                      : <RotateCcw className="w-3.5 h-3.5" />
                    }
                    {t('backup.restore')}
                  </button>
                  <button
                    onClick={() => handleDelete(backup.filename)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-Backup Settings */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Clock className="w-5 h-5 text-gray-400" />
          <div>
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{t('backup.auto.title')}</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('backup.auto.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          {/* Enable toggle */}
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div className="min-w-0">
              <span className="text-sm font-medium text-gray-900">{t('backup.auto.enable')}</span>
              <p className="text-xs text-gray-500 mt-0.5">{t('backup.auto.enableHint')}</p>
            </div>
            <button
              onClick={() => handleAutoSettingsChange('enabled', !autoSettings.enabled)}
              className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoSettings.enabled ? 'bg-slate-900 dark:bg-slate-100' : 'bg-gray-200 dark:bg-gray-600'}`}
            >
              <span className={`absolute left-1 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${autoSettings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </label>

          {autoSettings.enabled && (
            <>
              {/* Interval */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('backup.auto.interval')}</label>
                <div className="flex flex-wrap gap-2">
                  {INTERVAL_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleAutoSettingsChange('interval', opt.value)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        autoSettings.interval === opt.value
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-700'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Keep duration */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('backup.auto.keepLabel')}</label>
                <div className="flex flex-wrap gap-2">
                  {KEEP_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleAutoSettingsChange('keep_days', opt.value)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        autoSettings.keep_days === opt.value
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-700'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Save button */}
          <div className="flex justify-end pt-2 border-t border-gray-100">
            <button
              onClick={handleSaveAutoSettings}
              disabled={autoSettingsSaving || !autoSettingsDirty}
              className="flex items-center gap-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-5 py-2 rounded-lg hover:bg-slate-900 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {autoSettingsSaving
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Check className="w-4 h-4" />
              }
              {autoSettingsSaving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
