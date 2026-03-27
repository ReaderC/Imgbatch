import { TOOL_MAP } from './config/tools.js'
import { renderAppShell } from './components/AppShell.js'
import { appendAssets, applyRunResult, dismissNotification, getState, moveAsset, pushNotification, removeAsset, setActiveTool, setSearchQuery, setState, subscribe, updateConfig } from './state/store.js'
import { getLaunchInputs, importItems, runTool, savePreset, subscribeLaunchInputs } from './services/ztools-bridge.js'

const app = document.getElementById('app')
const fileInput = createFileInput({ directory: false })
const folderInput = createFileInput({ directory: true })

document.body.append(fileInput, folderInput)
subscribe(render)
render(getState())
attachGlobalEvents()
bootstrapLaunchInputs().finally(() => {
  attachLaunchSubscription()
})

function render(state) {
  const snapshot = captureUiSnapshot()
  app.innerHTML = renderAppShell(state) + renderNotifications(state.notifications)
  restoreUiSnapshot(snapshot)
}

function attachLaunchSubscription() {
  subscribeLaunchInputs(async (values) => {
    try {
      const assets = await importItems(values)
      appendImportedAssets(assets, '已带入')
    } catch (error) {
      notify({ type: 'error', message: error?.message || '读取启动图片失败。' })
    }
  })
}

async function bootstrapLaunchInputs() {
  try {
    const assets = await getLaunchInputs()
    appendImportedAssets(assets, '已带入')
  } catch (error) {
    notify({ type: 'error', message: error?.message || '读取启动图片失败。' })
  }
}

function appendImportedAssets(assets, verb = '已导入') {
  if (!assets?.length) return
  appendAssets(assets)
  notify({ type: 'success', message: `${verb} ${assets.length} 张图片。` })
}

function captureUiSnapshot() {
  const activeElement = document.activeElement
  return {
    windowScrollY: window.scrollY,
    scrollTopByRole: Array.from(document.querySelectorAll('[data-scroll-role]')).map((node) => ({
      role: node.dataset.scrollRole,
      scrollTop: node.scrollTop,
    })),
    activeField: activeElement?.matches?.('[data-action][data-tool-id][data-key], [data-role="search-input"]')
      ? getElementDescriptor(activeElement)
      : null,
    selection: activeElement && 'selectionStart' in activeElement
      ? {
          start: activeElement.selectionStart,
          end: activeElement.selectionEnd,
        }
      : null,
  }
}

function restoreUiSnapshot(snapshot) {
  if (typeof snapshot?.windowScrollY === 'number') {
    window.scrollTo({ top: snapshot.windowScrollY })
  }

  for (const item of snapshot?.scrollTopByRole || []) {
    const node = document.querySelector(`[data-scroll-role="${item.role}"]`)
    if (node) node.scrollTop = item.scrollTop
  }

  if (!snapshot?.activeField) return
  const target = findElementByDescriptor(snapshot.activeField)
  if (!target) return
  target.focus({ preventScroll: true })
  if (snapshot.selection && 'setSelectionRange' in target) {
    target.setSelectionRange(snapshot.selection.start, snapshot.selection.end)
  }
}

function getElementDescriptor(element) {
  return {
    action: element.dataset.action || '',
    role: element.dataset.role || '',
    toolId: element.dataset.toolId || '',
    key: element.dataset.key || '',
    value: element.value ?? '',
  }
}

function findElementByDescriptor(descriptor) {
  if (descriptor.role === 'search-input') {
    return document.querySelector('[data-role="search-input"]')
  }

  const selector = `[data-action="${descriptor.action}"][data-tool-id="${descriptor.toolId}"][data-key="${descriptor.key}"]`
  const candidates = Array.from(document.querySelectorAll(selector))
  return candidates.find((element) => (element.value ?? '') === descriptor.value) || candidates[0] || null
}

function canImportFromEvent(event) {
  const types = Array.from(event.dataTransfer?.types || [])
  return types.includes('Files')
}

