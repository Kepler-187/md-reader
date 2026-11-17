import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from './clipboard'

const originalClipboard = navigator.clipboard
const originalExecCommand = document.execCommand

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: originalClipboard,
    configurable: true,
    writable: true,
  })
  document.execCommand = originalExecCommand
  vi.restoreAllMocks()
})

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
}

describe('copyText', () => {
  it('走现代 Clipboard API 成功后不再碰 execCommand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    await copyText('hello')

    expect(writeText).toHaveBeenCalledWith('hello')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('Clipboard API 被拒时退回 execCommand 并成功', async () => {
    stubClipboard(() => Promise.reject(new Error("Write permission denied.")))
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    await expect(copyText('fallback-text')).resolves.toBeUndefined()
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('两条路都失败时抛出可读错误', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    document.execCommand = vi.fn().mockReturnValue(false)

    await expect(copyText('x')).rejects.toThrow('剪贴板不可用')
  })

  it('空文本直接拒绝，不做无意义的写入', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)

    await expect(copyText('')).rejects.toThrow('没有可复制的内容')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('兜底路径结束后清理临时 textarea，不留在 DOM 里', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    document.execCommand = vi.fn().mockReturnValue(true)

    const before = document.body.querySelectorAll('textarea').length
    await copyText('cleanup-check')
    const after = document.body.querySelectorAll('textarea').length

    expect(after).toBe(before)
  })

  it('没有 navigator.clipboard 时直接走兜底', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    await expect(copyText('no-api')).resolves.toBeUndefined()
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('execCommand 抛异常时也能正常返回失败而不是崩溃', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    document.execCommand = vi.fn(() => {
      throw new Error('boom')
    })

    await expect(copyText('x')).rejects.toThrow('剪贴板不可用')
  })
})
