import { TOOL_MAP } from './config/tools.js'
import { renderAppShell } from './components/AppShell.js'
import { appendAssets, applyRunResult, dismissNotification, getState, moveAsset, pushNotification, removeAsset, setActiveTool, setConfirmDialog, setPresetDialog, setPreviewModal, setResultView, setSearchQuery, setSettingsDialog, setState, setToolPresets, subscribe, updateConfig, updateSettings } from './state/store.js'
import { buildStagedItems, deletePreset, getLaunchInputs, importItems, loadPresets, loadSettings, openInputDialog, renamePreset, resolveInputPaths, revealPath, replaceOriginals, runTool, saveAllStagedResults, savePreset, saveSettings, saveStagedResult, showMainWindow, stageToolPreview, subscribeLaunchInputs } from './services/ztools-bridge.js'

const PREVIEW_SAVE_TOOLS = new Set(['compression', 'format', 'resize', 'watermark', 'corners', 'padding', 'crop', 'rotate', 'flip'])
const PREVIEWABLE_TOOLS = new Set(['compression', 'format', 'resize', 'watermark', 'corners', 'padding', 'crop', 'rotate', 'flip'])
const SETTINGS_TOOL_ID = 'settings'

const app = document.getElementById('app')
const fileInput = createFileInput({ directory: false })
const folderInput = createFileInput({ directory: true })
const watermarkFileInput = createFileInput({ directory: false })
watermarkFileInput.multiple = false

const DRAG_CONTEXT = {
  rotateDial: null,
  manualCrop: null,
}
let resultMarqueeFrame = 0
let activeTooltipTarget = null
let tooltipElement = null

document.body.append(fileInput, folderInput, watermarkFileInput)
subscribe(render)
render(getState())
attachGlobalEvents()
window.addEventListener('resize', queueResultMarqueeSync)
bootstrapSettings().finally(() => {
  bootstrapLaunchInputs().finally(() => {
    attachLaunchSubscription()
  })
})

async function bootstrapSettings() {
  try {
    const settings = await loadSettings()
    updateSettings(settings)
    void applyDefaultPresetForTool(getState().activeTool, true)
  } catch {
    // ignore settings bootstrap errors
  }
}

function getDefaultPresetMap() {
  return getState().settings.defaultPresetByTool || {}
}

function createSettingsDialogState() {
  const settings = getState().settings
  return {
    visible: true,
    saveLocationMode: settings.saveLocationMode || 'source',
    saveLocationCustomPath: settings.saveLocationCustomPath || settings.defaultSavePath || '',
    settingsSelectOpen: false,
  }
}

function openSettingsDialog() {
  setSettingsDialog(createSettingsDialogState())
}

function closeSettingsDialog() {
  setSettingsDialog(null)
}

function updateSettingsDialog(patch) {
  const current = getState().settingsDialog
  if (!current) return
  setSettingsDialog({ ...current, ...patch })
}

function normalizeLoadedPresets(presets = []) {
  return (Array.isArray(presets) ? presets : []).map((preset, index) => ({
    id: String(preset?.id || `preset-${index + 1}`),
    name: String(preset?.name || `预设 ${index + 1}`),
    config: preset?.config && typeof preset.config === 'object' ? preset.config : preset || {},
    createdAt: preset?.createdAt || '',
  }))
}

async function ensureToolPresetsLoaded(toolId, force = false) {
  const cached = getState().presetsByTool?.[toolId]
  if (!force && Array.isArray(cached)) return cached
  const presets = normalizeLoadedPresets(await loadPresets(toolId))
  setToolPresets(toolId, presets)
  return presets
}

function closePresetDialog() {
  setPresetDialog(null)
}

function openConfirmDialog(dialog) {
  setConfirmDialog({ visible: true, ...dialog })
}

function closeConfirmDialog() {
  setConfirmDialog(null)
}

function updatePresetDialog(patch) {
  const current = getState().presetDialog
  if (!current) return
  setPresetDialog({ ...current, ...patch })
}

function normalizeMeasureToggleValue(value, nextUnit) {
  const raw = String(value ?? '').trim()
  if (!raw) return nextUnit === '%' ? '%' : 'px'
  const numeric = raw.replace(/(px|%)$/i, '').trim()
  if (!numeric) return nextUnit === '%' ? '%' : 'px'
  return nextUnit === '%' ? `${numeric}%` : `${numeric}px`
}

async function applyDefaultPresetForTool(toolId, silent = false) {
  const defaultPresetId = getDefaultPresetMap()?.[toolId]
  if (!defaultPresetId) return false
  const presets = await ensureToolPresetsLoaded(toolId)
  const preset = presets.find((item) => item.id === defaultPresetId)
  if (!preset?.config) return false
  updateConfig(toolId, preset.config)
  if (!silent) notify({ type: 'success', message: `已应用默认预设：${preset.name}` })
  return true
}

async function saveSettingsFromDialog() {
  const dialog = getState().settingsDialog
  if (!dialog) return
  if (dialog.saveLocationMode === 'custom' && !String(dialog.saveLocationCustomPath || '').trim()) {
    notify({ type: 'info', message: '请先选择自定义保存目录。' })
    return
  }
  const payload = {
    saveLocationMode: dialog.saveLocationMode || 'source',
    saveLocationCustomPath: dialog.saveLocationCustomPath || '',
  }
  const settings = await saveSettings(payload)
  updateSettings(settings)
  closeSettingsDialog()
  notify({ type: 'success', message: '已保存默认图片保存位置。' })
}

async function chooseSettingsCustomPath() {
  const selected = await openInputDialog({
    title: '选择默认保存目录',
    properties: ['openDirectory'],
  })
  const paths = Array.isArray(selected?.filePaths) ? selected.filePaths : Array.isArray(selected) ? selected : []
  if (!paths.length) return
  updateSettingsDialog({ saveLocationMode: 'custom', saveLocationCustomPath: String(paths[0] || '') })
}

async function openApplyPresetDialog(toolId) {
  const presets = await ensureToolPresetsLoaded(toolId)
  setPresetDialog({
    visible: true,
    mode: 'apply',
    toolId,
    name: '',
    selectedPresetId: presets[0]?.id || '',
    setAsDefault: false,
  })
}

function openSavePresetDialog(toolId) {
  setPresetDialog({
    visible: true,
    mode: 'save',
    toolId,
    name: '',
    selectedPresetId: '',
    setAsDefault: false,
  })
}

function openRenamePresetDialog(toolId, preset) {
  setPresetDialog({
    visible: true,
    mode: 'rename',
    toolId,
    name: preset?.name || '',
    selectedPresetId: preset?.id || '',
    setAsDefault: false,
  })
}

async function confirmSavePresetDialog() {
  const dialog = getState().presetDialog
  if (!dialog?.toolId) return
  const liveName = document.querySelector('[data-action="change-preset-name"]')?.value
  const name = String(liveName ?? dialog.name ?? '').trim()
  if (!name) {
    notify({ type: 'info', message: '请先输入预设名称。' })
    return
  }
  const presets = normalizeLoadedPresets(await savePreset(dialog.toolId, {
    name,
    config: getState().configs[dialog.toolId],
  }))
  setToolPresets(dialog.toolId, presets)
  const savedPreset = presets[presets.length - 1]
  if (dialog.setAsDefault && savedPreset?.id) {
    const settings = await saveSettings({
      defaultPresetByTool: {
        ...getDefaultPresetMap(),
        [dialog.toolId]: savedPreset.id,
      },
    })
    updateSettings(settings)
  }
  setPresetDialog({
    visible: true,
    mode: 'apply',
    toolId: dialog.toolId,
    name: '',
    selectedPresetId: dialog.selectedPresetId,
    setAsDefault: false,
  })
  notify({ type: 'success', message: `已保存预设：${name}` })
}

async function confirmRenamePresetDialog() {
  const dialog = getState().presetDialog
  if (!dialog?.toolId || !dialog.selectedPresetId) return
  const liveName = document.querySelector('[data-action="change-preset-name"]')?.value
  const name = String(liveName ?? dialog.name ?? '').trim()
  if (!name) {
    notify({ type: 'info', message: '请先输入预设名称。' })
    return
  }
  const presets = normalizeLoadedPresets(await renamePreset(dialog.toolId, dialog.selectedPresetId, name))
  setToolPresets(dialog.toolId, presets)
  if (dialog.setAsDefault) {
    const settings = await saveSettings({
      defaultPresetByTool: {
        ...getDefaultPresetMap(),
        [dialog.toolId]: dialog.selectedPresetId,
      },
    })
    updateSettings(settings)
  }
  setPresetDialog({
    visible: true,
    mode: 'apply',
    toolId: dialog.toolId,
    name: '',
    selectedPresetId: dialog.selectedPresetId,
    setAsDefault: false,
  })
  notify({ type: 'success', message: `已重命名预设：${name}` })
}