function getDropSurface(event) {
  return event.target.closest('[data-role="drop-surface"]') || document.querySelector('[data-role="drop-surface"]')
}

function extractDroppedItems(event) {
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length) return files

  const entries = Array.from(event.dataTransfer?.items || [])
    .map((item) => item.getAsFile?.())
    .filter(Boolean)
  return entries
}

function attachGlobalEvents() {
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]')
    if (!target) return

    const { action } = target.dataset

    if (action === 'activate-tool') {
      setActiveTool(target.dataset.toolId)
      return
    }

    if (action === 'remove-asset') {
      removeAsset(target.dataset.assetId)
      return
    }

    if (action === 'move-asset') {
      moveAsset(target.dataset.assetId, target.dataset.direction)
      return
    }

    if (action === 'preview-asset') {
      previewAsset(target.dataset.assetId)
      return
    }

    if (action === 'process-current') {
      await processCurrentTool()
      return
    }

    if (action === 'open-file-input' || action === 'pick-demo') {
      fileInput.click()
      return
    }

    if (action === 'open-folder-input') {
      folderInput.click()
      return
    }

    if (action === 'save-preset') {
      const toolId = target.dataset.toolId
      await savePreset(toolId, getState().configs[toolId])
      notify({ type: 'success', message: `已保存 ${toolId} 预设。` })
      return
    }

    if (action === 'set-config' && target.dataset.toolId === 'crop' && target.dataset.key === 'ratio') {
      const ratio = parseValue(target.dataset.value)
      updateConfig('crop', { ratio, useCustomRatio: ratio === 'Custom' })
      return
    }

    if (action === 'set-config') {
      updateConfig(target.dataset.toolId, { [target.dataset.key]: parseValue(target.dataset.value) })
      return
    }

    if (action === 'apply-resize-preset') {
      updateConfig('resize', {
        width: target.dataset.width,
        height: target.dataset.height,
        widthUnit: inferResizeUnit(target.dataset.width),
        heightUnit: inferResizeUnit(target.dataset.height),
      })
      return
    }

    if (action === 'set-manual-crop-ratio') {
      updateConfig('manual-crop', {
        ratio: target.dataset.label,
        ratioValue: target.dataset.value,
      })
      return
    }

    if (action === 'manual-crop-prev' || action === 'manual-crop-next') {
      const state = getState()
      const currentIndex = state.configs['manual-crop'].currentIndex
      const nextIndex = action === 'manual-crop-prev' ? currentIndex - 1 : currentIndex + 1
      if (nextIndex >= 0 && nextIndex < state.assets.length) {
        updateConfig('manual-crop', { currentIndex: nextIndex })
      }
      return
    }

    if (action === 'manual-crop-skip' || action === 'manual-crop-complete') {
      const state = getState()
      const config = state.configs['manual-crop']
      const asset = state.assets[config.currentIndex]
      if (!asset) return

      const completedIds = [...config.completedIds]
      const skippedIds = [...config.skippedIds]
      const isComplete = action === 'manual-crop-complete'

      if (isComplete) {
        if (!completedIds.includes(asset.id)) completedIds.push(asset.id)
        const skipIndex = skippedIds.indexOf(asset.id)
        if (skipIndex >= 0) skippedIds.splice(skipIndex, 1)
      } else {
        if (!skippedIds.includes(asset.id)) skippedIds.push(asset.id)
        const completeIndex = completedIds.indexOf(asset.id)
        if (completeIndex >= 0) completedIds.splice(completeIndex, 1)
      }

      const nextIndex = Math.min(config.currentIndex + 1, Math.max(state.assets.length - 1, 0))
      updateConfig('manual-crop', {
        completedIds,
        skippedIds,
        currentIndex: nextIndex,
      })
      notify({ type: 'success', message: isComplete ? '已记录当前裁剪项。' : '已跳过当前图片。' })
      return
    }

    if (action === 'toggle-config') {
      const state = getState()
      const toolId = target.dataset.toolId
      const key = target.dataset.key
      updateConfig(toolId, { [key]: !state.configs[toolId][key] })
      return
    }
  })

  document.addEventListener('input', (event) => {
    const target = event.target
    if (target.matches('[data-role="search-input"]')) {
      getState().searchQuery = target.value
      return
    }

    const action = target.dataset.action
    if (action === 'set-config-input') {
      const toolId = target.dataset.toolId
      const key = target.dataset.key
      const value = parseValue(target.value)
      getState().configs[toolId] = { ...getState().configs[toolId], [key]: value }

      if (toolId === 'crop' && key === 'ratio') {
        getState().configs.crop = { ...getState().configs.crop, ratio: value, useCustomRatio: value === 'Custom' }
      }
    }
  })

  document.addEventListener('change', async (event) => {
    const target = event.target
    if (target === fileInput || target === folderInput) {
      await handleImport([...target.files])
      target.value = ''
      return
    }

    if (target.matches('[data-role="search-input"]')) {
      setSearchQuery(target.value)
      return
    }

    const action = target.dataset.action
    if ((action === 'set-config-input' || action === 'set-config-select') && target.dataset.toolId === 'crop' && target.dataset.key === 'ratio') {
      const ratio = parseValue(target.value)
      updateConfig('crop', { ratio, useCustomRatio: ratio === 'Custom' })
      return
    }

    if (action === 'set-config-input' || action === 'set-config-select') {
      updateConfig(target.dataset.toolId, { [target.dataset.key]: parseValue(target.value) })
    }
  })

  document.addEventListener('dragover', (event) => {
    if (!canImportFromEvent(event)) return
    if (!getDropSurface(event)) return
    event.preventDefault()
  })

  document.addEventListener('drop', async (event) => {
    if (!canImportFromEvent(event)) return
    if (!getDropSurface(event)) return
    event.preventDefault()
    await handleImport(extractDroppedItems(event))
  })
}

