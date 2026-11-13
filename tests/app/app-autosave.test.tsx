vi.mock('../../src/editor/visual-markdown-editor-loader', () => ({ preloadVisualMarkdownEditor: vi.fn() }))
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContentHash } from '../../src/shared/content-hash'

const localState = {
  activeDocumentPath: 'docs/guide.md',
  activeMode: 'edit' as const,
  lastKnownScrollTop: 0,
  readingProgressByDocument: {
    'docs/guide.md': 0,
    'docs/next.md': 0,
  },
}

const documents = new Map([
  [
    'docs/guide.md',
    {
      path: 'docs/guide.md',
      content: '# 旧标题\n\n旧内容',
      mtimeMs: 100,
      size: 11,
    },
  ],
  [
    'docs/next.md',
    {
      path: 'docs/next.md',
      content: '# 第二篇\n\n第二篇内容',
      mtimeMs: 200,
      size: 13,
    },
  ],
])

const bridgeMocks = vi.hoisted(() => ({
  saveDocumentContentToBridge: vi.fn(),
  getDocumentContentFromBridge: vi.fn(),
  getProfileFromBridge: vi.fn(),
  listProjectProfilesFromBridge: vi.fn(),
  saveProfileToBridge: vi.fn(),
  saveState: vi.fn(),
  setActiveProjectWithBridge: vi.fn(),
  restartLocalBridgeService: vi.fn(),
  stopLocalBridgeService: vi.fn(),
  getLocalBridgeHealth: vi.fn(),
}))

vi.mock('../../src/shared/key-value-store', () => ({
  createBrowserKeyValueStore: () => ({
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
  }),
}))

vi.mock('../../src/workspace/profile-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/workspace/profile-store')>(),
  createProfileStore: () => ({
    getProfile: vi.fn(async () => ({
      layout: {
        sidebarWidth: 280,
        outlineWidth: 320,
      },
    })),
    saveProfile: vi.fn(async () => undefined),
  }),
}))

vi.mock('../../src/workspace/local-state', () => ({
  createLocalStateStore: () => ({
    getState: vi.fn(async () => localState),
    saveState: bridgeMocks.saveState,
    updateState: async (projectId: string, profileId: string, update: (state: typeof localState) => typeof localState) => bridgeMocks.saveState(projectId, profileId, update(localState)),
  }),
}))

