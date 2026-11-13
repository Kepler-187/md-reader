vi.mock('../../src/editor/visual-markdown-editor-loader', () => ({ preloadVisualMarkdownEditor: vi.fn() }))
import { useEffect, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/editor/visual-markdown-editor', () => ({
  preloadVisualMarkdownEditor: vi.fn(),
  VisualMarkdownEditor: ({ value, readonly }: { value: string; readonly?: boolean }) => {
    const [isReady, setIsReady] = useState(false)
    const lines = value.split(/\r?\n/)

    useEffect(() => {
      const timer = window.setTimeout(() => {
        setIsReady(true)
      }, 0)

      return () => {
        window.clearTimeout(timer)
      }
    }, [])

    if (!isReady) {
      return <div role="status">正在加载可视编辑器…</div>
    }

    return (
      <div aria-label="可视 Markdown 编辑器" data-readonly={readonly ? 'true' : 'false'}>
        {renderMockMarkdown(lines, true)}
      </div>
    )
  },
}))

vi.mock('../../src/document-renderer/readonly-markdown-renderer', () => ({
  ReadonlyMarkdownRenderer: ({ value }: { value: string }) => (
    <article aria-label="只读 Markdown 渲染器">{renderMockMarkdown(value.split(/\r?\n/), true)}</article>
  ),
}))

vi.mock('../../src/workspace/local-bridge-access', () => ({
  getLinkIndexFromBridge: vi.fn().mockResolvedValue({ nodes: [], edges: [], backlinks: {}, broken: [], titles: {}, scannedAt: '', documentCount: 0 }),
  BridgeDocumentConflictError: class BridgeDocumentConflictError extends Error {},
  BridgeDocumentSavedCacheInvalidationError: class BridgeDocumentSavedCacheInvalidationError extends Error {},
  createDirectoryNodeInBridge: vi.fn(),
  createDocumentNodeInBridge: vi.fn(),
  deleteDocumentNodeInBridge: vi.fn(),
  duplicateDocumentNodeInBridge: vi.fn(),
  getDocumentContentFromBridge: vi.fn(),
  getFileTreePathsFromBridge: vi.fn(),
  getLocalBridgeHealth: vi.fn(async () => ({ ok: false, mode: 'offline', projectsLoaded: 0, port: 8797 })),
  getProfileFromBridge: vi.fn(),
  getProjectTreeSnapshotFromBridge: vi.fn(),
  listProjectProfilesFromBridge: vi.fn(),
  listProjectsFromBridge: vi.fn(),
  moveDocumentNodeInBridge: vi.fn(),
  refreshFileTreeFromBridge: vi.fn(),
  refreshProjectTreeSnapshotFromBridge: vi.fn(),
  registerProjectWithBridge: vi.fn(),
  renameDocumentNodeInBridge: vi.fn(),
  restartLocalBridgeService: vi.fn(),
  saveDocumentContentToBridge: vi.fn(),
  saveProfileToBridge: vi.fn(),
  setActiveProjectWithBridge: vi.fn(),
  stopLocalBridgeService: vi.fn(),
}))

import App from '../../src/App'
import { AppShell } from '../../src/app/AppShell'
import { buildFileTree, createVisibleFileTree } from '../../src/workspace/file-tree'

const defaultTabs = [
  {
    id: 'docs/README.md',
    documentPath: 'docs/README.md',
    title: 'README.md',
    saveState: 'clean' as const,
    saveErrorMessage: null,
  },
]

function createVisibleTree(paths: string[]) {
  return createVisibleFileTree({
    sourceNodes: buildFileTree(paths),
    hiddenPaths: [],
    showHiddenItems: false,
  })
}

function renderMockMarkdown(lines: string[], attachHeadingIds = false) {
  return lines.map((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.*)$/)

    if (match) {
      const HeadingTag = `h${match[1].length}` as keyof JSX.IntrinsicElements
      const headingProps = attachHeadingIds ? { 'data-heading-id': match[2] } : {}

      return (
        <HeadingTag key={`heading-${index}`} {...headingProps}>
          {match[2]}
        </HeadingTag>
      )
    }

    if (line.trim().length === 0) {
      return null
    }

    return <p key={`paragraph-${index}`}>{line}</p>
  })
}

