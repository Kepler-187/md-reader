vi.mock('../../src/editor/visual-markdown-editor-loader', () => ({ preloadVisualMarkdownEditor: vi.fn() }))
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const localState = {
  openDocumentPaths: ['docs/private.md'],
  activeDocumentPath: 'docs/private.md',
  activeMode: 'regular' as const,
  regularViewState: 'locked' as const,
  tabStateByDocument: {
    'docs/private.md': { lastKnownScrollTop: 0 },
  },
  readingProgressByDocument: {
    'docs/private.md': 0,
  },
}

const bridgeMocks = vi.hoisted(() => ({
  getProfileFromBridge: vi.fn(),
  listProjectProfilesFromBridge: vi.fn(),
  saveProfileToBridge: vi.fn(),
}))

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}))

vi.mock('../../src/shared/key-value-store', () => ({
  createBrowserKeyValueStore: () => ({
    getItem: storageMocks.getItem,
    setItem: storageMocks.setItem,
  }),
}))

vi.mock('../../src/workspace/profile-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/workspace/profile-store')>(),
  createProfileStore: () => ({
    getProfile: vi.fn(async () => null),
    saveProfile: vi.fn(async () => undefined),
  }),
}))

vi.mock('../../src/workspace/local-state', () => ({
  createLocalStateStore: () => ({
    getState: vi.fn(async () => localState),
    saveState: vi.fn(async () => undefined),
    updateState: async (_projectId: string, _profileId: string, update: (state: typeof localState) => typeof localState) => { update(localState) },
  }),
}))

vi.mock('../../src/workspace/local-bridge-access', () => ({
  getLinkIndexFromBridge: vi.fn().mockResolvedValue({ nodes: [], edges: [], backlinks: {}, broken: [], titles: {}, scannedAt: '', documentCount: 0 }),
  BridgeDocumentConflictError: class BridgeDocumentConflictError extends Error {},
  BridgeDocumentSavedCacheInvalidationError: class BridgeDocumentSavedCacheInvalidationError extends Error {},
  getLocalBridgeHealth: vi.fn(async () => ({
    ok: true,
    mode: 'local-service',
    projectsLoaded: 1,
    port: 8797,
  })),
  listProjectsFromBridge: vi.fn(async () => ({
    activeProjectId: 'notes',
    projects: [
      {
        id: 'notes',
        name: 'Notes',
        rootHandleKey: 'handle:notes',
        contentRoots: ['docs'],
        permissionState: 'granted',
      },
    ],
  })),
  listProjectProfilesFromBridge: bridgeMocks.listProjectProfilesFromBridge,
  getProfileFromBridge: bridgeMocks.getProfileFromBridge,
  saveProfileToBridge: bridgeMocks.saveProfileToBridge,
  getFileTreePathsFromBridge: vi.fn(async () => ['docs/guide.md', 'docs/private.md']),
  getProjectTreeSnapshotFromBridge: vi.fn(async () => ({ entries: [
    { path: 'docs/guide.md', createdAtMs: 1, modifiedAtMs: 1, recentAtMs: 1 },
    { path: 'docs/private.md', createdAtMs: 1, modifiedAtMs: 1, recentAtMs: 1 },
  ] })),
  refreshFileTreeFromBridge: vi.fn(async () => ['docs/guide.md', 'docs/private.md']),
  refreshProjectTreeSnapshotFromBridge: vi.fn(async () => ({ entries: [] })),
  getDocumentContentFromBridge: vi.fn(async (_projectId, _profileId, documentPath: string) => ({
    path: documentPath,
    content: '# Private\n\nBody',
    mtimeMs: 100,
    size: 10,
  })),
  saveDocumentContentToBridge: vi.fn(),
  registerProjectWithBridge: vi.fn(),
  setActiveProjectWithBridge: vi.fn(),
  restartLocalBridgeService: vi.fn(),
  stopLocalBridgeService: vi.fn(),
}))

vi.mock('../../src/editor/visual-markdown-editor', () => ({
  preloadVisualMarkdownEditor: vi.fn(),
  VisualMarkdownEditor: ({ value }: { value: string }) => (
    <textarea aria-label="可视 Markdown 编辑器" value={value} readOnly />
  ),
}))

vi.mock('../../src/app/AppShell', () => ({
  AppShell: (props: {
    activeProfileId: string
    currentDocumentPath: string | null
    fileTree: Array<{
      path: string
      kind: 'directory' | 'file'
      children?: Array<unknown>
    }>
    favoritePaths?: string[]
    showFavoritesOnly?: boolean
    showHiddenItems?: boolean
    onToggleShowFavoritesOnly?: () => void
    onToggleFavoriteDocument?: (path: string) => void
    onToggleShowHiddenItems?: () => void
    onProfileChange: (profileId: string) => void
  }) => {
    function flattenPaths(
      nodes: Array<{ path: string; kind: 'directory' | 'file'; children?: Array<unknown> }>,
    ): string[] {
      return nodes.flatMap((node) => [
        node.path,
        ...(node.kind === 'directory'
          ? flattenPaths((node.children ?? []) as Array<{
              path: string
              kind: 'directory' | 'file'
              children?: Array<unknown>
            }>)
          : []),
      ])
    }

    return (
      <div>
        <div data-testid="active-profile">{props.activeProfileId}</div>
        <div data-testid="current-document">{props.currentDocumentPath ?? ''}</div>
        <div data-testid="show-hidden-items">{props.showHiddenItems ? 'true' : 'false'}</div>
        <div data-testid="show-favorites-only">{props.showFavoritesOnly ? 'true' : 'false'}</div>
        <div data-testid="favorite-paths">{(props.favoritePaths ?? []).join(',')}</div>
        <div data-testid="visible-tree">{flattenPaths(props.fileTree).join(',')}</div>
        <button type="button" onClick={() => props.onToggleShowHiddenItems?.()}>
          toggle-hidden-items
        </button>
        <button type="button" onClick={() => props.onToggleShowFavoritesOnly?.()}>
          toggle-favorites-only
        </button>
        <button type="button" onClick={() => props.onToggleFavoriteDocument?.('docs/private.md')}>
          toggle-favorite-private
        </button>
        <button type="button" onClick={() => props.onProfileChange('writer')}>
          switch-profile
        </button>
      </div>
    )
  },
}))

