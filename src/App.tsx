import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { ActionDialog } from './app/ActionDialog'
import { ProjectManager } from './app/ProjectManager'
import { RegistryRequestError, type ProjectsSnapshot } from './workspace/project-registry-contract'
import { AppShell } from './app/AppShell'
import { parseWorkspaceLocator, replaceWorkspaceHref, createDocumentShareHref, type DeepLinkTarget } from './app/workspace-links'
import type { WorkspaceActionToast } from './app/WorkspaceLayout'
import type { RegularViewState, WorkspaceMode } from './app/TopBar'
import { createBrowserKeyValueStore } from './shared/key-value-store'
import { STORAGE_KEYS } from './shared/storage-keys'
import {
  buildFileTree,
  collectRecentFileTreeNodes,
  createVisibleFileTree,
  filterFileTreeByFavorites,
  isPathExplicitlyHidden,
  isPathHiddenByAncestor,
} from './workspace/file-tree'
import {
  appendNodeToManualOrder,
  applyManualTreeOrder,
  type ManualNodeOrderByParent,
  moveNodeToParentTailInManualOrder,
  normalizeManualNodeOrderByParent,
  reorderManualNodeOrder,
  rewriteManualOrderPaths,
  removeNodeFromManualOrder,
} from './workspace/file-tree-order'
import { createContentHash } from './shared/content-hash'
import type { FileTreeNode } from './workspace/file-tree-types'
import type { ProjectTreeDocumentEntry } from './workspace/local-bridge-access'
import {
  getActiveTab,
  selectTabsForOpening,
  sessionTabMetadata,
  type TabSaveState,
  type WorkspaceSession,
  type WorkspaceTab,
} from './workspace/workspace-session'
import {
  createDirectoryNodeInBridge,
  createDocumentNodeInBridge,
  deleteDocumentNodeInBridge,
  duplicateDocumentNodeInBridge,
  BridgeDocumentConflictError,
  BridgeDocumentSavedCacheInvalidationError,
  moveDocumentNodeInBridge,
  getDocumentContentFromBridge,
  getProjectAssetHref,
  getProfileFromBridge,
  getFileTreePathsFromBridge,
  getLinkIndexFromBridge,
  type LinkIndexPayload,
  getProjectTreeSnapshotFromBridge,
  refreshFileTreeFromBridge,
  refreshProjectTreeSnapshotFromBridge,
  getLocalBridgeHealth,
  listProjectsFromBridge,
  listProjectProfilesFromBridge,
  renameDocumentNodeInBridge,
  revealDocumentInBridge,
  registerProjectWithBridge,
  reorderProjectsWithBridge,
  unregisterProjectWithBridge,
  reconcileProjectsWithBridge,
  restartLocalBridgeService,
  saveProfileToBridge,
  saveDocumentContentToBridge,
  setActiveProjectWithBridge,
  stopLocalBridgeService,
} from './workspace/local-bridge-access'
import { createLocalStateStore } from './workspace/local-state'
import type { WorkspaceLocalState } from './workspace/local-state'
import {
  removePathCollections,
  rewritePathCollections,
  rewriteSessionDocumentPath,
} from './workspace/document-path-mutation'
import {
  createProfileStore,
  normalizeMaxUnpinnedTabs,
  type DocumentLineHeight,
  type PageWidthMode,
  type WorkspaceProfile,
} from './workspace/profile-store'
import type { ProjectRegistryRecord } from './workspace/registry'
import { createWorkspaceProvider, type WorkspaceSource } from './workspace/workspace-provider'

const storage = createBrowserKeyValueStore()
const profileStore = createProfileStore(storage)
const localStateStore = createLocalStateStore(storage)
const workspaceProvider = createWorkspaceProvider({
  bridge: {
    getHealth: getLocalBridgeHealth,
    listProjects: listProjectsFromBridge,
    registerProject: registerProjectWithBridge,
    setActiveProject: setActiveProjectWithBridge,
    reorderProjects: (...args) => reorderProjectsWithBridge(...args),
    unregisterProject: (...args) => unregisterProjectWithBridge(...args),
    reconcileProjects: (...args) => reconcileProjectsWithBridge(...args),
    getFileTreePaths: getFileTreePathsFromBridge,
    refreshFileTree: refreshFileTreeFromBridge,
    getProjectTreeSnapshot: getProjectTreeSnapshotFromBridge,
    refreshProjectTreeSnapshot: refreshProjectTreeSnapshotFromBridge,
  },
})

const AUTOSAVE_DEBOUNCE_MS = 1200
const PROJECT_SWITCH_PREPARE_TIMEOUT_MS = 60_000
const MARKDOWN_TITLE_EXTENSION_PATTERN = /\.(md|mdx)$/i
const RECENT_DOCUMENT_LIMIT = 50

function profileWriteKey(projectId: string, profileId: string, source: WorkspaceSource) {
  return JSON.stringify(source === 'local-service' ? [source, projectId] : [source, projectId, profileId])
}

function createTabId(documentPath: string): string {
  return documentPath
}

function formatTabTitle(documentPath: string): string {
  const fileName = documentPath.split('/').at(-1) ?? documentPath
  return fileName.replace(MARKDOWN_TITLE_EXTENSION_PATTERN, '')
}

function createEmptySession(): WorkspaceSession {
  return {
    tabs: [],
    activeTabId: null,
    mode: 'regular',
    regularViewState: 'locked',
  }
}

function createWorkspaceTab(documentPath: string, lastKnownScrollTop = 0): WorkspaceTab {
  return {
    id: createTabId(documentPath),
    instanceId: Symbol(documentPath),
    documentPath,
    persistedContent: null,
    draftContent: null,
    mtimeMs: null,
    saveState: 'clean',
    saveErrorMessage: null,
    lastKnownScrollTop,
  }
}

function getTabByDocumentPath(session: WorkspaceSession, documentPath: string): WorkspaceTab | null {
  return session.tabs.find((tab) => tab.documentPath === documentPath) ?? null
}

function replaceTab(session: WorkspaceSession, nextTab: WorkspaceTab): WorkspaceSession {
  return {
    ...session,
    tabs: session.tabs.map((tab) => (tab.id === nextTab.id ? nextTab : tab)),
  }
}

function normalizeLocalStateSnapshot(state: {
  openDocumentPaths?: string[]
  activeDocumentPath: string | null
  activeMode: 'regular' | 'split' | 'read' | 'edit'
  regularViewState?: RegularViewState
  tabStateByDocument?: Record<string, { lastKnownScrollTop: number }>
  lastKnownScrollTop?: number
  readingProgressByDocument?: Record<string, number>
  tabOpenOrder?: string[]
  pinnedDocumentPaths?: string[]
}) {
  const openDocumentPaths =
    state.openDocumentPaths ??
    (state.activeDocumentPath ? [state.activeDocumentPath] : [])
  const tabStateByDocument =
    state.tabStateByDocument ??
    (state.activeDocumentPath
      ? {
          [state.activeDocumentPath]: {
            lastKnownScrollTop: state.lastKnownScrollTop ?? 0,
          },
        }
      : {})

  return {
    openDocumentPaths,
    activeDocumentPath: state.activeDocumentPath,
    activeMode: state.activeMode,
    regularViewState: state.regularViewState ?? inferRegularViewStateFromMode(state.activeMode),
    tabStateByDocument,
    readingProgressByDocument: state.readingProgressByDocument ?? {},
    tabOpenOrder: state.tabOpenOrder ?? openDocumentPaths,
    pinnedDocumentPaths: state.pinnedDocumentPaths ?? [],
  }
}

function reconcileLocalStateWithFileTree(
  state: ReturnType<typeof normalizeLocalStateSnapshot>,
  markdownPaths: string[],
) {
  const availableDocumentPaths = new Set(markdownPaths)
  const nextOpenDocumentPaths = state.openDocumentPaths.filter((path) => availableDocumentPaths.has(path))
  const nextActiveDocumentPath =
    state.activeDocumentPath && availableDocumentPaths.has(state.activeDocumentPath)
      ? state.activeDocumentPath
      : nextOpenDocumentPaths[0] ?? null
  const nextTabStateByDocument = Object.fromEntries(
    Object.entries(state.tabStateByDocument).filter(([path]) => availableDocumentPaths.has(path)),
  )
  const nextReadingProgressByDocument = Object.fromEntries(
    Object.entries(state.readingProgressByDocument).filter(([path]) => availableDocumentPaths.has(path)),
  )
  const openSet = new Set(nextOpenDocumentPaths)
  const tabOpenOrder = state.tabOpenOrder.filter((path) => openSet.has(path))
  const pinnedDocumentPaths = state.pinnedDocumentPaths.filter((path) => openSet.has(path))
  const changed =
    nextActiveDocumentPath !== state.activeDocumentPath ||
    nextOpenDocumentPaths.length !== state.openDocumentPaths.length ||
    Object.keys(nextTabStateByDocument).length !== Object.keys(state.tabStateByDocument).length ||
    Object.keys(nextReadingProgressByDocument).length !==
      Object.keys(state.readingProgressByDocument).length ||
    tabOpenOrder.length !== state.tabOpenOrder.length ||
    pinnedDocumentPaths.length !== state.pinnedDocumentPaths.length

  return {
    changed,
    state: {
      ...state,
      openDocumentPaths: nextOpenDocumentPaths,
      activeDocumentPath: nextActiveDocumentPath,
      tabStateByDocument: nextTabStateByDocument,
      readingProgressByDocument: nextReadingProgressByDocument,
      tabOpenOrder,
      pinnedDocumentPaths,
    },
  }
}

function isMissingDocumentLoadError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return (
    error.message.includes('Document not found:') ||
    error.message.includes('missing document:') ||
    error.message.includes('ENOENT:')
  )
}

function removeTab(session: WorkspaceSession, tabId: string): WorkspaceSession {
  const documentPath = session.tabs.find((tab) => tab.id === tabId)?.documentPath
  return {
    ...session,
    tabs: session.tabs.filter((tab) => tab.id !== tabId),
    tabOpenOrder: session.tabOpenOrder?.filter((path) => path !== documentPath),
    pinnedDocumentPaths: session.pinnedDocumentPaths?.filter((path) => path !== documentPath),
  }
}

function reorderSessionTabs(
  session: WorkspaceSession,
  nextOrderedTabIds: string[],
): WorkspaceSession {
  const tabById = new Map(session.tabs.map((tab) => [tab.id, tab]))
  const reorderedTabs = nextOrderedTabIds
    .map((id) => tabById.get(id))
    .filter((tab): tab is WorkspaceTab => tab != null)

  if (reorderedTabs.length !== session.tabs.length) {
    return session
  }

  const hasSameOrder = reorderedTabs.every((tab, index) => session.tabs[index]?.id === tab.id)
  if (hasSameOrder) {
    return session
  }

  return {
    ...session,
    tabs: reorderedTabs,
  }
}

function normalizeWorkspaceMode(
  activeMode: 'regular' | 'split' | 'read' | 'edit',
): WorkspaceMode {
  if (activeMode === 'split') {
    return 'split'
  }

  return 'regular'
}

function inferRegularViewStateFromMode(
  activeMode: 'regular' | 'split' | 'read' | 'edit',
): RegularViewState {
  if (activeMode === 'edit') {
    return 'editable'
  }

  return 'locked'
}

function formatSaveErrorMessage(message: string): string {
  return message
}

function getDocumentDirectoryPath(documentPath: string | null): string {
  if (!documentPath || !documentPath.includes('/')) {
    return ''
  }

  return documentPath.split('/').slice(0, -1).join('/')
}

function getDocumentAncestorDirectoryPaths(documentPath: string): string[] {
  const directoryPath = getDocumentDirectoryPath(documentPath)
  const segments = directoryPath.split('/').filter(Boolean)
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
}

function joinNodePath(directoryPath: string, name: string): string {
  const trimmedName = name.trim()
  return directoryPath ? `${directoryPath}/${trimmedName}` : trimmedName
}

function pruneFavoritePaths(fileTree: FileTreeNode[], favoritePaths: string[]): string[] {
  const availablePaths = new Set<string>()

  function visit(nodes: FileTreeNode[]) {
    for (const node of nodes) {
      availablePaths.add(node.path)
      if (node.kind === 'directory') {
        visit(node.children)
      }
    }
  }

  visit(fileTree)
  return Array.from(new Set(favoritePaths)).filter((path) => availablePaths.has(path))
}

function collectDocumentPaths(fileTree: FileTreeNode[]): string[] {
  const paths: string[] = []
  const visit = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'directory') visit(node.children)
      else paths.push(node.path)
    }
  }
  visit(fileTree)
  return paths
}

function formatReorderFeedbackMessage(payload: {
  sourcePath: string
  targetPath: string | null
  position: 'before' | 'after' | 'tail'
}) {
  if (payload.position === 'tail' || payload.targetPath == null) {
    return `已调整顺序：${payload.sourcePath} 已移到当前分组末尾`
  }

  return `已调整顺序：${payload.sourcePath} 已排到 ${payload.targetPath} ${
    payload.position === 'before' ? '之前' : '之后'
  }`
}

type PendingWorkspaceAction =
  | { kind: 'switch-project'; projectId: string; project?: ProjectRegistryRecord }
  | { kind: 'remove-project'; projectId: string }
  | { kind: 'switch-profile'; profileId: string }
  | { kind: 'restart-service' }
  | { kind: 'reconnect-service' }
  | { kind: 'stop-service' }

type PendingRefreshDocumentAction = {
  tabId: string
  projectId: string
  profileId: string
  documentPath: string
}

type PendingCloseTabAction = {
  kind: 'close-tab'
  tabId: string
}

type PendingDeleteDocumentAction = {
  kind: 'delete-document'
  documentPath: string
}

type PendingCreateNodeAction = {
  kind: 'document' | 'directory'
  directoryPath: string
  defaultName: string
}

function getSaveIndicator(
  activeTab: WorkspaceTab | null,
): string | null {
  if (activeTab == null) {
    return null
  }

  switch (activeTab.saveState) {
    case 'typing':
      return '输入中…'
    case 'save_queued':
      return '等待保存…'
    case 'saving_background':
      return '正在后台保存…'
    case 'leaving_with_pending_flush':
      return '正在保存后切换…'
    case 'save_failed_retryable':
      return `保存失败${activeTab.saveErrorMessage ? `：${activeTab.saveErrorMessage}` : ''}`
    case 'conflict_hard':
      return `正文冲突${activeTab.saveErrorMessage ? `：${activeTab.saveErrorMessage}` : ''}`
    case 'clean':
    default:
      return '已保存'
  }
}

