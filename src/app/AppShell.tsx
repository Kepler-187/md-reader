import type { CSSProperties } from 'react'

import { TopBar, type RegularViewState, type WorkspaceMode } from './TopBar'
import { WorkspaceLayout, type WorkspaceActionToast } from './WorkspaceLayout'
import type { VisibleFileTreeNode } from '../workspace/file-tree-types'
import type { ProjectRegistryRecord } from '../workspace/registry'
import type { TabSaveState } from '../workspace/workspace-session'
import type { DocumentLineHeight, PageWidthMode } from '../workspace/profile-store'
import type { DocumentLinkInvalidReason } from '../markdown/document-link'

interface AppShellTab {
  id: string
  documentPath: string
  title: string
  saveState: TabSaveState
  saveErrorMessage: string | null
  isPinned?: boolean
}

interface AppShellProps {
  projects: ProjectRegistryRecord[]
  activeProjectId: string | null
  pendingProjectId?: string | null
  profileIds: string[]
  activeProfileId: string
  tabs: AppShellTab[]
  activeTabId: string | null
  canManageService?: boolean
  isServiceActionPending?: boolean
  isWorkspaceBootstrapping?: boolean
  mode: WorkspaceMode
  regularViewState: RegularViewState
  fileTree: VisibleFileTreeNode[]
  availableDirectoryPaths: string[]
  currentDocumentPath: string | null
  currentDocumentContent: string | null
  documentScrollTop?: number
  documentScrollRestoreId?: number
  editingDocumentContent?: string | null
  saveIndicator?: string | null
  isDocumentLoading?: boolean
  isFileTreeRefreshing?: boolean
  isProjectSwitching?: boolean
  isWorkspaceInputBlocked?: boolean
  pendingProjectName?: string | null
  statusMessage: string | null
  actionToast?: WorkspaceActionToast | null
  sidebarWidth: number
  outlineWidth: number
  expandedFileNodes?: string[]
  hasPersistedExpandedFileNodes?: boolean
  documentFontSize?: number
  maxUnpinnedTabs?: number
  onMaxUnpinnedTabsChange?: (value: number) => void
  documentPageWidth?: PageWidthMode
  documentLineHeight?: DocumentLineHeight
  hideFileTitleDate?: boolean
  onConnectProject: () => void
  onManageProjects?: () => void
  onProjectChange: (projectId: string) => void
  onProfileChange: (profileId: string) => void
  onModeChange: (mode: WorkspaceMode) => void
  onToggleRegularLock: () => void
  favoritePaths?: string[]
  showFavoritesOnly?: boolean
  showRecentOnly?: boolean
  isCurrentDocumentOutsideRecent?: boolean
  isCurrentDocumentHiddenInRecent?: boolean
  isCurrentDocumentUnavailableInRecent?: boolean
  showHiddenItems?: boolean
  onToggleFavoriteDocument?: (path: string) => void
  onToggleShowFavoritesOnly?: () => void
  onToggleShowRecentOnly?: () => void
  onLocateCurrentDocumentInTree?: () => void | Promise<void>
  onToggleShowHiddenItems?: () => void
  onHidePath?: (path: string) => void
  onUnhidePath?: (path: string) => void
  onTabSelect: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onTabPin?: (tabId: string) => void
  onTabReorder: (nextOrderedTabIds: string[]) => void
  onRestartService?: () => void
  onReconnectService?: () => void
  onStopService?: () => void
  graphOpen?: boolean
  graphIndex?: import('../workspace/local-bridge-access').LinkIndexPayload | null
  graphLoading?: boolean
  graphError?: string | null
  onToggleGraph?: () => void
  onCloseGraph?: () => void
  onRefreshGraph?: () => void
  graphProjectId?: string | null
  onGraphEnterDocument?: (path: string) => void
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
  onReorderFileTreeNode?: (payload: {
    sourcePath: string
    sourceParentPath: string | null
    targetPath: string | null
    targetParentPath: string | null
    position: 'before' | 'after' | 'tail'
  }) => void | Promise<void>
  onExpandedFileNodesChange?: (paths: string[]) => void | Promise<void>
  onDocumentFontSizeChange?: (fontSize: number) => void
  onDocumentPageWidthChange?: (pageWidth: PageWidthMode) => void
  onDocumentLineHeightChange?: (lineHeight: DocumentLineHeight) => void
  onHideFileTitleDateChange?: (hideFileTitleDate: boolean) => void
  onRefreshDocument?: () => void | Promise<void>
  onRefreshFileTree?: () => void | Promise<void>
  onEditingDocumentContentChange?: (content: string) => void
  onEditingCompositionStart?: () => void
  onEditingCompositionEnd?: () => void
  documentLinkPaths?: Iterable<string>
  documentLinkContentRoots?: Iterable<string>
  getDocumentLinkHref?: (documentPath: string, headingId: string | null) => string
  getAssetHref?: (assetPath: string) => string
  onDocumentLinkNavigate?: (documentPath: string, headingId: string | null) => void | Promise<void>
  onCurrentDocumentAnchorNavigate?: (headingId: string) => void
  onInvalidDocumentLink?: (href: string, reason: DocumentLinkInvalidReason) => void
  pendingHeadingId?: string | null
  onPendingHeadingHandled?: (found: boolean) => void
  onSidebarWidthChange: (width: number) => void
  onSidebarWidthCommit: (width: number) => void | Promise<void>
  onOutlineWidthChange: (width: number) => void
  onOutlineWidthCommit: (width: number) => void | Promise<void>
}