import App from '../../src/App'

describe('App hidden items state', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost:3000/')
    storageMocks.getItem.mockReset()
    storageMocks.setItem.mockReset()
    bridgeMocks.getProfileFromBridge.mockReset()
    bridgeMocks.listProjectProfilesFromBridge.mockReset()
    bridgeMocks.saveProfileToBridge.mockReset()

    storageMocks.getItem.mockResolvedValue(null)
    storageMocks.setItem.mockResolvedValue(undefined)
    bridgeMocks.listProjectProfilesFromBridge.mockResolvedValue({
      profileIds: ['default', 'writer'],
    })
    bridgeMocks.getProfileFromBridge.mockImplementation(async (_projectId: string, profileId: string) => ({
      id: profileId,
      appearance: {
        theme: 'system',
        fontSize: 16,
        pageWidth: 'narrow',
      },
      layout: {
        sidebarWidth: 280,
        outlineWidth: 320,
        sidebarCollapsed: false,
        outlineCollapsed: false,
      },
      navigation: {
        expandedFileNodes: [],
        expandedHeadingNodes: {},
        hiddenPaths: profileId === 'default' ? ['docs/private.md'] : [],
        favoritePaths: profileId === 'default' ? ['docs/private.md'] : [],
      },
    }))
    bridgeMocks.saveProfileToBridge.mockImplementation(async (_projectId: string, profile: unknown) => profile)
  })

  it('keeps the active hidden document open, reveals it temporarily, and resets the reveal state on profile switch', async () => {
    const user = userEvent.setup()

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('active-profile')).toHaveTextContent('default')
    })

    await waitFor(() => {
      expect(screen.getByTestId('show-hidden-items')).toHaveTextContent('false')
      expect(screen.getByTestId('visible-tree')).toHaveTextContent('docs,docs/guide.md')
      expect(screen.getByTestId('visible-tree')).not.toHaveTextContent('docs/private.md')
    })
    expect(screen.getByTestId('current-document')).toHaveTextContent('docs/private.md')

    await user.click(screen.getByRole('button', { name: 'toggle-hidden-items' }))

    await waitFor(() => {
      expect(screen.getByTestId('show-hidden-items')).toHaveTextContent('true')
    })
    expect(screen.getByTestId('visible-tree')).toHaveTextContent('docs/private.md')

    await user.click(screen.getByRole('button', { name: 'switch-profile' }))

    await waitFor(() => {
      expect(screen.getByTestId('active-profile')).toHaveTextContent('writer')
    })
    expect(screen.getByTestId('show-hidden-items')).toHaveTextContent('false')
    expect(screen.getByTestId('visible-tree')).toHaveTextContent('docs/private.md')
  })

  it('supports the combined hidden-items and favorites-only mode, and resets favorites-only on profile switch', async () => {
    const user = userEvent.setup()

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('favorite-paths')).toHaveTextContent('docs/private.md')
      expect(screen.getByTestId('show-hidden-items')).toHaveTextContent('false')
      expect(screen.getByTestId('show-favorites-only')).toHaveTextContent('false')
      expect(screen.getByTestId('visible-tree')).not.toHaveTextContent('docs/private.md')
    })

    await user.click(screen.getByRole('button', { name: 'toggle-hidden-items' }))
    await user.click(screen.getByRole('button', { name: 'toggle-favorites-only' }))

    await waitFor(() => {
      expect(screen.getByTestId('show-hidden-items')).toHaveTextContent('true')
      expect(screen.getByTestId('show-favorites-only')).toHaveTextContent('true')
    })
    expect(screen.getByTestId('visible-tree')).toHaveTextContent('docs/private.md')
    expect(screen.getByTestId('visible-tree')).not.toHaveTextContent('docs/guide.md')

    await user.click(screen.getByRole('button', { name: 'switch-profile' }))

    await waitFor(() => {
      expect(screen.getByTestId('active-profile')).toHaveTextContent('writer')
    })
    expect(screen.getByTestId('show-hidden-items')).toHaveTextContent('false')
    expect(screen.getByTestId('show-favorites-only')).toHaveTextContent('false')
    expect(screen.getByTestId('favorite-paths')).toHaveTextContent('')
    expect(screen.getByTestId('visible-tree')).toHaveTextContent('docs/private.md')
  })
})
