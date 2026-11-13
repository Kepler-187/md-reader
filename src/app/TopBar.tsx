import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  ChevronDown,
  Eye,
  EyeOff,
  FolderSync,
  Lock,
  LockOpen,
  Network,
  PanelTop,
  Pin,
  Plus,
  Power,
  RotateCw,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react'

import type { ProjectRegistryRecord } from '../workspace/registry'
import { preloadVisualMarkdownEditor } from '../editor/visual-markdown-editor-loader'
import type { TabSaveState } from '../workspace/workspace-session'
import type { DocumentLineHeight, PageWidthMode } from '../workspace/profile-store'
import {
  buildShiftMap,
  findDropIndexByCenter,
  moveTabId,
  type TabRect,
} from '../workspace/tab-order'

export type WorkspaceMode = 'regular' | 'split'
export type RegularViewState = 'locked' | 'unlocking' | 'editable' | 'locking'

interface TopBarTab {
  id: string
  documentPath: string
  title: string
  saveState: TabSaveState
  saveErrorMessage: string | null
  isPinned?: boolean
}

interface TopBarProps {
  projects: ProjectRegistryRecord[]
  activeProjectId: string | null
  pendingProjectId?: string | null
  profileIds: string[]
  activeProfileId: string
  tabs: TopBarTab[]
  activeTabId: string | null
  canManageService?: boolean
  isServiceActionPending?: boolean
  mode: WorkspaceMode
  regularViewState: RegularViewState
  statusMessage: string | null
  saveIndicator?: string | null
  currentDocumentPath?: string | null
  isDocumentLoading?: boolean
  isFileTreeRefreshing?: boolean
  onConnectProject: () => void
  onManageProjects?: () => void
  onProjectChange: (projectId: string) => void
  onProfileChange: (profileId: string) => void
  onModeChange: (mode: WorkspaceMode) => void
  graphOpen?: boolean
  onToggleGraph?: () => void
  onToggleRegularLock: () => void
  showHiddenItems?: boolean
  onToggleShowHiddenItems?: () => void
  onTabSelect: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onTabPin?: (tabId: string) => void
  onTabReorder?: (nextOrderedTabIds: string[]) => void
  onRestartService?: () => void
  onReconnectService?: () => void
  onStopService?: () => void
  documentFontSize?: number
  maxUnpinnedTabs?: number
  onMaxUnpinnedTabsChange?: (value: number) => void
  documentPageWidth?: PageWidthMode
  documentLineHeight?: DocumentLineHeight
  hideFileTitleDate?: boolean
  onDocumentFontSizeChange?: (fontSize: number) => void
  onDocumentPageWidthChange?: (pageWidth: PageWidthMode) => void
  onDocumentLineHeightChange?: (lineHeight: DocumentLineHeight) => void
  onHideFileTitleDateChange?: (hideFileTitleDate: boolean) => void
  onRefreshDocument?: () => void | Promise<void>
  onRefreshFileTree?: () => void | Promise<void>
}

const MODE_LABELS: Record<WorkspaceMode, string> = {
  regular: '常规',
  split: '分栏',
}

const FONT_SIZE_OPTIONS = [14, 15, 16, 17, 18] as const
const PAGE_WIDTH_OPTIONS: Array<{ value: PageWidthMode; label: string }> = [
  { value: 'narrow', label: '窄版' },
  { value: 'wide', label: '宽版' },
  { value: 'full', label: '全屏' },
]
const LINE_HEIGHT_OPTIONS: Array<{ value: DocumentLineHeight; label: string }> = [
  { value: 1.5, label: '1.5' },
  { value: 1.6, label: '1.6' },
  { value: 1.7, label: '1.7' },
  { value: 1.8, label: '1.8' },
  { value: 1.9, label: '1.9' },
  { value: 2.0, label: '2.0' },
]

const DRAG_THRESHOLD_PX = 6