vi.mock('../../src/workspace/local-bridge-access', () => ({
  getLinkIndexFromBridge: vi.fn().mockResolvedValue({ nodes: [], edges: [], backlinks: {}, broken: [], titles: {}, scannedAt: '', documentCount: 0 }),
  BridgeDocumentConflictError: class BridgeDocumentConflictError extends Error {},
  BridgeDocumentSavedCacheInvalidationError: class BridgeDocumentSavedCacheInvalidationError extends Error {},
  getLocalBridgeHealth: bridgeMocks.getLocalBridgeHealth,
  listProjectsFromBridge: vi.fn(async () => ({
    initialized: true, revision: 1,
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
  getFileTreePathsFromBridge: vi.fn(async () => ['docs/guide.md', 'docs/next.md']),
  getProjectTreeSnapshotFromBridge: vi.fn(async () => ({ entries: [
    { path: 'docs/guide.md', createdAtMs: 1, modifiedAtMs: 1, recentAtMs: 1 },
    { path: 'docs/next.md', createdAtMs: 1, modifiedAtMs: 1, recentAtMs: 1 },
  ] })),
  refreshFileTreeFromBridge: vi.fn(async () => ['docs/guide.md', 'docs/next.md']),
  refreshProjectTreeSnapshotFromBridge: vi.fn(async () => ({ entries: [] })),
  getDocumentContentFromBridge: bridgeMocks.getDocumentContentFromBridge,
  saveDocumentContentToBridge: bridgeMocks.saveDocumentContentToBridge,
  registerProjectWithBridge: vi.fn(),
  setActiveProjectWithBridge: bridgeMocks.setActiveProjectWithBridge,
  restartLocalBridgeService: bridgeMocks.restartLocalBridgeService,
  stopLocalBridgeService: bridgeMocks.stopLocalBridgeService,
}))

vi.mock('../../src/editor/visual-markdown-editor', () => ({
  preloadVisualMarkdownEditor: vi.fn(),
  VisualMarkdownEditor: ({
    value,
    readonly,
    onChange,
    onCompositionStart,
    onCompositionEnd,
  }: {
    value: string
    readonly?: boolean
    onChange: (nextValue: string) => void
    onCompositionStart?: () => void
    onCompositionEnd?: () => void
  }) => (
    <textarea
      aria-label="可视 Markdown 编辑器"
      readOnly={readonly}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
    />
  ),
}))

import App from '../../src/App'

describe('App autosave transitions', () => {
  beforeEach(() => {
    bridgeMocks.saveDocumentContentToBridge.mockReset()
    bridgeMocks.getDocumentContentFromBridge.mockReset()
    bridgeMocks.getProfileFromBridge.mockReset()
    bridgeMocks.listProjectProfilesFromBridge.mockReset()
    bridgeMocks.saveProfileToBridge.mockReset()
    bridgeMocks.saveState.mockReset()
    bridgeMocks.setActiveProjectWithBridge.mockReset()
    bridgeMocks.restartLocalBridgeService.mockReset()
    bridgeMocks.stopLocalBridgeService.mockReset()
    bridgeMocks.getLocalBridgeHealth.mockReset()
    bridgeMocks.getLocalBridgeHealth.mockResolvedValue({
      ok: true,
      mode: 'local-service',
      projectsLoaded: 1,
      port: 8797,
    })

    bridgeMocks.listProjectProfilesFromBridge.mockResolvedValue({
      profileIds: ['default', 'Lans'],
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
        expandedFileNodes: [],
        expandedHeadingNodes: {},
      },
    })
    bridgeMocks.saveProfileToBridge.mockImplementation(async (_projectId, profile) => profile)

    documents.set('docs/guide.md', {
      path: 'docs/guide.md',
      content: '# 旧标题\n\n旧内容',
      mtimeMs: 100,
      size: 11,
    })
    documents.set('docs/next.md', {
      path: 'docs/next.md',
      content: '# 第二篇\n\n第二篇内容',
      mtimeMs: 200,
      size: 13,
    })

    bridgeMocks.getDocumentContentFromBridge.mockImplementation(
      async (_projectId: string, _profileId: string, documentPath: string) => {
        const document = documents.get(documentPath)
        if (!document) {
          throw new Error(`missing document: ${documentPath}`)
        }

        return document
      },
    )

    bridgeMocks.saveDocumentContentToBridge.mockImplementation(
      async (
        _projectId: string,
        _profileId: string,
        documentPath: string,
        content: string,
        expectedMtimeMs: number | null,
        expectedContentHash: string | null,
      ) => {
        const currentDocument = documents.get(documentPath)
        if (!currentDocument) {
          throw new Error(`missing document: ${documentPath}`)
        }

        if (
          expectedMtimeMs !== currentDocument.mtimeMs &&
          expectedContentHash !== createContentHash(currentDocument.content)
        ) {
          throw new Error(`Document has changed on disk: ${documentPath}`)
        }

        const nextDocument = {
          ...currentDocument,
          content,
          mtimeMs: currentDocument.mtimeMs + 1,
          size: content.length,
        }

        documents.set(documentPath, nextDocument)
        return nextDocument
      },
    )
    bridgeMocks.setActiveProjectWithBridge.mockResolvedValue(undefined)
    bridgeMocks.restartLocalBridgeService.mockResolvedValue(undefined)
    bridgeMocks.stopLocalBridgeService.mockResolvedValue(undefined)
  })

  it('flushes the dirty draft before locking regular mode', async () => {
    const user = userEvent.setup()

    render(<App />)

    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })

    await user.clear(editor)
    await user.type(editor, '# 新标题{enter}{enter}新内容')
    await user.click(screen.getByRole('button', { name: '锁定' }))

    await waitFor(() => {
      expect(bridgeMocks.saveDocumentContentToBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/guide.md',
        '# 新标题\n\n新内容',
        100,
        'fe1b7d93',
      )
    })

    await waitFor(() => {
      expect(screen.getByLabelText('只读 Markdown 渲染器')).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: '可视 Markdown 编辑器' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '解锁' })).toBeInTheDocument()
    })
  })

  it('switches documents without flushing the current dirty tab and restores the draft when切回', async () => {
    const user = userEvent.setup()

    render(<App />)

    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })

    await user.clear(editor)
    await user.type(editor, '# 当前文档已改动')
    await user.click(screen.getByRole('button', { name: 'next.md' }))

    expect(bridgeMocks.saveDocumentContentToBridge).not.toHaveBeenCalled()

    expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue(
      '# 第二篇\n\n第二篇内容',
    )

    await user.click(screen.getByRole('tab', { name: 'guide' }))

    expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue(
      '# 当前文档已改动',
    )
  })

  it('keeps a delayed save failure on its original tab after switching', async () => {
    const user = userEvent.setup()
    let rejectSave!: (error: Error) => void
    bridgeMocks.saveDocumentContentToBridge.mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject }))
    render(<App />)
    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    fireEvent.change(editor, { target: { value: '# 待保存草稿' } })
    await waitFor(() => expect(bridgeMocks.saveDocumentContentToBridge).toHaveBeenCalled(), { timeout: 3000 })
    await user.click(screen.getByRole('button', { name: 'next.md' }))
    await act(async () => { rejectSave(new Error('disk full')); await Promise.resolve() })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'guide' }).querySelector('[data-state="save_failed_retryable"]')).not.toBeNull())
    expect(screen.getByRole('tab', { name: 'next' }).querySelector('[data-state="clean"]')).not.toBeNull()
    await user.click(screen.getByRole('tab', { name: 'guide' }))
    expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue('# 待保存草稿')
  })

  it('does not evict a tab while its editor is composing input', async () => {
    const user = userEvent.setup()
    const profile = await bridgeMocks.getProfileFromBridge()
    bridgeMocks.getProfileFromBridge.mockResolvedValue({ ...profile, appearance: { ...profile.appearance, maxUnpinnedTabs: 1 } })
    render(<App />)
    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    const nextFile = await screen.findByRole('button', { name: 'next.md' })
    fireEvent.compositionStart(editor)
    await user.click(nextFile)
    expect((await screen.findAllByText(/标签页数量已达上限/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('tab', { name: 'guide' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'next' })).not.toBeInTheDocument()
    fireEvent.compositionEnd(editor)
  })

  it('does not evict a tab after undo while its previous save remains in flight', async () => {
    const user = userEvent.setup()
    const profile = await bridgeMocks.getProfileFromBridge()
    bridgeMocks.getProfileFromBridge.mockResolvedValue({ ...profile, appearance: { ...profile.appearance, maxUnpinnedTabs: 1 } })
    let finish!: (document: { path: string; content: string; mtimeMs: number; size: number }) => void
    const delayed = new Promise<{ path: string; content: string; mtimeMs: number; size: number }>((resolve) => { finish = resolve })
    bridgeMocks.saveDocumentContentToBridge.mockReturnValue(delayed)
    render(<App />)
    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })
    const nextFile = await screen.findByRole('button', { name: 'next.md' })
    fireEvent.change(editor, { target: { value: '# 尚在保存' } })
    await waitFor(() => expect(bridgeMocks.saveDocumentContentToBridge).toHaveBeenCalled(), { timeout: 3000 })
    fireEvent.change(editor, { target: { value: '# 旧标题\n\n旧内容' } })
    await user.click(nextFile)
    expect((await screen.findAllByText(/标签页数量已达上限/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('tab', { name: 'guide' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'next' })).not.toBeInTheDocument()
    await act(async () => { finish({ path: 'docs/guide.md', content: '# 尚在保存', mtimeMs: 101, size: 5 }); await delayed })
    expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue('# 旧标题\n\n旧内容')
  })

  it('blocks locking regular mode when saving fails', async () => {
    const user = userEvent.setup()

    bridgeMocks.saveDocumentContentToBridge.mockRejectedValue(new Error('disk full'))

    render(<App />)

    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })

    await user.clear(editor)
    await user.type(editor, '# 保存失败内容')
    await user.click(screen.getByRole('button', { name: '锁定' }))

    await waitFor(() => {
      expect(screen.getAllByText(/保存失败：disk full/).length).toBeGreaterThan(0)
    })

    expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue('# 保存失败内容')
    expect(screen.getByRole('button', { name: '常规' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '锁定' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('recovers from an mtime-only conflict before locking regular mode', async () => {
    const user = userEvent.setup()

    render(<App />)

    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })

    await user.clear(editor)
    await user.type(editor, '# 新标题{enter}{enter}新内容')

    documents.set('docs/guide.md', {
      path: 'docs/guide.md',
      content: '# 旧标题\n\n旧内容',
      mtimeMs: 101,
      size: 11,
    })

    await user.click(screen.getByRole('button', { name: '锁定' }))

    await waitFor(() => {
      expect(bridgeMocks.saveDocumentContentToBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/guide.md',
        '# 新标题\n\n新内容',
        100,
        'fe1b7d93',
      )
    })

    expect(screen.getByLabelText('只读 Markdown 渲染器')).toHaveTextContent('新标题')
    expect(screen.queryByRole('textbox', { name: '可视 Markdown 编辑器' })).not.toBeInTheDocument()
    expect(screen.queryByText(/保存失败：/)).not.toBeInTheDocument()
  })

  it('switches documents even when the dirty tab would fail to save later', async () => {
    const user = userEvent.setup()

    bridgeMocks.saveDocumentContentToBridge.mockRejectedValue(new Error('write denied'))

    render(<App />)

    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })

    await user.clear(editor)
    await user.type(editor, '# 当前内容不能切走')
    await user.click(screen.getByRole('button', { name: 'next.md' }))

    expect(bridgeMocks.saveDocumentContentToBridge).not.toHaveBeenCalled()
    expect(screen.queryByText(/保存失败：write denied/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue(
      '# 第二篇\n\n第二篇内容',
    )
    expect(screen.getByRole('tab', { name: 'next' })).toHaveAttribute('aria-selected', 'true')
  })

  it('requires a session-level save gate before restarting service when any tab is dirty', async () => {
    const user = userEvent.setup()

    render(<App />)

    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })

    await user.clear(editor)
    await user.type(editor, '# 当前文档留脏')
    await user.click(screen.getByRole('button', { name: 'next.md' }))
    await user.click(screen.getByRole('button', { name: '重启服务' }))

    expect(screen.getByRole('dialog', { name: '会话级保存闸门' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存全部' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放弃全部' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
    expect(bridgeMocks.restartLocalBridgeService).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '保存全部' }))

    await waitFor(() => {
      expect(bridgeMocks.saveDocumentContentToBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/guide.md',
        '# 当前文档留脏',
        100,
        'fe1b7d93',
      )
    })

    await waitFor(() => {
      expect(bridgeMocks.restartLocalBridgeService).toHaveBeenCalledTimes(1)
    })
  })

  it('re-probes and restores the workspace after entering offline mode', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(await screen.findByRole('button', { name: '关闭服务' }))
    await user.click(await screen.findByRole('button', { name: '重新连接服务' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '重启服务' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /guide/ })).toHaveAttribute('aria-selected', 'true')
    })
    expect(bridgeMocks.stopLocalBridgeService).toHaveBeenCalledTimes(1)
    expect(bridgeMocks.getLocalBridgeHealth.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('blocks service restart when saving fails', async () => {
    const user = userEvent.setup()

    bridgeMocks.saveDocumentContentToBridge.mockRejectedValue(new Error('bridge busy'))

    render(<App />)

    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })

    await user.clear(editor)
    await user.type(editor, '# 先不要重启')
    await user.click(screen.getByRole('button', { name: '重启服务' }))
    await user.click(screen.getByRole('button', { name: '保存全部' }))

    await waitFor(() => {
      expect(screen.getAllByText(/保存失败：bridge busy/).length).toBeGreaterThan(0)
    })

    expect(bridgeMocks.restartLocalBridgeService).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' })).toHaveValue('# 先不要重启')
  })

  it('flushes all dirty tabs before locking regular mode', async () => {
    const user = userEvent.setup()

    render(<App />)

    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })

    await user.clear(editor)
    await user.type(editor, '# 第一篇已改')
    await user.click(screen.getByRole('button', { name: 'next.md' }))
    await user.clear(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' }))
    await user.type(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' }), '# 第二篇也改了')
    await user.click(screen.getByRole('button', { name: '锁定' }))

    await waitFor(() => {
      expect(bridgeMocks.saveDocumentContentToBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/guide.md',
        '# 第一篇已改',
        100,
        'fe1b7d93',
      )
      expect(bridgeMocks.saveDocumentContentToBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/next.md',
        '# 第二篇也改了',
        200,
        '200880b6',
      )
    })

    expect(screen.getByLabelText('只读 Markdown 渲染器')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '可视 Markdown 编辑器' })).not.toBeInTheDocument()
  })

  it('prompts before closing a dirty tab and can save it before closing', async () => {
    const user = userEvent.setup()

    render(<App />)

    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })

    await user.clear(editor)
    await user.type(editor, '# 第一篇待保存')
    await user.click(screen.getByRole('button', { name: 'next.md' }))
    await user.click(screen.getByRole('button', { name: '关闭标签：guide' }))

    expect(screen.getByRole('dialog', { name: '关闭未保存标签' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放弃' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(bridgeMocks.saveDocumentContentToBridge).toHaveBeenCalledWith(
        'notes',
        'default',
        'docs/guide.md',
        '# 第一篇待保存',
        100,
        'fe1b7d93',
      )
    })

    expect(screen.queryByRole('tab', { name: 'guide' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'next' })).toHaveAttribute('aria-selected', 'true')
  })

  it('does not autosave during composition until composition ends', async () => {
    render(<App />)

    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })

    vi.useFakeTimers()

    try {
      fireEvent.change(editor, { target: { value: '# 拼音输入前缀' } })
      fireEvent.compositionStart(editor)
      fireEvent.change(editor, { target: { value: '# 拼音输入前缀zhong' } })
      vi.advanceTimersByTime(2000)

      expect(bridgeMocks.saveDocumentContentToBridge).not.toHaveBeenCalled()
      expect(screen.getAllByText(/等待保存…/).length).toBeGreaterThan(0)

      fireEvent.compositionEnd(editor)
      await vi.advanceTimersByTimeAsync(1300)
      expect(bridgeMocks.saveDocumentContentToBridge).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears stale save failure status once the draft returns to a clean state', async () => {
    const user = userEvent.setup()

    bridgeMocks.saveDocumentContentToBridge.mockRejectedValueOnce(
      new Error('Document has changed on disk: .instructions.md'),
    )

    render(<App />)

    const editor = await screen.findByRole('textbox', { name: '可视 Markdown 编辑器' })

    await user.clear(editor)
    await user.type(editor, '# 会先失败的内容')
    await user.click(screen.getByRole('button', { name: '锁定' }))

    await waitFor(() => {
      expect(screen.getAllByText(/保存失败：Document has changed on disk: \.instructions\.md/).length).toBeGreaterThan(0)
    })

    await user.clear(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' }))
    await user.type(screen.getByRole('textbox', { name: '可视 Markdown 编辑器' }), '# 旧标题{enter}{enter}旧内容')
    await user.click(screen.getByRole('button', { name: '锁定' }))

    await waitFor(() => {
      expect(screen.queryByText(/状态：保存失败：Document has changed on disk: \.instructions\.md/)).not.toBeInTheDocument()
    })

    expect(screen.getByText('保存：已保存')).toBeInTheDocument()
    expect(screen.getByText('状态：当前项目：Notes')).toBeInTheDocument()
  })
})