async function confirmApplyPresetDialog() {
  const dialog = getState().presetDialog
  if (!dialog?.toolId || !dialog.selectedPresetId) return
  const presets = await ensureToolPresetsLoaded(dialog.toolId)
  const preset = presets.find((item) => item.id === dialog.selectedPresetId)
  if (!preset?.config) {
    notify({ type: 'error', message: '未找到要应用的预设。' })
    return
  }
  updateConfig(dialog.toolId, preset.config)
  if (dialog.setAsDefault) {
    const settings = await saveSettings({
      defaultPresetByTool: {
        ...getDefaultPresetMap(),
        [dialog.toolId]: preset.id,
      },
    })
    updateSettings(settings)
  }
  closePresetDialog()
  notify({ type: 'success', message: `已应用预设：${preset.name}` })
}

async function removeSelectedPreset() {
  const dialog = getState().presetDialog
  if (!dialog?.toolId || !dialog.selectedPresetId) return
  const presets = getState().presetsByTool?.[dialog.toolId] || []
  const preset = presets.find((item) => item.id === dialog.selectedPresetId)
  if (!preset) return
  const next = normalizeLoadedPresets(await deletePreset(dialog.toolId, dialog.selectedPresetId))
  setToolPresets(dialog.toolId, next)
  const defaultPresetByTool = { ...getDefaultPresetMap() }
  if (defaultPresetByTool[dialog.toolId] === dialog.selectedPresetId) {
    delete defaultPresetByTool[dialog.toolId]
    const settings = await saveSettings({ defaultPresetByTool })
    updateSettings(settings)
  }
  updatePresetDialog({ selectedPresetId: next[0]?.id || '' })
  notify({ type: 'success', message: `已删除预设：${preset.name}` })
}

function confirmDeleteSelectedPreset() {
  const dialog = getState().presetDialog
  if (!dialog?.toolId || !dialog.selectedPresetId) return
  const presets = getState().presetsByTool?.[dialog.toolId] || []
  const preset = presets.find((item) => item.id === dialog.selectedPresetId)
  if (!preset) return
  openConfirmDialog({
    title: '删除预设',
    subtitle: TOOL_MAP[dialog.toolId]?.label || dialog.toolId,
    message: `确认删除预设“${preset.name}”吗？删除后不可恢复。`,
    confirmLabel: '删除',
    confirmAction: 'confirm-delete-selected-preset',
  })
}

function isPreviewSaveTool(toolId) {
  return PREVIEW_SAVE_TOOLS.has(toolId)
}

function isPreviewableTool(toolId) {
  return PREVIEWABLE_TOOLS.has(toolId)
}

function getCurrentDestinationPath() {
  const state = getState()
  return state.destinationPath || state.settings.defaultSavePath || ''
}

function getStagedItemByAssetId(assetId) {
  const state = getState()
  const asset = state.assets.find((item) => item.id === assetId)
  if (!asset?.stagedOutputPath || asset.previewStatus !== 'staged' || asset.stagedToolId !== state.activeTool) return null
  return {
    assetId: asset.id,
    name: asset.name,
    stagedPath: asset.stagedOutputPath,
    outputName: asset.stagedOutputName,
    runId: asset.runId,
    runFolderName: asset.runFolderName,
  }
}

async function saveAssetResult(assetId) {
  const state = getState()
  const stagedItem = getStagedItemByAssetId(assetId)
  if (!stagedItem) {
    notify({ type: 'info', message: '当前图片还没有可保存的处理结果。' })
    return
  }

  setState({ isProcessing: true })
  try {
    const result = await saveStagedResult(state.activeTool, stagedItem, getCurrentDestinationPath())
    if (result?.processed?.length || result?.failed?.length) {
      applyRunResult(result)
      handleResultSaveCompletion()
    }
    notify({ type: result?.ok ? 'success' : result?.partial ? 'info' : 'error', message: result?.message || '保存失败。' })
  } catch (error) {
    notify({ type: 'error', message: error?.message || '保存失败。' })
  } finally {
    setState({ isProcessing: false })
  }
}

async function saveAllCurrentResults() {
  const state = getState()
  const stagedItems = buildStagedItems(state.assets).filter((item) => item.runFolderName && item.toolId === state.activeTool)
  if (!stagedItems.length) {
    notify({ type: 'info', message: '当前没有可批量保存的处理结果。' })
    return
  }

  setState({ isProcessing: true })
  try {
    const result = await saveAllStagedResults(state.activeTool, stagedItems, getCurrentDestinationPath())
    if (result?.processed?.length || result?.failed?.length) {
      applyRunResult(result)
      handleResultSaveCompletion()
    }
    notify({ type: result?.ok ? 'success' : result?.partial ? 'info' : 'error', message: result?.message || '批量保存失败。' })
  } catch (error) {
    notify({ type: 'error', message: error?.message || '批量保存失败。' })
  } finally {
    setState({ isProcessing: false })
  }
}

async function resolveWatermarkImagePath(file) {
  if (!file) return ''
  const directPath = file.path || file.filePath || file.webkitRelativePath || ''
  if (directPath) return directPath
  try {
    const [resolvedPath] = await resolveInputPaths([file])
    if (resolvedPath) return resolvedPath
  } catch {
    // fall through to data url
  }

  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => resolve('')
    reader.readAsDataURL(file)
  })
}

async function openSavedOutput(assetId) {
  const asset = getState().assets.find((item) => item.id === assetId)
  const targetPath = asset ? (getSavedOutputPath(asset) || getPreviewOutputPath(asset) || asset.outputPath || asset.sourcePath) : ''
  if (!targetPath) {
    notify({ type: 'info', message: '当前还没有可打开的结果目录。' })
    return
  }
  const ok = await revealPath(targetPath)
  if (!ok) {
    notify({ type: 'error', message: `打开结果目录失败：${targetPath}` })
  }
}

async function openResultPath(targetPath) {
  if (!targetPath) return
  const ok = await revealPath(targetPath)
  if (!ok) {
    notify({ type: 'error', message: `打开结果目录失败：${targetPath}` })
  }
}

function getReplacePayload(asset, resultPath) {
  const sourcePath = normalizeAssetPath(asset?.sourcePath)
  const outputPath = normalizeAssetPath(resultPath)
  return {
    assetId: asset.id,
    name: asset.name,
    sourcePath,
    savedOutputPath: outputPath,
  }
}

function normalizeAssetPath(value = '') {
  return String(value || '').replaceAll('\\', '/').trim()
}

function clearAssetsResultState(assetIds) {
  const ids = new Set(assetIds)
  const state = getState()
  setState({
    assets: state.assets.map((asset) => {
      if (!ids.has(asset.id)) return asset
      return {
        ...asset,
        previewStatus: 'idle',
        previewUrl: '',
        stagedOutputPath: '',
        stagedOutputName: '',
        stagedSizeBytes: 0,
        stagedWidth: 0,
        stagedHeight: 0,
        savedOutputPath: '',
        outputPath: '',
        runId: '',
        runFolderName: '',
        stagedToolId: '',
        saveSignature: '',
      }
    }),
  })
}

function buildResultViewItem(asset) {
  const resultSizeBytes = asset.stagedSizeBytes || asset.sizeBytes || 0
  const resultWidth = asset.stagedWidth || asset.width || 0
  const resultHeight = asset.stagedHeight || asset.height || 0
  const outputPath = getSavedOutputPath(asset) || getPreviewOutputPath(asset) || ''
  return {
    assetId: asset.id,
    name: asset.name,
    outputPath,
    source: {
      name: asset.name || '',
      sizeBytes: asset.sizeBytes || 0,
      width: asset.width || 0,
      height: asset.height || 0,
    },
    result: {
      name: getResultFileName(asset, outputPath),
      sizeBytes: resultSizeBytes,
      width: resultWidth,
      height: resultHeight,
    },
    summary: getPreviewMessage(asset),
  }
}

function getResultFileName(asset, outputPath) {
  const normalized = String(outputPath || '').replaceAll('\\', '/')
  const fileName = normalized.split('/').pop()
  return fileName || asset.name || ''
}

function formatDimensions(width = 0, height = 0) {
  return `${width || '—'} × ${height || '—'}`
}

function hasVisibleResultComparison() {
  return !!getState().resultView?.items?.length
}

function refreshResultView() {
  const state = getState()
  const items = state.assets
    .filter((asset) => getSavedOutputPath(asset) || getPreviewOutputPath(asset))
    .map(buildResultViewItem)
    .filter((item) => item.outputPath)

  if (!items.length) {
    setResultView(null)
    return
  }

  setResultView({
    runId: state.activeRun?.runId || '',
    toolId: state.activeTool,
    mode: state.activeRun?.mode || 'save',
    items,
    failed: [],
    createdAt: Date.now(),
  })
}

function syncResultUiAfterSave() {
  refreshResultView()
}

function syncResultUiAfterReplace(assetIds = []) {
  clearAssetsResultState(assetIds)
  refreshResultView()
}

function updateResultUiAfterProcess() {
  refreshResultView()
}

function handleResultSaveCompletion() {
  syncResultUiAfterSave()
}

function handleResultProcessCompletion() {
  updateResultUiAfterProcess()
}

