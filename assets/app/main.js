import { TOOL_MAP } from './config/tools.js'
import { renderAppShell } from './components/AppShell.js'
import { appendAssets, applyRunResult, dismissNotification, getState, moveAsset, pushNotification, removeAsset, setActiveTool, setPreviewModal, setSearchQuery, setState, subscribe, updateConfig, updateSettings } from './state/store.js'
import { buildStagedItems, getLaunchInputs, importItems, loadSettings, runTool, saveAllStagedResults, savePreset, saveSettings, saveStagedResult, stageToolPreview, subscribeLaunchInputs } from './services/ztools-bridge.js'

const PREVIEW_SAVE_TOOLS = new Set(['compression', 'format', 'resize'])
const SETTINGS_TOOL_ID = 'settings'

const app = document.getElementById('app')
const fileInput = createFileInput({ directory: false })
const folderInput = createFileInput({ directory: true })

const DRAG_CONTEXT = {
  rotateDial: null,
}

document.body.append(fileInput, folderInput)
subscribe(render)
render(getState())
attachGlobalEvents()
bootstrapSettings().finally(() => {
  bootstrapLaunchInputs().finally(() => {
    attachLaunchSubscription()
  })
})

async function bootstrapSettings() {
  try {
    const settings = await loadSettings()
    updateSettings(settings)
  } catch {
    // ignore settings bootstrap errors
  }
}