function TopBarReadingPreferences({
  fontSize,
  maxUnpinnedTabs,
  onMaxUnpinnedTabsChange,
  pageWidth,
  lineHeight,
  hideFileTitleDate,
  onFontSizeChange,
  onPageWidthChange,
  onLineHeightChange,
  onHideFileTitleDateChange,
}: {
  fontSize: number
  maxUnpinnedTabs: number
  onMaxUnpinnedTabsChange?: (value: number) => void
  pageWidth: PageWidthMode
  lineHeight: DocumentLineHeight
  hideFileTitleDate: boolean
  onFontSizeChange?: (fontSize: number) => void
  onPageWidthChange?: (pageWidth: PageWidthMode) => void
  onLineHeightChange?: (lineHeight: DocumentLineHeight) => void
  onHideFileTitleDateChange?: (hideFileTitleDate: boolean) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleWindowBlur() {
      setIsOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [])

  return (
    <div ref={rootRef} className="topbar__reading-preferences" data-open={isOpen ? 'true' : undefined}>
      <button
        type="button"
        className="topbar__service-button"
        aria-label="阅读选项"
        title="阅读选项"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="topbar__icon" aria-hidden="true">
          <SlidersHorizontal />
        </span>
      </button>

      {isOpen ? (
        <div className="topbar__reading-popover" role="group" aria-label="阅读偏好">
          <section className="topbar__reading-section">
            <label className="topbar__reading-label" htmlFor="max-unpinned-tabs">未固定标签上限：{maxUnpinnedTabs}</label>
            <input id="max-unpinned-tabs" type="range" min="1" max="30" step="1" value={maxUnpinnedTabs}
              onChange={(event) => onMaxUnpinnedTabsChange?.(Number(event.target.value))} />
          </section>
          <section className="topbar__reading-section" aria-label="默认字体大小">
            <p className="topbar__reading-label">默认字体大小</p>
            <div className="topbar__reading-options" role="group" aria-label="字体大小选项">
              {FONT_SIZE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="topbar__reading-option"
                  aria-pressed={fontSize === option}
                  onClick={() => onFontSizeChange?.(option)}
                >
                  {option} px
                </button>
              ))}
            </div>
          </section>

          <section className="topbar__reading-section" aria-label="页面宽度">
            <p className="topbar__reading-label">页面宽度</p>
            <div className="topbar__reading-options" role="group" aria-label="页面宽度选项">
              {PAGE_WIDTH_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="topbar__reading-option"
                  aria-pressed={pageWidth === option.value}
                  onClick={() => onPageWidthChange?.(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="topbar__reading-section" aria-label="正文行间距">
            <p className="topbar__reading-label">正文行间距</p>
            <div className="topbar__reading-options" role="group" aria-label="正文行间距选项">
              {LINE_HEIGHT_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="topbar__reading-option"
                  aria-pressed={lineHeight === option.value}
                  onClick={() => onLineHeightChange?.(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="topbar__reading-section" aria-label="文件树显示">
            <label className="topbar__reading-checkbox">
              <input
                type="checkbox"
                checked={hideFileTitleDate}
                onChange={(event) => onHideFileTitleDateChange?.(event.target.checked)}
              />
              <span>隐藏标题日期</span>
            </label>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function TopBarSelect({
  ariaLabel,
  className,
  options,
  placeholder,
  value,
  onChange,
  onManage,
}: {
  ariaLabel: string
  className: string
  options: Array<{ value: string; label: string; disabled?: boolean }>
  placeholder?: string
  value: string
  onChange: (value: string) => void
  onManage?: () => void
}) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === value) ?? null
  const visibleLabel = selectedOption?.label ?? placeholder ?? ''

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleWindowBlur() {
      setIsOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [])

  function commitSelection(nextValue: string) {
    setIsOpen(false)

    if (nextValue !== value) {
      onChange(nextValue)
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setIsOpen(true)
      return
    }

    if (event.key === 'Escape') {
      setIsOpen(false)
    }
  }

  function handleOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    nextValue: string,
    disabled = false,
  ) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setIsOpen(false)
      return
    }

    if (disabled) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      commitSelection(nextValue)
    }
  }

  return (
    <div ref={rootRef} className={`topbar__select ${className}`} data-open={isOpen ? 'true' : undefined}>
      <button
        type="button"
        role="combobox"
        className="topbar__select-trigger"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="topbar__select-value">{visibleLabel}</span>
        <span className="topbar__select-chevron" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>

      {isOpen ? (
        <div className="topbar__select-popover">
          <div id={listboxId} role="listbox" aria-label={ariaLabel} className="topbar__select-listbox">
            {options.map((option) => {
              const isSelected = option.value === value

              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  className="topbar__select-option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  onClick={() => {
                    if (!option.disabled) {
                      commitSelection(option.value)
                    }
                  }}
                  onKeyDown={(event) => handleOptionKeyDown(event, option.value, option.disabled)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          {onManage ? <button type="button" className="topbar__select-option" onClick={() => { setIsOpen(false); onManage() }}>管理项目…</button> : null}
        </div>
      ) : null}
    </div>
  )
}

export function TopBar({
  projects,
  activeProjectId,
  pendingProjectId = null,
  profileIds,
  activeProfileId,
  tabs,
  activeTabId,
  canManageService = false,
  isServiceActionPending = false,
  mode,
  regularViewState,
  statusMessage,
  saveIndicator,
  currentDocumentPath = null,
  isDocumentLoading = false,
  isFileTreeRefreshing = false,
  onConnectProject,
  onManageProjects,
  onProjectChange,
  onProfileChange,
  onModeChange,
  graphOpen = false,
  onToggleGraph,
  onToggleRegularLock,
  showHiddenItems = false,
  onToggleShowHiddenItems,
  onTabSelect,
  onTabClose,
  onTabPin,
  onTabReorder,
  onRestartService,
  onReconnectService,
  onStopService,
  documentFontSize = 16,
  maxUnpinnedTabs = 10,
  onMaxUnpinnedTabsChange,
  documentPageWidth = 'narrow',
  documentLineHeight = 1.6,
  hideFileTitleDate = false,
  onDocumentFontSizeChange,
  onDocumentPageWidthChange,
  onDocumentLineHeightChange,
  onHideFileTitleDateChange,
  onRefreshDocument,
  onRefreshFileTree,
}: TopBarProps) {
  const [dragState, setDragState] = useState<'idle' | 'press_pending' | 'dragging' | 'settling'>('idle')
  const [pinHoverTabId, setPinHoverTabId] = useState<string | null>(null)
  const [dragTabId, setDragTabId] = useState<string | null>(null)
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null)
  const [dragOffsetX, setDragOffsetX] = useState(0)
  const [settlingTabId, setSettlingTabId] = useState<string | null>(null)
  const [dragLayout, setDragLayout] = useState<{ order: string[]; rectsById: Record<string, TabRect> } | null>(null)
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const tabLabelRefs = useRef<Record<string, HTMLSpanElement | null>>({})
  const tabstripRef = useRef<HTMLDivElement | null>(null)
  const settlingTimerRef = useRef<number | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const dragStateRef = useRef(dragState)
  const dragTabIdRef = useRef(dragTabId)
  const previewOrderRef = useRef(previewOrder)
  const dragMetaRef = useRef<{
    pointerId: number
    startX: number
    tabId: string
    order: string[]
    rectsById: Record<string, TabRect>
    triggerElement: HTMLButtonElement | null
  } | null>(null)
  const [tooltipTabId, setTooltipTabId] = useState<string | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null)
  const isRegularMode = mode === 'regular'
  const isLockActionPending =
    regularViewState === 'unlocking' || regularViewState === 'locking'
  const isUnlocked = regularViewState === 'editable' || regularViewState === 'locking'
  const lockButtonLabel = isUnlocked ? '锁定' : '解锁'
  const projectOptions = [
    { value: '', label: '选择项目', disabled: true },
    ...projects.map((project) => ({ value: project.id, label: project.name })),
  ]
  const profileOptions = profileIds.map((profileId) => ({ value: profileId, label: profileId }))
  const committedOrder = tabs.map((tab) => tab.id)
  const effectiveOrder = dragState === 'dragging' ? committedOrder : previewOrder ?? committedOrder
  const orderedTabs = effectiveOrder
    .map((id) => tabs.find((tab) => tab.id === id) ?? null)
    .filter((tab): tab is TopBarTab => tab != null)

  function clearSettlingTimer() {
    if (settlingTimerRef.current != null) {
      window.clearTimeout(settlingTimerRef.current)
      settlingTimerRef.current = null
    }
  }

  function isTabTruncated(tabId: string) {
    const labelElement = tabLabelRefs.current[tabId]
    if (labelElement == null) {
      return false
    }

    return labelElement.scrollWidth > labelElement.clientWidth + 1
  }

  function hideTabTooltip() {
    setTooltipTabId(null)
  }

  function showTabTooltip(tabId: string) {
    if (dragStateRef.current !== 'idle') {
      setTooltipTabId(null)
      return
    }

    if (!isTabTruncated(tabId)) {
      setTooltipTabId(null)
      return
    }

    const rect = tabButtonRefs.current[tabId]?.getBoundingClientRect()
    if (!rect) return
    setTooltipPosition({ left: rect.left + rect.width / 2, top: rect.bottom + 10 })
    setTooltipTabId(tabId)
  }

  function collectTabRects(): Record<string, TabRect> {
    return Object.fromEntries(
      tabs.flatMap((tab) => {
        const element = tabButtonRefs.current[tab.id]
        if (element == null) {
          return []
        }

        const rect = element.getBoundingClientRect()
        if (rect.width <= 0) {
          return []
        }

        return [
          [
            tab.id,
            {
              left: rect.left,
              width: rect.width,
              center: rect.left + rect.width / 2,
            } satisfies TabRect,
          ],
        ]
      }),
    )
  }

  function cleanupDragging(pointerId?: number) {
    window.removeEventListener('pointermove', handleWindowPointerMove)
    window.removeEventListener('pointerup', handleWindowPointerUp)
    window.removeEventListener('pointercancel', handleWindowPointerCancel)

    const target = dragMetaRef.current?.triggerElement
    if (
      pointerId != null &&
      target != null &&
      typeof target.hasPointerCapture === 'function' &&
      target.hasPointerCapture(pointerId)
    ) {
      target.releasePointerCapture(pointerId)
    }
  }

  function finishDrag() {
    const meta = dragMetaRef.current
    if (meta == null) {
      return
    }

    const nextDragState = dragStateRef.current
    const nextDragTabId = dragTabIdRef.current
    const nextPreviewOrder = previewOrderRef.current

    cleanupDragging(meta.pointerId)
    dragCleanupRef.current = null
    dragMetaRef.current = null
    setTooltipTabId(null)
    setDragOffsetX(0)
    setPreviewOrder(null)
    setDragLayout(null)
    setDragState('settling')
    setSettlingTabId(nextDragState === 'dragging' ? nextDragTabId : null)
    setDragTabId(null)
    meta.triggerElement?.focus()
    clearSettlingTimer()
    settlingTimerRef.current = window.setTimeout(() => {
      setDragState('idle')
      setSettlingTabId(null)
      settlingTimerRef.current = null
    }, 160)

    if (nextDragState === 'dragging' && nextDragTabId && nextPreviewOrder) {
      onTabReorder?.(nextPreviewOrder)
    } else if (nextDragState === 'press_pending') {
      onTabSelect(meta.tabId)
    }
  }

  function beginDragging(meta: NonNullable<typeof dragMetaRef.current>) {
    if (meta.triggerElement && typeof meta.triggerElement.setPointerCapture === 'function') {
      meta.triggerElement.setPointerCapture(meta.pointerId)
    }
    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerCancel)
  }

  function handleWindowPointerMove(event: PointerEvent) {
    const meta = dragMetaRef.current
    if (meta == null || event.pointerId !== meta.pointerId) {
      return
    }

    const nextDragTabId = dragTabIdRef.current ?? meta.tabId
    const nextOffsetX = event.clientX - meta.startX
    if (dragStateRef.current === 'press_pending') {
      if (Math.abs(nextOffsetX) < DRAG_THRESHOLD_PX) {
        return
      }
      beginDragging(meta)
    }

    const rectsById = meta.rectsById
    const dragRect = rectsById[nextDragTabId]
    if (dragRect == null) {
      return
    }

    const measurableOrder = meta.order.filter((id) => rectsById[id] != null)
    const baseOrder = (previewOrderRef.current ?? measurableOrder).filter((id) => rectsById[id] != null)
    const dragCenterX = dragRect.center + nextOffsetX
    const nextIndex = findDropIndexByCenter(baseOrder, nextDragTabId, dragCenterX, rectsById)
    const nextOrder = moveTabId(baseOrder, nextDragTabId, nextIndex)
    const remainingIds = meta.order.filter((id) => !nextOrder.includes(id))

    setDragState('dragging')
    setDragTabId(nextDragTabId)
    setDragOffsetX(nextOffsetX)
    setPreviewOrder([...nextOrder, ...remainingIds])
  }

  function handleWindowPointerUp(event: PointerEvent) {
    if (event.pointerId === dragMetaRef.current?.pointerId) {
      finishDrag()
    }
  }

  function handleWindowPointerCancel(event: PointerEvent) {
    if (event.pointerId === dragMetaRef.current?.pointerId) {
      finishDrag()
    }
  }

  function handleTabPointerDown(event: React.PointerEvent<HTMLButtonElement>, tabId: string) {
    if (event.button !== 0) {
      return
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerCancel)
    clearSettlingTimer()
    setTooltipTabId(null)
    setSettlingTabId(null)
    setDragState('press_pending')
    setDragTabId(tabId)
    setDragOffsetX(0)
    setPreviewOrder(committedOrder)
    const rectsById = collectTabRects()
    setDragLayout({ order: committedOrder, rectsById })
    dragMetaRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      tabId,
      order: committedOrder,
      rectsById,
      triggerElement: event.currentTarget,
    }
    dragCleanupRef.current = () => cleanupDragging(event.pointerId)
  }

  useEffect(() => {
    return () => {
      clearSettlingTimer()
      dragCleanupRef.current?.()
    }
  }, [])

  const shiftMap =
    dragState === 'dragging' && dragTabId != null && previewOrder != null && dragLayout != null
      ? buildShiftMap({
          committedOrder: dragLayout.order,
          previewOrder,
          dragTabId,
          rectsById: dragLayout.rectsById,
        })
      : {}

  useEffect(() => {
    dragStateRef.current = dragState
  }, [dragState])

  useEffect(() => {
    dragTabIdRef.current = dragTabId
  }, [dragTabId])

  useEffect(() => {
    previewOrderRef.current = previewOrder
  }, [previewOrder])

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      if (tooltipTabId != null && !isTabTruncated(tooltipTabId)) {
        setTooltipTabId(null)
      } else if (tooltipTabId != null) {
        const rect = tabButtonRefs.current[tooltipTabId]?.getBoundingClientRect()
        if (rect) setTooltipPosition({ left: rect.left + rect.width / 2, top: rect.bottom + 10 })
      }
    })

    const elements: Element[] = []
    if (tabstripRef.current != null) {
      elements.push(tabstripRef.current)
    }
    tabs.forEach((tab) => {
      const labelElement = tabLabelRefs.current[tab.id]
      if (labelElement != null) {
        elements.push(labelElement)
      }

      const buttonElement = tabButtonRefs.current[tab.id]
      if (buttonElement != null) {
        elements.push(buttonElement)
      }
    })

    elements.forEach((element) => observer.observe(element))

    return () => observer.disconnect()
  }, [tabs, tooltipTabId])

  const activeTooltipTab =
    tooltipTabId != null && dragState === 'idle'
      ? orderedTabs.find((tab) => tab.id === tooltipTabId) ?? null
      : null
  const activeTooltipPosition = activeTooltipTab != null ? tooltipPosition : null

  return (
    <header className="topbar" role="banner">
      <span className="topbar__sr-status">{statusMessage ?? '等待载入项目'}</span>
      <span className="topbar__sr-status">{`状态：${statusMessage ?? '等待载入项目'}`}</span>
      <span className="topbar__sr-status">{`保存：${saveIndicator ?? '未打开文档'}`}</span>
      <div className="topbar__group topbar__group--start">
        <TopBarSelect
          ariaLabel="项目切换"
          className="topbar__field topbar__field--project"
          options={projectOptions}
          placeholder="选择项目"
          value={pendingProjectId ?? activeProjectId ?? ''}
          onChange={onProjectChange}
          onManage={onManageProjects}
        />

        <button
          type="button"
          className="topbar__action"
          aria-label="接入项目"
          title="接入项目"
          onClick={onConnectProject}
        >
          <span className="topbar__icon" aria-hidden="true">
            <Plus />
          </span>
        </button>
      </div>

      <div className="topbar__center">
        <div
          ref={tabstripRef}
          className="topbar__tabstrip"
          role="tablist"
          aria-label="打开的文档标签"
        >
          {orderedTabs.map((tab) => {
            const isActive = tab.id === activeTabId

            return (
              <div
                key={tab.id}
                className="topbar__tab"
                data-pin-visible={tab.isPinned || pinHoverTabId === tab.id ? 'true' : undefined}
                onMouseEnter={() => setPinHoverTabId(tab.id)}
                onMouseLeave={() => setPinHoverTabId(null)}
                data-active={isActive ? 'true' : undefined}
                data-editable={isActive && isUnlocked && isRegularMode ? 'true' : undefined}
                data-dragging={dragTabId === tab.id && dragState === 'dragging' ? 'true' : undefined}
                data-shifting={
                  dragTabId !== tab.id && dragState === 'dragging' && shiftMap[tab.id] !== 0
                    ? 'true'
                    : undefined
                }
                data-settling={
                  dragState === 'settling' && settlingTabId !== tab.id ? 'true' : undefined
                }
                data-settling-dragged={
                  dragState === 'settling' && settlingTabId === tab.id ? 'true' : undefined
                }
                style={{
                  transform:
                    dragTabId === tab.id && dragState === 'dragging'
                      ? `translateX(${dragOffsetX}px)`
                      : shiftMap[tab.id] != null && shiftMap[tab.id] !== 0
                        ? `translateX(${shiftMap[tab.id]}px)`
                        : undefined,
                }}
              >
                <button type="button" className="topbar__tab-pin" aria-label={`${tab.isPinned ? '取消固定' : '固定'}标签：${tab.title}`}
                  aria-pressed={Boolean(tab.isPinned)} title={tab.isPinned ? '取消固定标签' : '固定标签'}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); onTabPin?.(tab.id) }}><Pin /></button>
                <button
                  type="button"
                  role="tab"
                  className="topbar__tab-button"
                  aria-selected={isActive}
                  aria-controls={undefined}
                  ref={(element) => {
                    tabButtonRefs.current[tab.id] = element
                  }}
                  onPointerDown={(event) => handleTabPointerDown(event, tab.id)}
                  onClick={() => {
                    if (dragState === 'idle') {
                      onTabSelect(tab.id)
                    }
                  }}
                  onMouseEnter={() => showTabTooltip(tab.id)}
                  onMouseLeave={hideTabTooltip}
                  onFocus={() => showTabTooltip(tab.id)}
                  onBlur={hideTabTooltip}
                >
                  <span
                    className="topbar__tab-state"
                    data-state={tab.saveState}
                    aria-hidden="true"
                  />
                  <span
                    className="topbar__tab-label"
                    ref={(element) => {
                      tabLabelRefs.current[tab.id] = element
                    }}
                  >
                    {tab.title}
                  </span>
                </button>
                <button
                  type="button"
                  className="topbar__tab-close"
                  aria-label={`关闭标签：${tab.title}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => { hideTabTooltip(); onTabClose(tab.id) }}
                >
                  <X />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {activeTooltipTab != null && activeTooltipPosition != null ? (
        <div
          className="topbar__tab-tooltip"
          role="tooltip"
          style={{
            left: activeTooltipPosition.left,
            top: activeTooltipPosition.top,
          }}
        >
          {activeTooltipTab.title}
        </div>
      ) : null}

      <div className="topbar__group topbar__group--end">
        <button
          type="button"
          className="topbar__service-button"
          aria-label="刷新文件树"
          title="刷新文件树"
          disabled={activeProjectId == null || isFileTreeRefreshing}
          aria-busy={isFileTreeRefreshing}
          onClick={() => void onRefreshFileTree?.()}
        >
          <span className="topbar__icon" aria-hidden="true">
            <FolderSync />
          </span>
        </button>
        <button
          type="button"
          className="topbar__service-button"
          aria-label="刷新当前文档"
          title="刷新当前文档"
          disabled={currentDocumentPath == null || isDocumentLoading}
          aria-busy={isDocumentLoading}
          onClick={() => void onRefreshDocument?.()}
        >
          <span className="topbar__icon" aria-hidden="true">
            <RotateCw />
          </span>
        </button>
        <TopBarSelect
          ariaLabel="Profile 切换"
          className="topbar__field topbar__field--profile"
          options={profileOptions}
          value={activeProfileId}
          onChange={onProfileChange}
        />

        <div className="topbar__actions-fixed">
          <div className="topbar__mode-cluster">
            {isRegularMode ? (
              <button
                type="button"
                className="topbar__lock-toggle"
                aria-pressed={isUnlocked}
                aria-label={lockButtonLabel}
                title={lockButtonLabel}
                disabled={isLockActionPending}
                onPointerEnter={preloadVisualMarkdownEditor}
                onFocus={preloadVisualMarkdownEditor}
                onClick={onToggleRegularLock}
              >
                <span className="topbar__lock-icon" aria-hidden="true">
                  {isUnlocked ? <LockOpen /> : <Lock />}
                </span>
              </button>
            ) : null}

            <button
              type="button"
              className="topbar__lock-toggle topbar__hidden-toggle"
              aria-pressed={showHiddenItems}
              aria-label="显示隐藏项"
              title="显示隐藏项"
              onClick={onToggleShowHiddenItems}
            >
              <span className="topbar__lock-icon" aria-hidden="true">
                {showHiddenItems ? <Eye /> : <EyeOff />}
              </span>
            </button>

            <div className="topbar__modes" role="group" aria-label="模式切换">
              {(Object.keys(MODE_LABELS) as WorkspaceMode[]).map((nextMode) => (
                <button
                  key={nextMode}
                  type="button"
                  className="topbar__mode"
                  aria-pressed={mode === nextMode}
                  aria-label={MODE_LABELS[nextMode]}
                  title={MODE_LABELS[nextMode]}
                  onPointerEnter={nextMode === 'regular' ? preloadVisualMarkdownEditor : undefined}
                  onFocus={nextMode === 'regular' ? preloadVisualMarkdownEditor : undefined}
                  onClick={() => onModeChange(nextMode)}
                >
                  <span className="topbar__icon" aria-hidden="true">
                    {nextMode === 'regular' ? <Square /> : <PanelTop />}
                  </span>
                </button>
              ))}
              <button
                type="button"
                className="topbar__mode"
                aria-pressed={graphOpen}
                aria-label="关系图谱"
                title={graphOpen ? '关闭图谱' : '关系图谱'}
                onClick={onToggleGraph}
                disabled={!onToggleGraph}
              >
                <span className="topbar__icon" aria-hidden="true">
                  <Network />
                </span>
              </button>
            </div>
          </div>

          {canManageService ? (
          <div className="topbar__service-actions" role="group" aria-label="服务操作">
            <TopBarReadingPreferences
              fontSize={documentFontSize}
              maxUnpinnedTabs={maxUnpinnedTabs}
              onMaxUnpinnedTabsChange={onMaxUnpinnedTabsChange}
              pageWidth={documentPageWidth}
              lineHeight={documentLineHeight}
              hideFileTitleDate={hideFileTitleDate}
              onFontSizeChange={onDocumentFontSizeChange}
              onPageWidthChange={onDocumentPageWidthChange}
              onLineHeightChange={onDocumentLineHeightChange}
              onHideFileTitleDateChange={onHideFileTitleDateChange}
            />
            <button
              type="button"
              className="topbar__service-button"
              aria-label="重启服务"
              title="重启服务"
              disabled={isServiceActionPending}
              onClick={onRestartService}
            >
              <span className="topbar__icon" aria-hidden="true">
                <RotateCw />
              </span>
            </button>
            <button
              type="button"
              className="topbar__service-button topbar__service-button--danger"
              aria-label="关闭服务"
              title="关闭服务"
              disabled={isServiceActionPending}
              onClick={onStopService}
            >
              <span className="topbar__icon" aria-hidden="true">
                <Power />
              </span>
            </button>
          </div>
          ) : (
            <div className="topbar__service-actions" role="group" aria-label="服务操作">
              <button
                type="button"
                className="topbar__service-button"
                aria-label="重新连接服务"
                title="重新连接服务"
                disabled={isServiceActionPending}
                onClick={onReconnectService}
              >
                <span className="topbar__icon" aria-hidden="true">
                  <RotateCw />
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
