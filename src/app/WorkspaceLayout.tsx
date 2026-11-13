import {
  memo,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  FilePlus2,
  FileText,
  FolderPlus,
  FolderSearch,
  History,
  Link2,
  Pencil,
  Star,
  Trash2,
  X,
} from 'lucide-react'

import { getFileTreeEdgeScrollDelta, createInitialExpandedDirectories, formatFileTreeDisplayName } from './workspace-file-tree-utils'
import { findActiveHeadingId, type HeadingTarget } from './outline-active-heading'
import { GraphView } from '../graph/GraphView'
import type { LinkIndexPayload } from '../workspace/local-bridge-access'
import { VisualMarkdownEditor } from '../editor/visual-markdown-editor'
import { EDITOR_STRUCTURE_UPDATED_EVENT } from '../editor/editor-structure-events'
import { ReadonlyMarkdownRenderer } from '../document-renderer/readonly-markdown-renderer'
import type { DocumentLinkInvalidReason } from '../markdown/document-link'
import {
  extractMarkdownHeadings,
  type MarkdownHeading,
} from '../markdown/heading-outline'
import type { VisibleFileTreeNode } from '../workspace/file-tree-types'
import { filterFileTree } from '../workspace/file-tree'
import type { RegularViewState, WorkspaceMode } from './TopBar'

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

function isOutlinePerfEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  if (new URLSearchParams(window.location.search).get('perf') === 'outline') {
    return true
  }

  try {
    return window.localStorage.getItem('mdReaderOutlinePerf') === '1'
  } catch {
    return false
  }
}

const OUTLINE_PERF_ENABLED = isOutlinePerfEnabled()
function collectDirectoryPaths(nodes: VisibleFileTreeNode[]): string[] {
  const directoryPaths: string[] = []

  function visit(nextNodes: VisibleFileTreeNode[]) {
    for (const node of nextNodes) {
      if (node.kind !== 'directory') {
        continue
      }

      directoryPaths.push(node.path)
      visit(node.children)
    }
  }

  visit(nodes)
  return directoryPaths
}

function collectDocumentPaths(nodes: VisibleFileTreeNode[]): string[] {
  const documentPaths: string[] = []

  function visit(nextNodes: VisibleFileTreeNode[]) {
    for (const node of nextNodes) {
      if (node.kind === 'directory') {
        visit(node.children)
        continue
      }

      documentPaths.push(node.path)
    }
  }

  visit(nodes)
  return documentPaths
}

function createDefaultDuplicateName(
  documentPath: string,
  existingDocumentPaths: Iterable<string>,
): string {
  const fileName = documentPath.split('/').at(-1) ?? documentPath
  const lastSlashIndex = documentPath.lastIndexOf('/')
  const directoryPrefix = lastSlashIndex >= 0 ? `${documentPath.slice(0, lastSlashIndex)}/` : ''
  const extensionMatch = fileName.match(/(\.[^.]+)$/)
  const extension = extensionMatch?.[1] ?? ''
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName
  const existingPathSet = new Set(existingDocumentPaths)

  let sequence = 1
  while (true) {
    const suffix = sequence === 1 ? '-副本' : `-副本-${sequence}`
    const candidateName = `${baseName}${suffix}${extension}`
    if (!existingPathSet.has(`${directoryPrefix}${candidateName}`)) {
      return candidateName
    }
    sequence += 1
  }
}

interface WorkspaceLayoutProps {
  mode: WorkspaceMode
  regularViewState: RegularViewState
  fileTree: VisibleFileTreeNode[]
  availableDirectoryPaths?: string[]
  currentDocumentPath: string | null
  currentDocumentContent: string | null
  documentScrollTop?: number
  documentScrollRestoreId?: number
  editingDocumentContent?: string | null
  isDocumentLoading?: boolean
  isProjectSwitching?: boolean
  isWorkspaceInputBlocked?: boolean
  pendingProjectName?: string | null
  statusMessage: string | null
  actionToast?: WorkspaceActionToast | null
  sidebarWidth: number
  outlineWidth: number
  persistedExpandedDirectories?: string[]
  hasPersistedExpandedDirectories?: boolean
  hasProjects: boolean
  isWorkspaceBootstrapping?: boolean
  onDocumentSelect: (path: string) => void
  onDocumentScrollTopChange?: (documentPath: string, scrollTop: number) => void
  onCreateDocument?: (directoryPath?: string) => void | Promise<void>
  onCreateDirectory?: (directoryPath?: string) => void | Promise<void>
  onCopyDocumentLink?: (path: string) => void | Promise<void>
  onRevealDocumentInFolder?: (path: string) => void | Promise<void>
  onCopyDirectoryPath?: (path: string) => void | Promise<void>
  onDuplicateDocument?: (path: string, nextName: string) => void | boolean | Promise<void | boolean>
  onRenameDocument?: (path: string, nextName: string) => void | boolean | Promise<void | boolean>
  onDeleteDocument?: (path: string) => void | Promise<void>
  onMoveDocument?: (sourcePath: string, targetDirectoryPath: string) => void | Promise<void>
  onReorderFileTreeNode?: (payload: FileTreeReorderPayload) => void | Promise<void>
  favoritePaths?: string[]
  showFavoritesOnly?: boolean
  showRecentOnly?: boolean
  isCurrentDocumentOutsideRecent?: boolean
  isCurrentDocumentHiddenInRecent?: boolean
  isCurrentDocumentUnavailableInRecent?: boolean
  showHiddenItems?: boolean
  hideFileTitleDate?: boolean
  onToggleFavoriteDocument?: (path: string) => void
  onToggleShowFavoritesOnly?: () => void
  onToggleShowRecentOnly?: () => void
  onLocateCurrentDocumentInTree?: () => void | Promise<void>
  onHidePath?: (path: string) => void
  onUnhidePath?: (path: string) => void
  onExpandedDirectoriesChange?: (paths: string[]) => void | Promise<void>
  onEditingDocumentContentChange?: (content: string) => void
  onEditingCompositionStart?: () => void
  onEditingCompositionEnd?: () => void
  documentLinkPaths?: Iterable<string>
  documentLinkContentRoots?: Iterable<string>
  getDocumentLinkHref?: (documentPath: string, headingId: string | null) => string
  onDocumentLinkNavigate?: (documentPath: string, headingId: string | null) => void | Promise<void>
  onCurrentDocumentAnchorNavigate?: (headingId: string) => void
  onInvalidDocumentLink?: (href: string, reason: DocumentLinkInvalidReason) => void
  pendingHeadingId?: string | null
  onPendingHeadingHandled?: (found: boolean) => void
  onSidebarWidthChange: (width: number) => void
  onSidebarWidthCommit: (width: number) => void | Promise<void>
  onOutlineWidthChange: (width: number) => void
  onOutlineWidthCommit: (width: number) => void | Promise<void>
  graphOpen?: boolean
  graphIndex?: LinkIndexPayload | null
  graphLoading?: boolean
  graphError?: string | null
  onCloseGraph?: () => void
  onRefreshGraph?: () => void
  graphProjectId?: string | null
  onGraphEnterDocument?: (path: string) => void
}

export interface WorkspaceActionToast {
  id: number
  message: string
  tone: 'success' | 'error' | 'info'
}

export interface FileTreeReorderPayload {
  sourcePath: string
  sourceParentPath: string | null
  targetPath: string | null
  targetParentPath: string | null
  position: 'before' | 'after' | 'tail'
}

type FileTreeNameActionState = {
  path: string
  sourceName: string
  value: string
}

type FileTreeContextMenuState =
  | {
      kind: 'file'
      path: string
      name: string
      x: number
      y: number
    }
  | {
      kind: 'directory'
      path: string
      name: string
      x: number
      y: number
    }

const CONTEXT_MENU_WIDTH = 196
const CONTEXT_MENU_GAP = 8
const EMPTY_PATHS: string[] = []
const DOCUMENT_DRAG_MIME = 'application/x-md-reader-document-path'
const TREE_NODE_DRAG_MIME = 'application/x-md-reader-tree-node-path'

type FileTreeReorderDropTarget = {
  targetPath: string | null
  targetParentPath: string | null
  position: 'before' | 'after' | 'tail'
}

export interface WorkspaceSidebarPaneProps {
  fileTree: VisibleFileTreeNode[]
  availableDirectoryPaths?: string[]
  currentDocumentPath: string | null
  persistedExpandedDirectories?: string[]
  hasPersistedExpandedDirectories?: boolean
  hasProjects: boolean
  isWorkspaceBootstrapping?: boolean
  isProjectSwitching?: boolean
  favoritePaths?: string[]
  showFavoritesOnly?: boolean
  showRecentOnly?: boolean
  isCurrentDocumentOutsideRecent?: boolean
  isCurrentDocumentHiddenInRecent?: boolean
  isCurrentDocumentUnavailableInRecent?: boolean
  showHiddenItems?: boolean
  hideFileTitleDate?: boolean
  onDocumentSelect: (path: string) => void
  onCreateDocument?: (directoryPath?: string) => void | Promise<void>
  onCreateDirectory?: (directoryPath?: string) => void | Promise<void>
  onCopyDocumentLink?: (path: string) => void | Promise<void>
  onRevealDocumentInFolder?: (path: string) => void | Promise<void>
  onCopyDirectoryPath?: (path: string) => void | Promise<void>
  onDuplicateDocument?: (path: string, nextName: string) => void | boolean | Promise<void | boolean>
  onRenameDocument?: (path: string, nextName: string) => void | boolean | Promise<void | boolean>
  onDeleteDocument?: (path: string) => void | Promise<void>
  onMoveDocument?: (sourcePath: string, targetDirectoryPath: string) => void | Promise<void>
  onReorderFileTreeNode?: (payload: FileTreeReorderPayload) => void | Promise<void>
  onToggleFavoriteDocument?: (path: string) => void
  onToggleShowFavoritesOnly?: () => void
  onToggleShowRecentOnly?: () => void
  onLocateCurrentDocumentInTree?: () => void | Promise<void>
  onHidePath?: (path: string) => void
  onUnhidePath?: (path: string) => void
  onExpandedDirectoriesChange?: (paths: string[]) => void | Promise<void>
  onRender?: () => void
}

function collectHeadingTargets(
  root: ParentNode | null,
  documentHeadings: MarkdownHeading[],
): HeadingTarget[] {
  return Array.from(root?.querySelectorAll<HTMLElement>(HEADING_SELECTOR) ?? [])
    .map((element, index) => {
      const id = documentHeadings[index]?.id || element.dataset.headingId || element.id
      return id ? { element, id } : null
    })
    .filter((target): target is HeadingTarget => target != null)
}