function isPreviewSaveTool(toolId) {
  return PREVIEW_SAVE_TOOLS.has(toolId)
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

function getActiveToolLabel() {
  const tool = TOOL_MAP[getState().activeTool]
  return tool?.label || getState().activeTool
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
    }
    notify({ type: result?.ok ? 'success' : result?.partial ? 'info' : 'error', message: result?.message || '批量保存失败。' })
  } catch (error) {
    notify({ type: 'error', message: error?.message || '批量保存失败。' })
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

function canSaveAllCurrentResults() {
  return buildStagedItems(getState().assets).some((item) => item.runFolderName && item.toolId === getState().activeTool)
}

function isSettingsAction(action) {
  return action === 'open-settings' || action === 'save-default-path'
}

function handleSettingsAction(action) {
  if (action === 'open-settings' || action === 'save-default-path') {
    void persistDefaultSavePath()
    return true
  }
  return false
}

function getProcessRunner(toolId) {
  return isPreviewSaveTool(toolId)
    ? (configToolId, config, assets, destinationPath) => stageToolPreview(configToolId, config, assets, destinationPath, 'preview-save')
    : runTool
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

function shouldNavigateManualCropAction(action) {
  return action === 'manual-crop-prev' || action === 'manual-crop-next'
}

function shouldCommitManualCropAction(action) {
  return action === 'manual-crop-skip' || action === 'manual-crop-complete'
}

function isUtilityTool(toolId) {
  return toolId === SETTINGS_TOOL_ID
}

function createSettingsToolResult() {
  return { ok: true, partial: false, processed: [], failed: [], message: '设置已更新。' }
}

function processUtilityTool(toolId) {
  if (!isUtilityTool(toolId)) return null
  void persistDefaultSavePath()
  return createSettingsToolResult()
}

function resolveToolById(toolId) {
  return TOOL_MAP[toolId]
}

function getSelectedTool() {
  return resolveToolById(getState().activeTool)
}

function getPreviewableAssetCount(assets) {
  return assets.length
}

function getConfiguredToolSummary(tool) {
  return describeToolConfig(tool.id, getState().configs[tool.id])
}

function canRunTool(tool) {
  return !!tool && !isUtilityTool(tool.id)
}

function getToolAssets(tool) {
  return getAssetsForTool(tool.id, getState().assets)
}

function getToolRunner(tool) {
  return getProcessRunner(tool.id)
}

function applyResultAndNotify(result, successFallback, errorFallback) {
  if (result?.processed?.length || result?.failed?.length) {
    applyRunResult(result)
  }
  if (result?.ok || result?.partial) {
    notify({ type: result.partial ? 'info' : 'success', message: result.message || successFallback })
    return true
  }
  notify({ type: 'info', message: result?.message || errorFallback })
  return false
}

function getDefaultSavePathLabel() {
  return getState().settings.defaultSavePath || '未设置'
}

function resolvePreviewAsset(assetId) {
  return getState().assets.find((item) => item.id === assetId)
}

function previewAssetResult(asset) {
  notify({ type: 'info', message: getPreviewMessage(asset) })
}

function isPreviewReady(asset) {
  return asset?.previewStatus === 'staged'
}

function isPreviewExpired(asset) {
  return asset?.previewStatus === 'stale'
}

function isPreviewSaved(asset) {
  return asset?.previewStatus === 'saved'
}

function shouldOpenSettingsTool(toolId) {
  return toolId === SETTINGS_TOOL_ID
}

function getSettingsHint() {
  return `默认保存路径：${getDefaultSavePathLabel()}`
}

function notifySettingsHint() {
  notify({ type: 'info', message: getSettingsHint() })
}

function maybeNotifySettingsHint(action) {
  if (action === 'open-settings') notifySettingsHint()
}

function getBulkSaveMessage() {
  return canSaveAllCurrentResults() ? '可批量保存当前预览结果。' : '当前没有可批量保存的预览结果。'
}

function maybeNotifyBulkSaveState() {
  if (!canSaveAllCurrentResults()) {
    notify({ type: 'info', message: getBulkSaveMessage() })
  }
}

function createNoopPromise() {
  return Promise.resolve()
}

function ensurePreviewableTool(tool) {
  return !!tool && isPreviewSaveTool(tool.id)
}

function getToolProcessingCount(tool) {
  return getToolAssets(tool).length
}

function getSavePathSummary() {
  return getCurrentDestinationPath() || '将按源目录推导输出位置'
}

function notifySavePathSummary() {
  notify({ type: 'info', message: `当前保存路径：${getSavePathSummary()}` })
}

function getToolPreviewSummary(tool, asset) {
  return `${tool.label} · ${truncate(asset.name, 20)} · ${getConfiguredToolSummary(tool)}`
}

function previewGenericAsset(tool, asset) {
  notify({ type: 'info', message: `预览占位：${getToolPreviewSummary(tool, asset)}` })
}

function resolvePreviewAction(tool, asset) {
  if (!tool || !asset) return
  if (ensurePreviewableTool(tool)) {
    previewAssetResult(asset)
    return
  }
  previewGenericAsset(tool, asset)
}

function notifyMissingAsset() {
  notify({ type: 'error', message: '未找到要预览的图片。' })
}

function notifyNoImages() {
  notify({ type: 'info', message: '请先导入图片，再开始处理。' })
}

function notifyProcessingError(error) {
  notify({ type: 'error', message: error?.message || '批处理触发失败。' })
}

function notifyImportError(error) {
  notify({ type: 'error', message: error?.message || '导入失败。' })
}

function notifyLaunchError(error) {
  notify({ type: 'error', message: error?.message || '读取启动图片失败。' })
}

function isProcessingLocked() {
  return getState().isProcessing
}

function setProcessing(value) {
  setState({ isProcessing: value })
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

function maybeHandleSettingsActions(action) {
  if (!isSettingsAction(action)) return false
  maybeNotifySettingsHint(action)
  void persistDefaultSavePath()
  return true
}

function maybeHandlePreviewAction(action, target) {
  if (!shouldPreviewAssetAction(action)) return false
  const tool = getSelectedTool()
  const asset = resolvePreviewAsset(target.dataset.assetId)
  if (!asset) {
    notifyMissingAsset()
    return true
  }
  resolvePreviewAction(tool, asset)
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
    return true
  }
  if (shouldSetConfigAction(action)) {
    updateConfig(target.dataset.toolId, { [target.dataset.key]: parseValue(target.dataset.value) })
    return true
  }
  if (shouldApplyResizePresetAction(action)) {
    updateConfig('resize', {
      width: target.dataset.width,
      height: target.dataset.height,
      widthUnit: inferResizeUnit(target.dataset.width),
      heightUnit: inferResizeUnit(target.dataset.height),
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

function maybeHandleManualCropActions(action) {
  if (shouldNavigateManualCropAction(action) || shouldCommitManualCropAction(action)) {
    return false
  }
  return false
}

function getSettingsState() {
  return getState().settings
}

function getSettingsDefaultSavePath() {
  return getSettingsState().defaultSavePath || ''
}

function hasDefaultSavePath() {
  return !!getSettingsDefaultSavePath()
}

function getDestinationSummaryMessage() {
  return hasDefaultSavePath() ? `默认保存路径：${getSettingsDefaultSavePath()}` : '未设置默认保存路径，将按源目录生成输出目录。'
}

function notifyDestinationSummary() {
  notify({ type: 'info', message: getDestinationSummaryMessage() })
}

function maybeHandleOpenSettingsAction(action) {
  if (action !== 'open-settings') return false
  notifyDestinationSummary()
  void persistDefaultSavePath()
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

function getPreviewStatusMessage(asset) {
  return getPreviewMessage(asset)
}

function getToolOrThrow() {
  return getSelectedTool()
}

function getReadyAssets(tool) {
  return getToolAssets(tool)
}

function getRunFallbackMessage(tool, assets) {
  return getProcessFallbackMessage(tool, assets.length)
}

function isEmptyAssets(assets) {
  return !assets.length
}

function getRunSummary(tool) {
  return getConfiguredToolSummary(tool)
}

function shouldPreviewSaveTool(tool) {
  return ensurePreviewableTool(tool)
}

function getToolRunnerForExecution(tool) {
  return getToolRunner(tool)
}

function getDestinationPathForExecution() {
  return getCurrentDestinationPath()
}

function getCurrentState() {
  return getState()
}

function handleRunResult(result, tool, assets) {
  return applyResultAndNotify(result, getProcessSuccessMessage(result, tool), getRunFallbackMessage(tool, assets))
}

function createSettingsStatePatch(settings) {
  return settings
}

function applySettingsState(settings) {
  updateSettings(createSettingsStatePatch(settings))
}

function ensureSettingsLoaded() {
  return getSettingsState()
}

function getSaveActionDestination() {
  return getCurrentDestinationPath()
}

function resolveSelectedAsset(assetId) {
  return resolvePreviewAsset(assetId)
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

function canBulkSave() {
  return getPreviewSaveAssets().length > 0
}

function getBulkSaveItems() {
  return buildStagedItems(getPreviewSaveAssets())
}

function getPreviewStaleAssets() {
  return getState().assets.filter((asset) => asset.previewStatus === 'stale')
}

function shouldWarnStaleBeforeBulkSave() {
  return getPreviewStaleAssets().length > 0 && !canBulkSave()
}

function maybeWarnStaleBeforeBulkSave() {
  if (shouldWarnStaleBeforeBulkSave()) {
    notifyStalePreview()
    return true
  }
  return false
}

function normalizeToolLabel(tool) {
  return tool?.label || '当前工具'
}

function getProcessedAssetCount(assets) {
  return assets.length
}

function createSettingsInfoMessage() {
  return `默认保存路径：${getSettingsDefaultSavePath() || '未设置'}`
}

function showSettingsInfoMessage() {
  notify({ type: 'info', message: createSettingsInfoMessage() })
}

function maybeShowSettingsInfo(tool) {
  if (shouldOpenSettingsTool(tool?.id)) showSettingsInfoMessage()
}

function getSelectionSummary(assets) {
  return `${getProcessedAssetCount(assets)} 张`
}

function createProcessMessage(tool, assets) {
  return `${normalizeToolLabel(tool)} · ${getSelectionSummary(assets)} · ${getRunSummary(tool)}`
}

function notifyProcessPlaceholder(tool, assets) {
  notify({ type: 'info', message: createProcessMessage(tool, assets) })
}

function getEffectiveAssets(tool) {
  return getReadyAssets(tool)
}

function shouldAbortProcessing(tool, assets) {
  if (!canRunTool(tool)) return true
  if (isEmptyAssets(assets)) {
    notifyNoImages()
    return true
  }
  return false
}

function setLaunchError(error) {
  notifyLaunchError(error)
}

function setImportError(error) {
  notifyImportError(error)
}

function setRunError(error) {
  notifyProcessingError(error)
}

function getProcessRunnerResult(tool, assets) {
  return getToolRunnerForExecution(tool)(tool.id, getState().configs[tool.id], assets, getDestinationPathForExecution())
}

function getPreviewStatus(asset) {
  return asset?.previewStatus || 'idle'
}

function shouldUsePreviewSummary(asset) {
  return ['staged', 'saved', 'stale'].includes(getPreviewStatus(asset))
}

function maybePreviewSummary(tool, asset) {
  if (shouldUsePreviewSummary(asset)) {
    previewAssetResult(asset)
    return true
  }
  return false
}

function createSavePathHint() {
  return `保存位置：${getSavePathSummary()}`
}

function maybeNotifySavePathHint() {
  notify({ type: 'info', message: createSavePathHint() })
}

function shouldHandleProcessingTool(tool) {
  return canRunTool(tool)
}

function getProcessingAssets(tool) {
  return getEffectiveAssets(tool)
}

function resolveProcessingResult(tool, assets) {
  return getProcessRunnerResult(tool, assets)
}

function updateCurrentSettings(settings) {
  applySettingsState(settings)
}

function getRunLockState() {
  return isProcessingLocked()
}

function setRunLockState(value) {
  setProcessing(value)
}

function shouldSavePreviewAsset(asset) {
  return canSaveAsset(asset)
}

function getSingleSaveItem(asset) {
  return getStagedItemByAssetId(asset.id)
}

function getBulkSaveTargetItems() {
  return getBulkSaveItems()
}

function shouldSaveAnything() {
  return canBulkSave()
}

function maybeNotifyNoSaveTargets() {
  if (!shouldSaveAnything()) {
    notifyNoPreviewToSave()
    return true
  }
  return false
}

function shouldUseUtilityTool(tool) {
  return isUtilityTool(tool?.id)
}

function maybeProcessUtilityTool(tool) {
  return processUtilityTool(tool?.id)
}

function shouldShowPreviewResult(asset) {
  return shouldUsePreviewSummary(asset)
}

function showPreviewResult(asset) {
  previewAssetResult(asset)
}

function maybeShowPreviewResult(asset) {
  if (shouldShowPreviewResult(asset)) {
    showPreviewResult(asset)
    return true
  }
  return false
}

function shouldProcessPreviewSave(tool) {
  return shouldPreviewSaveTool(tool)
}

function getToolExecutionIntro(tool, assets) {
  return `${normalizeToolLabel(tool)} 正在处理 ${getSelectionSummary(assets)}`
}

function notifyToolExecutionIntro(tool, assets) {
  notify({ type: 'info', message: getToolExecutionIntro(tool, assets) })
}

function shouldNotifyToolExecutionIntro(tool) {
  return shouldProcessPreviewSave(tool)
}

function maybeNotifyToolExecutionIntro(tool, assets) {
  if (shouldNotifyToolExecutionIntro(tool)) notifyToolExecutionIntro(tool, assets)
}

function shouldShowBulkSaveHint() {
  return canBulkSaveAllCurrentResults()
}

function maybeShowBulkSaveHint() {
  if (shouldShowBulkSaveHint()) {
    notify({ type: 'info', message: '当前结果可直接使用“全部保存”。' })
  }
}

function getSaveResultState() {
  return getPreviewSaveAssets().length
}

function getSettingsMessage() {
  return createSettingsInfoMessage()
}

function maybeNotifySettingsMessage() {
  notify({ type: 'info', message: getSettingsMessage() })
}

function getToolPreviewHint(tool, asset) {
  return getToolPreviewSummary(tool, asset)
}

function getToolFallbackResult(tool, assets) {
  return getRunFallbackMessage(tool, assets)
}

function finalizeProcessingResult(result, tool, assets) {
  return handleRunResult(result, tool, assets)
}

function applyImportedAssets(assets) {
  appendAssets(assets)
}

function maybeAppendImportedAssets(assets) {
  if (assets?.length) applyImportedAssets(assets)
}

function getPreviewState(asset) {
  return getPreviewStatus(asset)
}

function createRunPlaceholderMessage(tool, assets) {
  return getToolFallbackResult(tool, assets)
}

function shouldSaveStagedItem(item) {
  return !!item?.stagedPath
}

function filterSavableItems(items) {
  return items.filter(shouldSaveStagedItem)
}

function getSavableBulkItems() {
  return filterSavableItems(getBulkSaveTargetItems())
}

function canSaveNow() {
  return getSavableBulkItems().length > 0
}

function maybeNotifyCannotSaveNow() {
  if (!canSaveNow()) {
    notifyNoPreviewToSave()
    return true
  }
  return false
}

function ensurePreviewActionState(asset) {
  if (maybeShowPreviewResult(asset)) return true
  return false
}

function maybeHandlePreviewResult(asset) {
  return ensurePreviewActionState(asset)
}

function getToolForAction() {
  return getSelectedTool()
}

function createSettingsSuccessMessage(settings) {
  return settings.defaultSavePath ? '已保存默认保存路径。' : '已清空默认保存路径。'
}

function notifySettingsSaved(settings) {
  notify({ type: 'success', message: createSettingsSuccessMessage(settings) })
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
  return getSettingsDefaultSavePath() || getState().destinationPath || ''
}

function shouldProcessClickAction(action, target, event) {
  return shouldShortCircuitClickAction(action, target, event)
}

function handleImportedAssets(assets) {
  maybeAppendImportedAssets(assets)
}

function getPreviewOutputDimensions(asset) {
  return `${asset.stagedWidth || '—'} × ${asset.stagedHeight || '—'}`
}

function getPreviewOutputSummary(asset) {
  return `${formatBytes(asset.stagedSizeBytes)} · ${getPreviewOutputDimensions(asset)}`
}

function createPreviewReadyMessage(asset) {
  return `预览已生成：${truncate(asset.name, 20)} · ${getPreviewOutputSummary(asset)}`
}

function maybeNotifyPreviewReady(asset) {
  if (isPreviewReady(asset)) notify({ type: 'info', message: createPreviewReadyMessage(asset) })
}

function maybeNotifySaveCompleted(asset) {
  if (isPreviewSaved(asset)) notify({ type: 'success', message: `已保存 ${truncate(asset.name, 20)}。` })
}

function maybeNotifyPreviewExpired(asset) {
  if (isPreviewExpired(asset)) notifyStalePreview()
}

function getSettingsPromptTitle() {
  return '默认保存路径'
}

function openSettingsPrompt() {
  return window.prompt(getSettingsPromptTitle(), getSettingsPromptDefaultValue())
}

function hasPreviewableResults() {
  return getPreviewSaveAssets().length > 0
}

function getProcessTargetCount(tool) {
  return getToolAssets(tool).length
}

function getPreviewSummary(asset) {
  return getPreviewStatusMessage(asset)
}

function maybeShowPreviewSummary(asset) {
  if (shouldUsePreviewSummary(asset)) {
    notify({ type: 'info', message: getPreviewSummary(asset) })
    return true
  }
  return false
}

function getSettingsPreviewText() {
  return getDestinationSummaryMessage()
}

function maybeShowSettingsPreview() {
  notify({ type: 'info', message: getSettingsPreviewText() })
}

function canApplyResult(result) {
  return !!(result?.processed?.length || result?.failed?.length)
}

function maybeApplyResult(result) {
  if (canApplyResult(result)) applyRunResult(result)
}

function getCurrentToolConfig(toolId) {
  return getState().configs[toolId]
}

function getToolRunArgs(tool, assets) {
  return [tool.id, getCurrentToolConfig(tool.id), assets, getDestinationPathForExecution()]
}

function runToolExecution(tool, assets) {
  return getToolRunnerForExecution(tool)(...getToolRunArgs(tool, assets))
}

function maybeHandleSingleSaveState(asset) {
  return handleSavableAssetState(asset)
}

function getSettingsSavedMessage(settings) {
  return createSettingsSuccessMessage(settings)
}

function maybeNotifySettingsSaved(settings) {
  notify({ type: 'success', message: getSettingsSavedMessage(settings) })
}

function getStateAssets() {
  return getState().assets
}

function getStateActiveTool() {
  return getState().activeTool
}

function getStateDestinationPath() {
  return getState().destinationPath
}

function getStateConfigs() {
  return getState().configs
}

function shouldSaveAllResults() {
  return hasPreviewableResults()
}

function maybeNotifyBulkSaveUnavailable() {
  if (!shouldSaveAllResults()) {
    notifyNoPreviewToSave()
    return true
  }
  return false
}

function getSettingsDefaultValue() {
  return getSettingsPromptDefaultValue()
}

function shouldUseWindowPrompt() {
  return typeof window?.prompt === 'function'
}

function ensureSettingsPrompt() {
  return shouldUseWindowPrompt() ? openSettingsPrompt() : null
}

function getPreviewSummaryMessage(asset) {
  return getPreviewStatusMessage(asset)
}

function notifyPreviewSummary(asset) {
  notify({ type: 'info', message: getPreviewSummaryMessage(asset) })
}

function shouldUsePreviewNotification(asset) {
  return shouldUsePreviewSummary(asset)
}

function maybeNotifyPreviewSummary(asset) {
  if (shouldUsePreviewNotification(asset)) notifyPreviewSummary(asset)
}

function getToolRunnerMessage(tool, assets) {
  return createRunPlaceholderMessage(tool, assets)
}

function ensureAssetsAvailable(assets) {
  if (!assets.length) {
    notifyNoImages()
    return false
  }
  return true
}

function maybeHandleUtilityTool(tool) {
  const result = maybeProcessUtilityTool(tool)
  if (result) {
    notify({ type: 'success', message: result.message })
    return true
  }
  return false
}

function maybeNotifySavePath() {
  notifySavePathSummary()
}

function shouldEmitSavePathHint(tool) {
  return shouldPreviewSaveTool(tool)
}

function maybeEmitSavePathHint(tool) {
  if (shouldEmitSavePathHint(tool)) maybeNotifySavePath()
}

function getActionableSaveItems() {
  return getSavableBulkItems()
}

function canActionSaveItems() {
  return getActionableSaveItems().length > 0
}

function maybeWarnNoActionableSaveItems() {
  if (!canActionSaveItems()) {
    notifyNoPreviewToSave()
    return true
  }
  return false
}

function maybeWarnPreviewStale(asset) {
  if (isPreviewExpired(asset)) {
    notifyStalePreview()
    return true
  }
  return false
}

function maybeHandleClickAction(action, target, event) {
  return shouldProcessClickAction(action, target, event)
}

function getSettingsResultLabel() {
  return getSettingsPreviewText()
}

function maybeNotifySettingsResultLabel() {
  notify({ type: 'info', message: getSettingsResultLabel() })
}

function normalizeImportedAssets(assets) {
  return assets
}

function getSafeImportedAssets(assets) {
  return normalizeImportedAssets(assets)
}

function appendSafeImportedAssets(assets) {
  appendImportedAssets(getSafeImportedAssets(assets))
}

function shouldDisplayPreviewDetails(asset) {
  return shouldUsePreviewSummary(asset)
}

function maybeDisplayPreviewDetails(asset) {
  if (shouldDisplayPreviewDetails(asset)) {
    notifyPreviewSummary(asset)
    return true
  }
  return false
}

function getToolExecutionPlaceholder(tool, assets) {
  return getToolRunnerMessage(tool, assets)
}

function maybeNotifyToolPlaceholder(tool, assets) {
  notify({ type: 'info', message: getToolExecutionPlaceholder(tool, assets) })
}

function shouldSkipPreviewSaveTool(tool) {
  return !shouldPreviewSaveTool(tool)
}

function maybeHandlePreviewSaveTool(tool, assets) {
  if (shouldSkipPreviewSaveTool(tool)) return false
  maybeEmitSavePathHint(tool)
  maybeNotifyToolExecutionIntro(tool, assets)
  return false
}

function getDefaultSavePathState() {
  return getSettingsDefaultSavePath()
}

function shouldUseDefaultSavePathState() {
  return !!getDefaultSavePathState()
}

function getSettingsStatusText() {
  return shouldUseDefaultSavePathState() ? getDefaultSavePathState() : '未设置'
}

function maybeNotifySettingsStatus() {
  notify({ type: 'info', message: `默认保存路径：${getSettingsStatusText()}` })
}

function getPendingSaveItemsCount() {
  return getActionableSaveItems().length
}

function shouldShowPendingSaveItemsCount() {
  return getPendingSaveItemsCount() > 0
}

function maybeNotifyPendingSaveItemsCount() {
  if (shouldShowPendingSaveItemsCount()) {
    notify({ type: 'info', message: `当前有 ${getPendingSaveItemsCount()} 项结果可保存。` })
  }
}

function notifySavedOutputPath(result) {
  if (result?.destinationPath) {
    notify({ type: 'info', message: `保存输出目录：${result.destinationPath}` })
  }
}

function maybeNotifySavedOutputPath(result) {
  if (result?.mode === 'save') notifySavedOutputPath(result)
}

function maybeNotifyRunOutputPath(result) {
  if (result?.mode === 'preview-save') {
    notify({ type: 'info', message: `预览输出目录：${result.destinationPath}` })
  }
}

function maybeNotifyResultOutputPath(result) {
  maybeNotifySavedOutputPath(result)
  maybeNotifyRunOutputPath(result)
}

function updateSettingsAfterSave(settings) {
  applySettingsState(settings)
}

function getPreviewOutputPath(asset) {
  return asset.stagedOutputPath || ''
}

function getSavedOutputPath(asset) {
  return asset.savedOutputPath || asset.outputPath || ''
}

function hasSavedOutputPath(asset) {
  return !!getSavedOutputPath(asset)
}

function maybeNotifyAssetOutput(asset) {
  if (hasSavedOutputPath(asset)) {
    notify({ type: 'info', message: `输出：${getSavedOutputPath(asset)}` })
  }
}

function canPreviewAsset(asset) {
  return !!asset
}

function maybeHandleAssetPreview(asset) {
  if (!canPreviewAsset(asset)) return false
  maybeShowPreviewSummary(asset)
  return true
}

function getAssetById(assetId) {
  return resolveSelectedAsset(assetId)
}

function getToolExecutionResult(tool, assets) {
  return runToolExecution(tool, assets)
}

function maybeHandleSingleAssetSave(asset) {
  if (!maybeHandleSingleSaveState(asset)) return false
  void saveAssetResult(asset.id)
  return true
}

function maybeHandleSaveAllAction() {
  if (maybeWarnNoActionableSaveItems()) return true
  void saveAllCurrentResults()
  return true
}

function getCurrentActiveTool() {
  return getSelectedTool()
}

function getCurrentToolAssets() {
  const tool = getCurrentActiveTool()
  return tool ? getToolAssets(tool) : []
}

function maybeHandleCurrentToolExecution() {
  const tool = getCurrentActiveTool()
  if (!tool) return true
  if (maybeHandleUtilityTool(tool)) return true
  return false
}

function shouldUseStagedPreview(tool) {
  return shouldPreviewSaveTool(tool)
}

function getResultInfoMessage(result) {
  return result?.message || '操作已完成。'
}

function notifyResultInfo(result) {
  notify({ type: 'info', message: getResultInfoMessage(result) })
}

function maybeNotifyResultInfo(result) {
  if (result?.mode === 'preview-save' || result?.mode === 'save') notifyResultInfo(result)
}

function shouldShowPreviewPath(asset) {
  return !!getPreviewOutputPath(asset)
}

function maybeNotifyPreviewPath(asset) {
  if (shouldShowPreviewPath(asset)) {
    notify({ type: 'info', message: `预览文件：${getPreviewOutputPath(asset)}` })
  }
}

function maybeNotifySaveReadyState() {
  maybeNotifyPendingSaveItemsCount()
}

function canUpdateSettings() {
  return true
}

function maybeApplySettings(settings) {
  if (canUpdateSettings()) updateSettingsAfterSave(settings)
}

function getProcessingState() {
  return getRunLockState()
}

function setProcessingState(value) {
  setRunLockState(value)
}

function shouldOpenSettingsPrompt() {
  return shouldUseWindowPrompt()
}

function maybeOpenSettingsPrompt() {
  return shouldOpenSettingsPrompt() ? ensureSettingsPrompt() : null
}

function getSettingsPromptResult() {
  return maybeOpenSettingsPrompt()
}

function getSettingsPayloadFromPrompt() {
  const value = getSettingsPromptResult()
  if (isSettingsPromptCancelled(value)) return null
  return createSettingsPayload(value)
}

function maybeCreateSettingsPayload() {
  return getSettingsPayloadFromPrompt()
}

function hasSettingsPayload(payload) {
  return !!payload
}

function maybePersistSettingsPayload() {
  const payload = maybeCreateSettingsPayload()
  if (!hasSettingsPayload(payload)) return null
  return saveSettings(payload)
}

function shouldHandleSettingsPersistence(settings) {
  return !!settings
}

function maybeHandleSettingsPersistence() {
  const settings = maybePersistSettingsPayload()
  if (!shouldHandleSettingsPersistence(settings)) return false
  maybeApplySettings(settings)
  maybeNotifySettingsSaved(settings)
  return true
}

function getResultNotificationType(result) {
  if (result?.ok) return 'success'
  if (result?.partial) return 'info'
  return 'error'
}

function notifyResult(result, fallback) {
  notify({ type: getResultNotificationType(result), message: result?.message || fallback })
}

function maybeNotifyResult(result, fallback) {
  notifyResult(result, fallback)
}

function getSaveAllItems() {
  return getActionableSaveItems()
}

function hasSaveAllItems() {
  return getSaveAllItems().length > 0
}

function maybeSaveAllItems() {
  if (!hasSaveAllItems()) return false
  void saveAllCurrentResults()
  return true
}

function shouldShowSettingsChangeNotice() {
  return hasDefaultSavePath()
}

function maybeShowSettingsChangeNotice() {
  if (shouldShowSettingsChangeNotice()) {
    notify({ type: 'info', message: `默认保存路径已更新为：${getSettingsDefaultSavePath()}` })
  }
}

function getActionTargetAsset(target) {
  return getAssetById(target.dataset.assetId)
}

function maybeHandleClickAssetSave(action, target) {
  if (!shouldUseSingleSaveAction(action)) return false
  const asset = getActionTargetAsset(target)
  return maybeHandleSingleAssetSave(asset)
}

function maybeHandleClickSaveAll(action) {
  if (!shouldUseBulkSaveAction(action)) return false
  return maybeHandleSaveAllAction()
}

function maybeHandleClickPreview(action, target) {
  if (!shouldPreviewAssetAction(action)) return false
  const asset = getActionTargetAsset(target)
  if (!asset) {
    notifyMissingAsset()
    return true
  }
  return maybeHandleAssetPreview(asset)
}

function maybeHandleClickProcess(action) {
  if (!shouldProcessCurrentAction(action)) return false
  if (maybeHandleCurrentToolExecution()) return true
  void processCurrentTool()
  return true
}

function maybeHandleClickSettings(action) {
  if (!isSettingsAction(action)) return false
  maybeHandleSettingsPersistence()
  maybeShowSettingsChangeNotice()
  return true
}

function shouldUseImmediateAction(action) {
  return maybeHandleClickSettings(action)
}

function maybeHandleImmediateAction(action) {
  return shouldUseImmediateAction(action)
}

function getActionResult(action, target, event) {
  return maybeHandleImmediateAction(action)
    || maybeHandleClickAssetSave(action, target)
    || maybeHandleClickSaveAll(action)
    || maybeHandleBasicAssetActions(action, target)
    || maybeHandleClickPreview(action, target)
    || maybeHandleClickProcess(action)
    || maybeHandleOpenInputActions(action)
    || maybeHandlePresetAction(action, target)
    || maybeHandleToolActions(action, target, event)
    || maybeHandleConfigActions(action, target)
}

function shouldHandleAction(action, target, event) {
  return getActionResult(action, target, event)
}

function getSettingsModeHint() {
  return getSettingsPreviewText()
}

function maybeShowSettingsModeHint() {
  notify({ type: 'info', message: getSettingsModeHint() })
}

function maybeHandleSettingsMode(action) {
  if (action !== 'open-settings') return false
  maybeShowSettingsModeHint()
  return true
}

function getClickHandlerResult(action, target, event) {
  return maybeHandleSettingsMode(action) || shouldHandleAction(action, target, event)
}

function shouldHandleClick(action, target, event) {
  return getClickHandlerResult(action, target, event)
}

function getToolProcessingAssets(tool) {
  return getToolAssets(tool)
}

function getRunnerForTool(tool) {
  return getToolRunnerForExecution(tool)
}

function runSelectedTool(tool, assets) {
  return getRunnerForTool(tool)(tool.id, getCurrentToolConfig(tool.id), assets, getDestinationPathForExecution())
}

function applyExecutionResult(result) {
  maybeApplyResult(result)
  maybeNotifyResultOutputPath(result)
  maybeNotifyResultInfo(result)
  maybeNotifySaveReadyState()
}

function createFallbackExecutionMessage(tool, assets) {
  return getProcessFallbackMessage(tool, assets.length)
}

function finalizeExecution(result, tool, assets) {
  applyExecutionResult(result)
  notifyResult(result, createFallbackExecutionMessage(tool, assets))
}

function getPersistedSettings() {
  return getSettingsState()
}

function applyPersistedSettings(settings) {
  updateCurrentSettings(settings)
}

function shouldUsePersistedSettings(settings) {
  return !!settings
}

function maybeApplyPersistedSettings(settings) {
  if (shouldUsePersistedSettings(settings)) applyPersistedSettings(settings)
}

function notifyBootstrapSettingsFailure() {
  // ignore
}

function getProcessExecutionMessage(tool, assets) {
  return createProcessMessage(tool, assets)
}

function maybeNotifyProcessExecution(tool, assets) {
  if (shouldPreviewSaveTool(tool)) notify({ type: 'info', message: getProcessExecutionMessage(tool, assets) })
}

function normalizeSettingsBootstrap(settings) {
  return settings || { defaultSavePath: '' }
}

function getCurrentSavePathHint() {
  return getSavePathSummary()
}

function maybeNotifyCurrentSavePathHint() {
  notify({ type: 'info', message: `保存路径：${getCurrentSavePathHint()}` })
}

function shouldShowCurrentSavePathHint(tool) {
  return shouldPreviewSaveTool(tool)
}

function maybeShowCurrentSavePathHint(tool) {
  if (shouldShowCurrentSavePathHint(tool)) maybeNotifyCurrentSavePathHint()
}

function getActionState() {
  return getCurrentState()
}

function isSaveProcessingAction(action) {
  return shouldUseSingleSaveAction(action) || shouldUseBulkSaveAction(action)
}

function maybePreventWhileProcessing(action) {
  if (!isSaveProcessingAction(action)) return false
  if (!getProcessingState()) return false
  return true
}

function getPreviewNotificationMessage(asset) {
  return getPreviewSummaryMessage(asset)
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

function maybeHandlePreviewOnly(asset) {
  return maybeHandleExistingPreview(asset)
}

function canUsePromptApi() {
  return typeof window?.prompt === 'function'
}

function getPromptApiResult() {
  return canUsePromptApi() ? openSettingsPrompt() : null
}

function resolveSettingsPayloadFromPrompt() {
  const result = getPromptApiResult()
  if (isSettingsPromptCancelled(result)) return null
  return createSettingsPayload(result)
}

function maybeSaveSettingsFromPrompt() {
  const payload = resolveSettingsPayloadFromPrompt()
  if (!payload) return null
  return saveSettings(payload)
}

function maybePersistDefaultSavePath() {
  const settings = maybeSaveSettingsFromPrompt()
  if (!settings) return false
  maybeApplySettings(settings)
  notifySettingsSaved(settings)
  return true
}

function shouldHandleSettingsClick(action) {
  return action === 'open-settings' || action === 'save-default-path'
}

function maybeHandleSettingsClick(action) {
  if (!shouldHandleSettingsClick(action)) return false
  return maybePersistDefaultSavePath()
}

function routeClickAction(action, target, event) {
  return maybeHandleSettingsClick(action)
    || maybeHandleClickAssetSave(action, target)
    || maybeHandleClickSaveAll(action)
    || maybeHandleBasicAssetActions(action, target)
    || maybeHandleClickPreview(action, target)
    || maybeHandleClickProcess(action)
    || maybeHandleOpenInputActions(action)
    || maybeHandlePresetAction(action, target)
    || maybeHandleToolActions(action, target, event)
    || maybeHandleConfigActions(action, target)
}

function hasPreviewSaveOutputs() {
  return hasPreviewableResults()
}

function maybeNotifyPreviewSaveOutputs() {
  if (hasPreviewSaveOutputs()) {
    notify({ type: 'info', message: `当前有 ${getPreviewSaveAssets().length} 项预览结果可保存。` })
  }
}

function getProcessTool() {
  return getSelectedTool()
}

function getProcessAssets(tool) {
  return getToolAssets(tool)
}

function shouldSkipToolExecution(tool, assets) {
  if (!tool) return true
  if (shouldUseUtilityTool(tool)) {
    maybeProcessUtilityTool(tool)
    return true
  }
  return !ensureAssetsAvailable(assets)
}

function getExecutionRunner(tool) {
  return getToolRunnerForExecution(tool)
}

function createExecutionArgs(tool, assets) {
  return [tool.id, getCurrentToolConfig(tool.id), assets, getDestinationPathForExecution()]
}

function executeToolRunner(tool, assets) {
  return getExecutionRunner(tool)(...createExecutionArgs(tool, assets))
}

function normalizeBootstrapSettings(settings) {
  return normalizeSettingsBootstrap(settings)
}

function getSettingsBootstrapResult(settings) {
  return normalizeBootstrapSettings(settings)
}

function maybeUpdateBootstrapSettings(settings) {
  maybeApplyPersistedSettings(getSettingsBootstrapResult(settings))
}

function handleBootstrapSettingsError() {
  notifyBootstrapSettingsFailure()
}

function getPreviewSavePathMessage() {
  return `保存目录：${getSavePathSummary()}`
}

function maybeNotifyPreviewSavePath() {
  notify({ type: 'info', message: getPreviewSavePathMessage() })
}

function shouldShowPreviewSavePath(tool) {
  return shouldPreviewSaveTool(tool)
}

function maybeShowPreviewSavePath(tool) {
  if (shouldShowPreviewSavePath(tool)) maybeNotifyPreviewSavePath()
}

function getAllPreviewSaveItems() {
  return getActionableSaveItems()
}

function routeAssetPreview(asset) {
  if (maybeHandlePreviewOnly(asset)) return true
  previewAssetResult(asset)
  return true
}

function maybeHandlePreviewRoute(asset) {
  return routeAssetPreview(asset)
}

function getToolProcessingSummary(tool, assets) {
  return `${normalizeToolLabel(tool)} · ${assets.length} 张 · ${getConfiguredToolSummary(tool)}`
}

function maybeNotifyToolProcessingSummary(tool, assets) {
  if (shouldPreviewSaveTool(tool)) {
    notify({ type: 'info', message: getToolProcessingSummary(tool, assets) })
  }
}

function getPreviewSaveCount() {
  return getPreviewSaveAssets().length
}

function maybeNotifyPreviewSaveCount() {
  if (getPreviewSaveCount()) {
    notify({ type: 'info', message: `可保存结果：${getPreviewSaveCount()} 项` })
  }
}


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
    const modalRoot = event.target.closest('.preview-modal')
    if (modalRoot && !event.target.closest('[data-action]')) {
      if (!event.target.closest('.preview-modal__dialog')) {
        closePreviewModal()
      }
      return
    }

    const target = event.target.closest('[data-action]')
    if (!target) return

    const { action } = target.dataset

    if (action === 'activate-tool') {
      setActiveTool(target.dataset.toolId)
      return
    }

    if (action === 'close-preview-modal') {
      closePreviewModal()
      return
    }

    if (action === 'open-settings' || action === 'save-default-path') {
      await persistDefaultSavePath()
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

    if (action === 'drag-rotate') {
      beginRotateDrag(event, target)
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
    if (action === 'set-config-range') {
      commitRangeControl(target)
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
    if (!DRAG_CONTEXT.rotateDial) return
    handleRotateDrag(event)
  })

  document.addEventListener('pointerup', () => {
    endRotateDrag()
  })

  document.addEventListener('pointercancel', () => {
    endRotateDrag()
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

async function previewAsset(assetId) {
  const state = getState()
  const asset = state.assets.find((item) => item.id === assetId)
  if (!asset) {
    notify({ type: 'error', message: '未找到要预览的图片。' })
    return
  }

  const tool = TOOL_MAP[state.activeTool]
  const isCurrentToolPreview = asset.stagedToolId === tool.id && ['previewed', 'staged', 'saved'].includes(asset.previewStatus) && asset.previewUrl
  if (isCurrentToolPreview && openPreviewModal(asset)) {
    return
  }

  if (!isPreviewSaveTool(tool.id)) {
    notify({ type: 'info', message: getPreviewMessage(asset) })
    return
  }

  if (state.isProcessing) return

  setState({ isProcessing: true })
  try {
    const result = await stageToolPreview(tool.id, state.configs[tool.id], [asset], getCurrentDestinationPath(), 'preview-only')
    if (result?.processed?.length || result?.failed?.length) {
      applyRunResult(result)
    }

    if (result?.ok || result?.partial) {
      const nextAsset = getState().assets.find((item) => item.id === assetId)
      const previewedAsset = nextAsset?.previewUrl ? nextAsset : {
        ...asset,
        ...(result.processed || []).find((item) => item.assetId === assetId),
      }
      if (openPreviewModal(previewedAsset)) {
        return
      }
      notify({ type: 'error', message: '预览结果生成成功，但无法打开处理后的图片。' })
      return
    }

    notify({ type: 'info', message: result?.message || '预览失败。' })
  } catch (error) {
    notify({ type: 'error', message: error?.message || '预览失败。' })
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
  DRAG_CONTEXT.rotateDial = {
    toolId: target.dataset.toolId,
    element: target.closest('[data-role="rotate-dial"]'),
  }
  target.setPointerCapture?.(event.pointerId)
  handleRotateDrag(event)
}

function handleRotateDrag(event) {
  const context = DRAG_CONTEXT.rotateDial
  if (!context?.element) return
  const rect = context.element.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const dx = event.clientX - centerX
  const dy = event.clientY - centerY
  const degrees = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360)
  const signed = normalizeSignedAngle(degrees)
  updateConfig(context.toolId, {
    angle: Math.abs(signed),
    direction: signed >= 0 ? 'clockwise' : 'anticlockwise',
  })
}

function endRotateDrag() {
  DRAG_CONTEXT.rotateDial = null
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