function handleResultReplaceCompletion(processed) {
  syncResultUiAfterReplace((processed || []).map((item) => item.assetId).filter(Boolean))
}

function updateColorPreview(toolId, key, value) {
  updateConfig(toolId, { [key]: value })
}

function normalizeColorInputValue(value = '') {
  const text = String(value || '').trim().toUpperCase()
  return /^#([0-9A-F]{6})$/.test(text) ? text : ''
}

function syncColorTextInput(target) {
  const wrapper = target.closest('.color-field')
  const mirror = wrapper?.querySelector('.color-field__value')
  const value = target.value.toUpperCase()
  if (mirror) mirror.value = value
}

function syncResultMarquees() {
  document.querySelectorAll('.result-strip__value, .result-strip__meta').forEach((node) => {
    const marquee = node.querySelector('.result-strip__marquee')
    if (!marquee) return
    node.classList.toggle('is-marquee', marquee.scrollWidth > node.clientWidth + 1)
  })
}

function queueResultMarqueeSync() {
  if (resultMarqueeFrame) cancelAnimationFrame(resultMarqueeFrame)
  resultMarqueeFrame = requestAnimationFrame(() => {
    resultMarqueeFrame = 0
    syncResultMarquees()
  })
}

function openColorPickerZoom(target) {
  const field = target.closest('.color-field')
  const nativeInput = field?.querySelector('.color-field__native')
  if (!nativeInput) return
  nativeInput.showPicker?.()
  if (!nativeInput.showPicker) nativeInput.click()
}

function handleColorMagnifierAction(target) {
  openColorPickerZoom(target)
}


function isResultViewOpen() {
  return !!getState().resultView?.items?.length
}

function shouldShowResultActions() {
  const activeRun = getState().activeRun
  const hasBatchRun = activeRun && activeRun.mode !== 'preview-only'
  return !!hasBatchRun || isResultViewOpen()
}

function shouldKeepResultToolbar() {
  return shouldShowResultActions()
}

function clearResultOnlyView() {
  setResultView(null)
}

function closeResultWorkspace() {
  clearResultOnlyView()
}

function closeResultView() {
  closeResultWorkspace()
}

function ensureResultViewVisible() {
  if (getState().resultView?.items?.length) return true
  refreshResultView()
  return !!getState().resultView?.items?.length
}

function showResultComparison() {
  const visible = ensureResultViewVisible()
  if (visible) closePreviewModal()
  return visible
}

function clearAllResultOverlays() {
  closePreviewModal()
}

function clearResultUiAfterToolChange() {
  clearAllResultOverlays()
  closeResultWorkspace()
  setState({ activeRun: null })
}

function resetResultUiState() {
  clearAllResultOverlays()
  closeResultWorkspace()
  setState({ activeRun: null })
}

function openResultComparisonPath(targetPath) {
  return openResultPath(targetPath)
}

function continueProcessing() {
  clearAllResultOverlays()
  setResultView(null)
  setState({ activeRun: null })
}

function getResultToolbarLabel() {
  return hasVisibleResultComparison() ? '打开目录' : '显示结果'
}

function buildResultActions() {
  if (!shouldKeepResultToolbar()) return ''
  return `
    <div class="result-toolbar">
      <button class="secondary-button" data-action="continue-processing">继续处理</button>
      <button class="secondary-button" data-action="replace-current-originals">替换原图</button>
      <button class="primary-button" data-action="open-current-results">${getResultToolbarLabel()}</button>
    </div>
  `
}

function injectResultToolbar() {
  const shell = document.querySelector('.app-shell')
  if (!shell) return
  const existing = shell.querySelector('.result-toolbar')
  if (existing) existing.remove()
  if (!shouldKeepResultToolbar()) return
  shell.insertAdjacentHTML('beforeend', buildResultActions())
}

async function replaceAssetOriginal(assetId) {
  const asset = getState().assets.find((item) => item.id === assetId)
  if (!asset) return
  const resultPath = getSavedOutputPath(asset) || getPreviewOutputPath(asset)
  if (!resultPath) {
    notify({ type: 'info', message: '当前图片还没有可替换回原图的处理结果。' })
    return
  }
  if (!window.confirm(`确认用处理结果覆盖原图？\n\n${asset.name}`)) return

  setState({ isProcessing: true })
  try {
    const result = await replaceOriginals([getReplacePayload(asset, resultPath)])
    if (result?.processed?.length) {
      handleResultReplaceCompletion(result.processed)
    }
    notify({ type: result?.ok ? 'success' : result?.partial ? 'info' : 'error', message: result?.message || '替换原图失败。' })
  } catch (error) {
    notify({ type: 'error', message: error?.message || '替换原图失败。' })
  } finally {
    setState({ isProcessing: false })
  }
}

async function openCurrentResultsDirectory() {
  if (!hasVisibleResultComparison()) {
    const visible = showResultComparison()
    if (visible) return
  }
  const asset = getState().assets.find((item) => getSavedOutputPath(item) || getPreviewOutputPath(item))
  if (!asset) {
    notify({ type: 'info', message: '当前没有可打开的结果目录。' })
    return
  }
  await openSavedOutput(asset.id)
}

async function replaceCurrentOriginals() {
  const assets = getState().assets.filter((item) => (getSavedOutputPath(item) || getPreviewOutputPath(item)) && item.sourcePath)
  if (!assets.length) {
    notify({ type: 'info', message: '当前没有可替换的处理结果。' })
    return
  }
  if (!window.confirm(`确认用处理结果覆盖 ${assets.length} 张原图？此操作不可撤销。`)) return

  setState({ isProcessing: true })
  try {
    const result = await replaceOriginals(assets.map((asset) => getReplacePayload(asset, getSavedOutputPath(asset) || getPreviewOutputPath(asset))))
    if (result?.processed?.length) {
      handleResultReplaceCompletion(result.processed)
    }
    notify({ type: result?.ok ? 'success' : result?.partial ? 'info' : 'error', message: result?.message || '替换原图失败。' })
  } catch (error) {
    notify({ type: 'error', message: error?.message || '替换原图失败。' })
  } finally {
    setState({ isProcessing: false })
  }
}


async function persistDefaultSavePath() {
  const defaultSavePath = window.prompt('默认保存路径', getState().settings.defaultSavePath || getState().destinationPath || '')
  if (defaultSavePath == null) return
  const settings = await saveSettings({ defaultSavePath: defaultSavePath.trim() })
  updateSettings(settings)
  notify({ type: 'success', message: settings.defaultSavePath ? '已保存默认保存路径。' : '已清空默认保存路径。' })
}

function getPreviewMessage(asset) {
  const toolId = getState().activeTool
  const previewStatus = asset.stagedToolId === toolId ? asset.previewStatus : 'idle'
  if (previewStatus === 'previewed') {
    return `预览结果：${truncate(asset.name, 20)} · ${formatBytes(asset.stagedSizeBytes)} · ${asset.stagedWidth || '—'}×${asset.stagedHeight || '—'}`
  }
  if (previewStatus === 'staged') {
    return `待保存结果：${truncate(asset.name, 20)} · ${formatBytes(asset.stagedSizeBytes)} · ${asset.stagedWidth || '—'}×${asset.stagedHeight || '—'}`
  }
  if (previewStatus === 'saved') {
    return `已保存：${truncate(asset.name, 20)} · ${asset.savedOutputPath || asset.outputPath}`
  }
  if (previewStatus === 'stale') {
    return `当前结果已过期，请重新预览或重新处理：${truncate(asset.name, 20)}`
  }
  return `这张图片还没预览：${truncate(asset.name, 20)} · ${describeToolConfig(toolId, getState().configs[toolId])}`
}

function openPreviewModal(asset) {
  if (!asset?.previewUrl) {
    notify({ type: 'info', message: getPreviewMessage(asset) })
    return false
  }
  setPreviewModal({
    name: asset.name,
    url: asset.previewUrl,
    beforeUrl: asset.thumbnailUrl || asset.previewUrl,
    afterUrl: asset.previewUrl,
    summary: getPreviewMessage(asset),
  })
  return true
}