function App() {
  const [projects, setProjects] = useState<ProjectRegistryRecord[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [graphOpen, setGraphOpen] = useState(false)
  const [graphIndex, setGraphIndex] = useState<LinkIndexPayload | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null)
  const [profileIds, setProfileIds] = useState(['default'])
  const [activeProfileId, setActiveProfileId] = useState('default')
  const [session, setSession] = useState<WorkspaceSession>(createEmptySession)
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([])
  const [treeEntriesByPath, setTreeEntriesByPath] = useState<Map<string, ProjectTreeDocumentEntry>>(() => new Map())
  const [hiddenPaths, setHiddenPaths] = useState<string[]>([])
  const [favoritePaths, setFavoritePaths] = useState<string[]>([])
  const [manualNodeOrderByParent, setManualNodeOrderByParent] = useState<ManualNodeOrderByParent>({})
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [showRecentOnly, setShowRecentOnly] = useState(false)
  const [showHiddenItems, setShowHiddenItems] = useState(false)
  const [isDocumentLoading, setIsDocumentLoading] = useState(false)
  const [isFileTreeRefreshing, setIsFileTreeRefreshing] = useState(false)
  const [workspaceSource, setWorkspaceSource] = useState<WorkspaceSource>('offline')
  const [isServiceActionPending, setIsServiceActionPending] = useState(false)
  const [pendingWorkspaceAction, setPendingWorkspaceAction] = useState<PendingWorkspaceAction | null>(null)
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false)
  const [isProjectInputOpen, setIsProjectInputOpen] = useState(false)
  const [projectOperationBusy, setProjectOperationBusy] = useState(false)
  const projectOperationBusyRef = useRef(false)
  const [workspaceInputBlocked, setWorkspaceInputBlocked] = useState(false)
  const workspaceInputBlockedRef = useRef(false)
  const registrySnapshots = useRef(new Map<string, ProjectsSnapshot>())
  const [pendingRegistry, setPendingRegistry] = useState<{ profileId: string; expectedRevision: number } | null>(null)
  const pendingRegistryRef = useRef<typeof pendingRegistry>(null)
  const [pendingRefreshDocumentAction, setPendingRefreshDocumentAction] =
    useState<PendingRefreshDocumentAction | null>(null)
  const [pendingCloseTabAction, setPendingCloseTabAction] = useState<PendingCloseTabAction | null>(null)
  const [pendingDeleteDocumentAction, setPendingDeleteDocumentAction] =
    useState<PendingDeleteDocumentAction | null>(null)
  const [pendingCreateNodeAction, setPendingCreateNodeAction] = useState<PendingCreateNodeAction | null>(null)
  const [pendingCreateNodeName, setPendingCreateNodeName] = useState('')
  const [statusMessage, setStatusMessage] = useState<string | null>('正在恢复工作区…')
  const [actionToast, setActionToast] = useState<WorkspaceActionToast | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [outlineWidth, setOutlineWidth] = useState(320)
  const [expandedFileNodes, setExpandedFileNodes] = useState<string[]>([])
  const [hasPersistedExpandedFileNodes, setHasPersistedExpandedFileNodes] = useState(false)
  const [documentFontSize, setDocumentFontSize] = useState(16)
  const [maxUnpinnedTabs, setMaxUnpinnedTabs] = useState(10)
  const maxUnpinnedTabsRef = useRef(10)
  const persistedMaxUnpinnedTabsRef = useRef(10)
  const maxTabsRevisionRef = useRef(0)
  const [documentPageWidth, setDocumentPageWidth] = useState<PageWidthMode>('narrow')
  const [documentLineHeight, setDocumentLineHeight] = useState<DocumentLineHeight>(1.6)
  const [hideFileTitleDate, setHideFileTitleDate] = useState(false)
  const [isWorkspaceBootstrapping, setIsWorkspaceBootstrapping] = useState(true)
  const [pendingHeadingId, setPendingHeadingId] = useState<string | null>(null)
  const [documentScrollRestoreId, setDocumentScrollRestoreId] = useState(0)
  const activeTab = getActiveTab(session)
  const mode = session.mode
  const regularViewState = session.regularViewState
  const currentDocumentPath = activeTab?.documentPath ?? null
  const currentDocumentContent = activeTab?.persistedContent ?? null
  const editingDocumentContent = activeTab?.draftContent ?? null
  const currentDocumentMtimeMs = activeTab?.mtimeMs ?? null
  const saveState = activeTab?.saveState ?? 'clean'
  const { visibleNodes: visibleAfterHidden, availableDirectoryPaths } = useMemo(
    () =>
      createVisibleFileTree({
        sourceNodes: fileTree,
        hiddenPaths,
        showHiddenItems,
      }),
    [fileTree, hiddenPaths, showHiddenItems],
  )
  const strictVisibleNodes = useMemo(
    () => createVisibleFileTree({ sourceNodes: fileTree, hiddenPaths, showHiddenItems: false }).visibleNodes,
    [fileTree, hiddenPaths],
  )
  const recentAtMsByPath = useMemo(
    () => new Map([...treeEntriesByPath].map(([path, entry]) => [path, entry.recentAtMs])),
    [treeEntriesByPath],
  )
  const recentFileNodes = useMemo(
    () => collectRecentFileTreeNodes(strictVisibleNodes, recentAtMsByPath, RECENT_DOCUMENT_LIMIT),
    [recentAtMsByPath, strictVisibleNodes],
  )
  const hiddenPathSet = useMemo(() => new Set(hiddenPaths), [hiddenPaths])
  const strictVisibleDocumentPaths = useMemo(
    () => new Set(collectDocumentPaths(strictVisibleNodes)),
    [strictVisibleNodes],
  )
  const isCurrentDocumentHiddenInRecent =
    currentDocumentPath != null &&
    (isPathExplicitlyHidden(currentDocumentPath, hiddenPathSet) ||
      isPathHiddenByAncestor(currentDocumentPath, hiddenPathSet))
  const isCurrentDocumentUnavailableInRecent =
    currentDocumentPath != null &&
    !isCurrentDocumentHiddenInRecent &&
    !strictVisibleDocumentPaths.has(currentDocumentPath)
  const isCurrentDocumentOutsideRecent =
    currentDocumentPath != null &&
    !isCurrentDocumentHiddenInRecent &&
    !isCurrentDocumentUnavailableInRecent &&
    !recentFileNodes.some((node) => node.path === currentDocumentPath)
  const visibleFileTree = useMemo(
    () =>
      showRecentOnly
        ? recentFileNodes
        : showFavoritesOnly
        ? filterFileTreeByFavorites(visibleAfterHidden, favoritePaths)
        : visibleAfterHidden,
    [favoritePaths, recentFileNodes, showFavoritesOnly, showRecentOnly, visibleAfterHidden],
  )
  const documentLinkPaths = useMemo(() => collectDocumentPaths(fileTree), [fileTree])
  const autosaveTimerRef = useRef<number | null>(null)
  const actionToastTimerRef = useRef<number | null>(null)
  const flushPromiseRef = useRef<Promise<boolean> | null>(null)
  const pendingTabSavesRef = useRef(new Map<symbol, number>())
  const activeProjectIdRef = useRef<string | null>(null)
  const activeProfileIdRef = useRef(activeProfileId)
  const sessionRef = useRef(session)
  const pendingProfileWritesRef = useRef(new Map<string, Promise<void>>())
  const getCoordinatedProfile = useCallback(async (projectId: string, profileId: string, source: WorkspaceSource) => {
    await pendingProfileWritesRef.current.get(profileWriteKey(projectId, profileId, source))
    return source === 'local-service'
      ? getProfileFromBridge(projectId, profileId, profileId)
      : profileStore.getProfile(projectId, profileId)
  }, [])
  const currentDocumentPathRef = useRef<string | null>(null)
  const currentDocumentContentRef = useRef<string | null>(null)
  const editingDocumentContentRef = useRef<string | null>(null)
  const currentDocumentMtimeRef = useRef<number | null>(null)
  const saveStateRef = useRef<TabSaveState>('clean')
  const draftRevisionRef = useRef(0)
  const saveRequestRevisionRef = useRef(0)
  const lastAckedSaveRevisionRef = useRef(0)
  const isComposingRef = useRef(false)
  const hasHydratedActiveProfileRef = useRef(false)
  const actionToastIdRef = useRef(0)
  const navigationRequestRef = useRef(0)
  const documentLoadingRevisionRef = useRef(0)
  const scrollPositionTimerRef = useRef<number | null>(null)
  const latestScrollPositionsRef = useRef(new Map<string, number>())
  const workspaceLoadRevisionRef = useRef(0)
  const projectSwitchCommitRef = useRef(Promise.resolve())

  function beginTabSave(instanceId: symbol | undefined) {
    if (!instanceId) return () => {}
    const counts = pendingTabSavesRef.current
    counts.set(instanceId, (counts.get(instanceId) ?? 0) + 1)
    return () => {
      const remaining = (counts.get(instanceId) ?? 1) - 1
      if (remaining > 0) counts.set(instanceId, remaining)
      else counts.delete(instanceId)
    }
  }

  async function persistCurrentSession(projectId: string, profileId: string) {
    try {
      await localStateStore.updateState(projectId, profileId, (state) => {
        if (activeProjectIdRef.current !== projectId || activeProfileIdRef.current !== profileId) return state
        const current = sessionRef.current
        return {
          ...state,
          openDocumentPaths: current.tabs.map((tab) => tab.documentPath),
          activeDocumentPath: getActiveTab(current)?.documentPath ?? null,
          activeMode: current.mode,
          regularViewState: current.regularViewState,
          ...sessionTabMetadata(current),
        }
      })
      return true
    } catch (error) {
      if (activeProjectIdRef.current === projectId && activeProfileIdRef.current === profileId) {
        setStatusMessage(error instanceof Error ? `会话保存失败：${error.message}` : '会话保存失败')
      }
      return false
    }
  }

  function clearScrollPositionTimer() {
    if (scrollPositionTimerRef.current != null) {
      window.clearTimeout(scrollPositionTimerRef.current)
      scrollPositionTimerRef.current = null
    }
  }

  async function persistDocumentScrollPosition(projectId: string, profileId: string, documentPath: string, scrollTop: number) {
    try {
      await localStateStore.updateState(projectId, profileId, (localState) => ({
        ...localState,
        tabStateByDocument: { ...localState.tabStateByDocument, [documentPath]: { lastKnownScrollTop: scrollTop } },
      }))
      return true
    } catch (error) {
      if (activeProjectIdRef.current === projectId && activeProfileIdRef.current === profileId) {
        setStatusMessage(error instanceof Error ? `会话保存失败：${error.message}` : '会话保存失败')
      }
      return false
    }
  }

  async function flushDocumentScrollPosition(documentPath?: string): Promise<boolean> {
    clearScrollPositionTimer()
    const projectId = activeProjectIdRef.current
    const targetPath = documentPath ?? currentDocumentPathRef.current
    const scrollTop = targetPath ? latestScrollPositionsRef.current.get(targetPath) : null
    if (!projectId || !targetPath || scrollTop == null) return true
    return persistDocumentScrollPosition(projectId, activeProfileIdRef.current, targetPath, scrollTop)
  }

  function handleDocumentScrollTopChange(documentPath: string, scrollTop: number) {
    if (!Number.isFinite(scrollTop) || scrollTop < 0) return
    latestScrollPositionsRef.current.set(documentPath, scrollTop)
    setSession((current) => {
      const tab = getTabByDocumentPath(current, documentPath)
      return tab && tab.lastKnownScrollTop !== scrollTop
        ? replaceTab(current, { ...tab, lastKnownScrollTop: scrollTop })
        : current
    })
    clearScrollPositionTimer()
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    scrollPositionTimerRef.current = window.setTimeout(
      () => {
        scrollPositionTimerRef.current = null
        if (projectId) void persistDocumentScrollPosition(projectId, profileId, documentPath, scrollTop)
      },
      250,
    )
  }

  function clearSaveFailureStatus(projectId: string | null) {
    setStatusMessage((current) => {
      if (!current?.startsWith('保存失败：')) {
        return current
      }

      const projectName =
        projectId == null ? null : projects.find((entry) => entry.id === projectId)?.name ?? '当前项目'

      return projectName ? `当前项目：${projectName}` : current
    })
  }

  function buildOrderedFileTree(markdownPaths: string[], orderMap: ManualNodeOrderByParent) {
    return applyManualTreeOrder(buildFileTree(markdownPaths), orderMap)
  }

  async function persistManualNodeOrder(
    nextManualNodeOrderByParent: ManualNodeOrderByParent,
    options?: {
      refreshPaths?: string[]
    },
  ) {
    setManualNodeOrderByParent(nextManualNodeOrderByParent)

    const nextPaths = options?.refreshPaths
    if (nextPaths) {
      setFileTree(buildOrderedFileTree(nextPaths, nextManualNodeOrderByParent))
    }

    await saveActiveProfileNavigation({
      manualNodeOrderByParent: nextManualNodeOrderByParent,
    })
  }

  function clearActionToastTimer() {
    if (actionToastTimerRef.current != null) {
      window.clearTimeout(actionToastTimerRef.current)
      actionToastTimerRef.current = null
    }
  }

  function showActionToast(message: string, tone: WorkspaceActionToast['tone'] = 'success') {
    actionToastIdRef.current += 1
    setActionToast({
      id: actionToastIdRef.current,
      message,
      tone,
    })
  }

  function publishActionFeedback(
    message: string,
    tone: WorkspaceActionToast['tone'] = 'success',
    statusOverride?: string,
  ) {
    setStatusMessage(statusOverride ?? message)
    showActionToast(message, tone)
  }

  function getDirtyTabs(nextSession = sessionRef.current): WorkspaceTab[] {
    return nextSession.tabs.filter(
      (tab) => tab.persistedContent != null && tab.draftContent != null && tab.draftContent !== tab.persistedContent,
    )
  }

  function clearAutosaveTimer() {
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }

  function discardTabDraft(tabId: string) {
    const current = sessionRef.current
    const tab = current.tabs.find((entry) => entry.id === tabId)
    if (tab == null || tab.persistedContent == null) return
    const next = replaceTab(current, { ...tab, draftContent: tab.persistedContent, saveState: 'clean', saveErrorMessage: null })
    sessionRef.current = next
    setSession(next)
  }

  function discardDirtyTabs(tabIds: string[]) {
    setSession((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tabIds.includes(tab.id) && tab.persistedContent != null
          ? {
              ...tab,
              draftContent: tab.persistedContent,
              saveState: 'clean',
              saveErrorMessage: null,
            }
          : tab,
      ),
    }))
  }

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId
  }, [activeProjectId])

  useEffect(() => {
    activeProfileIdRef.current = activeProfileId
  }, [activeProfileId])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    currentDocumentPathRef.current = currentDocumentPath
  }, [currentDocumentPath])

  useEffect(() => {
    currentDocumentContentRef.current = currentDocumentContent
  }, [currentDocumentContent])

  useEffect(() => {
    editingDocumentContentRef.current = editingDocumentContent
  }, [editingDocumentContent])

  useEffect(() => {
    currentDocumentMtimeRef.current = currentDocumentMtimeMs
  }, [currentDocumentMtimeMs])

  useEffect(() => {
    saveStateRef.current = saveState
  }, [saveState])

  const bootstrapWorkspace = useEffectEvent(async () => {
      const locator = parseWorkspaceLocator()
      const deepLink = locator && locator !== 'invalid' && 'documentPath' in locator ? locator : null
      const restoredActiveProfileId =
        (await storage.getItem<string>(STORAGE_KEYS.activeProfile())) ?? 'default'
      const initialProfileId = locator && locator !== 'invalid' ? locator.profileId : restoredActiveProfileId
      hasHydratedActiveProfileRef.current = true
      activeProfileIdRef.current = initialProfileId
      setActiveProfileId(initialProfileId)

      const source = await workspaceProvider.getSource()
      setWorkspaceSource(source)

      if (source === 'local-service') {
        const health = await getLocalBridgeHealth()
        const snapshot = await workspaceProvider.listProjects(initialProfileId)
        registrySnapshots.current.set(initialProfileId, snapshot)
        setProjects(snapshot.projects)
        setActiveProjectId(locator && locator !== 'invalid' ? locator.projectId : snapshot.activeProjectId)
        setProfileIds(
          initialProfileId === 'default'
            ? ['default']
            : Array.from(new Set(['default', initialProfileId])),
        )

        if (locator === 'invalid') {
          setActiveProjectId(null)
          resetSessionState()
          setFileTree([])
          setStatusMessage('工作区链接无效，未恢复项目')
          setIsWorkspaceBootstrapping(false)
          return
        }

        if (locator && !snapshot.projects.some((project) => project.id === locator.projectId)) {
          setActiveProjectId(null)
          resetSessionState()
          setFileTree([])
          setStatusMessage('工作区链接中的项目不存在，未恢复项目')
          setIsWorkspaceBootstrapping(false)
          return
        }

        const initialProjectId = locator?.projectId ?? snapshot.activeProjectId
        if (!initialProjectId) {
          setIsWorkspaceBootstrapping(false)
          setStatusMessage(
            (health.projectsLoaded ?? 0) > 0
              ? '本地服务已连接，但当前 profile 还没有激活项目'
              : '本地服务已连接，等待接入 Markdown 项目',
          )
          return
        }

        const restored = await loadLocalServiceProject(
          initialProjectId,
          snapshot.projects,
          initialProfileId,
          deepLink ?? undefined,
        )
        if (!restored && deepLink) setStatusMessage('分享链接中的文档不存在，未恢复工作区文档')
        setIsWorkspaceBootstrapping(false)
        return
      }

      setProjects([])
      setActiveProjectId(null)
      setFileTree([])
      resetSessionState()
      setStatusMessage('本地服务不可用')
      setIsWorkspaceBootstrapping(false)
  })
  useEffect(() => { void bootstrapWorkspace() }, [])

  useEffect(() => {
    if (actionToast == null) {
      clearActionToastTimer()
      return
    }

    clearActionToastTimer()
    actionToastTimerRef.current = window.setTimeout(() => {
      setActionToast((current) => (current?.id === actionToast.id ? null : current))
      actionToastTimerRef.current = null
    }, 2600)

    return () => {
      clearActionToastTimer()
    }
  }, [actionToast])

  useEffect(() => {
    if (!hasHydratedActiveProfileRef.current) {
      return
    }

    void storage.setItem(STORAGE_KEYS.activeProfile(), activeProfileId)
  }, [activeProfileId])

  useEffect(() => {
    if (!activeProjectId) {
      setProfileIds(previous => Array.from(new Set([...previous, 'default', activeProfileId])))
      setSidebarWidth(280)
      setOutlineWidth(320)
      setExpandedFileNodes([])
      setHasPersistedExpandedFileNodes(false)
      setHiddenPaths([])
      setFavoritePaths([])
      setManualNodeOrderByParent({})
      setShowFavoritesOnly(false)
      setShowRecentOnly(false)
      setShowHiddenItems(false)
      setDocumentFontSize(16)
      setMaxUnpinnedTabs(10)
      maxUnpinnedTabsRef.current = 10
      persistedMaxUnpinnedTabsRef.current = 10
      setDocumentPageWidth('narrow')
      setDocumentLineHeight(1.6)
      setHideFileTitleDate(false)
      return
    }

    let cancelled = false
    const maxTabsRevision = maxTabsRevisionRef.current

    void (async () => {
      const profile = await getCoordinatedProfile(activeProjectId, activeProfileId, workspaceSource)
      const nextProfileIds =
        workspaceSource === 'local-service'
          ? (await listProjectProfilesFromBridge(activeProjectId, activeProfileId)).profileIds
          : ['default']

      if (cancelled) {
        return
      }

      setProfileIds(nextProfileIds)
      setSidebarWidth(profile.layout.sidebarWidth)
      setOutlineWidth(profile.layout.outlineWidth)
      setExpandedFileNodes(profile.navigation?.expandedFileNodes ?? [])
      setHasPersistedExpandedFileNodes(
        profile.navigation?.expandedFileNodesInitialized ?? false,
      )
      setHiddenPaths(profile.navigation?.hiddenPaths ?? [])
      setFavoritePaths(profile.navigation?.favoritePaths ?? [])
      setManualNodeOrderByParent(profile.navigation?.manualNodeOrderByParent ?? {})
      setShowFavoritesOnly(false)
      setShowRecentOnly(false)
      setShowHiddenItems(false)
      setDocumentFontSize(profile.appearance?.fontSize ?? 16)
      if (maxTabsRevisionRef.current === maxTabsRevision) {
        maxUnpinnedTabsRef.current = normalizeMaxUnpinnedTabs(profile.appearance?.maxUnpinnedTabs)
        persistedMaxUnpinnedTabsRef.current = maxUnpinnedTabsRef.current
        setMaxUnpinnedTabs(maxUnpinnedTabsRef.current)
      }
      setDocumentPageWidth(profile.appearance?.pageWidth ?? 'narrow')
      setDocumentLineHeight(profile.appearance?.lineHeight ?? 1.6)
      setHideFileTitleDate(profile.appearance?.hideFileTitleDate ?? false)
    })()

    return () => {
      cancelled = true
    }
  }, [activeProjectId, activeProfileId, workspaceSource, getCoordinatedProfile])

  const clearFailureForEffect = useEffectEvent((projectId: string | null) => clearSaveFailureStatus(projectId))
  const scheduleAutosaveForEffect = useEffectEvent(() => scheduleAutosave())

  useEffect(() => {
    const hasDirtyDraft =
      activeProjectId != null &&
      activeTab != null &&
      activeTab.persistedContent != null &&
      activeTab.draftContent != null &&
      activeTab.draftContent !== activeTab.persistedContent

    if (!hasDirtyDraft) {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }

      if (
        saveStateRef.current !== 'saving_background' &&
        saveStateRef.current !== 'leaving_with_pending_flush'
      ) {
        setActiveTabState({
          saveErrorMessage: null,
          saveState: 'clean',
        })
      }

      clearFailureForEffect(activeProjectId)

      return
    }

    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    if (isComposingRef.current) {
      setActiveTabState({ saveState: 'save_queued' })
      autosaveTimerRef.current = null
      return
    }

    scheduleAutosaveForEffect()

    return () => {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [activeProjectId, activeTab])

  useEffect(() => {
    return () => {
      clearActionToastTimer()
    }
  }, [])

  function resetSessionState() {
    draftRevisionRef.current = 0
    saveRequestRevisionRef.current = 0
    lastAckedSaveRevisionRef.current = 0
    isComposingRef.current = false
    clearScrollPositionTimer()
    latestScrollPositionsRef.current.clear()
    const next = { ...sessionRef.current, tabs: [], tabOpenOrder: [], pinnedDocumentPaths: [], activeTabId: null }
    sessionRef.current = next
    setSession(next)
  }

  function setActiveTabState(nextState: Partial<WorkspaceTab>) {
    const current = sessionRef.current
    const tab = getActiveTab(current)
    if (!tab || !Object.entries(nextState).some(([key, value]) => tab[key as keyof WorkspaceTab] !== value)) return
    const next = replaceTab(current, { ...tab, ...nextState })
    sessionRef.current = next
    setSession(next)
  }

  function setDraftDocumentContent(nextContent: string) {
    if (workspaceInputBlockedRef.current) return
    const savedContent = getActiveTab(sessionRef.current)?.persistedContent ?? null
    const hasDirtyDraft = savedContent != null && nextContent !== savedContent
    editingDocumentContentRef.current = nextContent

    if (hasDirtyDraft) {
      draftRevisionRef.current += 1
    }

    setActiveTabState({
      draftContent: nextContent,
      saveErrorMessage: null,
      saveState: hasDirtyDraft ? 'typing' : 'clean',
    })
  }

  function scheduleAutosave() {
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      if (isComposingRef.current) {
        setActiveTabState({ saveState: 'save_queued' })
        autosaveTimerRef.current = null
        return
      }

      void flushActiveDraft('background')
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function handleEditingCompositionStart() {
    isComposingRef.current = true
  }

  function handleEditingCompositionEnd() {
    isComposingRef.current = false

    const savedContent = currentDocumentContentRef.current
    const draftContent = editingDocumentContentRef.current
    const hasDirtyDraft = savedContent != null && draftContent != null && draftContent !== savedContent

    if (hasDirtyDraft) {
      setActiveTabState({ saveState: 'typing' })
      scheduleAutosave()
    }
  }

  async function saveTabById(tabId: string, reason: 'background' | 'leave' = 'leave'): Promise<boolean> {
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    if (pendingRegistryRef.current || (projectId && registrySnapshots.current.has(profileId) && !registrySnapshots.current.get(profileId)!.projects.some(project => project.id === projectId))) {
      setStatusMessage('项目登记尚未确认或已被移除，草稿保留，请先确认工作区')
      return false
    }
    const tab = sessionRef.current.tabs.find((entry) => entry.id === tabId)
    if (!projectId || !tab) return false
    const updateTarget = (update: (current: WorkspaceTab) => WorkspaceTab) => {
      if (activeProjectIdRef.current !== projectId || activeProfileIdRef.current !== profileId) return false
      const current = sessionRef.current
      const target = current.tabs.find((entry) => entry.id === tabId && entry.instanceId === tab.instanceId)
      if (!target) return false
      const next = replaceTab(current, update(target))
      sessionRef.current = next
      setSession(next)
      return true
    }
    if (tab.draftContent == null || tab.persistedContent == null || tab.draftContent === tab.persistedContent) {
      updateTarget((current) => ({ ...current, saveState: 'clean', saveErrorMessage: null }))
      clearSaveFailureStatus(projectId)
      return true
    }
    if (sessionRef.current.activeTabId === tabId) clearAutosaveTimer()
    updateTarget((current) => ({ ...current, saveState: reason === 'leave' ? 'leaving_with_pending_flush' : 'saving_background', saveErrorMessage: null }))
    const finishTabSave = beginTabSave(tab.instanceId)
    const applySaved = (document: { content: string; mtimeMs: number; treeEntry?: ProjectTreeDocumentEntry }, warning: string | null = null) => {
      const applied = updateTarget((current) => {
        const draft = current.draftContent === tab.draftContent ? document.content : current.draftContent
        return { ...current, persistedContent: document.content, draftContent: draft, mtimeMs: document.mtimeMs,
          saveState: draft === document.content ? 'clean' : 'typing', saveErrorMessage: warning }
      })
      if (applied && document.treeEntry) setTreeEntriesByPath((current) => new Map(current).set(document.treeEntry!.path, document.treeEntry!))
      if (applied && !warning) clearSaveFailureStatus(projectId)
      return applied
    }
    try {
      const document = await saveDocumentContentToBridge(projectId, profileId, tab.documentPath, tab.draftContent,
        tab.mtimeMs, tab.persistedContent ? createContentHash(tab.persistedContent) : null)
      applySaved(document)
      return true
    } catch (error) {
      if (error instanceof BridgeDocumentSavedCacheInvalidationError) {
        if (applySaved(error.document, error.message)) setStatusMessage(`文件已保存，但最近索引同步失败：${error.message}`)
        return true
      }
      const message = formatSaveErrorMessage(error instanceof Error ? error.message : '保存失败')
      if (updateTarget((current) => ({ ...current, saveState: error instanceof BridgeDocumentConflictError ? 'conflict_hard' : 'save_failed_retryable', saveErrorMessage: message }))) {
        setStatusMessage(`保存失败：${message}`)
      }
      return false
    } finally {
      finishTabSave()
    }
  }

  async function flushDirtyTabs(tabIds: string[]): Promise<boolean> {
    for (const tabId of tabIds) {
      const isSaved = await saveTabById(tabId, 'leave')
      if (!isSaved) {
        return false
      }
    }

    return true
  }

  async function flushAllDirtyTabs(): Promise<boolean> {
    return flushDirtyTabs(getDirtyTabs().map((tab) => tab.id))
  }

  async function flushActiveDraft(reason: 'background' | 'leave' = 'leave'): Promise<boolean> {
    if (pendingRegistryRef.current) return false
    if (flushPromiseRef.current) {
      return flushPromiseRef.current
    }

    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    if (projectId && registrySnapshots.current.has(profileId) && !registrySnapshots.current.get(profileId)!.projects.some(project => project.id === projectId)) {
      setStatusMessage('当前项目已从列表移除，草稿保留，请先处理草稿再切换')
      return false
    }
    const sourceTab = getActiveTab(sessionRef.current)
    const documentPath = sourceTab?.documentPath ?? null
    const savedContent = sourceTab?.persistedContent ?? null
    const draftContent = sourceTab?.draftContent ?? null
    const expectedMtimeMs = sourceTab?.mtimeMs ?? null

    if (!projectId || !documentPath || draftContent == null || draftContent === savedContent) {
      setActiveTabState({
        saveErrorMessage: null,
        saveState: 'clean',
      })
      clearSaveFailureStatus(projectId)
      return true
    }

    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }

    setActiveTabState({
      saveState: reason === 'leave' ? 'leaving_with_pending_flush' : 'saving_background',
      saveErrorMessage: null,
    })
    const finishTabSave = beginTabSave(sourceTab?.instanceId)

    const updateSavingTab = (update: (tab: WorkspaceTab) => WorkspaceTab) => {
      if (activeProjectIdRef.current !== projectId || activeProfileIdRef.current !== profileId) return false
      const current = sessionRef.current
      const tab = current.tabs.find((item) => item.id === sourceTab?.id && item.instanceId === sourceTab?.instanceId)
      if (!tab) return false
      const next = replaceTab(current, update(tab))
      sessionRef.current = next
      setSession(next)
      return true
    }

    const flushPromise = (async () => {
      const requestRevision = saveRequestRevisionRef.current + 1
      saveRequestRevisionRef.current = requestRevision
      const expectedContentHash = savedContent == null ? null : createContentHash(savedContent)

      const applySavedDocument = (document: {
        content: string
        mtimeMs: number
        treeEntry?: ProjectTreeDocumentEntry
      }) => {
        if (requestRevision <= lastAckedSaveRevisionRef.current) {
          return
        }

        lastAckedSaveRevisionRef.current = requestRevision
        if (updateSavingTab((tab) => ({
            ...tab,
            persistedContent: document.content,
            mtimeMs: document.mtimeMs,
            saveErrorMessage: null,
            draftContent: tab.draftContent === draftContent ? document.content : tab.draftContent,
            saveState: tab.draftContent === draftContent ? 'clean' : 'typing',
          }))) {
          if (document.treeEntry) {
            setTreeEntriesByPath((current) => new Map(current).set(document.treeEntry!.path, document.treeEntry!))
          }
          clearSaveFailureStatus(projectId)
        }
      }

      try {
        let document

        try {
          document = await saveDocumentContentToBridge(
            projectId,
            profileId,
            documentPath,
            draftContent,
            expectedMtimeMs,
            expectedContentHash,
          )
        } catch (error) {
          if (error instanceof BridgeDocumentSavedCacheInvalidationError) {
            applySavedDocument(error.document)
            if (error.document.treeEntry) setTreeEntriesByPath((current) => new Map(current).set(error.document.treeEntry!.path, error.document.treeEntry!))
            setStatusMessage(`文件已保存，但最近索引同步失败：${error.message}`)
            return true
          }
          if (!(error instanceof BridgeDocumentConflictError)) {
            throw error
          }
          throw error
        }

        applySavedDocument(document)
        return true
      } catch (error) {
        if (
          requestRevision < saveRequestRevisionRef.current ||
          requestRevision <= lastAckedSaveRevisionRef.current
        ) {
          return false
        }

        const message = formatSaveErrorMessage(error instanceof Error ? error.message : '保存失败')
        if (updateSavingTab((tab) => ({ ...tab, saveErrorMessage: message,
          saveState: error instanceof BridgeDocumentConflictError ? 'conflict_hard' : 'save_failed_retryable' }))) {
          setStatusMessage(`保存失败：${message}`)
        }
        return false
      } finally {
        finishTabSave()
        flushPromiseRef.current = null
      }
    })()

    flushPromiseRef.current = flushPromise
    return flushPromise
  }

  async function loadLocalServiceProject(
    projectId: string,
    nextProjects = projects,
    nextProfileId = activeProfileId,
    deepLink?: DeepLinkTarget,
    shouldApply: () => boolean = () => true,
  ) {
    const project = nextProjects.find((entry) => entry.id === projectId)

    if (!project) {
      setActiveProjectId(null)
      setFileTree([])
      resetSessionState()
      setStatusMessage('当前 profile 还没有接入任何项目')
      return false
    }

    const snapshot = await workspaceProvider.getProjectTreeSnapshot(project.id, nextProfileId)
    if (!shouldApply()) return false
    const markdownPaths = snapshot.entries.map((entry) => entry.path)
    if (deepLink && !markdownPaths.includes(deepLink.documentPath)) {
      setActiveProjectId(project.id)
      setFileTree(buildOrderedFileTree(markdownPaths, {}))
      setTreeEntriesByPath(new Map(snapshot.entries.map((entry) => [entry.path, entry])))
      resetSessionState()
      return false
    }
    const profile = await getCoordinatedProfile(project.id, nextProfileId, 'local-service')
    const restoredLocalState = deepLink
      ? normalizeLocalStateSnapshot({
          openDocumentPaths: [deepLink.documentPath],
          activeDocumentPath: deepLink.documentPath,
          activeMode: 'regular',
          regularViewState: 'locked',
        })
      : normalizeLocalStateSnapshot(
          (await localStateStore.getState(project.id, nextProfileId)) as Awaited<
            ReturnType<typeof localStateStore.getState>
          > & { activeMode: 'regular' | 'split' | 'read' | 'edit'; lastKnownScrollTop?: number },
        )
    if (!shouldApply()) return false
    const { state: localState, changed: localStateChanged } = reconcileLocalStateWithFileTree(
      restoredLocalState,
      markdownPaths,
    )
    const openDocumentPaths = localState.openDocumentPaths
    const tabStateByDocument = localState.tabStateByDocument
    const tabs = openDocumentPaths.map(
      (documentPath) =>
        createWorkspaceTab(
          documentPath,
          tabStateByDocument[documentPath]?.lastKnownScrollTop ?? 0,
        ),
    )
    const nextActiveDocumentPath =
      localState.activeDocumentPath &&
      openDocumentPaths.includes(localState.activeDocumentPath)
        ? localState.activeDocumentPath
        : openDocumentPaths[0] ?? null
    const restoredSession: WorkspaceSession = {
      tabs,
      tabOpenOrder: localState.tabOpenOrder,
      pinnedDocumentPaths: localState.pinnedDocumentPaths,
      activeTabId: nextActiveDocumentPath ? createTabId(nextActiveDocumentPath) : null,
      mode: normalizeWorkspaceMode(localState.activeMode),
      regularViewState:
        localState.regularViewState ?? inferRegularViewStateFromMode(localState.activeMode),
    }

    const orderedFileTree = buildOrderedFileTree(
      markdownPaths,
      profile.navigation?.manualNodeOrderByParent ?? {},
    )
    const nextFavoritePaths = pruneFavoritePaths(
      orderedFileTree,
      profile.navigation?.favoritePaths ?? [],
    )

    activeProjectIdRef.current = project.id
    clearScrollPositionTimer()
    latestScrollPositionsRef.current.clear()
    maxTabsRevisionRef.current += 1
    maxUnpinnedTabsRef.current = normalizeMaxUnpinnedTabs(profile.appearance?.maxUnpinnedTabs)
    persistedMaxUnpinnedTabsRef.current = maxUnpinnedTabsRef.current
    setMaxUnpinnedTabs(maxUnpinnedTabsRef.current)
    setActiveProjectId(project.id)
    setManualNodeOrderByParent(profile.navigation?.manualNodeOrderByParent ?? {})
    setFavoritePaths(nextFavoritePaths)
    setFileTree(orderedFileTree)
    setTreeEntriesByPath(new Map(snapshot.entries.map((entry) => [entry.path, entry])))
    sessionRef.current = restoredSession
    setSession(restoredSession)
    setStatusMessage(
      markdownPaths.length > 0 ? `当前项目：${project.name}` : `当前项目：${project.name}，但还没有发现 Markdown 文件`,
    )

    if (localStateChanged) {
      await localStateStore.updateState(project.id, nextProfileId, (current) => {
        if (!shouldApply() || activeProjectIdRef.current !== project.id || activeProfileIdRef.current !== nextProfileId) return current
        const cleaned = reconcileLocalStateWithFileTree(normalizeLocalStateSnapshot(current), markdownPaths).state
        const latest = sessionRef.current
        return { ...cleaned, openDocumentPaths: latest.tabs.map((tab) => tab.documentPath),
          activeDocumentPath: getActiveTab(latest)?.documentPath ?? null, activeMode: latest.mode,
          regularViewState: latest.regularViewState, ...sessionTabMetadata(latest) }
      })
    }

    if (nextFavoritePaths.length !== (profile.navigation?.favoritePaths ?? []).length) {
      await updateProfile(project.id, nextProfileId, 'local-service', (current) => ({
        ...current, navigation: { ...current.navigation,
          favoritePaths: pruneFavoritePaths(orderedFileTree, current.navigation?.favoritePaths ?? []) },
      }))
    }

    if (nextActiveDocumentPath) {
      const loaded = await loadDocumentContent(project, nextActiveDocumentPath, nextProfileId, shouldApply)
      if (loaded === 'stale') return true
      if (loaded === 'failed') {
        const original = tabs.find((tab) => tab.documentPath === nextActiveDocumentPath)
        const current = sessionRef.current
        if (!shouldApply() || activeProjectIdRef.current !== project.id || activeProfileIdRef.current !== nextProfileId ||
          current.tabs.some((tab) => tab.instanceId !== original?.instanceId)) return true
        if (deepLink && shouldApply() && activeProjectIdRef.current === project.id &&
          activeProfileIdRef.current === nextProfileId && current.tabs.length === 1 &&
          current.tabs[0]?.instanceId === original?.instanceId && current.activeTabId === original?.id) {
          resetSessionState()
        }
        return false
      }
      if (deepLink) {
        const original = tabs.find((tab) => tab.documentPath === nextActiveDocumentPath)
        if (!shouldApply() || activeProjectIdRef.current !== project.id || activeProfileIdRef.current !== nextProfileId ||
          sessionRef.current.activeTabId !== original?.id ||
          getTabByDocumentPath(sessionRef.current, nextActiveDocumentPath)?.instanceId !== original?.instanceId) return true
        setPendingHeadingId(deepLink.headingId)
        window.history.replaceState(null, '', createDocumentShareHref(project.id, nextProfileId, nextActiveDocumentPath, deepLink.headingId))
      }
    } else {
      resetSessionState()
    }
    return true
  }

  function recordRegistry(snapshot: ProjectsSnapshot, profileId: string, apply = true) {
    const previous = registrySnapshots.current.get(profileId)
    if (previous && previous.revision > snapshot.revision) return
    registrySnapshots.current.set(profileId, snapshot)
    if (apply && activeProfileIdRef.current === profileId) {
      setProjects(snapshot.projects)
      if (snapshot.lockCleanupWarning) setStatusMessage(snapshot.lockCleanupWarning)
    }
  }

  async function registryCommand<T extends ProjectsSnapshot | { snapshot: ProjectsSnapshot }>(
    profileId: string,
    expectedRevision: number,
    command: () => Promise<T>,
    blockInput = false,
  ): Promise<T | null> {
    const generation = workspaceLoadRevisionRef.current
    if (blockInput) { workspaceInputBlockedRef.current = true; setWorkspaceInputBlocked(true) }
    try {
      const result = await command()
      const snapshot = ('snapshot' in result ? result.snapshot : result) as ProjectsSnapshot
      recordRegistry(snapshot, profileId, generation === workspaceLoadRevisionRef.current)
      return result
    } catch (error) {
      if (error instanceof RegistryRequestError && error.outcomeUnknown) {
        const pending = { profileId, expectedRevision }
        pendingRegistryRef.current = pending
        setPendingRegistry(pending)
      } else if (error instanceof RegistryRequestError && error.code === 'REGISTRY_CONFLICT') {
        try { recordRegistry(await workspaceProvider.listProjects(profileId), profileId, generation === workspaceLoadRevisionRef.current) } catch { /* Keep the confirmed snapshot and drafts. */ }
      }
      setStatusMessage(error instanceof Error ? error.message : '项目列表操作失败')
      return null
    } finally {
      if (blockInput) { workspaceInputBlockedRef.current = false; setWorkspaceInputBlocked(false) }
    }
  }

  async function runProjectOperation(action: () => Promise<void>) {
    if (projectOperationBusyRef.current || pendingRegistryRef.current) return
    projectOperationBusyRef.current = true
    setProjectOperationBusy(true)
    try { await action() }
    catch (error) { setStatusMessage(error instanceof Error ? error.message : '项目操作失败') }
    finally {
      projectOperationBusyRef.current = false; setProjectOperationBusy(false)
      const warning = registrySnapshots.current.get(activeProfileIdRef.current)?.lockCleanupWarning
      if (warning) setStatusMessage(warning)
    }
  }

  function clearProjectWorkspace(profileId: string) {
    activeProfileIdRef.current = profileId
    activeProjectIdRef.current = null
    setActiveProjectId(null)
    setPendingProjectId(null)
    setFileTree([])
    setTreeEntriesByPath(new Map())
    setFavoritePaths([])
    setManualNodeOrderByParent({})
    resetSessionState()
    setIsWorkspaceBootstrapping(false)
    window.history.replaceState(null, '', window.location.pathname)
    setStatusMessage('当前个人配置没有接入项目，可以添加项目')
  }

  function commitPreparedWorkspace(prepared: NonNullable<Awaited<ReturnType<typeof prepareLocalServiceWorkspace>>>, profileId: string) {
    activeProjectIdRef.current = prepared.project.id
    clearScrollPositionTimer()
    latestScrollPositionsRef.current.clear()
    maxTabsRevisionRef.current += 1
    maxUnpinnedTabsRef.current = normalizeMaxUnpinnedTabs(prepared.profile.appearance?.maxUnpinnedTabs)
    persistedMaxUnpinnedTabsRef.current = maxUnpinnedTabsRef.current
    setMaxUnpinnedTabs(maxUnpinnedTabsRef.current)
    sessionRef.current = prepared.session
    setActiveProjectId(prepared.project.id)
    setPendingProjectId(null)
    setStatusMessage(`当前项目：${prepared.project.name}`)
    setManualNodeOrderByParent(prepared.profile.navigation?.manualNodeOrderByParent ?? {})
    setFavoritePaths(prepared.favoritePaths)
    setFileTree(prepared.orderedFileTree)
    setTreeEntriesByPath(new Map(prepared.snapshot.entries.map((entry) => [entry.path, entry])))
    setSession(prepared.session)
    replaceWorkspaceHref(prepared.project.id, profileId)
    window.requestAnimationFrame(() => performance.mark('project-tree-interactive'))

    setIsWorkspaceBootstrapping(false)
  }

  function loadPreparedDocument(prepared: Awaited<ReturnType<typeof prepareLocalServiceWorkspace>>, profileId: string) {
    if (!prepared.activeDocumentPath) return
    const generation = workspaceLoadRevisionRef.current
    void loadDocumentContent(prepared.project, prepared.activeDocumentPath, profileId, () =>
      generation === workspaceLoadRevisionRef.current && profileId === activeProfileIdRef.current && prepared.project.id === activeProjectIdRef.current,
    )
  }

  async function prepareLocalServiceWorkspace(
    project: ProjectRegistryRecord,
    profileId: string,
    options?: Parameters<typeof workspaceProvider.getProjectTreeSnapshot>[2],
  ) {
    const [snapshot, profile, restoredState] = await Promise.all([
      workspaceProvider.getProjectTreeSnapshot(project.id, profileId, options),
      getCoordinatedProfile(project.id, profileId, 'local-service'),
      localStateStore.getState(project.id, profileId),
    ])
    const markdownPaths = snapshot.entries.map((entry) => entry.path)
    const localState = normalizeLocalStateSnapshot(restoredState as Awaited<
      ReturnType<typeof localStateStore.getState>
    > & { activeMode: 'regular' | 'split' | 'read' | 'edit'; lastKnownScrollTop?: number })
    const reconciled = reconcileLocalStateWithFileTree(localState, markdownPaths).state
    const activeDocumentPath = reconciled.activeDocumentPath && reconciled.openDocumentPaths.includes(reconciled.activeDocumentPath)
      ? reconciled.activeDocumentPath
      : reconciled.openDocumentPaths[0] ?? null
    const session: WorkspaceSession = {
      tabs: reconciled.openDocumentPaths.map((documentPath) => createWorkspaceTab(
        documentPath,
        reconciled.tabStateByDocument[documentPath]?.lastKnownScrollTop ?? 0,
      )),
      tabOpenOrder: reconciled.tabOpenOrder,
      pinnedDocumentPaths: reconciled.pinnedDocumentPaths,
      activeTabId: activeDocumentPath ? createTabId(activeDocumentPath) : null,
      mode: normalizeWorkspaceMode(reconciled.activeMode),
      regularViewState: reconciled.regularViewState ?? inferRegularViewStateFromMode(reconciled.activeMode),
    }
    const orderedFileTree = buildOrderedFileTree(markdownPaths, profile.navigation?.manualNodeOrderByParent ?? {})
    const favoritePaths = pruneFavoritePaths(orderedFileTree, profile.navigation?.favoritePaths ?? [])
    return { project, markdownPaths, snapshot, profile, session, orderedFileTree, favoritePaths, activeDocumentPath }
  }

  async function switchLocalServiceProject(projectId: string, explicitProject?: ProjectRegistryRecord) {
    const requestedProject = explicitProject ?? registrySnapshots.current.get(activeProfileIdRef.current)?.projects.find(entry => entry.id === projectId)
    if (!requestedProject) return false

    const health = await getLocalBridgeHealth()
    if (!health.ok) {
      setStatusMessage('本地服务不可用，请重新启动服务后重试')
      return false
    }

    const profileId = activeProfileIdRef.current
    const revision = workspaceLoadRevisionRef.current + 1
    workspaceLoadRevisionRef.current = revision
    performance.mark('project-switch-requested')
    setPendingProjectId(projectId)
    setStatusMessage('正在切换项目…')
    window.requestAnimationFrame(() => {
      if (revision === workspaceLoadRevisionRef.current) {
        performance.mark('project-switch-identity-visible')
      }
    })

    let prepared
    let switchTimeout: number | null = null
    try {
      prepared = await Promise.race([
        prepareLocalServiceWorkspace(requestedProject, profileId, {
          onIndexing: async () => {
            if (revision !== workspaceLoadRevisionRef.current) return
            setStatusMessage('正在索引项目文件树…')
          },
        }),
        new Promise<never>((_, reject) => {
          switchTimeout = window.setTimeout(
            () => reject(new Error('项目准备超时：本地服务可能已停止或无响应，请重新启动服务后重试')),
            PROJECT_SWITCH_PREPARE_TIMEOUT_MS,
          )
        }),
      ])
    } catch (error) {
      if (revision === workspaceLoadRevisionRef.current) {
        setPendingProjectId(null)
        setStatusMessage(error instanceof Error ? `项目切换失败：${error.message}` : '项目切换失败')
      }
      return false
    } finally {
      if (switchTimeout != null) {
        window.clearTimeout(switchTimeout)
      }
    }
    if (!prepared || revision !== workspaceLoadRevisionRef.current) {
      if (!prepared && revision === workspaceLoadRevisionRef.current) {
        setPendingProjectId(null)
        setStatusMessage('项目切换失败：未能准备目标工作区')
      }
      return false
    }

    const commit = projectSwitchCommitRef.current.then(async () => {
      if (revision !== workspaceLoadRevisionRef.current) return false
      if (!(await flushDocumentScrollPosition())) {
        if (revision === workspaceLoadRevisionRef.current) setPendingProjectId(null)
        return false
      }
      if (revision !== workspaceLoadRevisionRef.current) return false
      if (getDirtyTabs().length > 0) throw new Error('准备期间有新的未保存内容，请处理后重新切换')
      const expected = registrySnapshots.current.get(profileId)?.revision
      if (expected === undefined) throw new Error('项目列表尚未确认，请刷新后重试')
      const next = await registryCommand(profileId, expected, () => workspaceProvider.setActiveProject(profileId, prepared.project.id, expected), true)
      if (!next) { if (revision === workspaceLoadRevisionRef.current) setPendingProjectId(null); return false }
      if (next.activeProjectId !== prepared.project.id) throw new Error('服务返回的当前项目不一致，请重试确认')
      if (revision !== workspaceLoadRevisionRef.current || activeProfileIdRef.current !== profileId) {
        return false
      }

      commitPreparedWorkspace(prepared, profileId)
      return true
    })
    projectSwitchCommitRef.current = commit.then(() => undefined, () => undefined)
    try {
      const didSwitch = await commit
      if (didSwitch && prepared.activeDocumentPath) {
        void loadDocumentContent(
          prepared.project,
          prepared.activeDocumentPath,
          profileId,
          () =>
            revision === workspaceLoadRevisionRef.current &&
            activeProjectIdRef.current === prepared.project.id &&
            activeProfileIdRef.current === profileId,
        )
      }
      return didSwitch
    } catch (error) {
      if (revision === workspaceLoadRevisionRef.current) {
        setPendingProjectId(null)
        setStatusMessage(error instanceof Error ? `项目切换失败：${error.message}` : '项目切换失败')
      }
      return false
    }
  }

  async function restoreLocalServiceWorkspace(profileId: string) {
    const source = await workspaceProvider.reprobeSource()
    if (source !== 'local-service') {
      throw new Error('本地服务仍不可用')
    }
    const health = await getLocalBridgeHealth()
    const snapshot = await workspaceProvider.listProjects(profileId)

    setWorkspaceSource('local-service')
    recordRegistry(snapshot, profileId)
    setProjects(snapshot.projects)
    setActiveProjectId(snapshot.activeProjectId)

    if (!snapshot.activeProjectId) {
      setStatusMessage(
        (health.projectsLoaded ?? 0) > 0
          ? '本地服务已连接，但当前 profile 还没有激活项目'
          : '本地服务已连接，等待接入 Markdown 项目',
      )
      return
    }

    await loadLocalServiceProject(snapshot.activeProjectId, snapshot.projects, profileId)
  }

  function handleConnectProject() {
    if (workspaceSource !== 'local-service') { setStatusMessage('本地服务不可用'); return }
    if (!projectOperationBusyRef.current && !pendingRegistryRef.current) setIsProjectInputOpen(true)
  }

  async function handleRegisterProject(rootPath: string) {
    await runProjectOperation(async () => {
      const profileId = activeProfileIdRef.current
      const snapshot = registrySnapshots.current.get(profileId)
      if (!snapshot) throw new Error('项目列表尚未确认，请刷新后重试')
      const result = await registryCommand(profileId, snapshot.revision, () => workspaceProvider.registerProject(profileId, rootPath, snapshot.revision))
      if (!result) return
      setIsProjectInputOpen(false)
      setStatusMessage('项目已添加，尚未切换')
      if (getDirtyTabs().length > 0) {
        setPendingWorkspaceAction({ kind: 'switch-project', projectId: result.project.id, project: result.project })
      } else if (!(await switchLocalServiceProject(result.project.id, result.project)) && !pendingRegistryRef.current) {
        setStatusMessage('项目已添加，尚未切换；请检查目标项目后重试')
      }
    })
  }

  async function removeRegisteredProject(projectId: string) {
    const profileId = activeProfileIdRef.current
    const snapshot = registrySnapshots.current.get(profileId)
    if (!snapshot) throw new Error('项目列表尚未确认')
    if (snapshot.activeProjectId !== activeProjectIdRef.current) {
      recordRegistry(await workspaceProvider.listProjects(profileId), profileId)
      throw new Error('其他窗口已改变当前项目，请先确认工作区再重试移除')
    }
    const index = snapshot.projects.findIndex(p => p.id === projectId)
    if (index < 0) return
    const removingCurrent = projectId === activeProjectIdRef.current
    const replacement = removingCurrent ? snapshot.projects[index + 1] ?? snapshot.projects[index - 1] : undefined
    const generation = removingCurrent ? ++workspaceLoadRevisionRef.current : workspaceLoadRevisionRef.current
    const prepared = replacement ? await prepareLocalServiceWorkspace(replacement, profileId) : null
    if (generation !== workspaceLoadRevisionRef.current || profileId !== activeProfileIdRef.current) return
    if (removingCurrent && getDirtyTabs().length > 0) throw new Error('准备期间有新的未保存内容，请处理后重新移除')
    const result = await registryCommand(profileId, snapshot.revision, () => workspaceProvider.unregisterProject(profileId, projectId, replacement?.id ?? null, snapshot.revision), removingCurrent)
    if (!result || generation !== workspaceLoadRevisionRef.current) return
    if (removingCurrent) {
      if (!result.activeProjectId) clearProjectWorkspace(profileId)
      else if (prepared && result.activeProjectId === prepared.project.id) {
        commitPreparedWorkspace(prepared, profileId)
        loadPreparedDocument(prepared, profileId)
      } else throw new Error('项目已移除，但替代工作区尚未恢复，请重试确认')
    }
    setStatusMessage(result.lockCleanupWarning ?? '已从列表移除，项目文件和阅读配置保留')
  }

  async function handleRemoveProject(projectId: string) {
    if (projectOperationBusyRef.current || pendingRegistryRef.current) return
    if (projectId === activeProjectIdRef.current && getDirtyTabs().length > 0) {
      setPendingWorkspaceAction({ kind: 'remove-project', projectId })
      return
    }
    await runProjectOperation(() => removeRegisteredProject(projectId))
  }

  async function handleProjectReorder(orderedIds: string[]) {
    await runProjectOperation(async () => {
      const profileId = activeProfileIdRef.current, snapshot = registrySnapshots.current.get(profileId)
      if (!snapshot) return
      const result = await registryCommand(profileId, snapshot.revision, () => workspaceProvider.reorderProjects(profileId, orderedIds, snapshot.revision))
      if (result) setStatusMessage(result.lockCleanupWarning ?? '项目顺序已保存')
    })
  }

  async function handleReconcileRegistry() {
    const pending = pendingRegistryRef.current
    if (!pending || projectOperationBusyRef.current) return
    projectOperationBusyRef.current = true; setProjectOperationBusy(true)
    try {
      const snapshot = await workspaceProvider.reconcileProjects(pending.profileId, pending.expectedRevision)
      recordRegistry(snapshot, pending.profileId)
      // Keep drafts on their original project; never carry them into another workspace.
      if (pending.profileId === activeProfileIdRef.current && !getDirtyTabs().length) {
        workspaceInputBlockedRef.current = true; setWorkspaceInputBlocked(true)
        if (!snapshot.activeProjectId) clearProjectWorkspace(pending.profileId)
        else if (snapshot.activeProjectId !== activeProjectIdRef.current) {
          const project = snapshot.projects.find(p => p.id === snapshot.activeProjectId)!
          const prepared = await prepareLocalServiceWorkspace(project, pending.profileId)
          if (getDirtyTabs().length) throw new Error('检测到新的未保存内容，草稿保留，请先处理后重试确认')
          commitPreparedWorkspace(prepared, pending.profileId)
          loadPreparedDocument(prepared, pending.profileId)
        }
      }
      pendingRegistryRef.current = null; setPendingRegistry(null)
      setStatusMessage(snapshot.lockCleanupWarning ?? (getDirtyTabs().length ? '列表已确认，原工作区草稿保留；请处理草稿后再切换' : '项目列表已确认'))
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : '暂时无法确认，请重试') }
    finally {
      workspaceInputBlockedRef.current = false; setWorkspaceInputBlocked(false)
      projectOperationBusyRef.current = false; setProjectOperationBusy(false)
    }
  }

  async function closeTabInternal(tabId: string) {
    navigationRequestRef.current += 1
    documentLoadingRevisionRef.current += 1
    setIsDocumentLoading(false)
    if (!activeProjectIdRef.current) {
      return
    }

    const currentSession = sessionRef.current
    const closingIndex = currentSession.tabs.findIndex((tab) => tab.id === tabId)
    const closingTab = closingIndex >= 0 ? currentSession.tabs[closingIndex] : null

    if (closingTab == null) {
      return
    }

    const remainingTabs = currentSession.tabs.filter((tab) => tab.id !== tabId)
    const fallbackTab =
      closingTab.id !== currentSession.activeTabId
        ? getActiveTab(currentSession)
        : remainingTabs[Math.max(0, closingIndex - 1)] ?? remainingTabs[0] ?? null

    const nextSession = {
      ...removeTab(currentSession, tabId),
      activeTabId: currentSession.activeTabId === tabId ? (fallbackTab?.id ?? null) : currentSession.activeTabId,
    }
    sessionRef.current = nextSession
    setSession(nextSession)
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    await persistCurrentSession(projectId, profileId)

    if (fallbackTab && fallbackTab.persistedContent == null) {
      const project = projects.find((entry) => entry.id === activeProjectIdRef.current)
      if (project) {
        await loadDocumentContent(project, fallbackTab.documentPath, activeProfileIdRef.current)
      }
    }

  }

  async function continueWorkspaceAction(action: PendingWorkspaceAction) {
    if (action.kind === 'switch-project') {
      await runProjectOperation(async () => { await switchLocalServiceProject(action.projectId, action.project) })
      return
    }

    if (action.kind === 'remove-project') {
      await runProjectOperation(() => removeRegisteredProject(action.projectId))
      return
    }

    if (action.kind === 'switch-profile') {
      await runProjectOperation(async () => {
        const revision = ++workspaceLoadRevisionRef.current
        setPendingProjectId(null)
        if (workspaceSource !== 'local-service') throw new Error('本地服务不可用')
        const snapshot = await workspaceProvider.listProjects(action.profileId)
        if (revision !== workspaceLoadRevisionRef.current) return
        let nextSnapshot = snapshot
        recordRegistry(snapshot, action.profileId, false)
        if (!snapshot.initialized) {
          const currentProject = projects.find(project => project.id === activeProjectIdRef.current)
          if (currentProject?.rootPath) {
            const registered = await registryCommand(action.profileId, snapshot.revision, () => workspaceProvider.registerProject(action.profileId, currentProject.rootPath!, snapshot.revision))
            if (!registered) return
            nextSnapshot = registered.snapshot
          }
        }
        const target = nextSnapshot.projects.find(project => project.id === nextSnapshot.activeProjectId)
        const prepared = target ? await prepareLocalServiceWorkspace(target, action.profileId) : null
        if (revision !== workspaceLoadRevisionRef.current) return
        if (!(await flushDocumentScrollPosition())) return
        if (revision !== workspaceLoadRevisionRef.current) return
        if (getDirtyTabs().length > 0) throw new Error('准备期间有新的未保存内容，请处理后重新切换')
        activeProfileIdRef.current = action.profileId
        setActiveProfileId(action.profileId)
        recordRegistry(nextSnapshot, action.profileId)
        if (!prepared) clearProjectWorkspace(action.profileId)
        else {
          commitPreparedWorkspace(prepared, action.profileId)
          loadPreparedDocument(prepared, action.profileId)
        }
      })
      return
    }

    if (action.kind === 'restart-service') {
      setIsServiceActionPending(true)
      setStatusMessage('正在重启本地服务…')

      try {
        await restartLocalBridgeService()
        await waitForLocalBridgeReady()
        await restoreLocalServiceWorkspace(activeProfileIdRef.current)
        setStatusMessage('本地服务已重启')
      } catch (error) {
        setWorkspaceSource('offline')
        setStatusMessage(error instanceof Error ? error.message : '本地服务重启失败')
      } finally {
        setIsServiceActionPending(false)
      }
      return
    }

    if (action.kind === 'reconnect-service') {
      setIsServiceActionPending(true)
      setStatusMessage('正在重新连接本地服务…')

      try {
        await restoreLocalServiceWorkspace(activeProfileIdRef.current)
        setStatusMessage('本地服务已重新连接')
      } catch (error) {
        setWorkspaceSource('offline')
        setStatusMessage(error instanceof Error ? error.message : '本地服务重新连接失败')
      } finally {
        setIsServiceActionPending(false)
      }
      return
    }

    if (action.kind === 'stop-service') {
      setIsServiceActionPending(true)
      setStatusMessage('正在关闭本地服务…')

      try {
        await stopLocalBridgeService()
        setWorkspaceSource('offline')
        setStatusMessage('本地服务已关闭')
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : '本地服务关闭失败')
      } finally {
        setIsServiceActionPending(false)
      }
    }
  }

  async function handleProjectChange(projectId: string) {
    if (projectOperationBusyRef.current || pendingRegistryRef.current) return
    if (workspaceSource !== 'local-service') {
      setStatusMessage('本地服务不可用')
      return
    }

    if (getDirtyTabs().length > 0) {
      setPendingWorkspaceAction({ kind: 'switch-project', projectId })
      return
    }

    await continueWorkspaceAction({ kind: 'switch-project', projectId })
  }

  async function handleProfileChange(profileId: string) {
    if (projectOperationBusyRef.current || pendingRegistryRef.current) return
    if (getDirtyTabs().length > 0) {
      setPendingWorkspaceAction({ kind: 'switch-profile', profileId })
      return
    }

    await continueWorkspaceAction({ kind: 'switch-profile', profileId })
  }

  async function readNormalizedLocalState(projectId: string, profileId = activeProfileIdRef.current): Promise<WorkspaceLocalState> {
    return normalizeLocalStateSnapshot(
      (await localStateStore.getState(projectId, profileId)) as Awaited<
        ReturnType<typeof localStateStore.getState>
      > & { activeMode: 'regular' | 'split' | 'read' | 'edit'; lastKnownScrollTop?: number },
    ) as WorkspaceLocalState
  }

  async function readActiveProfile(projectId: string, profileId = activeProfileIdRef.current) {
    return getCoordinatedProfile(projectId, profileId, workspaceSource)
  }

  async function refreshProjectTree(projectId: string, profileId: string, isCurrent: () => boolean) {
    const snapshot = await workspaceProvider.getProjectTreeSnapshot(projectId, profileId)
    if (!isCurrent()) return false
    const markdownPaths = snapshot.entries.map((entry) => entry.path)
    const nextFileTree = buildOrderedFileTree(markdownPaths, manualNodeOrderByParent)
    const nextFavoritePaths = pruneFavoritePaths(nextFileTree, favoritePaths)
    setFileTree(nextFileTree)
    setTreeEntriesByPath(new Map(snapshot.entries.map((entry) => [entry.path, entry])))

    if (nextFavoritePaths.length !== favoritePaths.length) {
      setFavoritePaths(nextFavoritePaths)
      await updateProfile(projectId, profileId, workspaceSource, (current) => ({ ...current,
        navigation: { ...current.navigation, favoritePaths: pruneFavoritePaths(nextFileTree, current.navigation.favoritePaths) } }))
    }

    return isCurrent()
  }

  async function getMarkdownPathsFromSnapshot(projectId: string, profileId: string) {
    const snapshot = await workspaceProvider.getProjectTreeSnapshot(projectId, profileId)
    setTreeEntriesByPath(new Map(snapshot.entries.map((entry) => [entry.path, entry])))
    return snapshot.entries.map((entry) => entry.path)
  }

  async function handleRefreshFileTree() {
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    const refreshRevision = workspaceLoadRevisionRef.current
    if (!projectId || pendingProjectId != null || isFileTreeRefreshing) return

    setIsFileTreeRefreshing(true)
    setStatusMessage('正在刷新文件树…')
    try {
      const snapshot = await workspaceProvider.refreshProjectTreeSnapshot(projectId, profileId, {
        onIndexing: () => setStatusMessage('正在刷新文件树…'),
      })
      const markdownPaths = snapshot.entries.map((entry) => entry.path)
      if (
        activeProjectIdRef.current !== projectId ||
        activeProfileIdRef.current !== profileId ||
        workspaceLoadRevisionRef.current !== refreshRevision
      ) {
        return
      }

      const nextFileTree = buildOrderedFileTree(markdownPaths, manualNodeOrderByParent)
      const nextFavoritePaths = pruneFavoritePaths(nextFileTree, favoritePaths)
      setFileTree(nextFileTree)
      setTreeEntriesByPath(new Map(snapshot.entries.map((entry) => [entry.path, entry])))
      if (nextFavoritePaths.length !== favoritePaths.length) {
        setFavoritePaths(nextFavoritePaths)
        await saveActiveProfileNavigation({ favoritePaths: nextFavoritePaths })
      }
      setStatusMessage('文件树已刷新')
    } catch (error) {
      if (
        activeProjectIdRef.current === projectId &&
        activeProfileIdRef.current === profileId &&
        workspaceLoadRevisionRef.current === refreshRevision
      ) {
        setStatusMessage(error instanceof Error ? `刷新文件树失败：${error.message}` : '刷新文件树失败')
      }
    } finally {
      setIsFileTreeRefreshing(false)
    }
  }

  async function purgeMissingDocumentPath(
    project: ProjectRegistryRecord,
    profileId: string,
    documentPath: string,
    isCurrent: () => boolean,
  ) {
    if (!isCurrent()) return false
    const currentSession = sessionRef.current
    const closingIndex = currentSession.tabs.findIndex((tab) => tab.documentPath === documentPath)
    const closingTab = closingIndex >= 0 ? currentSession.tabs[closingIndex] : null
    const remainingTabs =
      closingTab == null
        ? currentSession.tabs
        : currentSession.tabs.filter((tab) => tab.documentPath !== documentPath)
    const fallbackTab =
      closingTab == null || closingTab.id !== currentSession.activeTabId
        ? getActiveTab({
            ...currentSession,
            tabs: remainingTabs,
          })
        : remainingTabs[Math.max(0, closingIndex - 1)] ?? remainingTabs[0] ?? null
    const nextSession =
      closingTab == null
        ? currentSession
        : {
            ...removeTab(currentSession, closingTab.id),
            activeTabId:
              currentSession.activeTabId === closingTab.id
                ? (fallbackTab?.id ?? null)
                : currentSession.activeTabId,
          }

    if (closingTab != null) {
      sessionRef.current = nextSession
      setSession(nextSession)
    }

    await localStateStore.updateState(project.id, profileId, (localState) => {
      if (!isCurrent()) return localState
      const latest = sessionRef.current
      return {
        ...localState,
        openDocumentPaths: latest.tabs.map((tab) => tab.documentPath),
        activeDocumentPath: getActiveTab(latest)?.documentPath ?? null,
        activeMode: latest.mode,
        regularViewState: latest.regularViewState,
        ...sessionTabMetadata(latest),
        tabStateByDocument: Object.fromEntries(
          Object.entries(localState.tabStateByDocument).filter(([path]) => path !== documentPath),
        ),
        readingProgressByDocument: Object.fromEntries(
          Object.entries(localState.readingProgressByDocument).filter(([path]) => path !== documentPath),
        ),
      }
    })

    if (!isCurrent()) return false

    if (fallbackTab && fallbackTab.persistedContent == null) {
      await loadDocumentContent(project, fallbackTab.documentPath, profileId)
    }

    if (!isCurrent() || !(await refreshProjectTree(project.id, profileId, isCurrent))) return false
    setStatusMessage(`已移除失效文档：${documentPath}`)
    return true
  }

  function resolveDefaultDirectoryPath(preferredDirectoryPath?: string) {
    if (preferredDirectoryPath != null) {
      return preferredDirectoryPath
    }

    return getDocumentDirectoryPath(currentDocumentPathRef.current)
  }

  async function flushDocumentDraftIfNeeded(documentPath: string): Promise<boolean> {
    const tab = sessionRef.current.tabs.find((entry) => entry.documentPath === documentPath)
    if (!tab) {
      return true
    }

    const isDirty =
      tab.persistedContent != null &&
      tab.draftContent != null &&
      tab.draftContent !== tab.persistedContent

    if (!isDirty) {
      return true
    }

    return saveTabById(tab.id, 'leave')
  }

  async function rewriteDocumentPathState(
    sourcePath: string,
    targetPath: string,
    nextManualNodeOrderByParentOverride?: ManualNodeOrderByParent,
    scope?: { projectId: string; profileId: string },
  ) {
    const projectId = scope?.projectId ?? activeProjectIdRef.current
    if (!projectId) {
      return
    }

    const profileId = scope?.profileId ?? activeProfileIdRef.current
    const source = workspaceSource
    const [localState, profile] = await Promise.all([
      readNormalizedLocalState(projectId, profileId),
      readActiveProfile(projectId, profileId),
    ])
    const nextCollections = rewritePathCollections({
      localState,
      profile,
      sourcePath,
      targetPath,
    })
    const nextProfile = nextManualNodeOrderByParentOverride
      ? {
          ...nextCollections.profile,
          navigation: {
            ...nextCollections.profile.navigation,
            manualNodeOrderByParent: nextManualNodeOrderByParentOverride,
          },
        }
      : nextCollections.profile

    if (activeProjectIdRef.current === projectId && activeProfileIdRef.current === profileId) {
      const renamedSession = rewriteSessionDocumentPath(sessionRef.current, sourcePath, targetPath)
      sessionRef.current = renamedSession
      setSession(renamedSession)
      setHiddenPaths(nextProfile.navigation.hiddenPaths)
      setFavoritePaths(nextProfile.navigation.favoritePaths)
      setManualNodeOrderByParent(nextProfile.navigation.manualNodeOrderByParent)
    }

    await Promise.all([
      localStateStore.updateState(projectId, profileId, (current) =>
        rewritePathCollections({ localState: current, profile, sourcePath, targetPath }).localState),
      updateProfile(projectId, profileId, source, (current) => {
        const rewritten = rewritePathCollections({ localState, profile: current, sourcePath, targetPath }).profile
        return nextManualNodeOrderByParentOverride
          ? { ...rewritten, navigation: { ...rewritten.navigation, manualNodeOrderByParent: nextManualNodeOrderByParentOverride } }
          : rewritten
      }),
    ])
  }

  async function removeDocumentPathState(documentPath: string, scope?: { projectId: string; profileId: string }) {
    const projectId = scope?.projectId ?? activeProjectIdRef.current
    if (!projectId) {
      return
    }

    const profileId = scope?.profileId ?? activeProfileIdRef.current
    const source = workspaceSource
    const [localState, profile] = await Promise.all([
      readNormalizedLocalState(projectId, profileId),
      readActiveProfile(projectId, profileId),
    ])
    const nextCollections = removePathCollections({
      localState,
      profile,
      targetPath: documentPath,
    })

    if (activeProjectIdRef.current === projectId && activeProfileIdRef.current === profileId) {
      setHiddenPaths(nextCollections.profile.navigation.hiddenPaths)
      setFavoritePaths(nextCollections.profile.navigation.favoritePaths)
      setManualNodeOrderByParent(nextCollections.profile.navigation.manualNodeOrderByParent)
    }

    await Promise.all([
      localStateStore.updateState(projectId, profileId, (current) =>
        removePathCollections({ localState: current, profile, targetPath: documentPath }).localState),
      updateProfile(projectId, profileId, source, (current) =>
        removePathCollections({ localState, profile: current, targetPath: documentPath }).profile),
    ])
  }

  async function handleModeChange(nextMode: WorkspaceMode) {
    const nextSession = { ...sessionRef.current, mode: nextMode }
    sessionRef.current = nextSession
    setSession(nextSession)

    if (!activeProjectId) {
      return
    }

    await persistCurrentSession(activeProjectId, activeProfileIdRef.current)
  }

  async function handleCreateDocument(preferredDirectoryPath?: string) {
    const projectId = activeProjectIdRef.current
    if (!projectId) {
      return
    }

    const directoryPath = resolveDefaultDirectoryPath(preferredDirectoryPath)
    setPendingCreateNodeAction({
      kind: 'document',
      directoryPath,
      defaultName: '未命名文档.md',
    })
    setPendingCreateNodeName('未命名文档.md')
  }

  async function handleCreateDirectory(preferredDirectoryPath?: string) {
    const projectId = activeProjectIdRef.current
    if (!projectId) {
      return
    }

    const directoryPath = resolveDefaultDirectoryPath(preferredDirectoryPath)
    setPendingCreateNodeAction({
      kind: 'directory',
      directoryPath,
      defaultName: '未命名文件夹',
    })
    setPendingCreateNodeName('未命名文件夹')
  }

  function handleCancelCreateNode() {
    setPendingCreateNodeAction(null)
    setPendingCreateNodeName('')
  }

  async function handleConfirmCreateNode() {
    const action = pendingCreateNodeAction
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    if (!action || !projectId) {
      handleCancelCreateNode()
      return
    }

    try {
      const nextName = pendingCreateNodeName.trim()
      if (!nextName) {
        return
      }

      const targetPath = joinNodePath(action.directoryPath, nextName)
      if (action.kind === 'document') {
        await createDocumentNodeInBridge(projectId, profileId, targetPath, '')
      } else {
        await createDirectoryNodeInBridge(projectId, profileId, targetPath)
      }

      const nextMarkdownPaths = await getMarkdownPathsFromSnapshot(projectId, profileId)
      const nextManualNodeOrderByParent = appendNodeToManualOrder(manualNodeOrderByParent, targetPath)
      await persistManualNodeOrder(nextManualNodeOrderByParent, {
        refreshPaths: nextMarkdownPaths,
      })
      await handleExpandedFileNodesChange(
        action.kind === 'document'
          ? action.directoryPath && !expandedFileNodes.includes(action.directoryPath)
            ? [...expandedFileNodes, action.directoryPath].sort()
            : expandedFileNodes
          : Array.from(new Set([...expandedFileNodes, action.directoryPath, targetPath].filter(Boolean))).sort(),
      )

      if (action.kind === 'document') {
        const opened = await handleDocumentSelect(targetPath)
        publishActionFeedback(opened ? `已新建文档：${targetPath}` : `文档已创建，但未能打开：${targetPath}`, opened ? 'info' : 'error')
      } else {
        publishActionFeedback(`已新建文件夹：${targetPath}`)
      }

      handleCancelCreateNode()
    } catch (error) {
      publishActionFeedback(
        error instanceof Error
          ? `${action.kind === 'document' ? '新建文档' : '新建文件夹'}失败：${error.message}`
          : `${action.kind === 'document' ? '新建文档' : '新建文件夹'}失败`,
        'error',
      )
    }
  }

  async function handleCopyDocumentLink(documentPath: string) {
    try {
      const projectId = activeProjectIdRef.current
      if (!projectId) {
        throw new Error('当前没有可分享的项目')
      }
      const href = createDocumentShareHref(projectId, activeProfileIdRef.current, documentPath, null)
      await navigator.clipboard.writeText(href)
      publishActionFeedback(`已拷贝链接：${href}`)
    } catch (error) {
      publishActionFeedback(
        error instanceof Error ? `拷贝链接失败：${error.message}` : '拷贝链接失败',
        'error',
      )
    }
  }

  function getDocumentLinkHref(documentPath: string, headingId: string | null) {
    const projectId = activeProjectIdRef.current
    if (!projectId) return '#'
    return createDocumentShareHref(projectId, activeProfileIdRef.current, documentPath, headingId)
  }

  const getAssetHref = useCallback((assetPath: string) => (
    activeProjectId ? getProjectAssetHref(activeProjectId, activeProfileId, assetPath) : ''
  ), [activeProjectId, activeProfileId])

  function handleInvalidDocumentLink(href: string, reason: string) {
    publishActionFeedback(`无法打开链接「${href}」：${reason}`, 'error')
  }

  function handleCurrentDocumentAnchorNavigate(headingId: string) {
    setPendingHeadingId(headingId)
  }

  async function handleDocumentLinkNavigate(documentPath: string, headingId: string | null) {
    const sourceDocumentPath = currentDocumentPathRef.current
    if (sourceDocumentPath && !(await flushDocumentDraftIfNeeded(sourceDocumentPath))) return
    const opened = await openDocument(documentPath, false)
    if (!opened) return
    setPendingHeadingId(headingId)
    window.history.replaceState(null, '', getDocumentLinkHref(documentPath, headingId))
  }

  async function handleCopyDirectoryPath(directoryPath: string) {
    try {
      await navigator.clipboard.writeText(directoryPath)
      publishActionFeedback(`已拷贝路径：${directoryPath}`)
    } catch (error) {
      publishActionFeedback(
        error instanceof Error ? `拷贝路径失败：${error.message}` : '拷贝路径失败',
        'error',
      )
    }
  }

  async function handleDuplicateDocument(documentPath: string, duplicateName: string) {
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    if (!projectId) {
      return false
    }

    try {
      const baseName = documentPath.split('/').at(-1) ?? documentPath
      const trimmedDuplicateName = duplicateName.trim()
      if (!trimmedDuplicateName || trimmedDuplicateName === baseName) {
        return false
      }

      const targetPath = joinNodePath(getDocumentDirectoryPath(documentPath), trimmedDuplicateName)
      await duplicateDocumentNodeInBridge(projectId, profileId, documentPath, targetPath)
      const nextMarkdownPaths = await getMarkdownPathsFromSnapshot(projectId, profileId)
      const nextManualNodeOrderByParent = appendNodeToManualOrder(manualNodeOrderByParent, targetPath)
      await persistManualNodeOrder(nextManualNodeOrderByParent, {
        refreshPaths: nextMarkdownPaths,
      })
      const opened = await handleDocumentSelect(targetPath)
      publishActionFeedback(opened ? `已创建副本：${targetPath}` : `副本已创建，但未能打开：${targetPath}`, opened ? 'info' : 'error')
      return true
    } catch (error) {
      publishActionFeedback(
        error instanceof Error ? `创建副本失败：${error.message}` : '创建副本失败',
        'error',
      )
      return false
    }
  }

  async function handleRenameDocument(documentPath: string, nextName: string) {
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    if (!projectId) {
      return false
    }

    try {
      if (!(await flushDocumentDraftIfNeeded(documentPath))) {
        return false
      }

      const currentName = documentPath.split('/').at(-1) ?? documentPath
      const trimmedNextName = nextName.trim()
      if (!trimmedNextName || trimmedNextName === currentName) {
        return false
      }

      const result = await renameDocumentNodeInBridge(projectId, profileId, documentPath, trimmedNextName)
      await rewriteDocumentPathState(documentPath, result.path, undefined, { projectId, profileId })
      const nextMarkdownPaths = await getMarkdownPathsFromSnapshot(projectId, profileId)
      if (activeProjectIdRef.current !== projectId || activeProfileIdRef.current !== profileId) return true
      setFileTree(
        buildOrderedFileTree(
          nextMarkdownPaths,
          rewriteManualOrderPaths(manualNodeOrderByParent, documentPath, result.path),
        ),
      )
      publishActionFeedback(`已重命名：${currentName} -> ${trimmedNextName}`)
      return true
    } catch (error) {
      publishActionFeedback(
        error instanceof Error ? `重命名失败：${error.message}` : '重命名失败',
        'error',
      )
      return false
    }
  }

  async function handleDeleteDocument(documentPath: string) {
    const projectId = activeProjectIdRef.current
    if (!projectId) {
      return
    }

    setPendingDeleteDocumentAction({
      kind: 'delete-document',
      documentPath,
    })
  }

  function handleCancelDeleteDocument() {
    setPendingDeleteDocumentAction(null)
  }

  async function handleConfirmDeleteDocument() {
    const action = pendingDeleteDocumentAction
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    if (!action || !projectId) {
      setPendingDeleteDocumentAction(null)
      return
    }

    try {
      if (!(await flushDocumentDraftIfNeeded(action.documentPath))) {
        return
      }

      const tab = sessionRef.current.tabs.find((entry) => entry.documentPath === action.documentPath) ?? null
      await deleteDocumentNodeInBridge(projectId, profileId, action.documentPath)

      if (tab && activeProjectIdRef.current === projectId && activeProfileIdRef.current === profileId) {
        await closeTabInternal(tab.id)
      }

      await removeDocumentPathState(action.documentPath, { projectId, profileId })
      const nextMarkdownPaths = await getMarkdownPathsFromSnapshot(projectId, profileId)
      if (activeProjectIdRef.current !== projectId || activeProfileIdRef.current !== profileId) return
      setFileTree(
        buildOrderedFileTree(
          nextMarkdownPaths,
          removeNodeFromManualOrder(manualNodeOrderByParent, action.documentPath),
        ),
      )
      publishActionFeedback(`已删除：${action.documentPath}`)
      setPendingDeleteDocumentAction(null)
    } catch (error) {
      publishActionFeedback(
        error instanceof Error ? `删除失败：${error.message}` : '删除失败',
        'error',
      )
    }
  }

  async function handleMoveDocumentToDirectory(sourcePath: string, targetDirectoryPath: string) {
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    if (!projectId) {
      return
    }

    try {
      const fileName = sourcePath.split('/').at(-1) ?? sourcePath
      const targetPath = joinNodePath(targetDirectoryPath, fileName)

      if (targetPath === sourcePath) {
        return
      }

      if (!(await flushDocumentDraftIfNeeded(sourcePath))) {
        return
      }

      const result = await moveDocumentNodeInBridge(projectId, profileId, sourcePath, targetPath)
      const nextManualNodeOrderByParent = moveNodeToParentTailInManualOrder(
        manualNodeOrderByParent,
        sourcePath,
        result.path,
      )
      await rewriteDocumentPathState(sourcePath, result.path, nextManualNodeOrderByParent, { projectId, profileId })
      const nextMarkdownPaths = await getMarkdownPathsFromSnapshot(projectId, profileId)
      if (activeProjectIdRef.current !== projectId || activeProfileIdRef.current !== profileId) return
      setFileTree(
        buildOrderedFileTree(
          nextMarkdownPaths,
          nextManualNodeOrderByParent,
        ),
      )
      await handleExpandedFileNodesChange(
        Array.from(new Set([...expandedFileNodes, targetDirectoryPath].filter(Boolean))).sort(),
      )
      publishActionFeedback(`已移动：${sourcePath} -> ${result.path}`)
    } catch (error) {
      publishActionFeedback(
        error instanceof Error ? `移动失败：${error.message}` : '移动失败',
        'error',
      )
    }
  }

  async function handleReorderFileTreeNode(payload: {
    sourcePath: string
    sourceParentPath: string | null
    targetPath: string | null
    targetParentPath: string | null
    position: 'before' | 'after' | 'tail'
  }) {
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    if (!projectId) {
      return
    }

    try {
      const normalizedManualNodeOrder = normalizeManualNodeOrderByParent(
        manualNodeOrderByParent,
        fileTree,
      )
      const nextManualNodeOrderByParent = reorderManualNodeOrder(normalizedManualNodeOrder, payload)
      const nextMarkdownPaths = await getMarkdownPathsFromSnapshot(projectId, profileId)
      await persistManualNodeOrder(nextManualNodeOrderByParent, {
        refreshPaths: nextMarkdownPaths,
      })
      publishActionFeedback(formatReorderFeedbackMessage(payload), 'info')
    } catch (error) {
      publishActionFeedback(
        error instanceof Error ? `调整顺序失败：${error.message}` : '调整顺序失败',
        'error',
      )
    }
  }

  async function openDocument(path: string, regularMode: boolean): Promise<boolean> {
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    const project = projects.find((entry) => entry.id === projectId)
    if (!project || !projectId) return false
    const requestId = ++navigationRequestRef.current
    documentLoadingRevisionRef.current += 1
    setIsDocumentLoading(false)
    const valid = () => navigationRequestRef.current === requestId &&
      activeProjectIdRef.current === projectId && activeProfileIdRef.current === profileId
    if (!(await flushDocumentScrollPosition())) return false
    if (!valid()) return false
    let existing = getTabByDocumentPath(sessionRef.current, path)
    if (existing) {
      const next = { ...sessionRef.current, activeTabId: existing.id,
        mode: regularMode ? 'regular' as const : sessionRef.current.mode }
      sessionRef.current = next
      setSession(next)
      await persistCurrentSession(projectId, profileId)
      if (existing.persistedContent == null) {
        const loaded = await loadDocumentContent(project, path, profileId, valid)
        if (loaded !== 'loaded' || !valid()) return false
      }
      setDocumentScrollRestoreId((current) => current + 1)
      return valid()
    }

    const loadingRevision = ++documentLoadingRevisionRef.current
    setIsDocumentLoading(true)
    try {
      const document = await getDocumentContentFromBridge(projectId, profileId, path)
      if (!valid()) return false
      existing = getTabByDocumentPath(sessionRef.current, document.path)
      if (existing) {
        const next = { ...sessionRef.current, activeTabId: existing.id,
          mode: regularMode ? 'regular' as const : sessionRef.current.mode }
        sessionRef.current = next
        setSession(next)
        await persistCurrentSession(projectId, profileId)
        return valid()
      }
      const current = sessionRef.current
      const composingTabId = isComposingRef.current ? current.activeTabId : null
      const savingTabIds = new Set(current.tabs.filter((item) => item.instanceId && pendingTabSavesRef.current.has(item.instanceId)).map((item) => item.id))
      const evict = selectTabsForOpening(current, maxUnpinnedTabsRef.current, composingTabId, savingTabIds)
      if (evict == null) {
        publishActionFeedback('标签页数量已达上限，请先保存、关闭或固定标签页后重试', 'error')
        return false
      }
      const tab: WorkspaceTab = { ...createWorkspaceTab(document.path), persistedContent: document.content,
        draftContent: document.content, mtimeMs: document.mtimeMs }
      const metadata = sessionTabMetadata(current)
      const removed = new Set(evict)
      const removedPaths = new Set(current.tabs.filter((item) => removed.has(item.id)).map((item) => item.documentPath))
      const next: WorkspaceSession = { ...current,
        tabs: [...current.tabs.filter((item) => !removed.has(item.id)), tab],
        tabOpenOrder: [...metadata.tabOpenOrder.filter((item) => !removedPaths.has(item)), document.path],
        pinnedDocumentPaths: metadata.pinnedDocumentPaths,
        activeTabId: tab.id, mode: regularMode ? 'regular' : current.mode }
      sessionRef.current = next
      setSession(next)
      setDocumentScrollRestoreId((value) => value + 1)
      const persisted = await persistCurrentSession(projectId, profileId)
      if (!valid()) return false
      if (persisted) setStatusMessage(`当前项目：${project.name}`)
      return true
    } catch (error) {
      if (valid()) publishActionFeedback(error instanceof Error ? `读取文档失败：${error.message}` : '读取文档失败', 'error')
      return false
    } finally {
      if (documentLoadingRevisionRef.current === loadingRevision) setIsDocumentLoading(false)
    }
  }

  /** 拉一次链接索引。图谱打开时调，失败不清空旧数据。 */
  async function loadGraphIndex() {
    if (!activeProjectId) {
      setGraphError('还没有接入任何项目')
      return
    }
    setGraphLoading(true)
    setGraphError(null)
    try {
      const payload = await getLinkIndexFromBridge(activeProjectId, activeProfileId)
      setGraphIndex(payload)
    } catch (error) {
      setGraphError(
        error instanceof Error ? `读取链接索引失败：${error.message}` : '读取链接索引失败',
      )
    } finally {
      setGraphLoading(false)
    }
  }

  function handleToggleGraph() {
    setGraphOpen((prev) => {
      const next = !prev
      if (next) void loadGraphIndex()
      return next
    })
  }

  /** 图谱里点节点：打开那篇文档，并退回文档视图 */
  /**
   * 图谱里点「进入文章」：退出图谱、打开该文档，并确保停在阅读态。
   * 「进入文章」在用户语义里是读书而不是改稿，所以强制 locked；
   * 如果当前是分栏模式，也切回常规，否则右侧预览抢焦点。
   */
  function handleGraphEnterDocument(path: string) {
    setGraphOpen(false)
    setSession((current) => ({
      ...current,
      mode: 'regular',
      regularViewState: 'locked',
    }))
    void handleDocumentSelect(path)
  }

  async function handleDocumentSelect(path: string) {
    return openDocument(path, true)
  }

  async function handleRefreshDocument() {
    const projectId = activeProjectIdRef.current
    const documentPath = currentDocumentPathRef.current
    if (!projectId || !documentPath || isDocumentLoading) {
      return
    }

    const project = projects.find((entry) => entry.id === projectId)
    const tab = sessionRef.current.tabs.find((entry) => entry.documentPath === documentPath)
    if (!project || !tab) {
      return
    }

    const isDirty =
      tab.persistedContent != null &&
      tab.draftContent != null &&
      tab.draftContent !== tab.persistedContent

    if (isDirty) {
      setPendingRefreshDocumentAction({
        tabId: tab.id,
        projectId,
        profileId: activeProfileIdRef.current,
        documentPath,
      })
      return
    }

    await loadDocumentContent(project, documentPath, activeProfileIdRef.current)
  }

  async function handleTabSelect(tabId: string) {
    const tab = sessionRef.current.tabs.find((item) => item.id === tabId)
    if (!tab) return
    await openDocument(tab.documentPath, false)
  }

  async function handleTabReorder(nextOrderedTabIds: string[]) {
    const projectId = activeProjectIdRef.current
    if (!projectId) {
      return
    }

    const nextSession = reorderSessionTabs(sessionRef.current, nextOrderedTabIds)
    if (nextSession === sessionRef.current) {
      return
    }

    sessionRef.current = nextSession
    setSession(nextSession)
    await persistCurrentSession(projectId, activeProfileIdRef.current)
  }

  async function handleTabPin(tabId: string) {
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    const current = sessionRef.current
    const tab = current.tabs.find((item) => item.id === tabId)
    if (!projectId || !tab) return
    const metadata = sessionTabMetadata(current)
    const pins = metadata.pinnedDocumentPaths.includes(tab.documentPath)
      ? metadata.pinnedDocumentPaths.filter((path) => path !== tab.documentPath)
      : [...metadata.pinnedDocumentPaths, tab.documentPath]
    const next = { ...current, ...metadata, pinnedDocumentPaths: pins }
    sessionRef.current = next
    setSession(next)
    await persistCurrentSession(projectId, profileId)
  }

  async function handleTabClose(tabId: string) {
    if (!activeProjectId) {
      return
    }

    const closingTab = session.tabs.find((tab) => tab.id === tabId) ?? null

    if (closingTab == null) {
      return
    }

    const isDirty =
      closingTab.persistedContent != null &&
      closingTab.draftContent != null &&
      closingTab.draftContent !== closingTab.persistedContent

    if (isDirty) {
      setPendingCloseTabAction({ kind: 'close-tab', tabId })
      return
    }

    await closeTabInternal(tabId)
  }

  async function loadDocumentContent(
    project: ProjectRegistryRecord,
    documentPath: string,
    profileId: string,
    shouldApply: () => boolean = () => true,
  ) {
    const target = getTabByDocumentPath(sessionRef.current, documentPath)
    if (!target) return 'stale' as const
    const workspaceRevision = workspaceLoadRevisionRef.current
    const isCurrent = () => shouldApply() && workspaceLoadRevisionRef.current === workspaceRevision &&
      activeProjectIdRef.current === project.id && activeProfileIdRef.current === profileId
    const valid = () => isCurrent() && getTabByDocumentPath(sessionRef.current, documentPath) === target
    const loadingRevision = ++documentLoadingRevisionRef.current
    setIsDocumentLoading(true)
    try {
      const document = await getDocumentContentFromBridge(project.id, profileId, documentPath)
      if (!valid()) return 'stale' as const
      const loaded: WorkspaceTab = { ...target, persistedContent: document.content,
        draftContent: document.content, mtimeMs: document.mtimeMs, saveState: 'clean', saveErrorMessage: null }
      const next = replaceTab(sessionRef.current, loaded)
      sessionRef.current = next
      setSession(next)
      setStatusMessage(`当前项目：${project.name}`)
      return 'loaded' as const
    } catch (error) {
      if (!valid()) return 'stale' as const
      if (isMissingDocumentLoadError(error)) {
        if (!(await purgeMissingDocumentPath(project, profileId, documentPath, isCurrent))) return 'stale' as const
      } else {
        setStatusMessage(error instanceof Error ? `读取文档失败：${error.message}` : '读取文档失败')
      }
      return 'failed' as const
    } finally {
      if (documentLoadingRevisionRef.current === loadingRevision) setIsDocumentLoading(false)
    }
  }

  async function handleConfirmRefreshDocument() {
    const action = pendingRefreshDocumentAction
    if (!action) {
      return
    }

    setPendingRefreshDocumentAction(null)
    clearAutosaveTimer()
    isComposingRef.current = false
    discardTabDraft(action.tabId)

    const project = projects.find((entry) => entry.id === action.projectId)
    if (!project) {
      return
    }

    await loadDocumentContent(project, action.documentPath, action.profileId)
  }

  function handleCancelRefreshDocument() {
    setPendingRefreshDocumentAction(null)
  }

  async function handleToggleRegularLock() {
    if (mode !== 'regular') {
      return
    }

    if (regularViewState === 'locked') {
      setSession((current) => ({ ...current, regularViewState: 'unlocking' }))
      setSession((current) => ({ ...current, regularViewState: 'editable' }))
      return
    }

    if (regularViewState !== 'editable') {
      return
    }

    setSession((current) => ({ ...current, regularViewState: 'locking' }))

    if (!(await flushAllDirtyTabs())) {
      setSession((current) => ({ ...current, regularViewState: 'editable' }))
      return
    }

    setSession((current) => ({ ...current, regularViewState: 'locked' }))
  }

  async function updateProfile(projectId: string, profileId: string, source: WorkspaceSource,
    update: (profile: WorkspaceProfile) => WorkspaceProfile) {
    // The service stores all profiles of a project in one file, so writes for
    // different profiles of the same project must share the same queue too.
    const key = profileWriteKey(projectId, profileId, source)
    const pendingProfileWrites = pendingProfileWritesRef.current
    const previous = pendingProfileWrites.get(key) ?? Promise.resolve()
    const write = previous.catch(() => {}).then(async () => {
      const profile = source === 'local-service'
        ? await getProfileFromBridge(projectId, profileId, profileId)
        : await profileStore.getProfile(projectId, profileId)
      const next = update(profile)
      if (source === 'local-service') await saveProfileToBridge(projectId, next, profileId)
      else await profileStore.saveProfile(projectId, next)
    })
    const settled = write.then(() => {}, () => {})
    pendingProfileWrites.set(key, settled)
    void settled.then(() => { if (pendingProfileWrites.get(key) === settled) pendingProfileWrites.delete(key) })
    await write
  }

  async function updateActiveProfile(update: (profile: WorkspaceProfile) => WorkspaceProfile) {
    const projectId = activeProjectIdRef.current
    if (!projectId) return
    await updateProfile(projectId, activeProfileIdRef.current, workspaceSource, update)
  }

  async function saveActiveProfileLayout(nextLayout: { sidebarWidth?: number; outlineWidth?: number }) {
    await updateActiveProfile((profile) => ({ ...profile, layout: { ...profile.layout, ...nextLayout } }))
  }

  async function saveActiveProfileNavigation(nextNavigation: {
    expandedFileNodes?: string[]
    expandedFileNodesInitialized?: boolean
    hiddenPaths?: string[]
    favoritePaths?: string[]
    manualNodeOrderByParent?: ManualNodeOrderByParent
  }) {
    await updateActiveProfile((profile) => ({ ...profile, navigation: { ...profile.navigation, ...nextNavigation } }))
  }

  async function saveActiveProfileAppearance(nextAppearance: {
    fontSize?: number
    pageWidth?: PageWidthMode
    lineHeight?: DocumentLineHeight
    hideFileTitleDate?: boolean
    maxUnpinnedTabs?: number
  }) {
    await updateActiveProfile((profile) => ({ ...profile, appearance: { ...profile.appearance, ...nextAppearance } }))
  }

  function handleSidebarWidthChange(nextWidth: number) {
    setSidebarWidth(nextWidth)
  }

  async function handleSidebarWidthCommit(nextWidth: number) {
    setSidebarWidth(nextWidth)
    await saveActiveProfileLayout({ sidebarWidth: nextWidth })
  }

  function handleOutlineWidthChange(nextWidth: number) {
    setOutlineWidth(nextWidth)
  }

  async function handleOutlineWidthCommit(nextWidth: number) {
    setOutlineWidth(nextWidth)
    await saveActiveProfileLayout({ outlineWidth: nextWidth })
  }

  async function handleDocumentFontSizeChange(nextFontSize: number) {
    setDocumentFontSize(nextFontSize)
    await saveActiveProfileAppearance({ fontSize: nextFontSize })
  }

  async function handleMaxUnpinnedTabsChange(value: number) {
    const next = normalizeMaxUnpinnedTabs(value)
    const projectId = activeProjectIdRef.current
    const profileId = activeProfileIdRef.current
    const revision = ++maxTabsRevisionRef.current
    maxUnpinnedTabsRef.current = next
    setMaxUnpinnedTabs(next)
    try {
      await saveActiveProfileAppearance({ maxUnpinnedTabs: next })
      if (activeProjectIdRef.current === projectId && activeProfileIdRef.current === profileId) persistedMaxUnpinnedTabsRef.current = next
    } catch (error) {
      if (activeProjectIdRef.current === projectId && activeProfileIdRef.current === profileId && maxTabsRevisionRef.current === revision) {
        maxUnpinnedTabsRef.current = persistedMaxUnpinnedTabsRef.current
        setMaxUnpinnedTabs(maxUnpinnedTabsRef.current)
        setStatusMessage(error instanceof Error ? `标签上限保存失败：${error.message}` : '标签上限保存失败')
      }
    }
  }

  async function handleDocumentPageWidthChange(nextPageWidth: PageWidthMode) {
    setDocumentPageWidth(nextPageWidth)
    await saveActiveProfileAppearance({ pageWidth: nextPageWidth })
  }

  async function handleDocumentLineHeightChange(nextLineHeight: DocumentLineHeight) {
    setDocumentLineHeight(nextLineHeight)
    await saveActiveProfileAppearance({ lineHeight: nextLineHeight })
  }

  async function handleExpandedFileNodesChange(nextExpandedFileNodes: string[]) {
    setExpandedFileNodes(nextExpandedFileNodes)
    setHasPersistedExpandedFileNodes(true)
    await saveActiveProfileNavigation({
      expandedFileNodes: nextExpandedFileNodes,
      expandedFileNodesInitialized: true,
    })
  }

  async function handleHidePath(path: string) {
    const nextHiddenPaths = Array.from(new Set([...hiddenPaths, path]))
    setHiddenPaths(nextHiddenPaths)
    await saveActiveProfileNavigation({ hiddenPaths: nextHiddenPaths })
  }

  async function handleUnhidePath(path: string) {
    const nextHiddenPaths = hiddenPaths.filter((item) => item !== path)
    setHiddenPaths(nextHiddenPaths)
    await saveActiveProfileNavigation({ hiddenPaths: nextHiddenPaths })
  }

  async function handleToggleFavoriteDocument(path: string) {
    const nextFavoritePaths = favoritePaths.includes(path)
      ? favoritePaths.filter((item) => item !== path)
      : [...favoritePaths, path]
    setFavoritePaths(nextFavoritePaths)
    await saveActiveProfileNavigation({ favoritePaths: nextFavoritePaths })
  }

  function handleToggleShowFavoritesOnly() {
    setShowFavoritesOnly((current) => {
      const next = !current
      if (next) setShowRecentOnly(false)
      return next
    })
  }

  async function handleRevealDocumentInFolder(documentPath: string) {
    try {
      const projectId = activeProjectIdRef.current
      if (!projectId) throw new Error('当前项目不可用')
      await revealDocumentInBridge(projectId, activeProfileIdRef.current, documentPath)
      publishActionFeedback(`已发送文件夹定位请求：${documentPath}`)
    } catch (error) {
      publishActionFeedback(error instanceof Error ? `定位失败：${error.message}` : '定位失败', 'error')
    }
  }

  async function handleHideFileTitleDateChange(nextHideFileTitleDate: boolean) {
    setHideFileTitleDate(nextHideFileTitleDate)
    await saveActiveProfileAppearance({ hideFileTitleDate: nextHideFileTitleDate })
  }

  async function handleLocateCurrentDocumentInTree() {
    if (
      !currentDocumentPath ||
      isCurrentDocumentHiddenInRecent ||
      isCurrentDocumentUnavailableInRecent
    ) {
      return
    }

    setShowRecentOnly(false)
    const nextExpandedFileNodes = Array.from(
      new Set([...expandedFileNodes, ...getDocumentAncestorDirectoryPaths(currentDocumentPath)]),
    ).sort()
    await handleExpandedFileNodesChange(nextExpandedFileNodes)
  }

  function handleToggleShowRecentOnly() {
    setShowRecentOnly((current) => {
      const next = !current
      if (next) setShowFavoritesOnly(false)
      return next
    })
  }

  function handleToggleShowHiddenItems() {
    setShowHiddenItems((current) => !current)
  }

  async function waitForLocalBridgeReady(timeoutMs = 6000) {
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      const health = await getLocalBridgeHealth()

      if (health.ok) {
        return
      }

      await new Promise((resolve) => window.setTimeout(resolve, 200))
    }

    throw new Error('本地服务重启超时')
  }

  async function handleRestartService() {
    if (projectOperationBusyRef.current || pendingRegistryRef.current) return
    if (workspaceSource !== 'local-service' || isServiceActionPending) {
      return
    }

    if (getDirtyTabs().length > 0) {
      setPendingWorkspaceAction({ kind: 'restart-service' })
      return
    }

    await continueWorkspaceAction({ kind: 'restart-service' })
  }

  async function handleReconnectService() {
    if (projectOperationBusyRef.current || pendingRegistryRef.current) return
    if (workspaceSource === 'local-service' || isServiceActionPending) {
      return
    }

    if (getDirtyTabs().length > 0) {
      setPendingWorkspaceAction({ kind: 'reconnect-service' })
      return
    }

    await continueWorkspaceAction({ kind: 'reconnect-service' })
  }

  async function handleStopService() {
    if (projectOperationBusyRef.current || pendingRegistryRef.current) return
    if (workspaceSource !== 'local-service' || isServiceActionPending) {
      return
    }

    if (getDirtyTabs().length > 0) {
      setPendingWorkspaceAction({ kind: 'stop-service' })
      return
    }

    await continueWorkspaceAction({ kind: 'stop-service' })
  }

  async function handleSaveAllAndContinue() {
    const action = pendingWorkspaceAction

    if (action == null) {
      return
    }

    const isSaved = await flushAllDirtyTabs()
    setPendingWorkspaceAction(null)

    if (!isSaved) {
      return
    }

    await continueWorkspaceAction(action)
  }

  async function handleDiscardAllAndContinue() {
    const action = pendingWorkspaceAction

    if (action == null) {
      return
    }

    discardDirtyTabs(getDirtyTabs().map((tab) => tab.id))
    setPendingWorkspaceAction(null)
    await continueWorkspaceAction(action)
  }

  function handleCancelWorkspaceAction() {
    setPendingWorkspaceAction(null)
  }

  async function handleSaveTabAndClose() {
    const action = pendingCloseTabAction

    if (action == null) {
      return
    }

    const isSaved = await saveTabById(action.tabId, 'leave')
    setPendingCloseTabAction(null)

    if (!isSaved) {
      return
    }

    await closeTabInternal(action.tabId)
  }

  async function handleDiscardTabAndClose() {
    const action = pendingCloseTabAction

    if (action == null) {
      return
    }

    discardTabDraft(action.tabId)
    setPendingCloseTabAction(null)
    await closeTabInternal(action.tabId)
  }

  function handleCancelTabClose() {
    setPendingCloseTabAction(null)
  }

  return (
    <>
      <AppShell
        projects={projects}
        activeProjectId={activeProjectId}
        pendingProjectId={pendingProjectId}
        profileIds={profileIds}
        activeProfileId={activeProfileId}
        tabs={session.tabs.map((tab) => ({
          id: tab.id,
          documentPath: tab.documentPath,
          title: formatTabTitle(tab.documentPath),
          saveState: tab.saveState,
          saveErrorMessage: tab.saveErrorMessage,
          isPinned: session.pinnedDocumentPaths?.includes(tab.documentPath) ?? false,
        }))}
        activeTabId={session.activeTabId}
        canManageService={workspaceSource === 'local-service'}
        isServiceActionPending={isServiceActionPending}
        mode={mode}
        regularViewState={regularViewState}
        fileTree={visibleFileTree}
        availableDirectoryPaths={availableDirectoryPaths}
        favoritePaths={favoritePaths}
        showFavoritesOnly={showFavoritesOnly}
        showRecentOnly={showRecentOnly}
        isCurrentDocumentOutsideRecent={isCurrentDocumentOutsideRecent}
        isCurrentDocumentHiddenInRecent={isCurrentDocumentHiddenInRecent}
        isCurrentDocumentUnavailableInRecent={isCurrentDocumentUnavailableInRecent}
        showHiddenItems={showHiddenItems}
        currentDocumentPath={currentDocumentPath}
        currentDocumentContent={currentDocumentContent}
        documentScrollTop={
          (currentDocumentPath
            ? latestScrollPositionsRef.current.get(currentDocumentPath)
            : undefined) ?? activeTab?.lastKnownScrollTop ?? 0
        }
        documentScrollRestoreId={documentScrollRestoreId}
        editingDocumentContent={editingDocumentContent}
        saveIndicator={getSaveIndicator(activeTab)}
        isDocumentLoading={isDocumentLoading}
        isFileTreeRefreshing={isFileTreeRefreshing}
        isProjectSwitching={pendingProjectId != null}
        isWorkspaceInputBlocked={workspaceInputBlocked}
        pendingProjectName={projects.find((project) => project.id === pendingProjectId)?.name ?? null}
        statusMessage={statusMessage}
        actionToast={actionToast}
        sidebarWidth={sidebarWidth}
        outlineWidth={outlineWidth}
        expandedFileNodes={expandedFileNodes}
        hasPersistedExpandedFileNodes={hasPersistedExpandedFileNodes}
        documentFontSize={documentFontSize}
        maxUnpinnedTabs={maxUnpinnedTabs}
        onMaxUnpinnedTabsChange={handleMaxUnpinnedTabsChange}
        documentPageWidth={documentPageWidth}
        documentLineHeight={documentLineHeight}
        hideFileTitleDate={hideFileTitleDate}
        isWorkspaceBootstrapping={isWorkspaceBootstrapping}
        onConnectProject={handleConnectProject}
        onManageProjects={() => setIsProjectManagerOpen(true)}
        onProjectChange={handleProjectChange}
        onProfileChange={handleProfileChange}
        onRefreshDocument={handleRefreshDocument}
        onRefreshFileTree={handleRefreshFileTree}
        onModeChange={handleModeChange}
        onToggleRegularLock={handleToggleRegularLock}
        onToggleFavoriteDocument={handleToggleFavoriteDocument}
        onToggleShowFavoritesOnly={handleToggleShowFavoritesOnly}
        onToggleShowRecentOnly={handleToggleShowRecentOnly}
        onLocateCurrentDocumentInTree={handleLocateCurrentDocumentInTree}
        onToggleShowHiddenItems={handleToggleShowHiddenItems}
        onHidePath={handleHidePath}
        onUnhidePath={handleUnhidePath}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
        onTabPin={handleTabPin}
        onTabReorder={handleTabReorder}
        onRestartService={handleRestartService}
        onReconnectService={handleReconnectService}
        onStopService={handleStopService}
        graphOpen={graphOpen}
        graphIndex={graphIndex}
        graphLoading={graphLoading}
        graphError={graphError}
        onToggleGraph={handleToggleGraph}
        onCloseGraph={() => setGraphOpen(false)}
        onRefreshGraph={() => void loadGraphIndex()}
        graphProjectId={activeProjectId}
        onGraphEnterDocument={handleGraphEnterDocument}
        onDocumentSelect={handleDocumentSelect}
        onDocumentScrollTopChange={handleDocumentScrollTopChange}
        onCreateDocument={handleCreateDocument}
        onCreateDirectory={handleCreateDirectory}
        onCopyDocumentLink={handleCopyDocumentLink}
        onRevealDocumentInFolder={handleRevealDocumentInFolder}
        onCopyDirectoryPath={handleCopyDirectoryPath}
        onDuplicateDocument={handleDuplicateDocument}
        onRenameDocument={handleRenameDocument}
        onDeleteDocument={handleDeleteDocument}
        onMoveDocument={handleMoveDocumentToDirectory}
        onReorderFileTreeNode={handleReorderFileTreeNode}
        onExpandedFileNodesChange={handleExpandedFileNodesChange}
        onDocumentFontSizeChange={handleDocumentFontSizeChange}
        onDocumentPageWidthChange={handleDocumentPageWidthChange}
        onDocumentLineHeightChange={handleDocumentLineHeightChange}
        onHideFileTitleDateChange={handleHideFileTitleDateChange}
        onEditingDocumentContentChange={setDraftDocumentContent}
        onEditingCompositionStart={handleEditingCompositionStart}
        onEditingCompositionEnd={handleEditingCompositionEnd}
        documentLinkPaths={documentLinkPaths}
        documentLinkContentRoots={projects.find((project) => project.id === activeProjectId)?.contentRoots ?? ['.']}
        getDocumentLinkHref={getDocumentLinkHref}
        getAssetHref={getAssetHref}
        onDocumentLinkNavigate={handleDocumentLinkNavigate}
        onCurrentDocumentAnchorNavigate={handleCurrentDocumentAnchorNavigate}
        onInvalidDocumentLink={handleInvalidDocumentLink}
        pendingHeadingId={pendingHeadingId}
        onPendingHeadingHandled={(found) => {
          if (!found && pendingHeadingId) publishActionFeedback(`未找到标题：${pendingHeadingId}`, 'error')
          setPendingHeadingId(null)
        }}
        onSidebarWidthChange={handleSidebarWidthChange}
        onSidebarWidthCommit={handleSidebarWidthCommit}
        onOutlineWidthChange={handleOutlineWidthChange}
        onOutlineWidthCommit={handleOutlineWidthCommit}
      />
      <ProjectManager
        open={isProjectManagerOpen && !pendingWorkspaceAction} inputOpen={isProjectInputOpen}
        projects={projects} activeProjectId={activeProjectId}
        busy={projectOperationBusy} uncertain={Boolean(pendingRegistry)} status={statusMessage}
        onClose={() => setIsProjectManagerOpen(false)} onOpenInput={handleConnectProject}
        onCloseInput={() => setIsProjectInputOpen(false)} onRegister={handleRegisterProject}
        onRemove={handleRemoveProject} onReorder={handleProjectReorder} onReconcile={handleReconcileRegistry}
      />
      {pendingWorkspaceAction ? (
        <ActionDialog
          ariaLabel="会话级保存闸门"
          title="当前会话存在未保存标签"
          description="继续执行前，需要先决定这些文档的保存方式。"
          tone="warning"
          actions={[
            { label: '取消', onClick: handleCancelWorkspaceAction },
            { label: '放弃全部', onClick: handleDiscardAllAndContinue },
            { label: '保存全部', onClick: handleSaveAllAndContinue, tone: 'primary' },
          ]}
        >
          <ul className="app-dialog__list">
            {getDirtyTabs().map((tab) => (
              <li key={tab.id}>{tab.documentPath.split('/').at(-1) ?? tab.documentPath}</li>
            ))}
          </ul>
        </ActionDialog>
      ) : null}
      {pendingRefreshDocumentAction ? (
        <ActionDialog
          ariaLabel="刷新当前文档"
          title="刷新当前文档"
          description="当前文档存在未保存内容，重新读取会覆盖这部分编辑。"
          tone="warning"
          actions={[
            { label: '取消', onClick: handleCancelRefreshDocument },
            { label: '覆盖并刷新', onClick: handleConfirmRefreshDocument, tone: 'primary' },
          ]}
        >
          <p className="app-dialog__path">{pendingRefreshDocumentAction.documentPath}</p>
        </ActionDialog>
      ) : null}
      {pendingCloseTabAction ? (
        <ActionDialog
          ariaLabel="关闭未保存标签"
          title="当前标签存在未保存内容"
          description="关闭前请选择是否保留这次编辑。"
          tone="warning"
          actions={[
            { label: '取消', onClick: handleCancelTabClose },
            { label: '放弃', onClick: handleDiscardTabAndClose },
            { label: '保存', onClick: handleSaveTabAndClose, tone: 'primary' },
          ]}
        />
      ) : null}
      {pendingDeleteDocumentAction ? (
        <ActionDialog
          ariaLabel="删除文档"
          title="删除文档"
          description={`确认删除「${pendingDeleteDocumentAction.documentPath.split('/').at(-1) ?? pendingDeleteDocumentAction.documentPath}」？删除后无法恢复。`}
          tone="danger"
          actions={[
            { label: '取消', onClick: handleCancelDeleteDocument },
            { label: '删除', onClick: handleConfirmDeleteDocument, tone: 'danger' },
          ]}
        >
          <p className="app-dialog__path">{pendingDeleteDocumentAction.documentPath}</p>
        </ActionDialog>
      ) : null}
      {pendingCreateNodeAction ? (
        <ActionDialog
          ariaLabel={pendingCreateNodeAction.kind === 'document' ? '新建文档' : '新建文件夹'}
          title={pendingCreateNodeAction.kind === 'document' ? '新建文档' : '新建文件夹'}
          description={
            pendingCreateNodeAction.kind === 'document'
              ? '输入新文档名称，创建后会自动打开。'
              : '输入新文件夹名称，创建后会保留在当前目录树中。'
          }
          actions={[
            { label: '取消', onClick: handleCancelCreateNode },
            {
              label: pendingCreateNodeAction.kind === 'document' ? '创建文档' : '创建文件夹',
              onClick: handleConfirmCreateNode,
              tone: 'primary',
            },
          ]}
        >
          <div className="app-dialog__field">
            <label className="app-dialog__label" htmlFor="create-node-name">
              名称
            </label>
            <input
              id="create-node-name"
              className="app-dialog__input"
              value={pendingCreateNodeName}
              autoFocus
              onChange={(event) => setPendingCreateNodeName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleConfirmCreateNode()
                }
              }}
            />
            <p className="app-dialog__hint">
              {pendingCreateNodeAction.directoryPath
                ? `当前位置：${pendingCreateNodeAction.directoryPath}`
                : '当前位置：项目根目录'}
            </p>
          </div>
        </ActionDialog>
      ) : null}
    </>
  )
}

export default App
