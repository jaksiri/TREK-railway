import React, { useEffect, useState } from 'react'
import { adminApi } from '../../api/client'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { Puzzle, ListChecks, Wallet, FileText, CalendarDays, Globe, Briefcase } from 'lucide-react'

const ICON_MAP = {
  ListChecks, Wallet, FileText, CalendarDays, Puzzle, Globe, Briefcase,
}

function AddonIcon({ name, size = 20 }) {
  const Icon = ICON_MAP[name] || Puzzle
  return <Icon size={size} />
}

export default function AddonManager() {
  const { t } = useTranslation()
  const toast = useToast()
  const [addons, setAddons] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAddons()
  }, [])

  const loadAddons = async () => {
    setLoading(true)
    try {
      const data = await adminApi.addons()
      setAddons(data.addons)
    } catch (err) {
      toast.error(t('admin.addons.toast.error'))
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = async (addon) => {
    const newEnabled = !addon.enabled
    // Optimistic update
    setAddons(prev => prev.map(a => a.id === addon.id ? { ...a, enabled: newEnabled } : a))
    try {
      await adminApi.updateAddon(addon.id, { enabled: newEnabled })
      window.dispatchEvent(new Event('addons-changed'))
      toast.success(t('admin.addons.toast.updated'))
    } catch (err) {
      // Rollback
      setAddons(prev => prev.map(a => a.id === addon.id ? { ...a, enabled: !newEnabled } : a))
      toast.error(t('admin.addons.toast.error'))
    }
  }

  const tripAddons = addons.filter(a => a.type === 'trip')
  const globalAddons = addons.filter(a => a.type === 'global')

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin mx-auto" style={{ borderTopColor: 'var(--text-primary)' }}></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border-secondary)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{t('admin.addons.title')}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('admin.addons.subtitle')}</p>
        </div>

        {addons.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
            {t('admin.addons.noAddons')}
          </div>
        ) : (
          <div>
            {/* Trip Addons */}
            {tripAddons.length > 0 && (
              <div>
                <div className="px-6 py-2.5 border-b flex items-center gap-2" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-secondary)' }}>
                  <Briefcase size={13} style={{ color: 'var(--text-muted)' }} />
                  <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {t('admin.addons.type.trip')} — {t('admin.addons.tripHint')}
                  </span>
                </div>
                {tripAddons.map(addon => (
                  <AddonRow key={addon.id} addon={addon} onToggle={handleToggle} t={t} />
                ))}
              </div>
            )}

            {/* Global Addons */}
            {globalAddons.length > 0 && (
              <div>
                <div className="px-6 py-2.5 border-b border-t flex items-center gap-2" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-secondary)' }}>
                  <Globe size={13} style={{ color: 'var(--text-muted)' }} />
                  <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {t('admin.addons.type.global')} — {t('admin.addons.globalHint')}
                  </span>
                </div>
                {globalAddons.map(addon => (
                  <AddonRow key={addon.id} addon={addon} onToggle={handleToggle} t={t} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AddonRow({ addon, onToggle, t }) {
  return (
    <div className="flex items-center gap-4 px-6 py-4 border-b transition-colors hover:opacity-95" style={{ borderColor: 'var(--border-secondary)' }}>
      {/* Icon */}
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
        <AddonIcon name={addon.icon} size={20} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{addon.name}</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{
            background: addon.type === 'global' ? 'var(--bg-secondary)' : 'var(--bg-secondary)',
            color: 'var(--text-muted)',
          }}>
            {addon.type === 'global' ? t('admin.addons.type.global') : t('admin.addons.type.trip')}
          </span>
        </div>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{addon.description}</p>
      </div>

      {/* Toggle */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-medium" style={{ color: addon.enabled ? 'var(--text-primary)' : 'var(--text-faint)' }}>
          {addon.enabled ? t('admin.addons.enabled') : t('admin.addons.disabled')}
        </span>
        <button
          onClick={() => onToggle(addon)}
          className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
          style={{ background: addon.enabled ? 'var(--text-primary)' : 'var(--border-primary)' }}
        >
          <span
            className="inline-block h-4 w-4 transform rounded-full transition-transform"
            style={{
              background: addon.enabled ? 'var(--bg-card)' : 'var(--bg-card)',
              transform: addon.enabled ? 'translateX(22px)' : 'translateX(4px)',
            }}
          />
        </button>
      </div>
    </div>
  )
}
