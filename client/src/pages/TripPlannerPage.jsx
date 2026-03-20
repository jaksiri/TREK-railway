import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { useTripStore } from '../store/tripStore'
import { useSettingsStore } from '../store/settingsStore'
import { MapView } from '../components/Map/MapView'
import DayPlanSidebar from '../components/Planner/DayPlanSidebar'
import PlacesSidebar from '../components/Planner/PlacesSidebar'
import PlaceInspector from '../components/Planner/PlaceInspector'
import PlaceFormModal from '../components/Planner/PlaceFormModal'
import TripFormModal from '../components/Trips/TripFormModal'
import TripMembersModal from '../components/Trips/TripMembersModal'
import { ReservationModal } from '../components/Planner/ReservationModal'
import ReservationsPanel from '../components/Planner/ReservationsPanel'
import PackingListPanel from '../components/Packing/PackingListPanel'
import FileManager from '../components/Files/FileManager'
import BudgetPanel from '../components/Budget/BudgetPanel'
import Navbar from '../components/Layout/Navbar'
import { useToast } from '../components/shared/Toast'
import { Map, X, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useTranslation } from '../i18n'
import { joinTrip, leaveTrip, addListener, removeListener } from '../api/websocket'
import { addonsApi } from '../api/client'

const MIN_SIDEBAR = 200
const MAX_SIDEBAR = 520