function closePreviewModal() {
  setPreviewModal(null)
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function isSettingsAction(action) {
  return action === 'open-settings' || action === 'save-default-path'
}

function getProcessRunner(toolId) {
  return isPreviewSaveTool(toolId)
    ? (configToolId, config, assets, destinationPath) => stageToolPreview(configToolId, config, assets, destinationPath, 'preview-save')
    : runTool
}

function getPreviewRunner(toolId) {
  return isPreviewableTool(toolId)
    ? (configToolId, config, assets, destinationPath) => stageToolPreview(configToolId, config, assets, destinationPath, 'preview-only')
    : runTool
}

function shouldReusePreviewResult(toolId, asset) {
  if (!isPreviewableTool(toolId)) return false
  if (asset?.stagedToolId !== toolId) return false
  if (!asset?.previewUrl) return false
  const signature = JSON.stringify({ toolId, config: getState().configs[toolId] })
  if (asset?.saveSignature && asset.saveSignature !== signature) return false
  return ['previewed', 'staged', 'saved'].includes(asset.previewStatus)
}

function mapPreviewResultToAsset(asset, processed, toolId) {
  if (!processed) return asset
  return {
    ...asset,
    previewUrl: processed.previewUrl || processed.outputPath || asset.previewUrl,
    stagedSizeBytes: processed.outputSizeBytes || asset.stagedSizeBytes || 0,
    stagedWidth: processed.width || asset.stagedWidth || 0,
    stagedHeight: processed.height || asset.stagedHeight || 0,
    previewStatus: processed.previewStatus || (isPreviewSaveTool(toolId) ? 'previewed' : 'saved'),
    stagedToolId: toolId,
    savedOutputPath: processed.savedOutputPath || processed.outputPath || asset.savedOutputPath || '',
    outputPath: processed.outputPath || asset.outputPath || '',
  }
}

function getPreviewedAssetFromResult(assetId, toolId, fallbackAsset, result) {
  const nextAsset = getState().assets.find((item) => item.id === assetId)
  if (nextAsset?.previewUrl) return nextAsset
  const processed = (result?.processed || []).find((item) => item.assetId === assetId)
  return mapPreviewResultToAsset(fallbackAsset, processed, toolId)
}

async function runAssetPreview(tool, asset) {
  const state = getState()
  const runner = getPreviewRunner(tool.id)
  const result = await runner(tool.id, state.configs[tool.id], [asset], getCurrentDestinationPath())
  if (result?.processed?.length || result?.failed?.length) {
    applyRunResult(result)
  }
  if (result?.ok || result?.partial) {
    return getPreviewedAssetFromResult(asset.id, tool.id, asset, result)
  }
  throw new Error(result?.message || '预览失败。')
}

async function openProcessedPreview(tool, asset) {
  const previewedAsset = await runAssetPreview(tool, asset)
  if (openPreviewModal(previewedAsset)) {
    return true
  }
  throw new Error('预览结果生成成功，但无法打开处理后的图片。')
}

function isDirectPreviewTool(toolId) {
  return isPreviewableTool(toolId) && !isPreviewSaveTool(toolId)
}

function getNonSavePreviewSuccessMessage(tool) {
  return `${tool.label} 预览已生成。`
}

function isMergePreviewTool(toolId) {
  return ['merge-pdf', 'merge-image', 'merge-gif'].includes(toolId)
}

function shouldOpenRealPreview(toolId) {
  return isPreviewableTool(toolId) && !isMergePreviewTool(toolId)
}

function getPreviewPlaceholderMessage(tool, asset) {
  return `${tool.label} 暂不支持当前预览：${truncate(asset.name, 20)}`
}

function getPreviewOpenError(tool) {
  return `${tool?.label || '当前工具'} 预览结果无法打开。`
}

function getPreviewAssetAfterRun(assetId, toolId, asset, result) {
  const nextAsset = getState().assets.find((item) => item.id === assetId)
  if (nextAsset?.previewUrl) return nextAsset
  const processed = (result?.processed || []).find((item) => item.assetId === assetId)
  return mapPreviewResultToAsset(asset, processed, toolId)
}

function notifyPreviewReady(tool) {
  notify({ type: 'success', message: getNonSavePreviewSuccessMessage(tool) })
}

function notifyPreviewUnavailable(tool, asset) {
  notify({ type: 'info', message: getPreviewPlaceholderMessage(tool, asset) })
}

function openExistingPreview(toolId, asset) {
  if (shouldReusePreviewResult(toolId, asset) && openPreviewModal(asset)) {
    return true
  }
  return false
}

function maybeNotifyDirectPreviewReady(tool) {
  if (isDirectPreviewTool(tool.id)) {
    notifyPreviewReady(tool)
  }
}

function getPreviewAssetLabel(asset) {
  return truncate(asset?.name || '当前图片', 20)
}

function createPreviewUnavailableMessage(tool, asset) {
  return `${tool.label} 暂不支持预览：${getPreviewAssetLabel(asset)}`
}

function notifyUnsupportedPreview(tool, asset) {
  notify({ type: 'info', message: createPreviewUnavailableMessage(tool, asset) })
}

function shouldUseUnsupportedPreview(toolId) {
  return !shouldOpenRealPreview(toolId) && !isMergePreviewTool(toolId)
}

async function executePreviewRunner(toolId, config, assets, destinationPath) {
  return getPreviewRunner(toolId)(toolId, config, assets, destinationPath)
}

async function previewWithRunner(tool, asset) {
  const state = getState()
  const result = await executePreviewRunner(tool.id, state.configs[tool.id], [asset], getCurrentDestinationPath())
  if (result?.processed?.length || result?.failed?.length) {
    applyRunResult(result)
  }
  if (!(result?.ok || result?.partial)) {
    throw new Error(result?.message || '预览失败。')
  }
  const previewedAsset = getPreviewAssetAfterRun(asset.id, tool.id, asset, result)
  if (!openPreviewModal(previewedAsset)) {
    throw new Error(getPreviewOpenError(tool))
  }
  maybeNotifyDirectPreviewReady(tool)
}

async function previewAssetWithTool(tool, asset) {
  if (openExistingPreview(tool.id, asset)) return
  if (!shouldOpenRealPreview(tool.id)) {
    if (isMergePreviewTool(tool.id)) {
      notifyPreviewUnavailable(tool, asset)
      return
    }
    notifyUnsupportedPreview(tool, asset)
    return
  }
  await previewWithRunner(tool, asset)
}

function createToolPreviewFailure(error, tool) {
  return error?.message || `${tool.label} 预览失败。`
}

function notifyToolPreviewFailure(error, tool) {
  notify({ type: 'error', message: createToolPreviewFailure(error, tool) })
}


function getProcessSuccessMessage(result, tool) {
  if (result?.message) return result.message
  return isPreviewSaveTool(tool.id) ? `已生成 ${tool.label} 结果，确认后可保存。` : `已触发 ${tool.label} 批处理。`
}

function getProcessFallbackMessage(tool, assetCount) {
  const summary = describeToolConfig(tool.id, getState().configs[tool.id])
  return `处理占位：${tool.label} · ${assetCount} 张 · ${summary}`
}

function getAssetsForTool(toolId, assets) {
  if (toolId !== 'manual-crop') return assets
  return assets.filter((asset) => getState().configs['manual-crop'].completedIds.includes(asset.id))
}

function findNextManualCropIndex(config, assets, startIndex) {
  if (!assets.length) return 0
  const handled = new Set([...(config.completedIds || []), ...(config.skippedIds || [])])
  for (let index = startIndex; index < assets.length; index += 1) {
    if (!handled.has(assets[index].id)) return index
  }
  for (let index = 0; index < startIndex; index += 1) {
    if (!handled.has(assets[index].id)) return index
  }
  return Math.min(startIndex, assets.length - 1)
}

function shouldUseBulkSaveAction(action) {
  return action === 'save-all-results'
}

function shouldUseSingleSaveAction(action) {
  return action === 'save-asset-result'
}

function shouldPreviewAssetAction(action) {
  return action === 'preview-asset'
}

function shouldProcessCurrentAction(action) {
  return action === 'process-current'
}

function shouldHandlePresetAction(action) {
  return action === 'save-preset'
}

function shouldOpenFileInputAction(action) {
  return action === 'open-file-input' || action === 'pick-demo'
}

function shouldOpenFolderInputAction(action) {
  return action === 'open-folder-input'
}

function shouldRemoveAssetAction(action) {
  return action === 'remove-asset'
}

function shouldMoveAssetAction(action) {
  return action === 'move-asset'
}

function shouldActivateToolAction(action) {
  return action === 'activate-tool'
}

function shouldDragRotateAction(action) {
  return action === 'drag-rotate'
}

function shouldToggleConfigAction(action) {
  return action === 'toggle-config'
}

function shouldSetConfigAction(action) {
  return action === 'set-config'
}

function shouldApplyResizePresetAction(action) {
  return action === 'apply-resize-preset'
}

function shouldSetManualCropRatioAction(action) {
  return action === 'set-manual-crop-ratio'
}

function isUtilityTool(toolId) {
  return toolId === SETTINGS_TOOL_ID
}

function createSettingsToolResult() {
  return { ok: true, partial: false, processed: [], failed: [], message: '设置已更新。' }
}

function processUtilityTool(toolId) {
  if (!isUtilityTool(toolId)) return null
  openSettingsDialog()
  return createSettingsToolResult()
}

function getConfiguredToolSummary(tool) {
  return describeToolConfig(tool.id, getState().configs[tool.id])
}

function getDefaultSavePathLabel() {
  return getState().settings.defaultSavePath || '未设置'
}

function maybeHandleSaveActions(action, target) {
  if (shouldUseSingleSaveAction(action)) {
    void saveAssetResult(target.dataset.assetId)
    return true
  }
  if (shouldUseBulkSaveAction(action)) {
    void saveAllCurrentResults()
    return true
  }
  return false
}

function maybeHandlePreviewAction(action, target) {
  if (!shouldPreviewAssetAction(action)) return false
  const tool = TOOL_MAP[getState().activeTool]
  const asset = getState().assets.find((item) => item.id === target.dataset.assetId)
  if (!asset) {
    notify({ type: 'error', message: '未找到要预览的图片。' })
    return true
  }
  if (tool && isPreviewableTool(tool.id)) {
    void previewAsset(asset.id)
    return true
  }
  if (tool) {
    notifyPreviewUnavailable(tool, asset)
  }
  return true
}

function maybeHandleProcessAction(action) {
  if (!shouldProcessCurrentAction(action)) return false
  void processCurrentTool()
  return true
}

function maybeHandlePresetAction(action, target) {
  if (!shouldHandlePresetAction(action)) return false
  const toolId = target.dataset.toolId
  void savePreset(toolId, getState().configs[toolId]).then(() => {
    notify({ type: 'success', message: `已保存 ${toolId} 预设。` })
  })
  return true
}

function maybeHandleOpenInputActions(action) {
  if (shouldOpenFileInputAction(action)) {
    fileInput.click()
    return true
  }
  if (shouldOpenFolderInputAction(action)) {
    folderInput.click()
    return true
  }
  return false
}

function maybeHandleBasicAssetActions(action, target) {
  if (shouldRemoveAssetAction(action)) {
    removeAsset(target.dataset.assetId)
    return true
  }
  if (shouldMoveAssetAction(action)) {
    moveAsset(target.dataset.assetId, target.dataset.direction)
    return true
  }
  return false
}

function maybeHandleToolActions(action, target, event) {
  if (shouldActivateToolAction(action)) {
    setActiveTool(target.dataset.toolId)
    return true
  }
  if (shouldDragRotateAction(action)) {
    beginRotateDrag(event, target)
    return true
  }
  return false
}

function maybeHandleConfigActions(action, target) {
  if (action === 'set-config' && target.dataset.toolId === 'crop' && target.dataset.key === 'ratio') {
    const ratio = parseValue(target.dataset.value)
    updateConfig('crop', { ratio, useCustomRatio: ratio === 'Custom' })
    closeConfigSelect(target)
    return true
  }
  if (shouldSetConfigAction(action)) {
    updateConfig(target.dataset.toolId, { [target.dataset.key]: parseValue(target.dataset.value) })
    closeConfigSelect(target)
    return true
  }
  if (shouldApplyResizePresetAction(action)) {
    updateConfig('resize', {
      width: target.dataset.width,
      height: target.dataset.height,
    })
    return true
  }
  if (shouldSetManualCropRatioAction(action)) {
    updateConfig('manual-crop', {
      ratio: target.dataset.label,
      ratioValue: target.dataset.value,
    })
    return true
  }
  return false
}

function closeConfigSelect(target) {
  const shell = target?.closest?.('.select-shell')
  if (!shell) return
  shell.classList.remove('is-open')
  const trigger = shell.querySelector('.select-shell__value')
  if (trigger) trigger.setAttribute('aria-expanded', 'false')
}

function closeAllConfigSelects(exceptShell = null) {
  document.querySelectorAll('.select-shell.is-open').forEach((shell) => {
    if (exceptShell && shell === exceptShell) return
    shell.classList.remove('is-open')
    const trigger = shell.querySelector('.select-shell__value')
    if (trigger) trigger.setAttribute('aria-expanded', 'false')
  })
}

function toggleConfigSelect(target) {
  const shell = target?.closest?.('.select-shell')
  if (!shell) return
  const willOpen = !shell.classList.contains('is-open')
  closeAllConfigSelects(shell)
  shell.classList.toggle('is-open', willOpen)
  target.setAttribute('aria-expanded', willOpen ? 'true' : 'false')
}

function getDestinationSummaryMessage() {
  const defaultSavePath = getState().settings.defaultSavePath || ''
  return defaultSavePath ? `默认保存路径：${defaultSavePath}` : '未设置默认保存路径，将按源目录生成输出目录。'
}

function notifyDestinationSummary() {
  notify({ type: 'info', message: getDestinationSummaryMessage() })
}

function maybeHandleOpenSettingsAction(action) {
  if (action !== 'open-settings') return false
  notifyDestinationSummary()
  openSettingsDialog()
  return true
}

function shouldShortCircuitClickAction(action, target, event) {
  return maybeHandleOpenSettingsAction(action)
    || maybeHandleSaveActions(action, target)
    || maybeHandleBasicAssetActions(action, target)
    || maybeHandlePreviewAction(action, target)
    || maybeHandleProcessAction(action)
    || maybeHandleOpenInputActions(action)
    || maybeHandlePresetAction(action, target)
    || maybeHandleToolActions(action, target, event)
    || maybeHandleConfigActions(action, target)
}

function hasStagedOutput(asset) {
  return !!asset?.stagedOutputPath
}

function canSaveAsset(asset) {
  return hasStagedOutput(asset) && asset.previewStatus === 'staged'
}

function notifyStalePreview() {
  notify({ type: 'info', message: '当前预览已过期，请重新处理后再保存。' })
}

function notifyNoPreviewToSave() {
  notify({ type: 'info', message: '当前没有可保存的处理结果。' })
}

function ensureSavableAsset(asset) {
  if (!asset) return 'missing'
  if (asset.previewStatus === 'stale') return 'stale'
  if (!canSaveAsset(asset)) return 'empty'
  return 'ready'
}

function handleSavableAssetState(asset) {
  const state = ensureSavableAsset(asset)
  if (state === 'stale') notifyStalePreview()
  if (state === 'empty') notifyNoPreviewToSave()
  if (state === 'missing') notifyNoPreviewToSave()
  return state === 'ready'
}

function getPreviewSaveAssets() {
  return getState().assets.filter((asset) => asset.previewStatus === 'staged' && asset.stagedOutputPath)
}

function getBulkSaveItems() {
  return buildStagedItems(getPreviewSaveAssets())
}

function normalizeToolLabel(tool) {
  return tool?.label || '当前工具'
}

function getProcessedAssetCount(assets) {
  return assets.length
}

function createSettingsInfoMessage() {
  return `默认保存路径：${getState().settings.defaultSavePath || '未设置'}`
}

function getSelectionSummary(assets) {
  return `${getProcessedAssetCount(assets)} 张`
}

function createProcessMessage(tool, assets) {
  return `${normalizeToolLabel(tool)} · ${getSelectionSummary(assets)} · ${getConfiguredToolSummary(tool)}`
}

function getPreviewStatus(asset) {
  return asset?.previewStatus || 'idle'
}

function shouldUsePreviewSummary(asset) {
  return ['staged', 'saved', 'stale'].includes(getPreviewStatus(asset))
}

function updateCurrentSettings(settings) {
  updateSettings(settings)
}

function shouldNotifyToolExecutionIntro(tool) {
  return !!tool && isPreviewableTool(tool.id)
}

function shouldSaveStagedItem(item) {
  return !!item?.stagedPath
}

function filterSavableItems(items) {
  return items.filter(shouldSaveStagedItem)
}

function getSavableBulkItems() {
  return filterSavableItems(getBulkSaveItems())
}

function createSettingsSuccessMessage(settings) {
  return settings.defaultSavePath ? '已保存默认保存路径。' : '已清空默认保存路径。'
}

function isSettingsPromptCancelled(value) {
  return value == null
}

function normalizeSavePathInput(value) {
  return value.trim()
}

function createSettingsPayload(value) {
  return { defaultSavePath: normalizeSavePathInput(value) }
}

function getSettingsPromptDefaultValue() {
  return getState().settings.defaultSavePath || getState().destinationPath || ''
}

function getPreviewOutputDimensions(asset) {
  return `${asset.stagedWidth || '—'} × ${asset.stagedHeight || '—'}`
}

function getPreviewOutputSummary(asset) {
  return `${formatBytes(asset.stagedSizeBytes)} · ${getPreviewOutputDimensions(asset)}`
}

function getSettingsPromptTitle() {
  return '默认保存路径'
}

function openSettingsPrompt() {
  return window.prompt(getSettingsPromptTitle(), getSettingsPromptDefaultValue())
}

function getPreviewSummary(asset) {
  return getPreviewMessage(asset)
}

function maybeShowPreviewSummary(asset) {
  if (shouldUsePreviewSummary(asset)) {
    notify({ type: 'info', message: getPreviewSummary(asset) })
    return true
  }
  return false
}

function getSettingsSavedMessage(settings) {
  return createSettingsSuccessMessage(settings)
}

function maybeWarnNoActionableSaveItems() {
  if (!getSavableBulkItems().length) {
    notifyNoPreviewToSave()
    return true
  }
  return false
}

function getPreviewOutputPath(asset) {
  return asset.stagedOutputPath || ''
}

function getSavedOutputPath(asset) {
  return asset.savedOutputPath || ''
}

function maybeHandleAssetPreview(asset) {
  if (!asset) return false
  maybeShowPreviewSummary(asset)
  return true
}

function maybeHandleSingleAssetSave(asset) {
  if (!handleSavableAssetState(asset)) return false
  void saveAssetResult(asset.id)
  return true
}

function maybeHandleSaveAllAction() {
  if (maybeWarnNoActionableSaveItems()) return true
  void saveAllCurrentResults()
  return true
}

function notifyPreviewNotification(asset) {
  notify({ type: 'info', message: getPreviewNotificationMessage(asset) })
}

function maybeHandleExistingPreview(asset) {
  if (!asset) return false
  if (!shouldUsePreviewSummary(asset)) return false
  notifyPreviewNotification(asset)
  return true
}

function canUsePromptApi() {
  return typeof window?.prompt === 'function'
}

function getToolProcessingSummary(tool, assets) {
  return `${normalizeToolLabel(tool)} · ${assets.length} 张 · ${getConfiguredToolSummary(tool)}`
}

function render(state) {
  const snapshot = captureUiSnapshot()
  app.innerHTML = renderAppShell(state) + renderNotifications(state.notifications)
  injectResultToolbar()
  restoreUiSnapshot(snapshot)
  syncCustomTooltips()
  queueResultMarqueeSync()
}

function ensureTooltipElement() {
  if (tooltipElement?.isConnected) return tooltipElement
  tooltipElement = document.createElement('div')
  tooltipElement.className = 'app-tooltip'
  tooltipElement.hidden = true
  document.body.append(tooltipElement)
  return tooltipElement
}

function syncCustomTooltips() {
  document.querySelectorAll('[title]').forEach((node) => {
    const text = String(node.getAttribute('title') || '').trim()
    if (!text) return
    node.dataset.tooltip = text
    if (!node.getAttribute('aria-label') && node.matches('button, [role="button"]')) {
      node.setAttribute('aria-label', text)
    }
    node.removeAttribute('title')
  })
}

function positionTooltip(target) {
  if (!target || !tooltipElement || tooltipElement.hidden) return
  const rect = target.getBoundingClientRect()
  const tooltipRect = tooltipElement.getBoundingClientRect()
  const top = Math.max(8, rect.top - tooltipRect.height - 10)
  const left = Math.min(
    window.innerWidth - tooltipRect.width - 8,
    Math.max(8, rect.left + (rect.width - tooltipRect.width) / 2),
  )
  tooltipElement.style.top = `${top}px`
  tooltipElement.style.left = `${left}px`
}

function showTooltip(target) {
  const text = String(target?.dataset?.tooltip || '').trim()
  if (!text) return
  if (target?.closest?.('.nav-item') && !document.querySelector('.app-shell')?.classList.contains('app-shell--sidebar-collapsed')) {
    return
  }
  activeTooltipTarget = target
  const tooltip = ensureTooltipElement()
  tooltip.textContent = text
  tooltip.hidden = false
  positionTooltip(target)
}

function hideTooltip(target = activeTooltipTarget) {
  if (target && activeTooltipTarget && target !== activeTooltipTarget) return
  activeTooltipTarget = null
  if (tooltipElement) tooltipElement.hidden = true
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
    activeField: activeElement?.matches?.('[data-action][data-tool-id][data-key], [data-role="search-input"], [data-action="change-preset-name"]')
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

  if (descriptor.action === 'change-preset-name') {
    return document.querySelector('[data-action="change-preset-name"]')
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
  document.addEventListener('wheel', (event) => {
    const scroller = event.target.closest('[data-horizontal-scroll]')
    if (!scroller) return
    if (scroller.scrollWidth <= scroller.clientWidth) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) && !event.shiftKey) return
    scroller.scrollLeft += event.shiftKey ? (event.deltaX || event.deltaY) : event.deltaY
    event.preventDefault()
  }, { passive: false })

  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('[data-action]')
    if (!target) return
    const { action } = target.dataset
    if (action === 'drag-color-surface') {
      beginColorPickerDrag(event, target, 'surface')
      return
    }
    if (action === 'drag-color-hue') {
      beginColorPickerDrag(event, target, 'hue')
    }
  })

  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('[data-action]')
    if (!target) return
    if (target.dataset.action === 'drag-rotate') {
      beginRotateDrag(event, target)
      return
    }
    if (target.dataset.action === 'manual-crop-drag' || target.dataset.action === 'manual-crop-resize') {
      beginManualCropDrag(event, target)
    }
  })

  document.addEventListener('mouseover', (event) => {
    const target = event.target.closest('[data-tooltip]')
    if (!target) return
    showTooltip(target)
  })

  document.addEventListener('mouseout', (event) => {
    const target = event.target.closest('[data-tooltip]')
    if (!target) return
    if (event.relatedTarget?.closest?.('[data-tooltip]') === target) return
    hideTooltip(target)
  })

  document.addEventListener('focusin', (event) => {
    const target = event.target.closest('[data-tooltip]')
    if (target) showTooltip(target)
  })

  document.addEventListener('focusout', (event) => {
    const target = event.target.closest('[data-tooltip]')
    if (target) hideTooltip(target)
  })

  document.addEventListener('click', async (event) => {
    const modalRoot = event.target.closest('.preview-modal')
    if (modalRoot && !event.target.closest('[data-action]')) {
      if (!event.target.closest('.preview-modal__dialog')) {
        closePreviewModal()
      }
      return
    }

    if (!event.target.closest('.select-shell')) {
      closeAllConfigSelects()
    }

    const target = event.target.closest('[data-action]')
    if (!target) return

    if (target.matches('.nav-item')) {
      event.preventDefault()
    }

    const { action } = target.dataset

    if (action === 'activate-tool') {
      event.preventDefault()
      clearResultUiAfterToolChange()
      setActiveTool(target.dataset.toolId)
      void applyDefaultPresetForTool(target.dataset.toolId, true)
      return
    }

    if (action === 'close-preview-modal') {
      closePreviewModal()
      return
    }

    if (action === 'close-result-view') {
      closeResultView()
      return
    }

    if (action === 'open-settings' || action === 'save-default-path') {
      openSettingsDialog()
      return
    }

    if (action === 'close-settings-modal') {
      if (event.target.closest('.app-modal__dialog') && !event.target.closest('.app-modal__close')) return
      closeSettingsDialog()
      return
    }

    if (action === 'toggle-sidebar') {
      setState({ sidebarCollapsed: !getState().sidebarCollapsed })
      return
    }

    if (action === 'set-settings-save-mode') {
      updateSettingsDialog({ saveLocationMode: target.dataset.value })
      closeConfigSelect(target)
      return
    }

    if (action === 'pick-settings-custom-path') {
      await chooseSettingsCustomPath()
      return
    }

    if (action === 'save-settings-dialog') {
      await saveSettingsFromDialog()
      return
    }

    if (action === 'toggle-config-select') {
      toggleConfigSelect(target)
      return
    }

    if (action === 'save-all-results') {
      await saveAllCurrentResults()
      return
    }

    if (action === 'save-asset-result') {
      await saveAssetResult(target.dataset.assetId)
      return
    }

    if (action === 'remove-asset') {
      removeAsset(target.dataset.assetId)
      return
    }

    if (action === 'clear-assets') {
      resetResultUiState()
      setState({ assets: [], previewModal: null, resultView: null })
      return
    }

    if (action === 'move-asset') {
      moveAsset(target.dataset.assetId, target.dataset.direction)
      return
    }

    if (action === 'preview-asset') {
      await previewAsset(target.dataset.assetId)
      return
    }

    if (action === 'process-current') {
      await processCurrentTool()
      return
    }

    if (action === 'open-file-input' || action === 'pick-demo') {
      if (typeof window.imgbatch?.showOpenDialog === 'function') {
        await pickInputsFromHost('file')
      } else {
        fileInput.click()
      }
      return
    }

    if (action === 'pick-watermark-image') {
      watermarkFileInput.click()
      return
    }

    if (action === 'continue-processing') {
      continueProcessing()
      return
    }

    if (action === 'replace-current-originals') {
      await replaceCurrentOriginals()
      return
    }

    if (action === 'open-current-results') {
      await openCurrentResultsDirectory()
      return
    }

    if (action === 'open-result-path') {
      await openResultComparisonPath(target.dataset.path)
      return
    }

    if (action === 'open-color-picker') {
      handleColorMagnifierAction(target)
      return
    }

    if (action === 'confirm-native-color') {
      const field = target.closest('.color-field')
      const nativeInput = field?.querySelector('.color-field__native')
      const normalized = normalizeColorInputValue(nativeInput?.value || '')
      if (!normalized) {
        notify({ type: 'info', message: '请先选择有效颜色。' })
        return
      }
      updateColorPreview(target.dataset.toolId, target.dataset.key, normalized)
      syncColorTextInput(nativeInput)
      return
    }

    if (action === 'replace-asset-original') {
      await replaceAssetOriginal(target.dataset.assetId)
      return
    }

    if (action === 'open-asset-result') {
      await openSavedOutput(target.dataset.assetId)
      return
    }

    if (action === 'open-folder-input') {
      if (typeof window.imgbatch?.showOpenDialog === 'function') {
        await pickInputsFromHost('folder')
      } else {
        folderInput.click()
      }
      return
    }

    if (action === 'save-preset') {
      openSavePresetDialog(target.dataset.toolId)
      return
    }

    if (action === 'open-preset-dialog') {
      await openApplyPresetDialog(target.dataset.toolId)
      return
    }

    if (action === 'close-preset-dialog') {
      const clickedInsideDialog = !!event.target.closest('.app-modal__dialog')
      const clickedCloseIcon = !!event.target.closest('.app-modal__close')
      const clickedCancelButton = !!target.closest('.app-modal__footer [data-action="close-preset-dialog"]')
      if (clickedInsideDialog && !clickedCloseIcon && !clickedCancelButton) return
      closePresetDialog()
      return
    }

    if (action === 'close-confirm-dialog') {
      const clickedInsideDialog = !!event.target.closest('.app-modal__dialog')
      const clickedCloseIcon = !!event.target.closest('.app-modal__close')
      const clickedCancelButton = !!target.closest('.app-modal__footer [data-action="close-confirm-dialog"]')
      if (clickedInsideDialog && !clickedCloseIcon && !clickedCancelButton) return
      closeConfirmDialog()
      return
    }

    if (action === 'select-preset') {
      updatePresetDialog({ selectedPresetId: target.dataset.presetId })
      return
    }

    if (action === 'confirm-save-preset') {
      await confirmSavePresetDialog()
      return
    }

    if (action === 'confirm-rename-preset') {
      await confirmRenamePresetDialog()
      return
    }

    if (action === 'confirm-apply-preset') {
      await confirmApplyPresetDialog()
      return
    }

    if (action === 'rename-selected-preset') {
      const presets = getState().presetsByTool?.[target.dataset.toolId || getState().presetDialog?.toolId] || []
      const presetId = getState().presetDialog?.selectedPresetId
      const preset = presets.find((item) => item.id === presetId)
      if (preset) openRenamePresetDialog(getState().presetDialog.toolId, preset)
      return
    }

    if (action === 'delete-selected-preset') {
      confirmDeleteSelectedPreset()
      return
    }

    if (action === 'confirm-delete-selected-preset') {
      closeConfirmDialog()
      await removeSelectedPreset()
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
      closeConfigSelect(target)
      return
    }

    if (action === 'set-measure-unit') {
      const toolId = target.dataset.toolId
      const key = target.dataset.key
      const nextUnit = target.dataset.unit === '%' ? '%' : 'px'
      const input = target.closest('.input-shell')?.querySelector('.text-input')
      const liveValue = input?.value
      const currentValue = getState().configs?.[toolId]?.[key]
      updateConfig(toolId, { [key]: normalizeMeasureToggleValue(liveValue ?? currentValue, nextUnit) })
      return
    }

    if (action === 'set-config') {
      updateConfig(target.dataset.toolId, { [target.dataset.key]: parseValue(target.dataset.value) })
      closeConfigSelect(target)
      return
    }

    if (action === 'apply-resize-preset') {
      updateConfig('resize', {
        width: target.dataset.width,
        height: target.dataset.height,
      })
      return
    }

    if (action === 'set-manual-crop-ratio') {
      const state = getState()
      const config = state.configs['manual-crop']
      const asset = state.assets[config.currentIndex]
      const nextPatch = {
        ratio: target.dataset.label,
        ratioValue: target.dataset.value,
      }
      if (asset) {
        nextPatch.cropAreas = {
          ...(config.cropAreas || {}),
          [asset.id]: createDefaultManualCropArea(asset, target.dataset.value),
        }
      }
      updateConfig('manual-crop', nextPatch)
      return
    }

    if (action === 'toggle-manual-crop-hud') {
      const state = getState()
      const config = state.configs['manual-crop']
      updateConfig('manual-crop', { hudCollapsed: !(config.hudCollapsed !== false) })
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

      const nextIndex = findNextManualCropIndex(
        { ...config, completedIds, skippedIds },
        state.assets,
        Math.min(config.currentIndex + 1, Math.max(state.assets.length - 1, 0)),
      )
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
    if (target.matches('.color-field__picker')) {
      syncColorTextInput(target)
      return
    }

    if (action === 'change-preset-name') {
      const dialog = getState().presetDialog
      if (dialog) dialog.name = target.value
      return
    }

    if (action === 'set-config-range') {
      syncRangeControl(target)
      return
    }

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
    if (target === watermarkFileInput) {
      const file = target.files?.[0]
      const imagePath = await resolveWatermarkImagePath(file)
      if (!imagePath) {
        notify({ type: 'error', message: '读取图片水印文件失败。' })
      } else {
        updateConfig('watermark', { imagePath })
      }
      target.value = ''
      return
    }

    if (target === fileInput || target === folderInput) {
      await handleImport([...target.files])
      target.value = ''
      return
    }

    if (target.matches('[data-role="search-input"]')) {
      setSearchQuery(target.value)
      return
    }

    const action = target.dataset.changeAction || target.dataset.action
    if (action === 'toggle-preset-default') {
      updatePresetDialog({ setAsDefault: !!target.checked })
      return
    }

    if (action === 'set-config-range') {
      commitRangeControl(target)
      return
    }

    if (action === 'set-config-color') {
      const value = target.value.toUpperCase()
      updateColorPreview(target.dataset.toolId, target.dataset.key, value)
      syncColorTextInput(target)
      return
    }

    if (target.matches('.color-field__value')) {
      const normalized = normalizeColorInputValue(target.value)
      if (normalized) {
        updateColorPreview(target.dataset.toolId, target.dataset.key, normalized)
      }
      return
    }

    if ((action === 'set-config-input' || action === 'set-config-select') && target.dataset.toolId === 'crop' && target.dataset.key === 'ratio') {
      const ratio = parseValue(target.value)
      updateConfig('crop', { ratio, useCustomRatio: ratio === 'Custom' })
      return
    }

    if (action === 'set-config-input' || action === 'set-config-select') {
      updateConfig(target.dataset.toolId, { [target.dataset.key]: parseValue(target.value) })
    }
  })

  document.addEventListener('pointermove', (event) => {
    if (DRAG_CONTEXT.rotateDial) {
      handleRotateDrag(event)
      return
    }
    if (DRAG_CONTEXT.manualCrop) {
      handleManualCropDrag(event)
    }
  })

  document.addEventListener('pointerup', () => {
    endRotateDrag()
    endManualCropDrag()
  })

  document.addEventListener('pointercancel', () => {
    endRotateDrag()
    endManualCropDrag()
  })

  window.addEventListener('scroll', () => positionTooltip(activeTooltipTarget), true)
  window.addEventListener('resize', () => {
    positionTooltip(activeTooltipTarget)
    if (activeTooltipTarget) queueResultMarqueeSync()
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

async function pickInputsFromHost(kind) {
  const options = kind === 'folder'
    ? {
        title: '选择图片文件夹',
        properties: ['openDirectory', 'multiSelections'],
      }
    : {
        title: '选择图片',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'avif', 'ico'] },
        ],
      }

  const selected = await openInputDialog(options)
  const paths = Array.isArray(selected?.filePaths)
    ? selected.filePaths
    : Array.isArray(selected)
      ? selected
      : []
  if (paths.length) {
    await handleImport(paths)
  }

  await showMainWindow()
  window.setTimeout(() => {
    void showMainWindow()
    window.focus?.()
  }, 120)
}