function nodeTouchesHeadings(node: Node): boolean {
  if (node instanceof HTMLElement && node.matches(HEADING_SELECTOR)) {
    return true
  }

  if (!(node instanceof Element)) {
    return false
  }

  return node.querySelector(HEADING_SELECTOR) != null
}

function mutationRequiresHeadingResync(
  records: MutationRecord[],
  activeHeadingElement: HTMLElement | null,
  root: ParentNode | null,
  documentHeadings: MarkdownHeading[],
): boolean {
  if (activeHeadingElement != null && !activeHeadingElement.isConnected) {
    return true
  }

  const headingElements = Array.from(root?.querySelectorAll<HTMLElement>(HEADING_SELECTOR) ?? [])

  const hasHeadingIdMismatch = headingElements.some((element, index) => {
    const expectedId = documentHeadings[index]?.id
    return expectedId != null && (element.dataset.headingId !== expectedId || element.id !== expectedId)
  })

  if (hasHeadingIdMismatch) {
    return true
  }

  return records.some((record) => {
    if (record.target instanceof HTMLElement && record.target.matches(HEADING_SELECTOR)) {
      return true
    }

    return [...record.addedNodes, ...record.removedNodes].some((node) => nodeTouchesHeadings(node))
  })
}

function collectOutlinePerfSnapshot(root: ParentNode | null) {
  return {
    editorNodes: root?.querySelectorAll('*').length ?? 0,
    headings: root?.querySelectorAll(HEADING_SELECTOR).length ?? 0,
    inlineCode: root?.querySelectorAll('code').length ?? 0,
    links: root?.querySelectorAll('a').length ?? 0,
    tables: root?.querySelectorAll('table').length ?? 0,
  }
}

type OutlinePerfSnapshot = ReturnType<typeof collectOutlinePerfSnapshot>