export default function TripPlannerPage() {
  const { id: tripId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useTranslation()
  const { settings } = useSettingsStore()
  const tripStore = useTripStore()
  const { trip, days, places, assignments, packingItems, categories, reservations, budgetItems, files, selectedDayId, isLoading } = tripStore

  const [enabledAddons, setEnabledAddons] = useState({ packing: true, budget: true, documents: true })

  useEffect(() => {
    addonsApi.enabled().then(data => {
      const map = {}
      data.addons.forEach(a => { map[a.id] = true })
      setEnabledAddons({ packing: !!map.packing, budget: !!map.budget, documents: !!map.documents })
    }).catch(() => {})
  }, [])

  const TRIP_TABS = [
    { id: 'plan', label: t('trip.tabs.plan') },
    { id: 'buchungen', label: t('trip.tabs.reservations'), shortLabel: t('trip.tabs.reservationsShort') },
    ...(enabledAddons.packing ? [{ id: 'packliste', label: t('trip.tabs.packing'), shortLabel: t('trip.tabs.packingShort') }] : []),
    ...(enabledAddons.budget ? [{ id: 'finanzplan', label: t('trip.tabs.budget') }] : []),
    ...(enabledAddons.documents ? [{ id: 'dateien', label: t('trip.tabs.files') }] : []),
  ]

  const [activeTab, setActiveTab] = useState('plan')

  const handleTabChange = (tabId) => {
    setActiveTab(tabId)
    if (tabId === 'finanzplan') tripStore.loadBudgetItems?.(tripId)
    if (tabId === 'dateien' && (!files || files.length === 0)) tripStore.loadFiles?.(tripId)
  }
  const [leftWidth, setLeftWidth] = useState(() => parseInt(localStorage.getItem('sidebarLeftWidth')) || 340)
  const [rightWidth, setRightWidth] = useState(() => parseInt(localStorage.getItem('sidebarRightWidth')) || 300)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const isResizingLeft = useRef(false)
  const isResizingRight = useRef(false)

  const [selectedPlaceId, setSelectedPlaceId] = useState(null)
  const [showPlaceForm, setShowPlaceForm] = useState(false)
  const [editingPlace, setEditingPlace] = useState(null)
  const [showTripForm, setShowTripForm] = useState(false)
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [showReservationModal, setShowReservationModal] = useState(false)
  const [editingReservation, setEditingReservation] = useState(null)
  const [route, setRoute] = useState(null)
  const [routeInfo, setRouteInfo] = useState(null)
  const [fitKey, setFitKey] = useState(0)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(null) // 'left' | 'right' | null

  // Load trip + files (needed for place inspector file section)
  useEffect(() => {
    if (tripId) {
      tripStore.loadTrip(tripId).catch(() => { toast.error(t('trip.toast.loadError')); navigate('/dashboard') })
      tripStore.loadFiles(tripId)
    }
  }, [tripId])

  useEffect(() => {
    if (tripId) tripStore.loadReservations(tripId)
  }, [tripId])

  // WebSocket: join trip and listen for remote events
  useEffect(() => {
    if (!tripId) return
    const handler = useTripStore.getState().handleRemoteEvent
    joinTrip(tripId)
    addListener(handler)
    return () => {
      leaveTrip(tripId)
      removeListener(handler)
    }
  }, [tripId])

  useEffect(() => {
    const onMove = (e) => {
      if (isResizingLeft.current) {
        const w = Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, e.clientX - 10))
        setLeftWidth(w)
        localStorage.setItem('sidebarLeftWidth', w)
      }
      if (isResizingRight.current) {
        const w = Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, window.innerWidth - e.clientX - 10))
        setRightWidth(w)
        localStorage.setItem('sidebarRightWidth', w)
      }
    }
    const onUp = () => {
      isResizingLeft.current = false
      isResizingRight.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const mapPlaces = useCallback(() => {
    return places.filter(p => p.lat && p.lng)
  }, [places])

  const handleSelectDay = useCallback((dayId) => {
    tripStore.setSelectedDay(dayId)
    setRouteInfo(null)
    setFitKey(k => k + 1)
    setMobileSidebarOpen(null)

    // Auto-show Luftlinien for the selected day
    const da = (tripStore.assignments[String(dayId)] || []).slice().sort((a, b) => a.order_index - b.order_index)
    const waypoints = da.map(a => a.place).filter(p => p?.lat && p?.lng)
    if (waypoints.length >= 2) {
      setRoute(waypoints.map(p => [p.lat, p.lng]))
    } else {
      setRoute(null)
    }
  }, [tripStore])

  const handlePlaceClick = useCallback((placeId) => {
    setSelectedPlaceId(placeId)
    if (placeId) { setLeftCollapsed(false); setRightCollapsed(false) }
  }, [])

  const handleMarkerClick = useCallback((placeId) => {
    const opening = placeId !== undefined
    setSelectedPlaceId(prev => prev === placeId ? null : placeId)
    if (opening) { setLeftCollapsed(false); setRightCollapsed(false) }
  }, [])

  const handleMapClick = useCallback(() => {
    setSelectedPlaceId(null)
  }, [])

  const handleSavePlace = useCallback(async (data) => {
    if (editingPlace) {
      await tripStore.updatePlace(tripId, editingPlace.id, data)
      toast.success(t('trip.toast.placeUpdated'))
    } else {
      await tripStore.addPlace(tripId, data)
      toast.success(t('trip.toast.placeAdded'))
    }
  }, [editingPlace, tripId, tripStore, toast])

  const handleDeletePlace = useCallback(async (placeId) => {
    if (!confirm(t('trip.confirm.deletePlace'))) return
    try {
      await tripStore.deletePlace(tripId, placeId)
      if (selectedPlaceId === placeId) setSelectedPlaceId(null)
      toast.success(t('trip.toast.placeDeleted'))
    } catch (err) { toast.error(err.message) }
  }, [tripId, tripStore, toast, selectedPlaceId])

  const handleAssignToDay = useCallback(async (placeId, dayId, position) => {
    const target = dayId || selectedDayId
    if (!target) { toast.error(t('trip.toast.selectDay')); return }
    try {
      await tripStore.assignPlaceToDay(tripId, target, placeId, position)
      toast.success(t('trip.toast.assignedToDay'))
    } catch (err) { toast.error(err.message) }
  }, [selectedDayId, tripId, tripStore, toast])

  const handleRemoveAssignment = useCallback(async (dayId, assignmentId) => {
    try { await tripStore.removeAssignment(tripId, dayId, assignmentId) }
    catch (err) { toast.error(err.message) }
  }, [tripId, tripStore, toast])

  const handleReorder = useCallback(async (dayId, orderedIds) => {
    try { await tripStore.reorderAssignments(tripId, dayId, orderedIds) }
    catch { toast.error(t('trip.toast.reorderError')) }
  }, [tripId, tripStore, toast])

  const handleUpdateDayTitle = useCallback(async (dayId, title) => {
    try { await tripStore.updateDayTitle(tripId, dayId, title) }
    catch (err) { toast.error(err.message) }
  }, [tripId, tripStore, toast])

  const handleSaveReservation = async (data) => {
    try {
      if (editingReservation) {
        const r = await tripStore.updateReservation(tripId, editingReservation.id, data)
        toast.success(t('trip.toast.reservationUpdated'))
        setShowReservationModal(false)
        return r
      } else {
        const r = await tripStore.addReservation(tripId, { ...data, day_id: selectedDayId || null })
        toast.success(t('trip.toast.reservationAdded'))
        setShowReservationModal(false)
        return r
      }
    } catch (err) { toast.error(err.message) }
  }

  const handleDeleteReservation = async (id) => {
    try { await tripStore.deleteReservation(tripId, id); toast.success(t('trip.toast.deleted')) }
    catch (err) { toast.error(err.message) }
  }

  const selectedPlace = selectedPlaceId ? places.find(p => p.id === selectedPlaceId) : null

  // Build placeId → order-number map from the selected day's assignments
  const dayOrderMap = useMemo(() => {
    if (!selectedDayId) return {}
    const da = assignments[String(selectedDayId)] || []
    const sorted = [...da].sort((a, b) => a.order_index - b.order_index)
    const map = {}
    sorted.forEach((a, i) => { if (a.place?.id) map[a.place.id] = i + 1 })
    return map
  }, [selectedDayId, assignments])

  const mapTileUrl = settings.map_tile_url || 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
  const defaultCenter = [settings.default_lat || 48.8566, settings.default_lng || 2.3522]
  const defaultZoom = settings.default_zoom || 10

  const fontStyle = { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif" }

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', ...fontStyle }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, border: '3px solid rgba(0,0,0,0.1)', borderTopColor: '#111827', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, color: '#9ca3af' }}>{t('trip.loading')}</span>
        </div>
      </div>
    )
  }
  if (!trip) return null

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...fontStyle }}>
      <Navbar tripTitle={trip.title} tripId={tripId} showBack onBack={() => navigate('/dashboard')} onShare={() => setShowMembersModal(true)} />

      <div style={{
        position: 'fixed', top: 56, left: 0, right: 0, zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 12px',
        background: 'var(--bg-elevated)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-faint)',
        height: 44,
        overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none',
        gap: 2,
      }}>
        {TRIP_TABS.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              style={{
                flexShrink: 0,
                padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: isActive ? 600 : 400,
                background: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? 'var(--accent-text)' : 'var(--text-muted)',
                fontFamily: 'inherit', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = isActive ? 'var(--accent-text)' : 'var(--text-primary)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = isActive ? 'var(--accent-text)' : 'var(--text-muted)' }}
            >{tab.shortLabel
                ? <><span className="sm:hidden">{tab.shortLabel}</span><span className="hidden sm:inline">{tab.label}</span></>
                : tab.label
              }</button>
          )
        })}
      </div>

      {/* Offset by navbar (56px) + tab bar (44px) */}
      <div style={{ position: 'fixed', top: 100, left: 0, right: 0, bottom: 0, overflow: 'hidden', overscrollBehavior: 'contain' }}>

        {activeTab === 'plan' && (
          <div style={{ position: 'absolute', inset: 0 }}>
            <MapView
              places={mapPlaces()}
              route={route}
              selectedPlaceId={selectedPlaceId}
              onMarkerClick={handleMarkerClick}
              onMapClick={handleMapClick}
              center={defaultCenter}
              zoom={defaultZoom}
              tileUrl={mapTileUrl}
              fitKey={fitKey}
              dayOrderMap={dayOrderMap}
            />

            {routeInfo && (
              <div style={{
                position: 'absolute', bottom: selectedPlace ? 180 : 20, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)',
                borderRadius: 99, padding: '6px 20px', zIndex: 30,
                boxShadow: '0 2px 16px rgba(0,0,0,0.1)',
                display: 'flex', gap: 12, fontSize: 13, color: '#374151',
              }}>
                <span>{routeInfo.distance}</span>
                <span style={{ color: '#d1d5db' }}>·</span>
                <span>{routeInfo.duration}</span>
              </div>
            )}

            <div className="hidden md:block" style={{ position: 'absolute', left: 10, top: 10, bottom: 10, zIndex: 20 }}>
              <button onClick={() => setLeftCollapsed(c => !c)}
                style={{
                  position: leftCollapsed ? 'fixed' : 'absolute', top: leftCollapsed ? 'calc(56px + 44px + 14px)' : 14, left: leftCollapsed ? 10 : undefined, right: leftCollapsed ? undefined : -28, zIndex: 25,
                  width: 36, height: 36, borderRadius: leftCollapsed ? 10 : '0 10px 10px 0',
                  background: leftCollapsed ? '#000' : 'var(--sidebar-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                  boxShadow: leftCollapsed ? '0 2px 12px rgba(0,0,0,0.2)' : 'none', border: 'none',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: leftCollapsed ? '#fff' : 'var(--text-faint)', transition: 'color 0.15s',
                }}
                onMouseEnter={e => { if (!leftCollapsed) e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { if (!leftCollapsed) e.currentTarget.style.color = 'var(--text-faint)' }}>
                {leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>

              <div style={{
                width: leftCollapsed ? 0 : leftWidth, height: '100%',
                background: 'var(--sidebar-bg)',
                backdropFilter: 'blur(24px) saturate(180%)',
                WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                boxShadow: leftCollapsed ? 'none' : 'var(--sidebar-shadow)',
                borderRadius: 16,
                overflow: 'hidden', display: 'flex', flexDirection: 'column',
                transition: 'width 0.25s ease',
                opacity: leftCollapsed ? 0 : 1,
              }}>
                <DayPlanSidebar
                  tripId={tripId}
                  trip={trip}
                  days={days}
                  places={places}
                  categories={categories}
                  assignments={assignments}
                  selectedDayId={selectedDayId}
                  selectedPlaceId={selectedPlaceId}
                  onSelectDay={handleSelectDay}
                  onPlaceClick={handlePlaceClick}
                  onReorder={handleReorder}
                  onUpdateDayTitle={handleUpdateDayTitle}
                  onAssignToDay={handleAssignToDay}
                  onRouteCalculated={(r) => { if (r) { setRoute(r.coordinates); setRouteInfo({ distance: r.distanceText, duration: r.durationText }) } else { setRoute(null); setRouteInfo(null) } }}
                  reservations={reservations}
                  onAddReservation={(dayId) => { setEditingReservation(null); tripStore.setSelectedDay(dayId); setShowReservationModal(true) }}
                />
                {!leftCollapsed && (
                  <div
                    onMouseDown={() => { isResizingLeft.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none' }}
                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize', background: 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  />
                )}
              </div>
            </div>

            <div className="hidden md:block" style={{ position: 'absolute', right: 10, top: 10, bottom: 10, zIndex: 20 }}>
              <button onClick={() => setRightCollapsed(c => !c)}
                style={{
                  position: rightCollapsed ? 'fixed' : 'absolute', top: rightCollapsed ? 'calc(56px + 44px + 14px)' : 14, right: rightCollapsed ? 10 : undefined, left: rightCollapsed ? undefined : -28, zIndex: 25,
                  width: 36, height: 36, borderRadius: rightCollapsed ? 10 : '10px 0 0 10px',
                  background: rightCollapsed ? '#000' : 'var(--sidebar-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                  boxShadow: rightCollapsed ? '0 2px 12px rgba(0,0,0,0.2)' : 'none', border: 'none',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: rightCollapsed ? '#fff' : 'var(--text-faint)', transition: 'color 0.15s',
                }}
                onMouseEnter={e => { if (!rightCollapsed) e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { if (!rightCollapsed) e.currentTarget.style.color = 'var(--text-faint)' }}>
                {rightCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
              </button>

              <div style={{
                width: rightCollapsed ? 0 : rightWidth, height: '100%',
                background: 'var(--sidebar-bg)',
                backdropFilter: 'blur(24px) saturate(180%)',
                WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                boxShadow: rightCollapsed ? 'none' : 'var(--sidebar-shadow)',
                borderRadius: 16,
                overflow: 'hidden', display: 'flex', flexDirection: 'column',
                transition: 'width 0.25s ease',
                opacity: rightCollapsed ? 0 : 1,
              }}>
                {!rightCollapsed && (
                  <div
                    onMouseDown={() => { isResizingRight.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none' }}
                    style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize', background: 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  />
                )}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingLeft: 4 }}>
                  <PlacesSidebar
                    places={places}
                    categories={categories}
                    assignments={assignments}
                    selectedDayId={selectedDayId}
                    selectedPlaceId={selectedPlaceId}
                    onPlaceClick={handlePlaceClick}
                    onAddPlace={() => { setEditingPlace(null); setShowPlaceForm(true) }}
                    onAssignToDay={handleAssignToDay}
                  />
                </div>
              </div>
            </div>

            {/* Mobile sidebar buttons — portal to body to escape Leaflet touch handling */}
            {activeTab === 'plan' && !mobileSidebarOpen && !showPlaceForm && !showMembersModal && !showReservationModal && ReactDOM.createPortal(
              <div className="flex md:hidden" style={{ position: 'fixed', top: 112, left: 12, right: 12, justifyContent: 'space-between', zIndex: 100, pointerEvents: 'none' }}>
                <button onClick={() => setMobileSidebarOpen('left')}
                  style={{ pointerEvents: 'auto', background: 'var(--bg-card)', color: 'var(--text-primary)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-primary)', borderRadius: 24, padding: '11px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.15)', minHeight: 44, fontFamily: 'inherit', touchAction: 'manipulation' }}>
                  {t('trip.mobilePlan')}
                </button>
                <button onClick={() => setMobileSidebarOpen('right')}
                  style={{ pointerEvents: 'auto', background: 'var(--bg-card)', color: 'var(--text-primary)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-primary)', borderRadius: 24, padding: '11px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.15)', minHeight: 44, fontFamily: 'inherit', touchAction: 'manipulation' }}>
                  {t('trip.mobilePlaces')}
                </button>
              </div>,
              document.body
            )}

            {selectedPlace && (
              <PlaceInspector
                place={selectedPlace}
                categories={categories}
                days={days}
                selectedDayId={selectedDayId}
                assignments={assignments}
                onClose={() => setSelectedPlaceId(null)}
                onEdit={() => { setEditingPlace(selectedPlace); setShowPlaceForm(true) }}
                onDelete={() => handleDeletePlace(selectedPlace.id)}
                onAssignToDay={handleAssignToDay}
                onRemoveAssignment={handleRemoveAssignment}
                files={files}
                onFileUpload={(fd) => tripStore.addFile(tripId, fd)}
              />
            )}

            {mobileSidebarOpen && ReactDOM.createPortal(
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 9999 }} onClick={() => setMobileSidebarOpen(null)}>
                <div style={{ position: 'absolute', top: 56, left: 0, right: 0, bottom: 0, background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border-secondary)' }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{mobileSidebarOpen === 'left' ? t('trip.mobilePlan') : t('trip.mobilePlaces')}</span>
                    <button onClick={() => setMobileSidebarOpen(null)} style={{ background: 'var(--bg-tertiary)', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                      <X size={14} />
                    </button>
                  </div>
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    {mobileSidebarOpen === 'left'
                      ? <DayPlanSidebar trip={trip} days={days} places={places} categories={categories} assignments={assignments} selectedDayId={selectedDayId} selectedPlaceId={selectedPlaceId} onSelectDay={(id) => { handleSelectDay(id); setMobileSidebarOpen(null) }} onPlaceClick={handlePlaceClick} onReorder={handleReorder} onUpdateDayTitle={handleUpdateDayTitle} onAssignToDay={handleAssignToDay} onRouteCalculated={(r) => { if (r) { setRoute(r.coordinates); setRouteInfo({ distance: r.distanceText, duration: r.durationText }) } }} reservations={reservations} onAddReservation={(dayId) => { setEditingReservation(null); tripStore.setSelectedDay(dayId); setShowReservationModal(true); setMobileSidebarOpen(null) }} />
                      : <PlacesSidebar places={places} categories={categories} assignments={assignments} selectedDayId={selectedDayId} selectedPlaceId={selectedPlaceId} onPlaceClick={handlePlaceClick} onAddPlace={() => { setEditingPlace(null); setShowPlaceForm(true); setMobileSidebarOpen(null) }} onAssignToDay={handleAssignToDay} days={days} isMobile />
                    }
                  </div>
                </div>
              </div>,
              document.body
            )}
          </div>
        )}

        {activeTab === 'buchungen' && (
          <div style={{ height: '100%', maxWidth: 1200, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto', overscrollBehavior: 'contain' }}>
            <ReservationsPanel
              tripId={tripId}
              reservations={reservations}
              days={days}
              assignments={assignments}
              files={files}
              onAdd={() => { setEditingReservation(null); setShowReservationModal(true) }}
              onEdit={(r) => { setEditingReservation(r); setShowReservationModal(true) }}
              onDelete={handleDeleteReservation}
              onNavigateToFiles={() => handleTabChange('dateien')}
            />
          </div>
        )}

        {activeTab === 'packliste' && (
          <div style={{ height: '100%', overflowY: 'auto', overscrollBehavior: 'contain', maxWidth: 1200, margin: '0 auto', width: '100%', padding: '8px 0' }}>
            <PackingListPanel tripId={tripId} items={packingItems} />
          </div>
        )}

        {activeTab === 'finanzplan' && (
          <div style={{ height: '100%', overflowY: 'auto', overscrollBehavior: 'contain', maxWidth: 1400, margin: '0 auto', width: '100%', padding: '8px 0' }}>
            <BudgetPanel tripId={tripId} />
          </div>
        )}

        {activeTab === 'dateien' && (
          <div style={{ height: '100%', overflow: 'hidden', overscrollBehavior: 'contain' }}>
            <FileManager
              files={files || []}
              onUpload={(fd) => tripStore.addFile(tripId, fd)}
              onDelete={(id) => tripStore.deleteFile(tripId, id)}
              onUpdate={null}
              places={places}
              reservations={reservations}
              tripId={tripId}
            />
          </div>
        )}
      </div>

      <PlaceFormModal isOpen={showPlaceForm} onClose={() => { setShowPlaceForm(false); setEditingPlace(null) }} onSave={handleSavePlace} place={editingPlace} tripId={tripId} categories={categories} onCategoryCreated={cat => tripStore.addCategory?.(cat)} />
      <TripFormModal isOpen={showTripForm} onClose={() => setShowTripForm(false)} onSave={async (data) => { await tripStore.updateTrip(tripId, data); toast.success(t('trip.toast.tripUpdated')) }} trip={trip} />
      <TripMembersModal isOpen={showMembersModal} onClose={() => setShowMembersModal(false)} tripId={tripId} tripTitle={trip?.title} />
      <ReservationModal isOpen={showReservationModal} onClose={() => { setShowReservationModal(false); setEditingReservation(null) }} onSave={handleSaveReservation} reservation={editingReservation} days={days} places={places} selectedDayId={selectedDayId} files={files} onFileUpload={(fd) => tripStore.addFile(tripId, fd)} onFileDelete={(id) => tripStore.deleteFile(tripId, id)} />
    </div>
  )
}