async function previewAsset(assetId) {
  const state = getState()
  const asset = state.assets.find((item) => item.id === assetId)
  if (!asset) {
    notify({ type: 'error', message: '未找到要预览的图片。' })
    return
  }

  const tool = TOOL_MAP[state.activeTool]
  if (!tool) return
  if (openExistingPreview(tool.id, asset)) {
    return
  }
  if (!shouldOpenRealPreview(tool.id)) {
    notifyPreviewUnavailable(tool, asset)
    return
  }
  if (state.isProcessing) return

  setState({ isProcessing: true })
  try {
    await previewWithRunner(tool, asset)
  } catch (error) {
    notifyToolPreviewFailure(error, tool)
  } finally {
    setState({ isProcessing: false })
  }
}

async function processCurrentTool() {
  const state = getState()
  const tool = TOOL_MAP[state.activeTool]

  if (!state.assets.length) {
    notify({ type: 'info', message: '请先导入图片，再开始处理。' })
    return
  }

  if (tool.id === 'manual-crop' && !getAssetsForTool(tool.id, state.assets).length) {
    notify({ type: 'info', message: '请先至少标记一张图片，再开始手动裁剪。' })
    return
  }

  if (state.isProcessing) return

  setState({ isProcessing: true })
  try {
    const assets = getAssetsForTool(tool.id, state.assets)
    const runner = getProcessRunner(tool.id)
    const result = await runner(tool.id, state.configs[tool.id], assets, getCurrentDestinationPath())
    if (result?.processed?.length || result?.failed?.length) {
      applyRunResult(result)
    }

    if (result?.ok || result?.partial) {
      notify({ type: result.partial ? 'info' : 'success', message: getProcessSuccessMessage(result, tool) })
      return
    }

    notify({ type: 'info', message: result?.message || getProcessFallbackMessage(tool, assets.length) })
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
    <div style="position:fixed;right:20px;top:92px;display:flex;flex-direction:column;gap:10px;z-index:999;">
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

function syncRangeControl(target) {
  const value = parseValue(target.value)
  const suffix = target.dataset.valueSuffix || ''
  const wrapper = target.closest('.setting-row')
  const valueNode = wrapper?.querySelector('[data-range-value]')
  if (valueNode) valueNode.textContent = `${value}${suffix}`
  target.style.setProperty('--range-progress', `${getRangeProgress(value, target.min, target.max)}%`)
}

function commitRangeControl(target) {
  syncRangeControl(target)
  updateConfig(target.dataset.toolId, { [target.dataset.key]: parseValue(target.value) })
}

function beginRotateDrag(event, target) {
  event.preventDefault()
  const element = target.closest('[data-role="rotate-dial"]')
  if (!element) return
  const rect = element.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const state = getState()
  const rotateConfig = state.configs.rotate || { angle: 0 }
  DRAG_CONTEXT.rotateDial = {
    toolId: target.dataset.toolId,
    pointerId: event.pointerId,
    centerX,
    centerY,
    lastAngle: Number(rotateConfig.angle) || 0,
  }
  target.setPointerCapture?.(event.pointerId)
  handleRotateDrag(event)
}

function handleRotateDrag(event) {
  const context = DRAG_CONTEXT.rotateDial
  if (!context) return
  if (context.pointerId != null && event.pointerId != null && event.pointerId !== context.pointerId) return
  const dx = event.clientX - context.centerX
  const dy = event.clientY - context.centerY
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return
  const radians = Math.atan2(dy, dx)
  const signedDegrees = Math.round((((radians * 180) / Math.PI) + 450) % 360)
  const signed = signedDegrees > 180 ? signedDegrees - 360 : signedDegrees
  const nextAngle = signed
  if (nextAngle === context.lastAngle) return
  context.lastAngle = nextAngle
  updateConfig(context.toolId, {
    angle: nextAngle,
  })
}

function endRotateDrag() {
  DRAG_CONTEXT.rotateDial = null
}

function beginManualCropDrag(event, target) {
  const stage = target.closest('[data-role="manual-crop-stage"]')
  const box = target.closest('[data-role="manual-crop-box"]') || target
  if (!stage || !box) return
  event.preventDefault()
  const state = getState()
  const config = state.configs['manual-crop']
  const asset = state.assets[config.currentIndex]
  if (!asset) return
  const imageRect = stage.getBoundingClientRect()
  const area = getManualCropArea(asset, config)
  DRAG_CONTEXT.manualCrop = {
    assetId: asset.id,
    pointerId: event.pointerId,
    ratioValue: config.ratioValue || '16:9',
    stageRect: imageRect,
    area,
    startX: event.clientX,
    startY: event.clientY,
    mode: target.dataset.action === 'manual-crop-resize' ? 'resize' : 'move',
    handle: target.dataset.handle || '',
  }
  target.setPointerCapture?.(event.pointerId)
}

function handleManualCropDrag(event) {
  const context = DRAG_CONTEXT.manualCrop
  if (!context) return
  if (context.pointerId != null && event.pointerId != null && event.pointerId !== context.pointerId) return
  const state = getState()
  const config = state.configs['manual-crop']
  const asset = state.assets[config.currentIndex]
  if (!asset || asset.id !== context.assetId) return
  const nextArea = context.mode === 'move'
    ? moveManualCropArea(context, event, asset)
    : resizeManualCropArea(context, event, asset)
  const cropAreas = { ...(config.cropAreas || {}), [asset.id]: nextArea }
  updateConfig('manual-crop', { cropAreas })
}

function endManualCropDrag() {
  DRAG_CONTEXT.manualCrop = null
}

function getManualCropArea(asset, config) {
  return (config.cropAreas && config.cropAreas[asset.id]) || createDefaultManualCropArea(asset, config.ratioValue || '16:9')
}

function createDefaultManualCropArea(asset, ratioValue) {
  const width = Math.max(1, asset.width || 1)
  const height = Math.max(1, asset.height || 1)
  const [ratioX, ratioY] = String(ratioValue || '16:9').split(':').map((item) => Number(item) || 1)
  const targetRatio = ratioX / ratioY
  let cropWidth = width
  let cropHeight = Math.round(cropWidth / targetRatio)
  if (cropHeight > height) {
    cropHeight = height
    cropWidth = Math.round(cropHeight * targetRatio)
  }
  return {
    x: Math.max(0, Math.round((width - cropWidth) / 2)),
    y: Math.max(0, Math.round((height - cropHeight) / 2)),
    width: cropWidth,
    height: cropHeight,
  }
}

function moveManualCropArea(context, event, asset) {
  const dx = ((event.clientX - context.startX) / Math.max(1, context.stageRect.width)) * Math.max(1, asset.width || 1)
  const dy = ((event.clientY - context.startY) / Math.max(1, context.stageRect.height)) * Math.max(1, asset.height || 1)
  const area = {
    ...context.area,
    x: Math.round(context.area.x + dx),
    y: Math.round(context.area.y + dy),
  }
  return clampManualCropArea(area, asset)
}

function resizeManualCropArea(context, event, asset) {
  const ratio = getManualCropRatio(context.ratioValue)
  const dx = ((event.clientX - context.startX) / Math.max(1, context.stageRect.width)) * Math.max(1, asset.width || 1)
  const dy = ((event.clientY - context.startY) / Math.max(1, context.stageRect.height)) * Math.max(1, asset.height || 1)
  const start = context.area
  const left = start.x
  const top = start.y
  const right = start.x + start.width
  const bottom = start.y + start.height
  const centerX = start.x + start.width / 2
  const centerY = start.y + start.height / 2
  const handle = context.handle

  let width = start.width
  let height = start.height
  let x = start.x
  let y = start.y

  if (handle === 'ml' || handle === 'mr') {
    width = handle === 'ml' ? right - (left + dx) : start.width + dx
    width = Math.max(40, width)
    height = start.height
    x = handle === 'ml' ? right - width : left
    y = top
  } else if (handle === 'tm' || handle === 'bm') {
    height = handle === 'tm' ? bottom - (top + dy) : start.height + dy
    height = Math.max(40, height)
    width = start.width
    y = handle === 'tm' ? bottom - height : top
    x = left
  } else {
    const widthByDrag = handle.includes('l') ? right - (left + dx) : start.width + dx
    const heightByDrag = handle.includes('t') ? bottom - (top + dy) : start.height + dy
    const widthFromHeight = Math.max(40, heightByDrag * ratio)
    width = Math.max(40, Math.min(Math.abs(widthByDrag), Math.abs(widthFromHeight)))
    height = Math.max(40, width / ratio)
    x = handle.includes('l') ? right - width : left
    y = handle.includes('t') ? bottom - height : top
  }

  return clampManualCropArea({ x, y, width, height }, asset)
}

function clampManualCropArea(area, asset) {
  const assetWidth = Math.max(1, asset.width || 1)
  const assetHeight = Math.max(1, asset.height || 1)
  const width = Math.min(assetWidth, Math.max(40, Math.round(area.width)))
  const height = Math.min(assetHeight, Math.max(40, Math.round(area.height)))
  const x = Math.max(0, Math.min(assetWidth - width, Math.round(area.x)))
  const y = Math.max(0, Math.min(assetHeight - height, Math.round(area.y)))
  return { x, y, width, height }
}

function getManualCropRatio(ratioValue) {
  const [ratioX, ratioY] = String(ratioValue || '16:9').split(':').map((item) => Number(item) || 1)
  return ratioX / ratioY
}

function normalizeSignedAngle(value) {
  const normalized = ((value % 360) + 360) % 360
  if (normalized > 180) return normalized - 360
  return normalized
}

function parseValue(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value !== '' && !Number.isNaN(Number(value)) && !String(value).endsWith('px') && !String(value).endsWith('%')) {
    return Number(value)
  }
  return value
}

function formatMeasureValue(value, fallbackUnit = 'px') {
  const raw = String(value ?? '').trim()
  if (!raw) return `0${fallbackUnit}`
  if (raw.endsWith('px') || raw.endsWith('%')) return raw
  return `${raw}${fallbackUnit}`
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
  if (toolId === 'rotate') return `旋转 ${Number(config.angle) || 0}°`
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

function getRangeProgress(value, min, max) {
  const current = Number(value)
  const start = Number(min)
  const end = Number(max)
  if (!Number.isFinite(current) || !Number.isFinite(start) || !Number.isFinite(end) || start === end) return 0
  return Math.max(0, Math.min(100, ((current - start) / (end - start)) * 100))
}

function truncate(value, length) {
  if (value.length <= length) return value
  return `${value.slice(0, Math.max(0, length - 1))}…`
}
