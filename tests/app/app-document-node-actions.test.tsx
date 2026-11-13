vi.mock('../../src/editor/visual-markdown-editor-loader', () => ({ preloadVisualMarkdownEditor: vi.fn() }))
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}))

const bridgeMocks = vi.hoisted(() => ({
  createDirectoryNodeInBridge: vi.fn(),
  createDocumentNodeInBridge: vi.fn(),
  deleteDocumentNodeInBridge: vi.fn(),
  duplicateDocumentNodeInBridge: vi.fn(),
  getDocumentContentFromBridge: vi.fn(),
  getProfileFromBridge: vi.fn(),
  listProjectProfilesFromBridge: vi.fn(),
  listProjectsFromBridge: vi.fn(),
  renameDocumentNodeInBridge: vi.fn(),
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
    getState: vi.fn(async () => ({
      activeDocumentPath: 'docs/guide.md',
      activeMode: 'regular',
      lastKnownScrollTop: 0,
      readingProgressByDocument: {
        'docs/guide.md': 0,
      },
    })),
    saveState: vi.fn(async () => undefined),
    updateState: async () => undefined,
  }),
}))

vi.mock('../../src/workspace/local-bridge-access', () => ({
  getLinkIndexFromBridge: vi.fn().mockResolvedValue({ nodes: [], edges: [], backlinks: {}, broken: [], titles: {}, scannedAt: '', documentCount: 0 }),
  BridgeDocumentConflictError: class BridgeDocumentConflictError extends Error {},
  BridgeDocumentSavedCacheInvalidationError: class BridgeDocumentSavedCacheInvalidationError extends Error {},
  createDirectoryNodeInBridge: bridgeMocks.createDirectoryNodeInBridge,
  createDocumentNodeInBridge: bridgeMocks.createDocumentNodeInBridge,
  deleteDocumentNodeInBridge: bridgeMocks.deleteDocumentNodeInBridge,
  duplicateDocumentNodeInBridge: bridgeMocks.duplicateDocumentNodeInBridge,
  getDocumentContentFromBridge: bridgeMocks.getDocumentContentFromBridge,
  getFileTreePathsFromBridge: vi.fn(async () => ['docs/guide.md', 'docs/guide-副本.md']),
  getProjectTreeSnapshotFromBridge: vi.fn(async () => ({
    entries: [
      { path: 'docs/guide.md', createdAtMs: 100, modifiedAtMs: 100, recentAtMs: 100 },
      { path: 'docs/guide-副本.md', createdAtMs: 100, modifiedAtMs: 100, recentAtMs: 100 },
    ],
  })),
  getLocalBridgeHealth: vi.fn(async () => ({
    ok: true,
    mode: 'local-service',
    projectsLoaded: 1,
    port: 8797,
  })),
  getProfileFromBridge: bridgeMocks.getProfileFromBridge,
  listProjectProfilesFromBridge: bridgeMocks.listProjectProfilesFromBridge,
  listProjectsFromBridge: bridgeMocks.listProjectsFromBridge,
  moveDocumentNodeInBridge: vi.fn(),
  registerProjectWithBridge: vi.fn(),
  renameDocumentNodeInBridge: bridgeMocks.renameDocumentNodeInBridge,
  restartLocalBridgeService: vi.fn(),
  refreshFileTreeFromBridge: vi.fn(async () => ['docs/guide.md', 'docs/guide-副本.md']),
  refreshProjectTreeSnapshotFromBridge: vi.fn(async () => ({
    entries: [
      { path: 'docs/guide.md', createdAtMs: 100, modifiedAtMs: 100, recentAtMs: 100 },
      { path: 'docs/guide-副本.md', createdAtMs: 100, modifiedAtMs: 100, recentAtMs: 100 },
    ],
  })),
  saveDocumentContentToBridge: vi.fn(),
  saveProfileToBridge: vi.fn(async (_projectId, profile) => profile),
  setActiveProjectWithBridge: vi.fn(),
  stopLocalBridgeService: vi.fn(),
}))

