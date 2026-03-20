import React, { useState, useEffect } from 'react'
import Modal from '../shared/Modal'
import CustomSelect from '../shared/CustomSelect'
import { mapsApi } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import { useToast } from '../shared/Toast'
import { Search } from 'lucide-react'
import { useTranslation } from '../../i18n'
import CustomTimePicker from '../shared/CustomTimePicker'
import { CustomDateTimePicker } from '../shared/CustomDateTimePicker'

const TRANSPORT_MODES = [
  { value: 'walking', labelKey: 'places.transport.walking' },
  { value: 'driving', labelKey: 'places.transport.driving' },
  { value: 'cycling', labelKey: 'places.transport.cycling' },
  { value: 'transit', labelKey: 'places.transport.transit' },
]

const DEFAULT_FORM = {
  name: '',
  description: '',
  address: '',
  lat: '',
  lng: '',
  category_id: '',
  place_time: '',
  notes: '',
  transport_mode: 'walking',
  reservation_status: 'none',
  reservation_notes: '',
  reservation_datetime: '',
  website: '',
}

export default function PlaceFormModal({
  isOpen, onClose, onSave, place, tripId, categories,
  onCategoryCreated,
}) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [mapsSearch, setMapsSearch] = useState('')
  const [mapsResults, setMapsResults] = useState([])
  const [isSearchingMaps, setIsSearchingMaps] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const toast = useToast()
  const { t, language } = useTranslation()
  const { hasMapsKey } = useAuthStore()

  useEffect(() => {
    if (place) {
      setForm({
        name: place.name || '',
        description: place.description || '',
        address: place.address || '',
        lat: place.lat || '',
        lng: place.lng || '',
        category_id: place.category_id || '',
        place_time: place.place_time || '',
        notes: place.notes || '',
        transport_mode: place.transport_mode || 'walking',
        reservation_status: place.reservation_status || 'none',
        reservation_notes: place.reservation_notes || '',
        reservation_datetime: place.reservation_datetime || '',
        website: place.website || '',
      })
    } else {
      setForm(DEFAULT_FORM)
    }
  }, [place, isOpen])

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleMapsSearch = async () => {
    if (!mapsSearch.trim()) return
    setIsSearchingMaps(true)
    try {
      const result = await mapsApi.search(mapsSearch, language)
      setMapsResults(result.places || [])
    } catch (err) {
      toast.error(t('places.mapsSearchError'))
    } finally {
      setIsSearchingMaps(false)
    }
  }

  const handleSelectMapsResult = (result) => {
    setForm(prev => ({
      ...prev,
      name: result.name || prev.name,
      address: result.address || prev.address,
      lat: result.lat || prev.lat,
      lng: result.lng || prev.lng,
      google_place_id: result.google_place_id || prev.google_place_id,
    }))
    setMapsResults([])
    setMapsSearch('')
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return
    try {
      const cat = await onCategoryCreated?.({ name: newCategoryName, color: '#6366f1', icon: 'MapPin' })
      if (cat) setForm(prev => ({ ...prev, category_id: cat.id }))
      setNewCategoryName('')
      setShowNewCategory(false)
    } catch (err) {
      toast.error(t('places.categoryCreateError'))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error(t('places.nameRequired'))
      return
    }
    setIsSaving(true)
    try {
      await onSave({
        ...form,
        lat: form.lat ? parseFloat(form.lat) : null,
        lng: form.lng ? parseFloat(form.lng) : null,
        category_id: form.category_id || null,
      })
      onClose()
    } catch (err) {
      toast.error(err.message || t('places.saveError'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={place ? t('places.editPlace') : t('places.addPlace')}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Place Search */}
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
          {!hasMapsKey && (
            <p className="mb-2 text-xs" style={{ color: 'var(--text-faint)' }}>
              {t('places.osmActive')}
            </p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={mapsSearch}
              onChange={e => setMapsSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleMapsSearch())}
              placeholder={t('places.mapsSearchPlaceholder')}
              className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
            />
            <button
              type="button"
              onClick={handleMapsSearch}
              disabled={isSearchingMaps}
              className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-slate-700 disabled:opacity-60"
            >
              {isSearchingMaps ? '...' : <Search className="w-4 h-4" />}
            </button>
          </div>
          {mapsResults.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden max-h-40 overflow-y-auto mt-2">
              {mapsResults.map((result, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectMapsResult(result)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                >
                  <div className="font-medium text-sm">{result.name}</div>
                  <div className="text-xs text-slate-500 truncate">{result.address}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formName')} *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => handleChange('name', e.target.value)}
            required
            placeholder={t('places.formNamePlaceholder')}
            className="form-input"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formDescription')}</label>
          <textarea
            value={form.description}
            onChange={e => handleChange('description', e.target.value)}
            rows={2}
            placeholder={t('places.formDescriptionPlaceholder')}
            className="form-input" style={{ resize: 'none' }}
          />
        </div>

        {/* Address + Coordinates */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formAddress')}</label>
          <input
            type="text"
            value={form.address}
            onChange={e => handleChange('address', e.target.value)}
            placeholder={t('places.formAddressPlaceholder')}
            className="form-input"
          />
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input
              type="number"
              step="any"
              value={form.lat}
              onChange={e => handleChange('lat', e.target.value)}
              placeholder={t('places.formLat')}
              className="form-input"
            />
            <input
              type="number"
              step="any"
              value={form.lng}
              onChange={e => handleChange('lng', e.target.value)}
              placeholder={t('places.formLng')}
              className="form-input"
            />
          </div>
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formCategory')}</label>
          {!showNewCategory ? (
            <div className="flex gap-2">
              <CustomSelect
                value={form.category_id}
                onChange={value => handleChange('category_id', value)}
                placeholder={t('places.noCategory')}
                options={[
                  { value: '', label: t('places.noCategory') },
                  ...(categories || []).map(c => ({
                    value: c.id,
                    label: c.name,
                  })),
                ]}
                style={{ flex: 1 }}
                size="sm"
              />
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                placeholder={t('places.categoryNamePlaceholder')}
                className="form-input" style={{ flex: 1 }}
              />
              <button type="button" onClick={handleCreateCategory} className="bg-slate-900 text-white px-3 rounded-lg hover:bg-slate-700 text-sm">
                OK
              </button>
              <button type="button" onClick={() => setShowNewCategory(false)} className="text-gray-500 px-2 text-sm">
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>

        {/* Time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formTime')}</label>
          <CustomTimePicker
            value={form.place_time}
            onChange={v => handleChange('place_time', v)}
          />
        </div>

        {/* Website */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formWebsite')}</label>
          <input
            type="url"
            value={form.website}
            onChange={e => handleChange('website', e.target.value)}
            placeholder="https://..."
            className="form-input"
          />
        </div>

        {/* Reservation */}
        <div className="border border-gray-200 rounded-xl p-3 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <label className="block text-sm font-medium text-gray-700 shrink-0">{t('places.formReservation')}</label>
            <div className="flex gap-2 flex-wrap">
              {['none', 'pending', 'confirmed'].map(status => (
                <button
                  key={status}
                  type="button"
                  onClick={() => handleChange('reservation_status', status)}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                    form.reservation_status === status
                      ? status === 'confirmed' ? 'bg-emerald-600 text-white'
                        : status === 'pending' ? 'bg-yellow-500 text-white'
                        : 'bg-gray-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {status === 'none' ? t('common.none') : status === 'pending' ? t('reservations.pending') : t('reservations.confirmed')}
                </button>
              ))}
            </div>
          </div>
          {form.reservation_status !== 'none' && (
            <>
              <CustomDateTimePicker
                value={form.reservation_datetime}
                onChange={v => handleChange('reservation_datetime', v)}
              />
              <textarea
                value={form.reservation_notes}
                onChange={e => handleChange('reservation_notes', e.target.value)}
                rows={2}
                placeholder={t('places.reservationNotesPlaceholder')}
                className="form-input" style={{ resize: 'none' }}
              />
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-700 disabled:opacity-60 font-medium"
          >
            {isSaving ? t('common.saving') : place ? t('common.update') : t('common.add')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