export const WorkspaceSidebarPane = memo(function WorkspaceSidebarPane({
  fileTree,
  availableDirectoryPaths = EMPTY_PATHS,
  currentDocumentPath,
  persistedExpandedDirectories = EMPTY_PATHS,
  hasPersistedExpandedDirectories = false,
  hasProjects,
  isWorkspaceBootstrapping = false,
  isProjectSwitching = false,
  favoritePaths = EMPTY_PATHS,
  showFavoritesOnly = false,
  showRecentOnly = false,
  isCurrentDocumentOutsideRecent = false,
  isCurrentDocumentHiddenInRecent = false,
  isCurrentDocumentUnavailableInRecent = false,
  showHiddenItems = false,
  hideFileTitleDate = false,
  onDocumentSelect,
  onCreateDocument = () => {},
  onCreateDirectory = () => {},
  onCopyDocumentLink = () => {},
  onRevealDocumentInFolder = () => {},
  onCopyDirectoryPath = () => {},
  onDuplicateDocument = async () => true,
  onRenameDocument = async () => true,
  onDeleteDocument = () => {},
  onMoveDocument = () => {},
  onReorderFileTreeNode = () => {},
  onToggleFavoriteDocument = () => {},
  onToggleShowFavoritesOnly = () => {},
  onToggleShowRecentOnly = () => {},
  onLocateCurrentDocumentInTree,
  onHidePath = () => {},
  onUnhidePath = () => {},
  onExpandedDirectoriesChange,
  onRender,
}: WorkspaceSidebarPaneProps) {
  onRender?.()
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => createInitialExpandedDirectories(
    availableDirectoryPaths.length > 0 ? availableDirectoryPaths : collectDirectoryPaths(fileTree),
    currentDocumentPath, persistedExpandedDirectories, hasPersistedExpandedDirectories,
  ))
  const [expansionInputs, setExpansionInputs] = useState(() => ({ availableDirectoryPaths, currentDocumentPath, fileTree, hasPersistedExpandedDirectories, persistedExpandedDirectories }))
  if (expansionInputs.availableDirectoryPaths !== availableDirectoryPaths || expansionInputs.currentDocumentPath !== currentDocumentPath ||
    expansionInputs.fileTree !== fileTree || expansionInputs.hasPersistedExpandedDirectories !== hasPersistedExpandedDirectories ||
    expansionInputs.persistedExpandedDirectories !== persistedExpandedDirectories) {
    setExpansionInputs({ availableDirectoryPaths, currentDocumentPath, fileTree, hasPersistedExpandedDirectories, persistedExpandedDirectories })
    const paths = availableDirectoryPaths.length > 0 ? availableDirectoryPaths : collectDirectoryPaths(fileTree)
    setExpandedDirectories(createInitialExpandedDirectories(paths, currentDocumentPath, persistedExpandedDirectories, hasPersistedExpandedDirectories))
  }
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [contextMenuState, setContextMenuState] = useState<FileTreeContextMenuState | null>(null)
  const [nameActionState, setNameActionState] = useState<FileTreeNameActionState | null>(null)
  const [dragNodePath, setDragNodePath] = useState<string | null>(null)
  const [dropDirectoryPath, setDropDirectoryPath] = useState<string | null>(null)
  const [reorderDropTarget, setReorderDropTarget] = useState<FileTreeReorderDropTarget | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null)
  const dragNodePathRef = useRef<string | null>(null)
  const dragNodeParentPathRef = useRef<string | null>(null)
  const dragNodeKindRef = useRef<VisibleFileTreeNode['kind'] | null>(null)
  const fileTreePanelRef = useRef<HTMLDivElement | null>(null)
  const fileTreeHoverLayerRef = useRef<HTMLDivElement | null>(null)
  const edgeScrollFrameRef = useRef<number | null>(null)
  const edgeScrollDeltaRef = useRef(0)
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null)
  const deferredFileSearchQuery = useDeferredValue(fileSearchQuery)
  const isFilteringFiles = deferredFileSearchQuery.trim().length > 0
  const reorderEnabled = !isFilteringFiles && !showFavoritesOnly && !showRecentOnly
  const visibleFileTree = filterFileTree(
    fileTree,
    deferredFileSearchQuery,
  ) as VisibleFileTreeNode[]
  const allDocumentPaths = collectDocumentPaths(fileTree)
  const hasFavorites = favoritePaths.length > 0

  function stopEdgeAutoScroll() {
    edgeScrollDeltaRef.current = 0
    if (edgeScrollFrameRef.current != null) {
      window.cancelAnimationFrame(edgeScrollFrameRef.current)
      edgeScrollFrameRef.current = null
    }
  }

  function runEdgeAutoScroll() {
    const panel = fileTreePanelRef.current
    const delta = edgeScrollDeltaRef.current
    if (!panel || !delta || dragNodePathRef.current == null) {
      stopEdgeAutoScroll()
      return
    }

    const previousScrollTop = panel.scrollTop
    panel.scrollTop += delta
    if (panel.scrollTop === previousScrollTop) {
      stopEdgeAutoScroll()
      return
    }
    const pointer = dragPointerRef.current
    const row = pointer
      ? document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>('.file-tree__row')
      : null
    if (row) {
      const nodePath = row.dataset.treeNodePath
      const nodeKind = row.dataset.treeNodeKind as VisibleFileTreeNode['kind'] | undefined
      const parentPath = row.dataset.treeParentPath || null
      if (nodePath && nodeKind) {
        updateTreeNodeDropTarget(nodePath, nodeKind, parentPath, pointer!.y, row.getBoundingClientRect())
      }
    } else if (pointer) {
      const tail = document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLUListElement>('.file-tree')
      const parentPath = tail?.dataset.treeTailParentPath || null
      if (tail && dragNodePathRef.current != null && dragNodeParentPathRef.current === parentPath) {
        setDropDirectoryPath(null)
        setReorderDropTarget({ targetPath: null, targetParentPath: parentPath, position: 'tail' })
      }
    }
    edgeScrollFrameRef.current = window.requestAnimationFrame(runEdgeAutoScroll)
  }

  function handleFileTreeDragOverCapture(event: React.DragEvent<HTMLDivElement>) {
    if (dragNodePathRef.current == null) {
      return
    }
    const panel = fileTreePanelRef.current
    if (!panel) {
      return
    }
    dragPointerRef.current = { x: event.clientX, y: event.clientY }
    edgeScrollDeltaRef.current = getFileTreeEdgeScrollDelta(panel.getBoundingClientRect(), event.clientY)
    if (!edgeScrollDeltaRef.current) {
      stopEdgeAutoScroll()
      return
    }
    if (edgeScrollFrameRef.current == null) {
      edgeScrollFrameRef.current = window.requestAnimationFrame(runEdgeAutoScroll)
    }
  }

  useEffect(() => stopEdgeAutoScroll, [])

  useEffect(() => {
    const panel = fileTreePanelRef.current

    if (!panel) {
      return
    }

    const hideHoverLayer = () => {
      const layer = fileTreeHoverLayerRef.current

      if (layer) {
        layer.style.opacity = '0'
      }
    }

    const moveHoverLayer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.file-tree__row') : null
      const layer = fileTreeHoverLayerRef.current

      if (!target || !layer || target.dataset.renaming === 'true') {
        hideHoverLayer()
        return
      }

      const panelRect = panel.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()

      layer.style.width = `${targetRect.width}px`
      layer.style.height = `${targetRect.height}px`
      layer.style.transform = `translate3d(${targetRect.left - panelRect.left}px, ${
        targetRect.top - panelRect.top + panel.scrollTop
      }px, 0)`
      layer.style.opacity = '1'
    }

    panel.addEventListener('pointerover', moveHoverLayer, { passive: true })
    panel.addEventListener('pointerleave', hideHoverLayer, { passive: true })
    panel.addEventListener('scroll', hideHoverLayer, { passive: true })

    return () => {
      panel.removeEventListener('pointerover', moveHoverLayer)
      panel.removeEventListener('pointerleave', hideHoverLayer)
      panel.removeEventListener('scroll', hideHoverLayer)
    }
  }, [])

  useEffect(() => {
    const input = fileSearchInputRef.current

    if (!input) {
      return
    }

    const syncNativeSearchValue = () => {
      setFileSearchQuery(input.value)
    }

    input.addEventListener('search', syncNativeSearchValue)

    return () => {
      input.removeEventListener('search', syncNativeSearchValue)
    }
  }, [])

  useEffect(() => {
    if (!contextMenuState) {
      return
    }

    const handlePointerDown = () => {
      setContextMenuState(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenuState(null)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenuState])

  const renamePath = nameActionState?.path
  const renameSourceName = nameActionState?.sourceName
  useEffect(() => {
    if (!renamePath || renameSourceName == null) {
      return
    }

    const input = renameInputRef.current
    input?.focus()

    // Keep the suffix intact for the common "rename the title" flow while
    // still letting users replace the whole name with a single shortcut.
    const suffixStart = renameSourceName.lastIndexOf('.')
    const selectionEnd = suffixStart > 0 ? suffixStart : renameSourceName.length
    input?.setSelectionRange(0, selectionEnd)
  }, [renamePath, renameSourceName])

  function handleToggleDirectory(path: string) {
    const next = new Set(expandedDirectories)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setExpandedDirectories(next)
    void onExpandedDirectoriesChange?.([...next].sort())
  }

  function handleOpenContextMenu(state: FileTreeContextMenuState) {
    const container = fileTreePanelRef.current
    if (!container) {
      setContextMenuState(state)
      return
    }

    const rect = container.getBoundingClientRect()
    const maxX = Math.max(CONTEXT_MENU_GAP, rect.width - CONTEXT_MENU_WIDTH - CONTEXT_MENU_GAP)
    const maxY = Math.max(CONTEXT_MENU_GAP, rect.height - CONTEXT_MENU_GAP)
    const localX = Math.min(Math.max(state.x - rect.left, CONTEXT_MENU_GAP), maxX)
    const localY = Math.min(Math.max(state.y - rect.top, CONTEXT_MENU_GAP), maxY)

    setContextMenuState({
      ...state,
      x: localX,
      y: localY,
    })
  }

  async function handleContextMenuAction(action: () => void | Promise<void>) {
    setContextMenuState(null)
    await action()
  }

  function handleRenameStart(path: string, currentName: string) {
    setContextMenuState(null)
    setNameActionState({
      path,
      sourceName: currentName,
      value: currentName,
    })
  }

  async function handleImmediateDuplicate(path: string) {
    const nextName = createDefaultDuplicateName(path, allDocumentPaths)
    await onDuplicateDocument(path, nextName)
  }

  function onNameActionValueChange(nextValue: string) {
    setNameActionState((current) => (current ? { ...current, value: nextValue } : current))
  }

  function onNameActionCancel() {
    setNameActionState(null)
  }

  async function onNameActionSubmit() {
    const current = nameActionState
    if (!current) {
      return
    }

    const nextName = current.value.trim()
    const currentName = current.sourceName

    if (!nextName || nextName === currentName) {
      setNameActionState(null)
      return
    }

    const isSuccess = await onRenameDocument(current.path, nextName)
    if (isSuccess !== false) {
      setNameActionState(null)
    }
  }

  function handleNameActionBlur() {
    window.setTimeout(() => {
      const activeElement = document.activeElement
      if (activeElement === renameInputRef.current) {
        return
      }
      setNameActionState(null)
    }, 0)
  }

  function handleTreeNodeDragStart(
    nodePath: string,
    nodeKind: VisibleFileTreeNode['kind'],
    parentPath: string | null,
    event: React.DragEvent<HTMLElement>,
  ) {
    if (!reorderEnabled) {
      event.preventDefault()
      return
    }

    setContextMenuState(null)
    dragNodePathRef.current = nodePath
    dragNodeParentPathRef.current = parentPath
    dragNodeKindRef.current = nodeKind
    setDragNodePath(nodePath)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(TREE_NODE_DRAG_MIME, nodePath)
    if (nodeKind === 'file') {
      event.dataTransfer.setData(DOCUMENT_DRAG_MIME, nodePath)
      event.dataTransfer.setData('text/plain', nodePath)
    }
  }

  function handleTreeNodeDragEnd() {
    stopEdgeAutoScroll()
    dragPointerRef.current = null
    dragNodePathRef.current = null
    dragNodeParentPathRef.current = null
    dragNodeKindRef.current = null
    setDragNodePath(null)
    setDropDirectoryPath(null)
    setReorderDropTarget(null)
  }

  function handleDirectoryDragOver(directoryPath: string, event: React.DragEvent<HTMLElement>) {
    if (!reorderEnabled) {
      return
    }

    const dragTypes = listDragTypes(event.dataTransfer)
    const hasDraggedDocument =
      dragTypes.includes(DOCUMENT_DRAG_MIME) ||
      dragTypes.includes('text/plain') ||
      (dragNodePathRef.current != null && dragNodeKindRef.current === 'file')

    if (!hasDraggedDocument) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setReorderDropTarget(null)
    setDropDirectoryPath(directoryPath)
  }

  function handleDirectoryDragLeave(directoryPath: string, event?: React.DragEvent<HTMLElement>) {
    if (event) {
      event.stopPropagation()
      const nextTarget = event.relatedTarget
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return
      }
    }
    setDropDirectoryPath((current) => (current === directoryPath ? null : current))
  }

  async function handleDirectoryDrop(directoryPath: string, event: React.DragEvent<HTMLElement>) {
    if (!reorderEnabled) {
      return
    }

    const sourcePath =
      event.dataTransfer.getData(DOCUMENT_DRAG_MIME) ||
      event.dataTransfer.getData('text/plain') ||
      (dragNodeKindRef.current === 'file' ? dragNodePathRef.current : null)
    if (!sourcePath) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    dragNodePathRef.current = null
    dragNodeParentPathRef.current = null
    dragNodeKindRef.current = null
    setDragNodePath(null)
    setDropDirectoryPath(null)
    setReorderDropTarget(null)
    await onMoveDocument(sourcePath, directoryPath)
  }

  function handleTreeNodeDragOver(
    nodePath: string,
    nodeKind: VisibleFileTreeNode['kind'],
    parentPath: string | null,
    event: React.DragEvent<HTMLElement>,
  ) {
    const didUpdateTarget = updateTreeNodeDropTarget(
      nodePath,
      nodeKind,
      parentPath,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    )
    if (didUpdateTarget) {
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      return
    }
  }

  function updateTreeNodeDropTarget(
    nodePath: string,
    nodeKind: VisibleFileTreeNode['kind'],
    parentPath: string | null,
    clientY: number,
    rect: Pick<DOMRect, 'top' | 'height'>,
  ) {
    const draggedPath = dragNodePathRef.current
    const draggedParentPath = dragNodeParentPathRef.current
    const draggedKind = dragNodeKindRef.current
    if (!draggedPath || draggedKind == null) return false
    if (reorderEnabled && draggedPath !== nodePath && draggedParentPath === parentPath) {
      const band = draggedKind === 'file' && nodeKind === 'directory' ? 0.12 : 0
      const position = resolveRowReorderPosition(rect, clientY, band)
      if (position) {
        setDropDirectoryPath(null)
        setReorderDropTarget({ targetPath: nodePath, targetParentPath: parentPath, position })
        return true
      }
    }
    if (draggedKind === 'file' && nodeKind === 'directory' && draggedPath !== nodePath) {
      setReorderDropTarget(null)
      setDropDirectoryPath(nodePath)
      return true
    }
    return false
  }

  async function handleTreeNodeDrop(
    nodePath: string,
    nodeKind: VisibleFileTreeNode['kind'],
    parentPath: string | null,
    event: React.DragEvent<HTMLElement>,
  ) {
    const draggedPath = event.dataTransfer.getData(TREE_NODE_DRAG_MIME) || dragNodePathRef.current

    if (!draggedPath) {
      return
    }

    const sourceParentPath = dragNodeParentPathRef.current
    const directDropPosition =
      reorderEnabled && sourceParentPath === parentPath && draggedPath !== nodePath
        ? resolveRowReorderPositionWithCenterBand(
            event,
            dragNodeKindRef.current === 'file' && nodeKind === 'directory' ? 0.12 : 0,
          )
        : null

    if (directDropPosition) {
      event.preventDefault()
      event.stopPropagation()
      handleTreeNodeDragEnd()
      await onReorderFileTreeNode({
        sourcePath: draggedPath,
        sourceParentPath,
        targetPath: nodePath,
        targetParentPath: parentPath,
        position: directDropPosition,
      })
      return
    }

    if (nodeKind === 'directory') {
      await handleDirectoryDrop(nodePath, event)
    }
  }

  function handleTailDragOver(parentPath: string | null, event: React.DragEvent<HTMLUListElement>) {
    if (event.target !== event.currentTarget) {
      return
    }

    if (!reorderEnabled || dragNodePathRef.current == null || dragNodeParentPathRef.current !== parentPath) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropDirectoryPath(null)
    setReorderDropTarget({
      targetPath: null,
      targetParentPath: parentPath,
      position: 'tail',
    })
  }

  async function handleTailDrop(parentPath: string | null, event: React.DragEvent<HTMLUListElement>) {
    if (event.target !== event.currentTarget) {
      return
    }

    if (
      reorderDropTarget?.position !== 'tail' ||
      reorderDropTarget.targetParentPath !== parentPath ||
      dragNodePathRef.current == null
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const sourcePath = dragNodePathRef.current
    const sourceParentPath = dragNodeParentPathRef.current
    handleTreeNodeDragEnd()
    await onReorderFileTreeNode({
      sourcePath,
      sourceParentPath,
      targetPath: null,
      targetParentPath: parentPath,
      position: 'tail',
    })
  }

  return (
    <aside className="workspace__sidebar workspace__sidebar--left" aria-hidden={isProjectSwitching || undefined}>
      <div id="workspace-file-tree" className="panel panel--sidebar">
        <div className="panel__search panel__search--with-favorites">
          <button
            type="button"
            className="panel__recent-toggle"
            aria-label="按最近时间查看文档"
            aria-pressed={showRecentOnly}
            onClick={onToggleShowRecentOnly}
          >
            <History aria-hidden="true" />
          </button>
          <button
            type="button"
            className="panel__favorite-toggle"
            aria-label="只看收藏文档"
            aria-pressed={showFavoritesOnly}
            onClick={onToggleShowFavoritesOnly}
            >
              <Star fill={showFavoritesOnly ? 'currentColor' : 'none'} />
            </button>
            <input
              ref={fileSearchInputRef}
              type="search"
              className="panel__search-input"
            aria-label="搜索文件"
            placeholder="搜索文件"
            value={fileSearchQuery}
            onChange={(event) => setFileSearchQuery(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="panel__create-button"
            aria-label="新建文档"
            title="新建文档"
            onClick={() => void onCreateDocument()}
          >
            <FilePlus2 />
          </button>
          <button
            type="button"
            className="panel__create-button"
            aria-label="新建文件夹"
            title="新建文件夹"
            onClick={() => void onCreateDirectory()}
          >
            <FolderPlus />
          </button>
        </div>
        <div
          ref={fileTreePanelRef}
          className="panel__content panel__content--tree"
          onDragOverCapture={handleFileTreeDragOverCapture}
        >
          <div ref={fileTreeHoverLayerRef} className="file-tree__hover-layer" aria-hidden="true" />
          {showRecentOnly && (isCurrentDocumentOutsideRecent || isCurrentDocumentHiddenInRecent || isCurrentDocumentUnavailableInRecent) ? (
            <div className="file-tree__recent-status" role="status">
              {isCurrentDocumentHiddenInRecent ? (
                <span>当前文件已隐藏，未显示在最近列表中</span>
              ) : isCurrentDocumentUnavailableInRecent ? (
                <span>当前文件已不存在或不可访问</span>
              ) : (
                <>
                  <span>当前文件不在最近 50 项中</span>
                  <button
                    type="button"
                    onClick={() => void onLocateCurrentDocumentInTree?.()}
                    aria-label="在目录中定位当前文件"
                  >
                    在目录中定位
                  </button>
                </>
              )}
            </div>
          ) : null}
          {fileTree.length > 0 && visibleFileTree.length > 0 ? (
            <WorkspaceFileTree
              nodes={visibleFileTree}
              level={0}
              parentPath={null}
              isRecentView={showRecentOnly}
              searchActive={isFilteringFiles}
              reorderEnabled={reorderEnabled}
              currentDocumentPath={currentDocumentPath}
              expandedDirectories={expandedDirectories}
              onToggleDirectory={handleToggleDirectory}
              onDocumentSelect={onDocumentSelect}
              onCreateDocument={onCreateDocument}
              onCreateDirectory={onCreateDirectory}
              onCopyDocumentLink={onCopyDocumentLink}
              onRevealDocumentInFolder={onRevealDocumentInFolder}
              onCopyDirectoryPath={onCopyDirectoryPath}
              onDuplicateDocument={onDuplicateDocument}
              onRenameDocument={onRenameDocument}
              onDeleteDocument={onDeleteDocument}
              onMoveDocument={onMoveDocument}
              favoritePaths={favoritePaths}
              showHiddenItems={showHiddenItems}
              hideFileTitleDate={hideFileTitleDate}
              onToggleFavoriteDocument={onToggleFavoriteDocument}
              onHidePath={onHidePath}
              onUnhidePath={onUnhidePath}
              onOpenContextMenu={handleOpenContextMenu}
              nameActionState={nameActionState}
              renameInputRef={renameInputRef}
              onRenameStart={handleRenameStart}
              onNameActionValueChange={onNameActionValueChange}
              onNameActionSubmit={onNameActionSubmit}
              onNameActionCancel={onNameActionCancel}
              onNameActionBlur={handleNameActionBlur}
              dragNodePath={dragNodePath}
              dropDirectoryPath={dropDirectoryPath}
              reorderDropTarget={reorderDropTarget}
              onTreeNodeDragStart={handleTreeNodeDragStart}
              onTreeNodeDragEnd={handleTreeNodeDragEnd}
              onTreeNodeDragOver={handleTreeNodeDragOver}
              onTreeNodeDrop={handleTreeNodeDrop}
              onTailDragOver={handleTailDragOver}
              onTailDrop={handleTailDrop}
              onDirectoryDragOver={handleDirectoryDragOver}
              onDirectoryDragLeave={handleDirectoryDragLeave}
              onDirectoryDrop={handleDirectoryDrop}
            />
          ) : isFilteringFiles ? (
            <p className="panel__empty">没有匹配的文件</p>
          ) : showFavoritesOnly && !hasFavorites ? (
            <p className="panel__empty">当前还没有收藏文档</p>
          ) : isWorkspaceBootstrapping ? (
            <p className="panel__empty">正在恢复工作区…</p>
          ) : (
            <p className="panel__empty">
              {hasProjects ? '当前项目还没有可用的 Markdown 文件' : '还没有接入任何 Markdown 项目'}
            </p>
          )}
          {contextMenuState ? (
            <div
              role="menu"
              className="file-tree__context-menu"
              style={{
                left: contextMenuState.x,
                top: contextMenuState.y,
                position: 'absolute',
                width: `${CONTEXT_MENU_WIDTH}px`,
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {contextMenuState.kind === 'file' ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void handleContextMenuAction(() => onCopyDocumentLink(contextMenuState.path))
                    }
                  >
                    <Link2 aria-hidden="true" />
                    <span>拷贝链接</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleContextMenuAction(() => onRevealDocumentInFolder(contextMenuState.path))}
                  >
                    <FolderSearch aria-hidden="true" />
                    <span>在文件夹中显示</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void handleContextMenuAction(() =>
                        handleImmediateDuplicate(contextMenuState.path),
                      )
                    }
                  >
                    <Copy aria-hidden="true" />
                    <span>创建副本</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void handleContextMenuAction(() =>
                        handleRenameStart(contextMenuState.path, contextMenuState.name),
                      )
                    }
                  >
                    <Pencil aria-hidden="true" />
                    <span>重命名</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void handleContextMenuAction(() => onDeleteDocument(contextMenuState.path))
                    }
                  >
                    <Trash2 aria-hidden="true" />
                    <span>删除文档</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void handleContextMenuAction(() =>
                        onToggleFavoriteDocument(contextMenuState.path),
                      )
                    }
                  >
                    <Star aria-hidden="true" />
                    <span>
                      {favoritePaths.includes(contextMenuState.path) ? '取消收藏文件夹' : '收藏文件夹'}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void handleContextMenuAction(() => onCreateDocument(contextMenuState.path))
                    }
                  >
                    <FilePlus2 aria-hidden="true" />
                    <span>新建文档</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void handleContextMenuAction(() => onCreateDirectory(contextMenuState.path))
                    }
                  >
                    <FolderPlus aria-hidden="true" />
                    <span>新建文件夹</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void handleContextMenuAction(() => onCopyDirectoryPath(contextMenuState.path))
                    }
                  >
                    <Link2 aria-hidden="true" />
                    <span>拷贝目录路径</span>
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
})

