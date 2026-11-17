/**
 * 复制文本到剪贴板。
 *
 * 为什么不能直接用 navigator.clipboard.writeText：
 * 大书库的界面跑在 iframe 里（父页面是 Cindy 插件沙箱，iframe 是
 * http://127.0.0.1:18798），属于跨源。异步 Clipboard API 受 Permissions Policy
 * 约束，父页面的策略没有委派 clipboard-write 时，writeText 会直接抛
 *   Failed to execute 'writeText' on 'Clipboard': Write permission denied.
 * 这不是权限弹窗被拒，而是策略层面根本没给，也不会弹窗征求意见。
 *
 * 所以走两步：
 * 1) 先试现代 API（在原生页面、或策略已放行的环境里最干净）
 * 2) 失败后退回 execCommand('copy')：它作用在**本文档**上，不需要跨源权限委派，
 *    只要在用户点击的调用栈里就能成功
 *
 * execCommand 已被标记废弃，但在 iframe 场景下仍是唯一可靠的兜底。
 */
export async function copyText(text: string): Promise<void> {
  if (!text) throw new Error('没有可复制的内容')

  // 1) 现代 Clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // 权限被策略拒绝、或文档不在聚焦状态 —— 继续走兜底
    }
  }

  // 2) execCommand 兜底
  if (copyViaExecCommand(text)) return

  throw new Error('剪贴板不可用（浏览器拒绝写入）')
}

/**
 * 用一个临时 textarea 选中后 execCommand('copy')。
 * 返回是否成功；不抛错，交给调用方决定怎么提示。
 */
function copyViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined') return false

  const selection = document.getSelection()
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  const textarea = document.createElement('textarea')
  textarea.value = text
  // 放在视口外，避免页面跳动；不能 display:none，那样选不中
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'

  document.body.appendChild(textarea)

  let copied: boolean
  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    textarea.remove()
    // 还原用户原来的选区，别把阅读位置弄丢
    if (previousRange && selection) {
      selection.removeAllRanges()
      selection.addRange(previousRange)
    }
  }

  return copied
}