describe('App', () => {
  it('renders a workspace recovery state before startup finishes', () => {
    render(<App />)

    expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('选择项目')
    expect(screen.getByRole('button', { name: '接入项目' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '模式切换' })).toBeInTheDocument()
    expect(screen.getAllByText('正在恢复工作区…').length).toBeGreaterThan(0)
  })
})

describe('AppShell', () => {
  it('renders the active project, profile and file tree nodes', async () => {
    render(
      <AppShell
        projects={[
          {
            id: 'notes',
            name: 'Notes',
            rootHandleKey: 'handle:notes',
            contentRoots: ['docs'],
            permissionState: 'granted',
          },
        ]}
        activeProjectId="notes"
        profileIds={['default', 'writer']}
        activeProfileId="writer"
        tabs={defaultTabs}
        activeTabId="docs/README.md"
        mode="regular"
        regularViewState="locked"
        fileTree={createVisibleTree(['docs/README.md']).visibleNodes}
        availableDirectoryPaths={['docs']}
        currentDocumentPath="docs/README.md"
        currentDocumentContent={'# Readme\n\nHello world'}
        statusMessage="项目已接入"
        sidebarWidth={280}
        outlineWidth={320}
        canManageService
        onConnectProject={() => {}}
        onProjectChange={() => {}}
        onProfileChange={() => {}}
        onModeChange={() => {}}
        onToggleRegularLock={() => {}}
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onRestartService={() => {}}
        onStopService={() => {}}
        onDocumentSelect={() => {}}
        onSidebarWidthChange={() => {}}
        onSidebarWidthCommit={() => {}}
        onOutlineWidthChange={() => {}}
        onOutlineWidthCommit={() => {}}
      />,
    )

    expect(screen.getByRole('combobox', { name: '项目切换' })).toHaveTextContent('Notes')
    expect(screen.getByRole('combobox', { name: 'Profile 切换' })).toHaveTextContent('writer')
    expect(screen.getByRole('tab', { name: /README\.md/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '常规' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '解锁' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'docs' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'README.md' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('heading', { name: 'Readme' })).toBeInTheDocument()
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '文档标题导航' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Readme' })).toHaveAttribute('aria-current', 'location')
    expect(screen.getByRole('button', { name: '重启服务' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭服务' })).toBeInTheDocument()
  })

  it('passes action toast content into the workspace layout', () => {
    render(
      <AppShell
        projects={[
          {
            id: 'notes',
            name: 'Notes',
            rootHandleKey: 'handle:notes',
            contentRoots: ['docs'],
            permissionState: 'granted',
          },
        ]}
        activeProjectId="notes"
        profileIds={['default']}
        activeProfileId="default"
        tabs={defaultTabs}
        activeTabId="docs/README.md"
        mode="regular"
        regularViewState="locked"
        fileTree={createVisibleTree(['docs/README.md']).visibleNodes}
        availableDirectoryPaths={['docs']}
        currentDocumentPath="docs/README.md"
        currentDocumentContent={'# Readme\n\nHello world'}
        statusMessage="项目已接入"
        actionToast={{
          id: 1,
          tone: 'success',
          message: '已拷贝链接：docs/README.md',
        }}
        sidebarWidth={280}
        outlineWidth={320}
        onConnectProject={() => {}}
        onProjectChange={() => {}}
        onProfileChange={() => {}}
        onModeChange={() => {}}
        onToggleRegularLock={() => {}}
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onRestartService={() => {}}
        onStopService={() => {}}
        onDocumentSelect={() => {}}
        onSidebarWidthChange={() => {}}
        onSidebarWidthCommit={() => {}}
        onOutlineWidthChange={() => {}}
        onOutlineWidthCommit={() => {}}
      />,
    )

    const toast = screen.getByText('操作完成').closest('[role="status"]')

    expect(toast).not.toBeNull()
    expect(toast).toHaveTextContent('已拷贝链接：docs/README.md')
  })

  it('toggles non-current directories without affecting file selection wiring', async () => {
    const user = userEvent.setup()
    const onDocumentSelect = vi.fn()

    render(
      <AppShell
        projects={[
          {
            id: 'notes',
            name: 'Notes',
            rootHandleKey: 'handle:notes',
            contentRoots: ['docs'],
            permissionState: 'granted',
          },
        ]}
        activeProjectId="notes"
        profileIds={['default']}
        activeProfileId="default"
        tabs={[]}
        activeTabId={null}
        mode="regular"
        regularViewState="locked"
        fileTree={createVisibleTree(['docs/guides/intro.md']).visibleNodes}
        availableDirectoryPaths={['docs', 'docs/guides']}
        currentDocumentPath={null}
        currentDocumentContent={null}
        statusMessage="项目已接入"
        sidebarWidth={280}
        outlineWidth={320}
        onConnectProject={() => {}}
        onProjectChange={() => {}}
        onProfileChange={() => {}}
        onModeChange={() => {}}
        onToggleRegularLock={() => {}}
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onRestartService={() => {}}
        onStopService={() => {}}
        onDocumentSelect={onDocumentSelect}
        onSidebarWidthChange={() => {}}
        onSidebarWidthCommit={() => {}}
        onOutlineWidthChange={() => {}}
        onOutlineWidthCommit={() => {}}
      />,
    )

    const guidesDirectory = screen.getByRole('button', { name: 'guides' })

    expect(guidesDirectory).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'intro.md' })).not.toBeInTheDocument()

    await user.click(guidesDirectory)

    expect(guidesDirectory).toHaveAttribute('aria-expanded', 'true')

    const introDocument = screen.getByRole('button', { name: 'intro.md' })

    await user.click(introDocument)

    expect(onDocumentSelect).toHaveBeenCalledWith('docs/guides/intro.md')

    await user.click(guidesDirectory)

    expect(guidesDirectory).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'intro.md' })).not.toBeInTheDocument()
  })

  it('opens custom dropdowns and forwards selection changes', async () => {
    const user = userEvent.setup()
    const onProjectChange = vi.fn()
    const onProfileChange = vi.fn()

    render(
      <AppShell
        projects={[
          {
            id: 'notes',
            name: 'Notes',
            rootHandleKey: 'handle:notes',
            contentRoots: ['docs'],
            permissionState: 'granted',
          },
          {
            id: 'manual',
            name: 'Manual',
            rootHandleKey: 'handle:manual',
            contentRoots: ['docs'],
            permissionState: 'granted',
          },
        ]}
        activeProjectId="notes"
        profileIds={['default', 'writer']}
        activeProfileId="default"
        tabs={defaultTabs}
        activeTabId="docs/README.md"
        mode="regular"
        regularViewState="locked"
        fileTree={[]}
        availableDirectoryPaths={[]}
        currentDocumentPath="docs/README.md"
        currentDocumentContent={'# Readme'}
        statusMessage="项目已接入"
        sidebarWidth={280}
        outlineWidth={320}
        onConnectProject={() => {}}
        onProjectChange={onProjectChange}
        onProfileChange={onProfileChange}
        onModeChange={() => {}}
        onToggleRegularLock={() => {}}
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onRestartService={() => {}}
        onStopService={() => {}}
        onDocumentSelect={() => {}}
        onSidebarWidthChange={() => {}}
        onSidebarWidthCommit={() => {}}
        onOutlineWidthChange={() => {}}
        onOutlineWidthCommit={() => {}}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: '项目切换' }))
    await user.click(screen.getByRole('option', { name: 'Manual' }))
    await user.click(screen.getByRole('combobox', { name: 'Profile 切换' }))
    await user.click(screen.getByRole('option', { name: 'writer' }))

    expect(onProjectChange).toHaveBeenCalledWith('manual')
    expect(onProfileChange).toHaveBeenCalledWith('writer')
  })

  it('keeps the current document ancestors expanded', () => {
    render(
      <AppShell
        projects={[
          {
            id: 'notes',
            name: 'Notes',
            rootHandleKey: 'handle:notes',
            contentRoots: ['docs'],
            permissionState: 'granted',
          },
        ]}
        activeProjectId="notes"
        profileIds={['default']}
        activeProfileId="default"
        tabs={[
          {
            id: 'docs/guides/intro.md',
            documentPath: 'docs/guides/intro.md',
            title: 'intro.md',
            saveState: 'clean',
            saveErrorMessage: null,
          },
        ]}
        activeTabId="docs/guides/intro.md"
        mode="regular"
        regularViewState="editable"
        fileTree={createVisibleTree(['docs/guides/intro.md']).visibleNodes}
        availableDirectoryPaths={['docs', 'docs/guides']}
        currentDocumentPath="docs/guides/intro.md"
        currentDocumentContent={'# Intro'}
        statusMessage="项目已接入"
        sidebarWidth={280}
        outlineWidth={320}
        onConnectProject={() => {}}
        onProjectChange={() => {}}
        onProfileChange={() => {}}
        onModeChange={() => {}}
        onToggleRegularLock={() => {}}
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onRestartService={() => {}}
        onStopService={() => {}}
        onDocumentSelect={() => {}}
        onSidebarWidthChange={() => {}}
        onSidebarWidthCommit={() => {}}
        onOutlineWidthChange={() => {}}
        onOutlineWidthCommit={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'docs' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'guides' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'intro.md' })).toHaveAttribute('aria-current', 'page')
  })

  it('allows collapsing the current document branch manually', async () => {
    const user = userEvent.setup()

    render(
      <AppShell
        projects={[
          {
            id: 'notes',
            name: 'Notes',
            rootHandleKey: 'handle:notes',
            contentRoots: ['docs'],
            permissionState: 'granted',
          },
        ]}
        activeProjectId="notes"
        profileIds={['default']}
        activeProfileId="default"
        tabs={[
          {
            id: 'docs/guides/intro.md',
            documentPath: 'docs/guides/intro.md',
            title: 'intro.md',
            saveState: 'clean',
            saveErrorMessage: null,
          },
        ]}
        activeTabId="docs/guides/intro.md"
        mode="regular"
        regularViewState="editable"
        fileTree={createVisibleTree(['docs/guides/intro.md']).visibleNodes}
        availableDirectoryPaths={['docs', 'docs/guides']}
        currentDocumentPath="docs/guides/intro.md"
        currentDocumentContent={'# Intro'}
        statusMessage="项目已接入"
        sidebarWidth={280}
        outlineWidth={320}
        onConnectProject={() => {}}
        onProjectChange={() => {}}
        onProfileChange={() => {}}
        onModeChange={() => {}}
        onToggleRegularLock={() => {}}
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onRestartService={() => {}}
        onStopService={() => {}}
        onDocumentSelect={() => {}}
        onSidebarWidthChange={() => {}}
        onSidebarWidthCommit={() => {}}
        onOutlineWidthChange={() => {}}
        onOutlineWidthCommit={() => {}}
      />,
    )

    const guidesDirectory = screen.getByRole('button', { name: 'guides' })

    expect(guidesDirectory).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'intro.md' })).toBeInTheDocument()

    await user.click(guidesDirectory)

    expect(guidesDirectory).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'intro.md' })).not.toBeInTheDocument()
  })

  it('shows a lock button and forwards unlock actions in regular mode', async () => {
    const user = userEvent.setup()
    const onToggleRegularLock = vi.fn()
    const onTabClose = vi.fn()

    render(
      <AppShell
        projects={[
          {
            id: 'notes',
            name: 'Notes',
            rootHandleKey: 'handle:notes',
            contentRoots: ['docs'],
            permissionState: 'granted',
          },
        ]}
        activeProjectId="notes"
        profileIds={['default']}
        activeProfileId="default"
        tabs={defaultTabs}
        activeTabId="docs/README.md"
        mode="regular"
        regularViewState="locked"
        fileTree={[]}
        availableDirectoryPaths={[]}
        currentDocumentPath="docs/README.md"
        currentDocumentContent={'# Readme'}
        statusMessage="项目已接入"
        sidebarWidth={280}
        outlineWidth={320}
        onConnectProject={() => {}}
        onProjectChange={() => {}}
        onProfileChange={() => {}}
        onModeChange={() => {}}
        onToggleRegularLock={onToggleRegularLock}
        onTabSelect={() => {}}
        onTabClose={onTabClose}
        onRestartService={() => {}}
        onStopService={() => {}}
        onDocumentSelect={() => {}}
        onSidebarWidthChange={() => {}}
        onSidebarWidthCommit={() => {}}
        onOutlineWidthChange={() => {}}
        onOutlineWidthCommit={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: '解锁' }))
    await user.click(screen.getByRole('button', { name: '关闭标签：README.md' }))

    expect(onToggleRegularLock).toHaveBeenCalledTimes(1)
    expect(onTabClose).toHaveBeenCalledWith('docs/README.md')
  })

})