function listDragTypes(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer?.types) {
    return []
  }

  return Array.from(dataTransfer.types)
}

function resolveRowReorderPositionWithCenterBand(
  event: React.DragEvent<HTMLElement>,
  centerBandRatio: number,
) {
  return resolveRowReorderPosition(event.currentTarget.getBoundingClientRect(), event.clientY, centerBandRatio)
}

function resolveRowReorderPosition(
  rect: Pick<DOMRect, 'top' | 'height'>,
  clientY: number,
  centerBandRatio: number,
) {
  if (!Number.isFinite(clientY) || clientY <= 0) {
    return null
  }

  const ratio = (clientY - rect.top) / Math.max(rect.height, 1)
  const safeCenterBandRatio = Math.min(Math.max(centerBandRatio, 0), 0.48)
  const beforeThreshold = 0.5 - safeCenterBandRatio / 2
  const afterThreshold = 0.5 + safeCenterBandRatio / 2

  if (ratio < beforeThreshold) {
    return 'before'
  }
  if (ratio > afterThreshold) {
    return 'after'
  }
  if (safeCenterBandRatio === 0) {
    return ratio < 0.5 ? 'before' : 'after'
  }
  return null
}

export function WorkspaceFileTree({
  nodes,
  level,
  parentPath,
  isRecentView,
  searchActive,
  reorderEnabled,
  currentDocumentPath,
  expandedDirectories,
  onToggleDirectory,
  onDocumentSelect,
  onCreateDocument,
  onCreateDirectory,
  onCopyDocumentLink,
  onRevealDocumentInFolder,
  onCopyDirectoryPath,
  onDuplicateDocument,
  onRenameDocument,
  onDeleteDocument,
  onMoveDocument,
  favoritePaths,
  showHiddenItems,
  hideFileTitleDate,
  onToggleFavoriteDocument,
  onHidePath,
  onUnhidePath,
  onOpenContextMenu,
  nameActionState,
  renameInputRef,
  onRenameStart,
  onNameActionValueChange,
  onNameActionSubmit,
  onNameActionCancel,
  onNameActionBlur,
  dragNodePath,
  dropDirectoryPath,
  reorderDropTarget,
  onTreeNodeDragStart,
  onTreeNodeDragEnd,
  onTreeNodeDragOver,
  onTreeNodeDrop,
  onTailDragOver,
  onTailDrop,
  onDirectoryDragOver,
  onDirectoryDragLeave,
  onDirectoryDrop,
}: {
  nodes: VisibleFileTreeNode[]
  level: number
  parentPath: string | null
  isRecentView: boolean
  searchActive: boolean
  reorderEnabled: boolean
  currentDocumentPath: string | null
  expandedDirectories: Set<string>
  onToggleDirectory: (path: string) => void
  onDocumentSelect: (path: string) => void
  onCreateDocument: (directoryPath?: string) => void | Promise<void>
  onCreateDirectory: (directoryPath?: string) => void | Promise<void>
  onCopyDocumentLink: (path: string) => void | Promise<void>
  onRevealDocumentInFolder: (path: string) => void | Promise<void>
  onCopyDirectoryPath: (path: string) => void | Promise<void>
  onDuplicateDocument: (path: string, nextName: string) => void | boolean | Promise<void | boolean>
  onRenameDocument: (path: string, nextName: string) => void | boolean | Promise<void | boolean>
  onDeleteDocument: (path: string) => void | Promise<void>
  onMoveDocument: (sourcePath: string, targetDirectoryPath: string) => void | Promise<void>
  favoritePaths: string[]
  showHiddenItems: boolean
  hideFileTitleDate: boolean
  onToggleFavoriteDocument: (path: string) => void
  onHidePath: (path: string) => void
  onUnhidePath: (path: string) => void
  onOpenContextMenu: (state: FileTreeContextMenuState) => void
  nameActionState: FileTreeNameActionState | null
  renameInputRef: RefObject<HTMLInputElement | null>
  onRenameStart: (path: string, currentName: string) => void
  onNameActionValueChange: (nextValue: string) => void
  onNameActionSubmit: () => Promise<void>
  onNameActionCancel: () => void
  onNameActionBlur: () => void
  dragNodePath: string | null
  dropDirectoryPath: string | null
  reorderDropTarget: FileTreeReorderDropTarget | null
  onTreeNodeDragStart: (
    nodePath: string,
    nodeKind: VisibleFileTreeNode['kind'],
    parentPath: string | null,
    event: React.DragEvent<HTMLElement>,
  ) => void
  onTreeNodeDragEnd: () => void
  onTreeNodeDragOver: (
    nodePath: string,
    nodeKind: VisibleFileTreeNode['kind'],
    parentPath: string | null,
    event: React.DragEvent<HTMLElement>,
  ) => void
  onTreeNodeDrop: (
    nodePath: string,
    nodeKind: VisibleFileTreeNode['kind'],
    parentPath: string | null,
    event: React.DragEvent<HTMLElement>,
  ) => void
  onTailDragOver: (parentPath: string | null, event: React.DragEvent<HTMLUListElement>) => void
  onTailDrop: (parentPath: string | null, event: React.DragEvent<HTMLUListElement>) => void
  onDirectoryDragOver: (directoryPath: string, event: React.DragEvent<HTMLElement>) => void
  onDirectoryDragLeave: (directoryPath: string, event?: React.DragEvent<HTMLElement>) => void
  onDirectoryDrop: (directoryPath: string, event: React.DragEvent<HTMLElement>) => void
}) {
  const hasExpandableDirectDirectory = nodes.some(
    (node) => node.kind === 'directory' && node.children.length > 0,
  )

  return (
    <ul
      className="file-tree"
      data-level={level}
      data-has-expandable-directories={hasExpandableDirectDirectory ? 'true' : 'false'}
      data-tree-tail-parent-path={parentPath ?? ''}
      data-drag-active={dragNodePath != null ? 'true' : undefined}
      data-reorder-tail={
        reorderDropTarget?.position === 'tail' && reorderDropTarget.targetParentPath === parentPath
          ? 'true'
          : undefined
      }
      onDragOver={(event) => onTailDragOver(parentPath, event)}
      onDrop={(event) => onTailDrop(parentPath, event)}
    >
      {nodes.map((node) => (
        <li key={node.id} className="file-tree__item">
          {node.kind === 'directory' ? (
            (() => {
              const isExpanded = searchActive || expandedDirectories.has(node.path)
              const isCurrentBranch =
                currentDocumentPath != null &&
                (currentDocumentPath === node.path || currentDocumentPath.startsWith(`${node.path}/`))
              const isHidden = node.meta.isExplicitlyHidden || node.meta.isHiddenByAncestor
              const canUnhideDirectly = node.meta.isExplicitlyHidden && showHiddenItems
              const shouldShowActionButton = !node.meta.isHiddenByAncestor || node.meta.isExplicitlyHidden
              const isFavorited = favoritePaths.includes(node.path)
              const favoriteIndicatorTestId = `favorite-indicator-${node.path.replaceAll('/', '-')}`

              return (
                <>
                  <div
                    className="file-tree__row"
                    data-tree-node-path={node.path}
                    data-tree-node-kind={node.kind}
                    data-tree-parent-path={parentPath ?? ''}
                    data-hidden={isHidden ? 'true' : undefined}
                    data-drop-target={dropDirectoryPath === node.path ? 'true' : undefined}
                    data-reorder-target={
                      reorderDropTarget?.targetPath === node.path ? reorderDropTarget.position : undefined
                    }
                    draggable={reorderEnabled}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onOpenContextMenu({
                        kind: 'directory',
                        path: node.path,
                        name: node.name,
                        x: event.clientX,
                        y: event.clientY,
                      })
                    }}
                    onDragStart={(event) => onTreeNodeDragStart(node.path, node.kind, parentPath, event)}
                    onDragEnd={onTreeNodeDragEnd}
                    onDragEnter={(event) => onTreeNodeDragOver(node.path, node.kind, parentPath, event)}
                    onDragOver={(event) => onTreeNodeDragOver(node.path, node.kind, parentPath, event)}
                    onDrop={(event) => void onTreeNodeDrop(node.path, node.kind, parentPath, event)}
                    onDragLeave={(event) => onDirectoryDragLeave(node.path, event)}
                  >
                    <button
                      type="button"
                      className="file-tree__directory"
                      aria-expanded={isExpanded}
                      data-current-branch={isCurrentBranch ? 'true' : undefined}
                      onClick={() => onToggleDirectory(node.path)}
                    >
                      <span className="file-tree__chevron" aria-hidden="true" />
                      <span className="file-tree__directory-name">{node.name}</span>
                    </button>
                    <div className="file-tree__actions">
                      <button
                        type="button"
                        className="file-tree__action file-tree__action--favorite"
                        data-favorited={isFavorited ? 'true' : undefined}
                        data-testid={favoriteIndicatorTestId}
                        aria-label={isFavorited ? `取消收藏 ${node.name}` : `收藏 ${node.name}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          onToggleFavoriteDocument(node.path)
                        }}
                      >
                        <Star fill={isFavorited ? 'currentColor' : 'none'} />
                      </button>
                      {showHiddenItems && node.meta.isHiddenByAncestor && !node.meta.isExplicitlyHidden ? (
                        <span className="file-tree__derived-hidden-indicator" aria-hidden="true" />
                      ) : null}
                      {shouldShowActionButton ? (
                        <button
                          type="button"
                          className="file-tree__action file-tree__action--visibility"
                          aria-label={canUnhideDirectly ? `显示 ${node.name}` : `隐藏 ${node.name}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (canUnhideDirectly) {
                              onUnhidePath(node.path)
                              return
                            }
                            onHidePath(node.path)
                          }}
                        >
                          {canUnhideDirectly ? <Eye /> : <EyeOff />}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="file-tree__children">
                        <WorkspaceFileTree
                        nodes={node.children}
                        level={level + 1}
                        parentPath={node.path}
                        isRecentView={false}
                        searchActive={searchActive}
                        reorderEnabled={reorderEnabled}
                        currentDocumentPath={currentDocumentPath}
                        expandedDirectories={expandedDirectories}
                        onToggleDirectory={onToggleDirectory}
                        onDocumentSelect={onDocumentSelect}
                        onCreateDocument={onCreateDocument}
                        onCreateDirectory={onCreateDirectory}
                        onCopyDocumentLink={onCopyDocumentLink}
                        onRevealDocumentInFolder={onRevealDocumentInFolder}
                        onCopyDirectoryPath={onCopyDirectoryPath}
                        onDuplicateDocument={onDuplicateDocument}
                        onRenameDocument={onRenameDocument}
                        onDeleteDocument={onDeleteDocument}
                        onMoveDocument={onMoveDocument}
                        favoritePaths={favoritePaths}
                        showHiddenItems={showHiddenItems}
                        hideFileTitleDate={hideFileTitleDate}
                        onToggleFavoriteDocument={onToggleFavoriteDocument}
                        onHidePath={onHidePath}
                        onUnhidePath={onUnhidePath}
                        onOpenContextMenu={onOpenContextMenu}
                        nameActionState={nameActionState}
                        renameInputRef={renameInputRef}
                        onRenameStart={onRenameStart}
                        onNameActionValueChange={onNameActionValueChange}
                        onNameActionSubmit={onNameActionSubmit}
                        onNameActionCancel={onNameActionCancel}
                        onNameActionBlur={onNameActionBlur}
                        dragNodePath={dragNodePath}
                        dropDirectoryPath={dropDirectoryPath}
                        reorderDropTarget={reorderDropTarget}
                        onTreeNodeDragStart={onTreeNodeDragStart}
                        onTreeNodeDragEnd={onTreeNodeDragEnd}
                        onTreeNodeDragOver={onTreeNodeDragOver}
                        onTreeNodeDrop={onTreeNodeDrop}
                        onTailDragOver={onTailDragOver}
                        onTailDrop={onTailDrop}
                        onDirectoryDragOver={onDirectoryDragOver}
                        onDirectoryDragLeave={onDirectoryDragLeave}
                        onDirectoryDrop={onDirectoryDrop}
                      />
                    </div>
                  ) : null}
                </>
              )
            })()
          ) : (() => {
            const isHidden = node.meta.isExplicitlyHidden || node.meta.isHiddenByAncestor
            const canUnhideDirectly = node.meta.isExplicitlyHidden && showHiddenItems
            const shouldShowActionButton = !node.meta.isHiddenByAncestor || node.meta.isExplicitlyHidden
            const isFavorited = favoritePaths.includes(node.path)
            const favoriteIndicatorTestId = `favorite-indicator-${node.path.replaceAll('/', '-')}`
            const isNaming = nameActionState?.path === node.path
            const actionLabel = `重命名 ${node.name}`

            return (
              <div
                className="file-tree__row"
                data-tree-node-path={node.path}
                data-tree-node-kind={node.kind}
                data-tree-parent-path={parentPath ?? ''}
                data-hidden={isHidden ? 'true' : undefined}
                data-renaming={isNaming ? 'true' : undefined}
                data-reorder-target={
                  reorderDropTarget?.targetPath === node.path ? reorderDropTarget.position : undefined
                }
                draggable={reorderEnabled && !isNaming}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onOpenContextMenu({
                    kind: 'file',
                    path: node.path,
                    name: node.name,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }}
                onDragStart={(event) => onTreeNodeDragStart(node.path, node.kind, parentPath, event)}
                onDragEnd={onTreeNodeDragEnd}
                onDragEnter={(event) => onTreeNodeDragOver(node.path, node.kind, parentPath, event)}
                onDragOver={(event) => onTreeNodeDragOver(node.path, node.kind, parentPath, event)}
                onDrop={(event) => onTreeNodeDrop(node.path, node.kind, parentPath, event)}
              >
                {isNaming ? (
                  <div
                    className="file-tree__file file-tree__file--renaming"
                    aria-current={currentDocumentPath === node.path ? 'page' : undefined}
                  >
                    <span className="file-tree__file-icon" aria-hidden="true">
                      <FileText />
                    </span>
                    <input
                      ref={renameInputRef}
                      type="text"
                      className="file-tree__rename-input"
                      aria-label={actionLabel}
                      value={nameActionState.value}
                      onChange={(event) => onNameActionValueChange(event.target.value)}
                      onBlur={onNameActionBlur}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void onNameActionSubmit()
                          return
                        }

                        if (event.key === 'Escape') {
                          event.preventDefault()
                          onNameActionCancel()
                        }
                      }}
                    />
                    <div className="file-tree__rename-actions" aria-label="重命名操作">
                      <button
                        type="button"
                        className="file-tree__rename-action file-tree__rename-action--confirm"
                        aria-label={`保存 ${node.name} 的新名称`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => void onNameActionSubmit()}
                      >
                        <CheckCircle2 aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="file-tree__rename-action"
                        aria-label={`取消重命名 ${node.name}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onNameActionCancel}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={isRecentView ? 'file-tree__file file-tree__file--recent' : 'file-tree__file'}
                    data-favorited={isFavorited ? 'true' : undefined}
                    data-dragging={dragNodePath === node.path ? 'true' : undefined}
                    aria-current={currentDocumentPath === node.path ? 'page' : undefined}
                    onClick={() => onDocumentSelect(node.path)}
                  >
                    <span className="file-tree__file-icon" aria-hidden="true">
                      <FileText />
                    </span>
                    <span className="file-tree__file-copy">
                      <span className="file-tree__file-name">{formatFileTreeDisplayName(node.name, hideFileTitleDate)}</span>
                      {isRecentView ? (
                        <span className="file-tree__file-path" aria-hidden="true">
                          {node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '根目录'}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )}
                <div className="file-tree__actions">
                  <button
                    type="button"
                    className="file-tree__action file-tree__action--favorite"
                    data-favorited={isFavorited ? 'true' : undefined}
                    data-testid={favoriteIndicatorTestId}
                    aria-label={isFavorited ? `取消收藏 ${node.name}` : `收藏 ${node.name}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleFavoriteDocument(node.path)
                    }}
                  >
                    <Star fill={isFavorited ? 'currentColor' : 'none'} />
                  </button>
                  {showHiddenItems && node.meta.isHiddenByAncestor && !node.meta.isExplicitlyHidden ? (
                    <span className="file-tree__derived-hidden-indicator" aria-hidden="true" />
                  ) : null}
                  {shouldShowActionButton ? (
                    <button
                      type="button"
                      className="file-tree__action file-tree__action--visibility"
                      aria-label={canUnhideDirectly ? `显示 ${node.name}` : `隐藏 ${node.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (canUnhideDirectly) {
                          onUnhidePath(node.path)
                          return
                        }
                        onHidePath(node.path)
                      }}
                    >
                      {canUnhideDirectly ? <Eye /> : <EyeOff />}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })()}
        </li>
      ))}
    </ul>
  )
}

export function WorkspaceLayout({
  mode,
  regularViewState,
  fileTree,
  currentDocumentPath,
  currentDocumentContent,
  documentScrollTop = 0,
  documentScrollRestoreId = 0,
  editingDocumentContent,
  isDocumentLoading,
  isProjectSwitching = false,
  isWorkspaceInputBlocked = false,
  pendingProjectName = null,
  statusMessage,
  actionToast,
  sidebarWidth,
  outlineWidth,
  persistedExpandedDirectories = EMPTY_PATHS,
  hasPersistedExpandedDirectories = false,
  availableDirectoryPaths = EMPTY_PATHS,
  hasProjects,
  isWorkspaceBootstrapping = false,
  onDocumentSelect,
  onDocumentScrollTopChange,
  onCreateDocument = () => {},
  onCreateDirectory = () => {},
  onCopyDocumentLink = () => {},
  onRevealDocumentInFolder = () => {},
  onCopyDirectoryPath = () => {},
  onDuplicateDocument = async () => true,
  onRenameDocument = async () => true,
  onDeleteDocument = () => {},
  onMoveDocument = () => {},
  onReorderFileTreeNode = () => {},
  favoritePaths = [],
  showFavoritesOnly = false,
  showRecentOnly = false,
  isCurrentDocumentOutsideRecent = false,
  isCurrentDocumentHiddenInRecent = false,
  isCurrentDocumentUnavailableInRecent = false,
  showHiddenItems = false,
  hideFileTitleDate = false,
  onToggleFavoriteDocument = () => {},
  onToggleShowFavoritesOnly = () => {},
  onToggleShowRecentOnly = () => {},
  onLocateCurrentDocumentInTree,
  onHidePath = () => {},
  onUnhidePath = () => {},
  onExpandedDirectoriesChange,
  onEditingDocumentContentChange,
  onEditingCompositionStart,
  onEditingCompositionEnd,
  documentLinkPaths = EMPTY_PATHS,
  documentLinkContentRoots = ['.'],
  getDocumentLinkHref,
  onDocumentLinkNavigate,
  onCurrentDocumentAnchorNavigate,
  onInvalidDocumentLink,
  pendingHeadingId = null,
  onPendingHeadingHandled,
  onSidebarWidthChange,
  onSidebarWidthCommit,
  onOutlineWidthChange,
  onOutlineWidthCommit,
  graphOpen = false,
  graphIndex = null,
  graphLoading = false,
  graphError = null,
  onCloseGraph,
  onRefreshGraph,
  graphProjectId = null,
  onGraphEnterDocument,
}: WorkspaceLayoutProps) {
  const documentTitle = currentDocumentPath?.split('/').at(-1) ?? null
  const activeDocumentContent =
    mode === 'split' ? (editingDocumentContent ?? currentDocumentContent) : currentDocumentContent
  const documentHeadings = useMemo(() => activeDocumentContent ? extractMarkdownHeadings(activeDocumentContent) : [], [activeDocumentContent])
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(() => documentHeadings[0]?.id ?? null)
  const [headingContent, setHeadingContent] = useState(activeDocumentContent)
  if (headingContent !== activeDocumentContent) {
    setHeadingContent(activeDocumentContent)
    setActiveHeadingId(documentHeadings[0]?.id ?? null)
  }
  const documentRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const restoredScrollRequestRef = useRef(-1)
  const sessionScrollTopByDocumentRef = useRef(new Map<string, number>())
  const outlineRef = useRef<HTMLDivElement | null>(null)
  const outlinePerfItemRef = useRef<HTMLSpanElement | null>(null)
  const outlinePerfFrameRef = useRef<HTMLSpanElement | null>(null)
  const outlinePerfTotalRef = useRef<HTMLSpanElement | null>(null)
  const outlinePerfStatsRef = useRef<HTMLSpanElement | null>(null)
  const outlinePerfFrameHealthRef = useRef<HTMLSpanElement | null>(null)
  const outlinePerfLongTaskRef = useRef<HTMLSpanElement | null>(null)
  const outlineHoverLayerRef = useRef<HTMLDivElement | null>(null)
  const outlinePerfSnapshotRef = useRef<OutlinePerfSnapshot>({
    editorNodes: 0,
    headings: 0,
    inlineCode: 0,
    links: 0,
    tables: 0,
  })
  const headingTargetsRef = useRef<HeadingTarget[]>([])
  const activeHeadingIdRef = useRef<string | null>(null)
  const minSidebarWidth = 220
  const maxSidebarWidth = 520
  const minOutlineWidth = 220
  const maxOutlineWidth = 420

  const refreshOutlinePerfSnapshot = useEffectEvent(() => {
    if (!OUTLINE_PERF_ENABLED) {
      return
    }

    const snapshot = collectOutlinePerfSnapshot(documentRef.current)
    outlinePerfSnapshotRef.current = snapshot

    if (outlinePerfStatsRef.current) {
      outlinePerfStatsRef.current.textContent = `nodes: ${snapshot.editorNodes}, links: ${snapshot.links}, code: ${snapshot.inlineCode}`
    }
  })

  useEffect(() => {
    activeHeadingIdRef.current = activeHeadingId
  }, [activeHeadingId])

  useEffect(() => {
    if (!OUTLINE_PERF_ENABLED) {
      return
    }

    const outline = outlineRef.current

    if (!outline) {
      return
    }

    const recordOutlinePerfEvent = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.outline-nav__item') : null

      if (!target) {
        return
      }

      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) {
        return
      }

      const eventAt = performance.now()
      const item = target.textContent?.trim() ?? '(untitled)'

      window.requestAnimationFrame(() => {
        const frameAt = performance.now()
        const frameDelayMs = Math.round((frameAt - eventAt) * 10) / 10

        if (outlinePerfItemRef.current) {
          outlinePerfItemRef.current.textContent = `item: ${item}`
        }

        if (outlinePerfFrameRef.current) {
          outlinePerfFrameRef.current.textContent = `frame: ${frameDelayMs}ms`
        }

        if (outlinePerfTotalRef.current) {
          outlinePerfTotalRef.current.textContent = `total: ${frameDelayMs}ms`
        }
      })
    }

    outline.addEventListener('mouseover', recordOutlinePerfEvent)
    outline.addEventListener('click', recordOutlinePerfEvent)

    return () => {
      outline.removeEventListener('mouseover', recordOutlinePerfEvent)
      outline.removeEventListener('click', recordOutlinePerfEvent)
    }
  }, [])

  useEffect(() => {
    const outline = outlineRef.current

    if (!outline) {
      return
    }

    const hideHoverLayer = () => {
      const layer = outlineHoverLayerRef.current

      if (layer) {
        layer.style.opacity = '0'
      }
    }

    const moveHoverLayer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.outline-nav__item') : null
      const layer = outlineHoverLayerRef.current

      if (!target || !layer) {
        return
      }

      layer.style.height = `${target.offsetHeight}px`
      layer.style.transform = `translate3d(0, ${target.offsetTop}px, 0)`
      layer.style.opacity = '1'
    }

    outline.addEventListener('pointerover', moveHoverLayer, { passive: true })
    outline.addEventListener('pointerleave', hideHoverLayer, { passive: true })

    return () => {
      outline.removeEventListener('pointerover', moveHoverLayer)
      outline.removeEventListener('pointerleave', hideHoverLayer)
    }
  }, [])

  useEffect(() => {
    if (!OUTLINE_PERF_ENABLED) {
      return
    }

    let frameId = 0
    let previousFrameAt = performance.now()
    let latestFrameGapMs = 0
    let maxFrameGapMs = 0
    let recentFrameGaps: Array<{ at: number; gap: number }> = []
    let recentLongTasks: Array<{ at: number; duration: number }> = []
    let observer: PerformanceObserver | null = null
    let latestPanelRenderAt = 0

    const renderFrameHealth = (force = false) => {
      const now = performance.now()
      if (!force && now - latestPanelRenderAt < 250) {
        return
      }

      latestPanelRenderAt = now
      recentFrameGaps = recentFrameGaps.filter((entry) => now - entry.at <= 2000)
      recentLongTasks = recentLongTasks.filter((entry) => now - entry.at <= 2000)
      const recentMaxFrameGapMs = recentFrameGaps.reduce((max, entry) => Math.max(max, entry.gap), 0)
      const lastLongTaskMs = recentLongTasks.at(-1)?.duration ?? 0

      if (outlinePerfFrameHealthRef.current) {
        outlinePerfFrameHealthRef.current.textContent = `frame health: last ${latestFrameGapMs}ms, recent max ${recentMaxFrameGapMs}ms, all max ${maxFrameGapMs}ms`
      }

      if (outlinePerfLongTaskRef.current) {
        outlinePerfLongTaskRef.current.textContent = `long tasks 2s: ${recentLongTasks.length}, last ${lastLongTaskMs}ms`
      }
    }

    const tick = (frameAt: number) => {
      latestFrameGapMs = Math.round((frameAt - previousFrameAt) * 10) / 10
      maxFrameGapMs = Math.max(maxFrameGapMs, latestFrameGapMs)
      recentFrameGaps.push({ at: frameAt, gap: latestFrameGapMs })
      previousFrameAt = frameAt
      renderFrameHealth()
      frameId = window.requestAnimationFrame(tick)
    }

    if ('PerformanceObserver' in window) {
      try {
        observer = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          for (const entry of entries) {
            recentLongTasks.push({
              at: entry.startTime + entry.duration,
              duration: Math.round(entry.duration * 10) / 10,
            })
          }
          renderFrameHealth(true)
        })
        observer.observe({ entryTypes: ['longtask'] })
      } catch {
        observer = null
      }
    }

    frameId = window.requestAnimationFrame(tick)

    return () => {
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId)
      }
      observer?.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!activeDocumentContent) {
      headingTargetsRef.current = []
    }
    refreshOutlinePerfSnapshot()
  }, [activeDocumentContent])

  useEffect(() => {
    function updateHeadingTargets() {
      const nextTargets = collectHeadingTargets(documentRef.current, documentHeadings)
      headingTargetsRef.current = nextTargets
      return nextTargets
    }

    function syncActiveHeadingSnapshot(headingTargets: HeadingTarget[]) {
      activeHeadingIdRef.current =
        headingTargets.find((target) => target.id === activeHeadingIdRef.current)?.id ?? null

      if (headingTargets.length === 0) {
        setActiveHeadingId(documentHeadings[0]?.id ?? null)
        return
      }

      const canvasTop = canvasRef.current?.getBoundingClientRect().top ?? 0
      const anchorTop = canvasTop + 24
      setActiveHeadingId(findActiveHeadingId(headingTargets, anchorTop))
    }

    function applyHeadingIds() {
      const headingElements = Array.from(
        documentRef.current?.querySelectorAll<HTMLElement>(HEADING_SELECTOR) ?? [],
      )

      headingElements.forEach((element, index) => {
        const heading = documentHeadings[index]

        if (!heading) {
          element.removeAttribute('data-heading-id')
          return
        }

        element.dataset.headingId = heading.id
        element.id = heading.id
      })
    }

    function runHeadingSync() {
      applyHeadingIds()
      syncActiveHeadingSnapshot(updateHeadingTargets())
      refreshOutlinePerfSnapshot()
    }

    const root = documentRef.current

    if (!root) {
      return
    }

    let frameId = 0
    let hasScheduledSync = false

    const scheduleHeadingSync = () => {
      if (hasScheduledSync) {
        return
      }

      hasScheduledSync = true
      frameId = window.requestAnimationFrame(() => {
        frameId = 0
        hasScheduledSync = false
        runHeadingSync()
      })
    }

    runHeadingSync()

    if (mode === 'regular') {
      let attempts = 0

      const resyncEditHeadings = () => {
        frameId = 0
        hasScheduledSync = false
        attempts += 1
        runHeadingSync()

        const headingCount = headingTargetsRef.current.length

        if (headingCount === 0 && attempts < 12) {
          hasScheduledSync = true
          frameId = window.requestAnimationFrame(resyncEditHeadings)
        }
      }

      hasScheduledSync = true
      frameId = window.requestAnimationFrame(resyncEditHeadings)
    }

    if (mode === 'regular') {
      const handleStructureUpdated = () => {
        scheduleHeadingSync()
      }

      root.addEventListener(EDITOR_STRUCTURE_UPDATED_EVENT, handleStructureUpdated)

      return () => {
        if (frameId !== 0) {
          window.cancelAnimationFrame(frameId)
        }
        root.removeEventListener(EDITOR_STRUCTURE_UPDATED_EVENT, handleStructureUpdated)
      }
    }

    const observer = new MutationObserver((records) => {
      const activeHeadingElement =
        activeHeadingIdRef.current == null
          ? null
          : headingTargetsRef.current.find((target) => target.id === activeHeadingIdRef.current)?.element ??
            null

      if (!mutationRequiresHeadingResync(records, activeHeadingElement, documentRef.current, documentHeadings)) {
        return
      }

      scheduleHeadingSync()
    })

    observer.observe(root, {
      childList: true,
      subtree: true,
    })

    return () => {
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId)
      }
      observer.disconnect()
    }
  }, [documentHeadings, mode, activeDocumentContent])

  function getHeadingTargets(): HeadingTarget[] {
    const cachedTargets = headingTargetsRef.current

    if (cachedTargets.length > 0) {
      const headingElements = Array.from(
        documentRef.current?.querySelectorAll<HTMLElement>(HEADING_SELECTOR) ?? [],
      )

      const canReuseCachedTargets =
        cachedTargets.length === headingElements.length &&
        cachedTargets.every((target, index) => {
          const element = headingElements[index]
          return (
            target.element.isConnected &&
            element != null &&
            element === target.element &&
            target.id === (documentHeadings[index]?.id ?? element.dataset.headingId ?? element.id)
          )
        })

      if (canReuseCachedTargets) {
        return cachedTargets
      }
    }

    const nextTargets = collectHeadingTargets(documentRef.current, documentHeadings)
    headingTargetsRef.current = nextTargets
    return nextTargets
  }

  const syncActiveHeading = useEffectEvent(() => {
    const headingTargets = getHeadingTargets()

    if (headingTargets.length === 0) {
      setActiveHeadingId(null)
      return
    }

    const canvasTop = canvasRef.current?.getBoundingClientRect().top ?? 0
    const anchorTop = canvasTop + 24
    setActiveHeadingId(findActiveHeadingId(headingTargets, anchorTop))
  })

  const reportDocumentScrollTopChange = useEffectEvent((documentPath: string, scrollTop: number) => {
    onDocumentScrollTopChange?.(documentPath, scrollTop)
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scrollCanvas: HTMLDivElement = canvas
    let frameId = 0

    function handleScroll() {
      if (isDocumentLoading) return
      if (frameId !== 0) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0
        syncActiveHeading()
        if (currentDocumentPath) {
          sessionScrollTopByDocumentRef.current.set(currentDocumentPath, scrollCanvas.scrollTop)
          reportDocumentScrollTopChange(currentDocumentPath, scrollCanvas.scrollTop)
        }
      })
    }

    canvas.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)

    return () => {
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId)
      }
      canvas.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [
    currentDocumentPath,
    documentHeadings,
    isDocumentLoading,
  ])

  useEffect(() => {
    if (
      !currentDocumentPath ||
      isDocumentLoading ||
      restoredScrollRequestRef.current === documentScrollRestoreId
    ) return
    if (pendingHeadingId) {
      restoredScrollRequestRef.current = documentScrollRestoreId
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const savedTop = sessionScrollTopByDocumentRef.current.get(currentDocumentPath) ?? documentScrollTop
    let frameId = 0
    let attempts = 0
    const restoreWhenReady = () => {
      if (restoredScrollRequestRef.current === documentScrollRestoreId) return
      if (savedTop <= 0) {
        restoredScrollRequestRef.current = documentScrollRestoreId
        return
      }
      const maxTop = Math.max(0, canvas.scrollHeight - canvas.clientHeight)
      attempts += 1
      if (savedTop > maxTop && attempts < 30) {
        frameId = window.requestAnimationFrame(restoreWhenReady)
        return
      }
      const nextTop = Math.max(0, Math.min(savedTop, maxTop))
      if (typeof canvas.scrollTo === 'function') {
        canvas.scrollTo({ top: nextTop, behavior: 'auto' })
      } else {
        canvas.scrollTop = nextTop
      }
      restoredScrollRequestRef.current = documentScrollRestoreId
    }
    frameId = window.requestAnimationFrame(restoreWhenReady)
    return () => window.cancelAnimationFrame(frameId)
  }, [
    currentDocumentContent,
    currentDocumentPath,
    documentScrollRestoreId,
    documentScrollTop,
    isDocumentLoading,
    pendingHeadingId,
  ])

  useEffect(() => {
    if (!activeHeadingId) {
      return
    }

    outlineRef.current
      ?.querySelector<HTMLElement>(`[data-outline-id="${activeHeadingId}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [activeHeadingId])

  function handleHeadingSelect(headingId: string) {
    setActiveHeadingId(headingId)
    const target = getHeadingTargets().find((headingTarget) => headingTarget.id === headingId)

    if (!target) {
      return
    }

    const canvas = canvasRef.current
    if (!canvas) {
      target.element.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      return
    }

    const anchorTop = canvas.getBoundingClientRect().top + 24
    const targetTop = target.element.getBoundingClientRect().top
    const nextScrollTop = Math.max(0, canvas.scrollTop + targetTop - anchorTop)

    canvas.scrollTo?.({
      top: nextScrollTop,
      behavior: 'auto',
    })
  }

  const resolvePendingHeading = useEffectEvent((headingId: string, root: HTMLElement) => {
    const target = getHeadingTargets().find((entry) => entry.id === headingId)
    if (target) {
      handleHeadingSelect(headingId)
      onPendingHeadingHandled?.(true)
      return true
    }
    if (root.querySelector('[aria-label="只读 Markdown 渲染器"]')) {
      onPendingHeadingHandled?.(false)
      return true
    }
    return false
  })

  useEffect(() => {
    if (!pendingHeadingId) return
    const root = documentRef.current
    if (!root) return
    let isHandled = false
    const locateHeading = () => {
      if (isHandled) return
      isHandled = resolvePendingHeading(pendingHeadingId, root)
    }
    const observer = new MutationObserver(locateHeading)
    observer.observe(root, { childList: true, subtree: true })
    const frameId = window.requestAnimationFrame(() => {
      locateHeading()
    })
    return () => {
      window.cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [activeDocumentContent, documentHeadings, pendingHeadingId])

  function clampSidebarWidth(nextWidth: number) {
    return Math.max(minSidebarWidth, Math.min(maxSidebarWidth, Math.round(nextWidth)))
  }

  function clampOutlineWidth(nextWidth: number) {
    return Math.max(minOutlineWidth, Math.min(maxOutlineWidth, Math.round(nextWidth)))
  }

  function beginSidebarResize(startEvent: React.PointerEvent<HTMLDivElement>) {
    startEvent.preventDefault()

    const startX = startEvent.clientX
    const startWidth = sidebarWidth
    let latestWidth = startWidth

    document.body.classList.add('is-resizing-workspace-pane')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX)
      onSidebarWidthChange(latestWidth)
    }

    const finishResize = () => {
      document.body.classList.remove('is-resizing-workspace-pane')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      void onSidebarWidthCommit(latestWidth)
    }

    const handlePointerUp = () => {
      finishResize()
    }

    const handlePointerCancel = () => {
      finishResize()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
  }

  function beginOutlineResize(startEvent: React.PointerEvent<HTMLDivElement>) {
    startEvent.preventDefault()

    const startX = startEvent.clientX
    const startWidth = outlineWidth
    let latestWidth = startWidth

    document.body.classList.add('is-resizing-workspace-pane')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = clampOutlineWidth(startWidth - (moveEvent.clientX - startX))
      onOutlineWidthChange(latestWidth)
    }

    const finishResize = () => {
      document.body.classList.remove('is-resizing-workspace-pane')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      void onOutlineWidthCommit(latestWidth)
    }

    const handlePointerUp = () => {
      finishResize()
    }

    const handlePointerCancel = () => {
      finishResize()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
  }

  function renderDocumentPreview(content: string) {
    return (
      <article
        ref={(node) => {
          documentRef.current = node
        }}
        className="markdown-document markdown-document--milkdown-probe"
      >
        <ReadonlyMarkdownRenderer
          value={content}
          currentDocumentPath={currentDocumentPath}
          documentPaths={documentLinkPaths}
          contentRoots={documentLinkContentRoots}
          getDocumentLinkHref={getDocumentLinkHref}
          onDocumentLinkNavigate={onDocumentLinkNavigate}
          onCurrentDocumentAnchorNavigate={onCurrentDocumentAnchorNavigate}
          onInvalidDocumentLink={onInvalidDocumentLink}
        />
      </article>
    )
  }

  function renderDocumentWorkspace() {
    if (isDocumentLoading) {
      return <div className="workspace__status">正在读取 Markdown 内容…</div>
    }

    if (!activeDocumentContent && mode !== 'split' && !(mode === 'regular' && regularViewState === 'editable')) {
      return <div className="workspace__status">当前文档还没有可用内容</div>
    }

    if (mode === 'regular') {
      if (regularViewState !== 'editable') {
        return (
          <div className="workspace__document-workarea">
            {renderDocumentPreview(activeDocumentContent ?? '')}
          </div>
        )
      }

      return (
        <div className="workspace__document-workarea">
          <div
            ref={(node) => {
              documentRef.current = node
            }}
            className="workspace__editor-pane"
          >
            <VisualMarkdownEditor
              value={editingDocumentContent ?? currentDocumentContent ?? ''}
              readonly={isWorkspaceInputBlocked}
              onChange={(content) => onEditingDocumentContentChange?.(content)}
              onCompositionStart={onEditingCompositionStart}
              onCompositionEnd={onEditingCompositionEnd}
            />
          </div>
        </div>
      )
    }

    if (mode === 'split') {
      return (
        <div className="workspace__document-workarea">
          <div className="workspace__split">
            <div className="workspace__split-pane workspace__editor-pane">
              <textarea
                className="markdown-editor markdown-editor--split"
                readOnly={isWorkspaceInputBlocked}
                aria-label="Markdown 编辑器"
                value={editingDocumentContent ?? currentDocumentContent ?? ''}
                onChange={(event) => onEditingDocumentContentChange?.(event.target.value)}
              />
            </div>
            <div className="workspace__split-pane workspace__split-preview">
              {activeDocumentContent ? (
                renderDocumentPreview(activeDocumentContent)
              ) : (
                <div className="workspace__status">当前文档还没有可用内容</div>
              )}
            </div>
          </div>
        </div>
      )
    }

    return <div className="workspace__status">当前文档还没有可用内容</div>
  }

  function renderActionToast() {
    if (!actionToast) {
      return null
    }

    const title =
      actionToast.tone === 'error' ? '操作失败' : actionToast.tone === 'info' ? '操作提示' : '操作完成'
    const icon =
      actionToast.tone === 'error' ? (
        <AlertCircle />
      ) : (
        <CheckCircle2 />
      )

    return (
      <div className="workspace__toast-viewport" aria-live="polite" aria-atomic="true">
        <div className="workspace__toast" data-tone={actionToast.tone} role="status">
          <span className="workspace__toast-icon" aria-hidden="true">
            {icon}
          </span>
          <div className="workspace__toast-copy">
            <strong>{title}</strong>
            <span>{actionToast.message}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <main
      className="workspace"
      style={
        {
          '--workspace-sidebar-width': `${sidebarWidth}px`,
          '--workspace-outline-width': `${outlineWidth}px`,
        } as CSSProperties
      }
    >
      <WorkspaceSidebarPane
        fileTree={fileTree}
        availableDirectoryPaths={availableDirectoryPaths}
        currentDocumentPath={currentDocumentPath}
        persistedExpandedDirectories={persistedExpandedDirectories}
        hasPersistedExpandedDirectories={hasPersistedExpandedDirectories}
        hasProjects={hasProjects}
        isWorkspaceBootstrapping={isWorkspaceBootstrapping}
        isProjectSwitching={isProjectSwitching}
        favoritePaths={favoritePaths}
        showFavoritesOnly={showFavoritesOnly}
        showRecentOnly={showRecentOnly}
        isCurrentDocumentOutsideRecent={isCurrentDocumentOutsideRecent}
        isCurrentDocumentHiddenInRecent={isCurrentDocumentHiddenInRecent}
        isCurrentDocumentUnavailableInRecent={isCurrentDocumentUnavailableInRecent}
        showHiddenItems={showHiddenItems}
        hideFileTitleDate={hideFileTitleDate}
        onDocumentSelect={onDocumentSelect}
        onCreateDocument={onCreateDocument}
        onCreateDirectory={onCreateDirectory}
        onCopyDocumentLink={onCopyDocumentLink}
        onRevealDocumentInFolder={onRevealDocumentInFolder}
        onCopyDirectoryPath={onCopyDirectoryPath}
        onDuplicateDocument={onDuplicateDocument}
        onRenameDocument={onRenameDocument}
        onDeleteDocument={onDeleteDocument}
        onMoveDocument={onMoveDocument}
        onReorderFileTreeNode={onReorderFileTreeNode}
        onToggleFavoriteDocument={onToggleFavoriteDocument}
        onToggleShowFavoritesOnly={onToggleShowFavoritesOnly}
        onToggleShowRecentOnly={onToggleShowRecentOnly}
        onLocateCurrentDocumentInTree={onLocateCurrentDocumentInTree}
        onHidePath={onHidePath}
        onUnhidePath={onUnhidePath}
        onExpandedDirectoriesChange={onExpandedDirectoriesChange}
      />

      <div
        role="separator"
        aria-label="调整左侧文件列表宽度"
        aria-controls="workspace-file-tree"
        aria-orientation="vertical"
        aria-valuemin={minSidebarWidth}
        aria-valuemax={maxSidebarWidth}
        aria-valuenow={sidebarWidth}
        className="workspace__resize-handle"
        onPointerDown={beginSidebarResize}
      />

      <section className="workspace__center" inert={isWorkspaceInputBlocked || undefined} aria-hidden={isProjectSwitching || undefined}>
        <div className="panel panel--canvas">
          <div ref={canvasRef} className="panel__content panel__content--canvas">
            {graphOpen ? (
              <GraphView
                index={graphIndex}
                loading={graphLoading}
                error={graphError}
                currentDocumentPath={currentDocumentPath}
                projectId={graphProjectId}
                onCloseGraph={() => onCloseGraph?.()}
                onRefreshGraph={() => onRefreshGraph?.()}
                onEnterDocument={(path) => onGraphEnterDocument?.(path)}
              />
            ) : currentDocumentPath ? (
              <div className="workspace__document">
                <div className="workspace__document-meta">
                  <strong>{documentTitle}</strong>
                  <span>{currentDocumentPath}</span>
                </div>
                {renderDocumentWorkspace()}
              </div>
            ) : (
              <div className="workspace__empty-state">
                <h1>本地服务 Markdown 工作区</h1>
                <p>
                  当前阶段先打通项目接入、文件树、常规视图、分栏、标题导航、搜索和状态恢复。
                </p>
                {statusMessage ? <div className="workspace__status">{statusMessage}</div> : null}
              </div>
            )}
          </div>
        </div>
      </section>

      <div
        role="separator"
        aria-label="调整右侧标题导航宽度"
        aria-controls="workspace-outline"
        aria-orientation="vertical"
        aria-valuemin={minOutlineWidth}
        aria-valuemax={maxOutlineWidth}
        aria-valuenow={outlineWidth}
        className="workspace__resize-handle workspace__resize-handle--outline"
        onPointerDown={beginOutlineResize}
      />

      <aside className="workspace__sidebar workspace__sidebar--right" aria-hidden={isProjectSwitching || undefined}>
        <div id="workspace-outline" ref={outlineRef} className="panel panel--outline">
          <div className="panel__content panel__content--outline">
            {!currentDocumentPath ? (
              <p className="panel__empty">
                {isWorkspaceBootstrapping ? '正在恢复标题导航…' : '打开 Markdown 文档后，这里会基于标题节点生成快捷导航。'}
              </p>
            ) : isDocumentLoading ? (
              <p className="panel__empty">正在生成标题导航…</p>
            ) : documentHeadings.length > 0 ? (
              <nav className="outline-nav" aria-label="文档标题导航">
                <div ref={outlineHoverLayerRef} className="outline-nav__hover-layer" aria-hidden="true" />
                {documentHeadings.map((heading) => (
                  <button
                    key={heading.id}
                    type="button"
                    className="outline-nav__item"
                    aria-current={activeHeadingId === heading.id ? 'location' : undefined}
                    data-outline-id={heading.id}
                    style={{ '--outline-level': heading.depth } as CSSProperties}
                    onClick={() => handleHeadingSelect(heading.id)}
                  >
                    {heading.text}
                  </button>
                ))}
              </nav>
            ) : (
              <p className="panel__empty">当前文档没有可用标题节点。</p>
            )}
          </div>
        </div>
      </aside>
      {OUTLINE_PERF_ENABLED ? (
        <div className="outline-perf-panel" role="status" aria-live="polite">
          <strong>outline perf</strong>
          <span ref={outlinePerfItemRef}>item: waiting for outline event</span>
          <span ref={outlinePerfFrameRef}>frame: waiting</span>
          <span ref={outlinePerfTotalRef}>total: waiting</span>
          <span ref={outlinePerfStatsRef}>nodes: 0, links: 0, code: 0</span>
          <span ref={outlinePerfFrameHealthRef}>frame health: waiting</span>
          <span ref={outlinePerfLongTaskRef}>long tasks: waiting</span>
        </div>
      ) : null}
      {isProjectSwitching ? (
        <div className="workspace__project-switching" role="status" aria-live="polite">
          <strong>正在切换到 {pendingProjectName ?? '目标项目'}…</strong>
          <span>正在准备文件树和文档状态</span>
        </div>
      ) : null}
      {renderActionToast()}
    </main>
  )
}