vi.mock('../../src/editor/visual-markdown-editor', () => ({
  preloadVisualMarkdownEditor: vi.fn(),
  VisualMarkdownEditor: ({ value }: { value: string }) => (
    <textarea aria-label="可视 Markdown 编辑器" value={value} readOnly />
  ),
}))

import App from '../../src/App'

describe('App document node actions', () => {
  beforeEach(() => {
    storageMocks.getItem.mockReset()
    storageMocks.setItem.mockReset()
    bridgeMocks.createDirectoryNodeInBridge.mockReset()
    bridgeMocks.createDocumentNodeInBridge.mockReset()
    bridgeMocks.duplicateDocumentNodeInBridge.mockReset()
    bridgeMocks.deleteDocumentNodeInBridge.mockReset()
    bridgeMocks.getDocumentContentFromBridge.mockReset()
    bridgeMocks.getProfileFromBridge.mockReset()
    bridgeMocks.listProjectProfilesFromBridge.mockReset()
    bridgeMocks.listProjectsFromBridge.mockReset()
    bridgeMocks.renameDocumentNodeInBridge.mockReset()

    storageMocks.getItem.mockResolvedValue(null)
    storageMocks.setItem.mockResolvedValue(undefined)
    bridgeMocks.listProjectsFromBridge.mockResolvedValue({
      activeProjectId: 'notes',
      projects: [
        {
          id: 'notes',
          name: 'Notes',
          rootPath: 'C:\\Code\\Notes',
          contentRoots: ['docs'],
          permissionState: 'granted',
        },
      ],
    })
    bridgeMocks.listProjectProfilesFromBridge.mockResolvedValue({
      profileIds: ['default'],
    })
    bridgeMocks.getProfileFromBridge.mockResolvedValue({
      id: 'default',
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
        hiddenPaths: [],
        favoritePaths: [],
        expandedFileNodes: ['docs'],
        expandedHeadingNodes: {},
      },
    })
    bridgeMocks.getDocumentContentFromBridge.mockImplementation(async (_projectId: string, _profileId: string, path: string) => ({
      path,
      content: '# Guide\n\nBody',
      mtimeMs: 100,
      size: 10,
    }))
    bridgeMocks.createDocumentNodeInBridge.mockResolvedValue({
      path: 'docs/新文档.md',
      mtimeMs: 101,
      size: 0,
    })
    bridgeMocks.createDirectoryNodeInBridge.mockResolvedValue(undefined)
    bridgeMocks.duplicateDocumentNodeInBridge.mockResolvedValue({
      path: 'docs/guide-副本-2.md',
      mtimeMs: 101,
      size: 10,
    })
    bridgeMocks.deleteDocumentNodeInBridge.mockResolvedValue(undefined)
    bridgeMocks.renameDocumentNodeInBridge.mockResolvedValue({
      path: 'docs/guide-renamed.md',
      mtimeMs: 101,
      size: 10,
    })
  })

  it('submits duplicate from the context menu immediately through the duplicate bridge endpoint instead of rename', async () => {
    const user = userEvent.setup()

    render(<App />)

    const currentDocumentTab = await screen.findByRole('tab', { name: 'guide' })
    expect(currentDocumentTab).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'guide.md' })).toBeInTheDocument()
    })

    await user.pointer([
      {
        keys: '[MouseRight>]',
        target: screen.getByRole('button', { name: 'guide.md' }),
      },
      {
        keys: '[/MouseRight]',
      },
    ]) 

    await user.click(screen.getByRole('menuitem', { name: '创建副本' }))

    await waitFor(() => {
      expect(bridgeMocks.duplicateDocumentNodeInBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/guide.md',
        'docs/guide-副本-2.md',
      )
    })
    expect(bridgeMocks.renameDocumentNodeInBridge).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '创建副本 guide.md' })).not.toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: 'guide-副本-2' })).toBeInTheDocument()
    expect(screen.getAllByText('已创建副本：docs/guide-副本-2.md').length).toBeGreaterThan(0)
  })

  it('shows a project-styled delete confirmation dialog before removing a document', async () => {
    const user = userEvent.setup()

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'guide.md' })).toBeInTheDocument()
    })

    await user.pointer([
      {
        keys: '[MouseRight>]',
        target: screen.getByRole('button', { name: 'guide.md' }),
      },
      {
        keys: '[/MouseRight]',
      },
    ])

    await user.click(screen.getByRole('menuitem', { name: '删除文档' }))

    const deleteDialog = screen.getByRole('dialog', { name: '删除文档' })
    expect(deleteDialog).toBeInTheDocument()
    expect(within(deleteDialog).getByText('确认删除「guide.md」？删除后无法恢复。')).toBeInTheDocument()
    expect(within(deleteDialog).getByText('docs/guide.md')).toBeInTheDocument()
    expect(bridgeMocks.deleteDocumentNodeInBridge).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(bridgeMocks.deleteDocumentNodeInBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/guide.md',
      )
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '删除文档' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('tab', { name: 'guide' })).not.toBeInTheDocument()
    expect(screen.getAllByText('已删除：docs/guide.md').length).toBeGreaterThan(0)
  })

  it('creates a document through the project-styled create dialog instead of browser prompt', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(await screen.findByRole('button', { name: '新建文档' }))

    const createDialog = screen.getByRole('dialog', { name: '新建文档' })
    expect(createDialog).toBeInTheDocument()

    const input = within(createDialog).getByLabelText('名称')
    await user.clear(input)
    await user.type(input, '新文档.md')
    await user.click(within(createDialog).getByRole('button', { name: '创建文档' }))

    await waitFor(() => {
      expect(bridgeMocks.createDocumentNodeInBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/新文档.md',
        '',
      )
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '新建文档' })).not.toBeInTheDocument()
    })
    expect(screen.getAllByText('已新建文档：docs/新文档.md').length).toBeGreaterThan(0)
  })

  it('creates a directory through the project-styled create dialog instead of browser prompt', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(await screen.findByRole('button', { name: '新建文件夹' }))

    const createDialog = screen.getByRole('dialog', { name: '新建文件夹' })
    expect(createDialog).toBeInTheDocument()

    const input = within(createDialog).getByLabelText('名称')
    await user.clear(input)
    await user.type(input, '新目录')
    await user.click(within(createDialog).getByRole('button', { name: '创建文件夹' }))

    await waitFor(() => {
      expect(bridgeMocks.createDirectoryNodeInBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/新目录',
      )
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '新建文件夹' })).not.toBeInTheDocument()
    })
    expect(screen.getAllByText('已新建文件夹：docs/新目录').length).toBeGreaterThan(0)
  })

  it('publishes unified status and toast feedback after a file-tree reorder succeeds', async () => {
    const dragStore = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'all',
      dropEffect: 'none',
      setData: vi.fn((type: string, value: string) => {
        dragStore.set(type, value)
      }),
      getData: vi.fn((type: string) => dragStore.get(type) ?? ''),
    }

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'guide.md' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'guide-副本.md' })).toBeInTheDocument()
    })

    const guideButton = screen.getByRole('button', { name: 'guide.md' })
    const duplicateRow = screen.getByRole('button', { name: 'guide-副本.md' }).closest('.file-tree__row')

    expect(duplicateRow).not.toBeNull()

    Object.defineProperty(duplicateRow as HTMLDivElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 100, height: 40 }),
    })

    fireEvent.dragStart(guideButton, { dataTransfer })
    const reorderOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperties(reorderOverEvent, {
      clientY: { value: 120 },
      dataTransfer: { value: dataTransfer },
    })
    fireEvent(duplicateRow as HTMLDivElement, reorderOverEvent)

    const reorderDropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperties(reorderDropEvent, {
      clientY: { value: 120 },
      dataTransfer: { value: dataTransfer },
    })
    fireEvent(duplicateRow as HTMLDivElement, reorderDropEvent)

    await waitFor(() => {
      expect(screen.getAllByText('已调整顺序：docs/guide.md 已排到 docs/guide-副本.md 之后').length).toBeGreaterThan(0)
    })
  })
})
