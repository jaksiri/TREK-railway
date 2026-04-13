import React, { useState, useEffect } from 'react'
import { Palette, Sun, Moon, Monitor } from 'lucide-react'
import { SUPPORTED_LANGUAGES, useTranslation } from '../../i18n'
import { useSettingsStore } from '../../store/settingsStore'
import { useToast } from '../shared/Toast'
import Section from './Section'

export default function DisplaySettingsTab(): React.ReactElement {
  const { settings, updateSetting } = useSettingsStore()
  const { t } = useTranslation()
  const toast = useToast()
  const [tempUnit, setTempUnit] = useState<string>(settings.temperature_unit || 'celsius')

  useEffect(() => {
    setTempUnit(settings.temperature_unit || 'celsius')
  }, [settings.temperature_unit])

  return (
    <Section title={t('settings.display')} icon={Palette}>
      {/* Color Mode */}
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{t('settings.colorMode')}</label>
        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
          {[
            { value: 'light', label: t('settings.light'), icon: Sun },
            { value: 'dark', label: t('settings.dark'), icon: Moon },
            { value: 'auto', label: t('settings.auto'), icon: Monitor },
          ].map(opt => {
            const current = settings.dark_mode
            const isActive = current === opt.value || (opt.value === 'light' && current === false) || (opt.value === 'dark' && current === true)
            return (
              <button
                key={opt.value}
                onClick={async () => {
                  try {
                    await updateSetting('dark_mode', opt.value)
                  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 14px', borderRadius: 10, cursor: 'pointer', flex: '1 1 0', justifyContent: 'center', minWidth: 0,
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                  border: isActive ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)',
                  background: isActive ? 'var(--bg-hover)' : 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  transition: 'all 0.15s',
                }}
              >
                <opt.icon size={16} />
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Language */}
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{t('settings.language')}</label>
        <div className="flex flex-wrap gap-3">
          {SUPPORTED_LANGUAGES.map(opt => (
            <button
              key={opt.value}
              onClick={async () => {
                try { await updateSetting('language', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 10, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                border: settings.language === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)',
                background: settings.language === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)',
                color: 'var(--text-primary)',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Temperature */}
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{t('settings.temperature')}</label>
        <div className="flex gap-3">
          {[
            { value: 'celsius', label: '°C Celsius' },
            { value: 'fahrenheit', label: '°F Fahrenheit' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={async () => {
                setTempUnit(opt.value)
                try { await updateSetting('temperature_unit', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 10, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                border: tempUnit === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)',
                background: tempUnit === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)',
                color: 'var(--text-primary)',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Time Format */}
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{t('settings.timeFormat')}</label>
        <div className="flex gap-3">
          {[
            { value: '24h', label: '24h (14:30)' },
            { value: '12h', label: '12h (2:30 PM)' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={async () => {
                try { await updateSetting('time_format', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 10, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                border: settings.time_format === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)',
                background: settings.time_format === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)',
                color: 'var(--text-primary)',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Route Calculation */}
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{t('settings.routeCalculation')}</label>
        <div className="flex gap-3">
          {[
            { value: true, label: t('settings.on') || 'On' },
            { value: false, label: t('settings.off') || 'Off' },
          ].map(opt => (
            <button
              key={String(opt.value)}
              onClick={async () => {
                try { await updateSetting('route_calculation', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 10, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                border: (settings.route_calculation !== false) === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)',
                background: (settings.route_calculation !== false) === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)',
                color: 'var(--text-primary)',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Blur Booking Codes */}
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{t('settings.blurBookingCodes')}</label>
        <div className="flex gap-3">
          {[
            { value: true, label: t('settings.on') || 'On' },
            { value: false, label: t('settings.off') || 'Off' },
          ].map(opt => (
            <button
              key={String(opt.value)}
              onClick={async () => {
                try { await updateSetting('blur_booking_codes', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 10, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                border: (!!settings.blur_booking_codes) === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)',
                background: (!!settings.blur_booking_codes) === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)',
                color: 'var(--text-primary)',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </Section>
  )
}