async function handleImport(items) {
  if (!items.length) return
  try {
    const assets = await importItems(items)
    if (!assets.length) {
      notify({ type: 'info', message: '未识别到可导入的图片。' })
      return
    }
    appendAssets(assets)
    notify({ type: 'success', message: `已导入 ${assets.length} 张图片。` })
  } catch (error) {
    notify({ type: 'error', message: error?.message || '导入失败。' })
  }
}

function previewAsset(assetId) {
  const state = getState()
  const tool = TOOL_MAP[state.activeTool]
  const asset = state.assets.find((item) => item.id === assetId)
  if (!asset) {
    notify({ type: 'error', message: '未找到要预览的图片。' })
    return
  }

  const summary = describeToolConfig(tool.id, state.configs[tool.id])
  notify({ type: 'info', message: `预览占位：${tool.label} · ${truncate(asset.name, 20)} · ${summary}` })
}

async function processCurrentTool() {
  const state = getState()
  const tool = TOOL_MAP[state.activeTool]

  if (!state.assets.length) {
    notify({ type: 'info', message: '请先导入图片，再开始处理。' })
    return
  }

  if (state.isProcessing) return

  setState({ isProcessing: true })
  try {
    const assets = tool.id === 'manual-crop'
      ? state.assets.filter((asset) => state.configs['manual-crop'].completedIds.includes(asset.id))
      : state.assets
    const result = await runTool(tool.id, state.configs[tool.id], assets, state.destinationPath)
    if (result?.processed?.length || result?.failed?.length) {
      applyRunResult(result)
    }

    if (result?.ok || result?.partial) {
      notify({ type: result.partial ? 'info' : 'success', message: result.message || `已触发 ${tool.label} 批处理。` })
      return
    }

    const summary = describeToolConfig(tool.id, state.configs[tool.id])
    notify({ type: 'info', message: result?.message || `处理占位：${tool.label} · ${state.assets.length} 张 · ${summary}` })
  } catch (error) {
    notify({ type: 'error', message: error?.message || '批处理触发失败。' })
  } finally {
    setState({ isProcessing: false })
  }
}