export function AppShell(props: AppShellProps) {
  const documentFontSize = props.documentFontSize ?? 16
  const documentPageWidth = props.documentPageWidth ?? 'narrow'
  const documentLineHeight = props.documentLineHeight ?? 1.6
  const documentMaxWidth =
    documentPageWidth === 'full' ? 'none' : documentPageWidth === 'wide' ? '960px' : '720px'

  return (
    <div
      className="app-shell"
      style={
        {
          '--doc-body-font-size': `${documentFontSize}px`,
          '--doc-max-width': documentMaxWidth,
          '--doc-body-line-height': String(documentLineHeight),
        } as CSSProperties
      }
    >
      <TopBar
        projects={props.projects}
        activeProjectId={props.activeProjectId}
        pendingProjectId={props.pendingProjectId}
        profileIds={props.profileIds}
        activeProfileId={props.activeProfileId}
        tabs={props.pendingProjectId ? [] : props.tabs}
        activeTabId={props.pendingProjectId ? null : props.activeTabId}
        canManageService={props.canManageService}
        isServiceActionPending={props.isServiceActionPending}
        mode={props.mode}
        regularViewState={props.regularViewState}
        statusMessage={props.statusMessage}
        saveIndicator={props.saveIndicator}
        currentDocumentPath={props.currentDocumentPath}
        isDocumentLoading={props.isDocumentLoading}
        isFileTreeRefreshing={props.isFileTreeRefreshing}
        onConnectProject={props.onConnectProject}
        onManageProjects={props.onManageProjects}
        onProjectChange={props.onProjectChange}
        onProfileChange={props.onProfileChange}
        onModeChange={props.onModeChange}
        graphOpen={props.graphOpen}
        onToggleGraph={props.onToggleGraph}
        onToggleRegularLock={props.onToggleRegularLock}
        showHiddenItems={props.showHiddenItems}
        onToggleShowHiddenItems={props.onToggleShowHiddenItems}
        onTabSelect={props.onTabSelect}
        onTabClose={props.onTabClose}
        onTabPin={props.onTabPin}
        onTabReorder={props.onTabReorder}
        onRestartService={props.onRestartService}
        onReconnectService={props.onReconnectService}
        onStopService={props.onStopService}
        documentFontSize={documentFontSize}
        maxUnpinnedTabs={props.maxUnpinnedTabs}
        onMaxUnpinnedTabsChange={props.onMaxUnpinnedTabsChange}
        documentPageWidth={documentPageWidth}
        documentLineHeight={documentLineHeight}
        hideFileTitleDate={props.hideFileTitleDate}
        onDocumentFontSizeChange={props.onDocumentFontSizeChange}
        onDocumentPageWidthChange={props.onDocumentPageWidthChange}
        onDocumentLineHeightChange={props.onDocumentLineHeightChange}
        onHideFileTitleDateChange={props.onHideFileTitleDateChange}
        onRefreshDocument={props.onRefreshDocument}
        onRefreshFileTree={props.onRefreshFileTree}
      />
      <WorkspaceLayout
        mode={props.mode}
        regularViewState={props.regularViewState}
        fileTree={props.fileTree}
        availableDirectoryPaths={props.availableDirectoryPaths}
        currentDocumentPath={props.currentDocumentPath}
        currentDocumentContent={props.currentDocumentContent}
        documentScrollTop={props.documentScrollTop}
        documentScrollRestoreId={props.documentScrollRestoreId}
        editingDocumentContent={props.editingDocumentContent}
        isDocumentLoading={props.isDocumentLoading}
        isProjectSwitching={props.isProjectSwitching}
        isWorkspaceInputBlocked={props.isWorkspaceInputBlocked}
        pendingProjectName={props.pendingProjectName}
        statusMessage={props.statusMessage}
        actionToast={props.actionToast}
        sidebarWidth={props.sidebarWidth}
        outlineWidth={props.outlineWidth}
        persistedExpandedDirectories={props.expandedFileNodes}
        hasPersistedExpandedDirectories={props.hasPersistedExpandedFileNodes}
        hideFileTitleDate={props.hideFileTitleDate}
        hasProjects={props.projects.length > 0}
        isWorkspaceBootstrapping={props.isWorkspaceBootstrapping}
        graphOpen={props.graphOpen}
        graphIndex={props.graphIndex}
        graphLoading={props.graphLoading}
        graphError={props.graphError}
        onCloseGraph={props.onCloseGraph}
        onRefreshGraph={props.onRefreshGraph}
        graphProjectId={props.graphProjectId}
        onGraphEnterDocument={props.onGraphEnterDocument}
        onDocumentSelect={props.onDocumentSelect}
        onDocumentScrollTopChange={props.onDocumentScrollTopChange}
        onCreateDocument={props.onCreateDocument}
        onCreateDirectory={props.onCreateDirectory}
        onCopyDocumentLink={props.onCopyDocumentLink}
        onRevealDocumentInFolder={props.onRevealDocumentInFolder}
        onCopyDirectoryPath={props.onCopyDirectoryPath}
        onDuplicateDocument={props.onDuplicateDocument}
        onRenameDocument={props.onRenameDocument}
        onDeleteDocument={props.onDeleteDocument}
        onMoveDocument={props.onMoveDocument}
        onReorderFileTreeNode={props.onReorderFileTreeNode}
        favoritePaths={props.favoritePaths}
        showFavoritesOnly={props.showFavoritesOnly}
        showRecentOnly={props.showRecentOnly}
        isCurrentDocumentOutsideRecent={props.isCurrentDocumentOutsideRecent}
        isCurrentDocumentHiddenInRecent={props.isCurrentDocumentHiddenInRecent}
        isCurrentDocumentUnavailableInRecent={props.isCurrentDocumentUnavailableInRecent}
        showHiddenItems={props.showHiddenItems}
        onToggleFavoriteDocument={props.onToggleFavoriteDocument}
        onToggleShowFavoritesOnly={props.onToggleShowFavoritesOnly}
        onToggleShowRecentOnly={props.onToggleShowRecentOnly}
        onLocateCurrentDocumentInTree={props.onLocateCurrentDocumentInTree}
        onHidePath={props.onHidePath}
        onUnhidePath={props.onUnhidePath}
        onExpandedDirectoriesChange={props.onExpandedFileNodesChange}
        onEditingDocumentContentChange={props.onEditingDocumentContentChange}
        onEditingCompositionStart={props.onEditingCompositionStart}
        onEditingCompositionEnd={props.onEditingCompositionEnd}
        documentLinkPaths={props.documentLinkPaths}
        documentLinkContentRoots={props.documentLinkContentRoots}
        getDocumentLinkHref={props.getDocumentLinkHref}
        getAssetHref={props.getAssetHref}
        onDocumentLinkNavigate={props.onDocumentLinkNavigate}
        onCurrentDocumentAnchorNavigate={props.onCurrentDocumentAnchorNavigate}
        onInvalidDocumentLink={props.onInvalidDocumentLink}
        pendingHeadingId={props.pendingHeadingId}
        onPendingHeadingHandled={props.onPendingHeadingHandled}
        onSidebarWidthChange={props.onSidebarWidthChange}
        onSidebarWidthCommit={props.onSidebarWidthCommit}
        onOutlineWidthChange={props.onOutlineWidthChange}
        onOutlineWidthCommit={props.onOutlineWidthCommit}
      />
    </div>
  )
}
