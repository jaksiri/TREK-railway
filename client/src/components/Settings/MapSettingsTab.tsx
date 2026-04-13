import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Map, Save } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSettingsStore } from '../../store/settingsStore'
import { useToast } from '../shared/Toast'
import CustomSelect from '../shared/CustomSelect'
import { MapView } from '../Map/MapView'
import Section from './Section'
import type { Place } from '../../types'

interface MapPreset {
  name: string
  url: string
}

const MAP_PRESETS: MapPreset[] = [
  { name: 'OpenStreetMap', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
  { name: 'OpenStreetMap DE', url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png' },
  { name: 'CartoDB Light', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' },
  { name: 'CartoDB Dark', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' },
  { name: 'Stadia Smooth', url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png' },
]

export default function MapSettingsTab(): React.ReactElement {
  const { settings, updateSettings } = useSettingsStore()
  const { t } = useTranslation()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [mapTileUrl, setMapTileUrl] = useState<string>(settings.map_tile_url || '')
  const [defaultLat, setDefaultLat] = useState<number | string>(settings.default_lat || 48.8566)
  const [defaultLng, setDefaultLng] = useState<number | string>(settings.default_lng || 2.3522)
  const [defaultZoom, setDefaultZoom] = useState<number | string>(settings.default_zoom || 10)

  useEffect(() => {
    setMapTileUrl(settings.map_tile_url || '')
    setDefaultLat(settings.default_lat || 48.8566)
    setDefaultLng(settings.default_lng || 2.3522)
    setDefaultZoom(settings.default_zoom || 10)
  }, [settings])

  const handleMapClick = useCallback((mapInfo) => {
    setDefaultLat(mapInfo.latlng.lat)
    setDefaultLng(mapInfo.latlng.lng)
  }, [])

  const mapPlaces = useMemo((): Place[] => [{
    id: 1,
    trip_id: 1,
    name: 'Default map center',
    description: '',
    lat: defaultLat as number,
    lng: defaultLng as number,
    address: '',
    category_id: 0,
    icon: null,
    price: null,
    image_url: null,
    google_place_id: null,
    osm_id: null,
    route_geometry: null,
    place_time: null,
    end_time: null,
    created_at: Date(),
  }], [defaultLat, defaultLng])

  const saveMapSettings = async (): Promise<void> => {
    setSaving(true)
    try {
      await updateSettings({
        map_tile_url: mapTileUrl,
        default_lat: parseFloat(String(defaultLat)),
        default_lng: parseFloat(String(defaultLng)),
        default_zoom: parseInt(String(defaultZoom)),
      })
      toast.success(t('settings.toast.mapSaved'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title={t('settings.map')} icon={Map}>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('settings.mapTemplate')}</label>
        <CustomSelect
          value={mapTileUrl}
          onChange={(value: string) => { if (value) setMapTileUrl(value) }}
          placeholder={t('settings.mapTemplatePlaceholder.select')}
          options={MAP_PRESETS.map(p => ({ value: p.url, label: p.name }))}
          size="sm"
          style={{ marginBottom: 8 }}
        />
        <input
          type="text"
          value={mapTileUrl}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMapTileUrl(e.target.value)}
          placeholder="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
        />
        <p className="text-xs text-slate-400 mt-1">{t('settings.mapDefaultHint')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('settings.latitude')}</label>
          <input
            type="number"
            step="any"
            value={defaultLat}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDefaultLat(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('settings.longitude')}</label>
          <input
            type="number"
            step="any"
            value={defaultLng}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDefaultLng(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
          />
        </div>
      </div>

      <div>
        <div style={{ position: 'relative', inset: 0, height: '200px', width: '100%' }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {React.createElement(MapView as any, {
            places: mapPlaces,
            dayPlaces: [],
            route: null,
            routeSegments: null,
            selectedPlaceId: null,
            onMarkerClick: null,
            onMapClick: handleMapClick,
            onMapContextMenu: null,
            center: [settings.default_lat, settings.default_lng],
            zoom: defaultZoom,
            tileUrl: mapTileUrl,
            fitKey: null,
            dayOrderMap: [],
            leftWidth: 0,
            rightWidth: 0,
            hasInspector: false,
          })}
        </div>
      </div>

      <button
        onClick={saveMapSettings}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 disabled:bg-slate-400"
      >
        {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
        {t('settings.saveMap')}
      </button>
    </Section>
  )
}