function createFileInput({ directory }) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = 'image/*'
  input.hidden = true
  if (directory) {
    input.setAttribute('webkitdirectory', '')
    input.removeAttribute('accept')
  }
  return input
}

function renderNotifications(items) {
  if (!items.length) return ''
  return `
    <div style="position:fixed;right:20px;bottom:20px;display:flex;flex-direction:column;gap:10px;z-index:999;">
      ${items.map((item) => `
        <button data-action="dismiss-notification" data-id="${item.id}" style="min-width:280px;padding:14px 16px;border-radius:18px;background:${getToastColor(item.type)};color:white;text-align:left;box-shadow:var(--shadow-float);cursor:pointer;">
          ${item.message}
        </button>
      `).join('')}
    </div>
  `
}

function scheduleNotificationDismiss(id) {
  window.setTimeout(() => {
    const state = getState()
    if (state.notifications.some((item) => item.id === id)) {
      dismissNotification(id)
    }
  }, 2000)
}

function notify(notification) {
  const item = pushNotification(notification)
  scheduleNotificationDismiss(item.id)
  return item
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action="dismiss-notification"]')
  if (target) dismissNotification(target.dataset.id)
})

function getToastColor(type) {
  if (type === 'success') return 'linear-gradient(135deg, #4956b4 0%, #8c99fc 100%)'
  if (type === 'error') return '#a8364b'
  return '#5b5e72'
}

function parseValue(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value !== '' && !Number.isNaN(Number(value)) && !String(value).endsWith('px') && !String(value).endsWith('%')) {
    return Number(value)
  }
  return value
}

function inferResizeUnit(value) {
  return String(value).trim().endsWith('%') ? '%' : 'px'
}

function describeToolConfig(toolId, config) {
  if (toolId === 'compression') return config.mode === 'quality' ? `压缩质量 ${config.quality}%` : `目标大小 ${config.targetSizeKb} KB`
  if (toolId === 'format') return `输出 ${config.targetFormat}`
  if (toolId === 'resize') {
    const width = typeof config.width === 'object' ? `${config.width.value}${config.width.unit}` : config.width
    const height = typeof config.height === 'object' ? `${config.height.value}${config.height.unit}` : config.height
    return `尺寸 ${width} × ${height}`
  }
  if (toolId === 'watermark') return `${config.type === 'text' ? '文本' : '图片'}水印 ${config.position}`
  if (toolId === 'corners') return `圆角 ${config.radius}${config.unit}`
  if (toolId === 'padding') return `留白 ${config.top}/${config.right}/${config.bottom}/${config.left}px`
  if (toolId === 'crop') return `裁剪 ${config.ratio === 'Custom' ? `${config.customRatioX}:${config.customRatioY}` : config.ratio}`
  if (toolId === 'rotate') return `${config.direction === 'clockwise' ? '顺时针' : '逆时针'} ${config.angle}°`
  if (toolId === 'flip') {
    const directions = [config.horizontal ? '左右' : '', config.vertical ? '上下' : ''].filter(Boolean)
    return directions.length ? `${directions.join(' + ')}翻转` : '未翻转'
  }
  if (toolId === 'merge-pdf') return `PDF ${config.pageSize} / ${config.margin}`
  if (toolId === 'merge-image') return `${config.direction === 'vertical' ? '纵向' : '横向'}拼接 ${config.pageWidth}px`
  if (toolId === 'merge-gif') return `GIF ${config.width}×${config.height} / ${config.interval}s`
  if (toolId === 'manual-crop') return `手动裁剪 ${config.ratio}`
  return '待处理'
}

function truncate(value, length) {
  if (value.length <= length) return value
  return `${value.slice(0, Math.max(0, length - 1))}…`
}
