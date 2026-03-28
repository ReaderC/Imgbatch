import { DEFAULT_TOOL } from '../config/tools.js'

const listeners = new Set()
const PREVIEW_SAVE_TOOLS = new Set(['compression', 'format', 'resize', 'watermark', 'corners', 'padding', 'crop', 'rotate', 'flip'])

const state = {
  activeTool: DEFAULT_TOOL,
  searchQuery: '',
  destinationPath: '',
  isProcessing: false,
  activeRun: null,
  settings: {
    defaultSavePath: '',
  },
  previewModal: null,
  resultView: null,
  colorPicker: null,
  sidebarCollapsed: false,
  assets: [],
  notifications: [],
  configs: {
    compression: { mode: 'quality', quality: 85, targetSizeKb: 250 },
    format: { targetFormat: 'JPEG', quality: 90, keepTransparency: true, colorProfile: 'srgb' },
    resize: { width: '1920px', height: '1080px', lockAspectRatio: true },
    watermark: { type: 'text', text: '批量处理', opacity: 60, position: 'center', fontSize: 32, color: '#FFFFFF', rotation: 0, margin: 24, tiled: false, density: 100 },
    corners: { radius: '24px', background: '#ffffff', keepTransparency: false },
    padding: { top: 20, right: 20, bottom: 20, left: 20, color: '#ffffff', opacity: 100 },
    crop: { ratio: '16:9', useCustomRatio: false, customRatioX: 16, customRatioY: 9, x: 0, y: 0, width: 1920, height: 1080 },
    rotate: { angle: 0, autoCrop: true, keepAspectRatio: false, background: '#ffffff' },
    flip: { horizontal: true, vertical: false, preserveMetadata: true, autoCropTransparent: false, outputFormat: 'Keep Original' },
    'merge-pdf': { pageSize: 'A4', margin: 'narrow', background: '#ffffff', autoPaginate: false },
    'merge-image': { direction: 'vertical', pageWidth: 1920, spacing: 24, background: '#ffffff', align: 'start' },
    'merge-gif': { width: 1080, height: 1080, interval: 0.5, background: '#ffffff', loop: true },
    'manual-crop': { ratio: '16:9 电影', ratioValue: '16:9', currentIndex: 0, completedIds: [], skippedIds: [], cropAreas: {}, dragMode: '', dragHandle: '', draftArea: null, hudCollapsed: true },
  },
}

export function getState() {
  return state
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setState(patch) {
  Object.assign(state, patch)
  emit()
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch }
  emit()
}

export function setPreviewModal(previewModal) {
  state.previewModal = previewModal
  emit()
}

export function setResultView(resultView) {
  state.resultView = resultView
  emit()
}

export function setColorPicker(colorPicker) {
  state.colorPicker = colorPicker
  emit()
}

export function updateConfig(toolId, patch) {
  state.configs[toolId] = { ...state.configs[toolId], ...patch }
  if (PREVIEW_SAVE_TOOLS.has(toolId)) {
    state.assets = state.assets.map((asset) => markAssetPreviewStale(asset, toolId))
  }
  emit()
}

export function setActiveTool(toolId) {
  state.activeTool = toolId
  emit()
}

export function setSearchQuery(value) {
  state.searchQuery = value
  emit()
}

export function replaceAssets(assets) {
  state.assets = assets.map(createAssetState)
  emit()
}

export function appendAssets(assets) {
  const known = new Set(state.assets.map((item) => item.sourcePath))
  const next = [...state.assets]
  for (const asset of assets) {
    if (!known.has(asset.sourcePath)) {
      next.push(createAssetState(asset))
      known.add(asset.sourcePath)
    }
  }
  state.assets = next
  emit()
}

export function removeAsset(assetId) {
  state.assets = state.assets.filter((item) => item.id !== assetId)
  emit()
}

export function applyRunResult(result) {
  if (!result) return

  const processedMap = new Map((result.processed || []).map((item) => [item.assetId, item]))
  const failedMap = new Map((result.failed || []).map((item) => [item.assetId, item]))
  const isMergedOutput = ['merge-pdf', 'merge-image', 'merge-gif'].includes(result.toolId)

  state.activeRun = result.runId
    ? { runId: result.runId, runFolderName: result.runFolderName || '', toolId: result.toolId, mode: result.mode || 'direct' }
    : state.activeRun

  state.assets = state.assets.map((asset, index) => {
    const processed = processedMap.get(asset.id)
    if (processed) {
      return applyProcessedAsset(asset, processed, result)
    }

    if (isMergedOutput && index === 0 && result.processed?.[0]) {
      return applyProcessedAsset(asset, result.processed[0], result)
    }

    const failed = failedMap.get(asset.id)
    if (failed) {
      return {
        ...asset,
        status: 'error',
        error: failed.error || '处理失败',
      }
    }

    return asset
  })

  if (result.mode === 'save' || result.mode === 'direct' || result.mode === 'preview-save') {
    state.resultView = buildResultView(result, state.assets)
  }

  if (result.mode === 'preview-only') {
    state.resultView = null
  }

  emit()
}

export function moveAsset(assetId, direction) {
  const index = state.assets.findIndex((item) => item.id === assetId)
  if (index === -1) return
  const nextIndex = direction === 'up' ? index - 1 : index + 1
  if (nextIndex < 0 || nextIndex >= state.assets.length) return
  const next = [...state.assets]
  ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
  state.assets = next
  emit()
}

export function pushNotification(notification) {
  const item = { id: crypto.randomUUID(), ...notification }
  state.notifications = [...state.notifications, item].slice(-4)
  emit()
  return item
}

export function dismissNotification(id) {
  state.notifications = state.notifications.filter((item) => item.id !== id)
  emit()
}

function createAssetState(asset) {
  return {
    ...asset,
    status: asset.status || 'idle',
    outputPath: asset.outputPath || '',
    error: asset.error || '',
    previewStatus: asset.previewStatus || 'idle',
    previewUrl: asset.previewUrl || '',
    stagedOutputPath: asset.stagedOutputPath || '',
    stagedOutputName: asset.stagedOutputName || '',
    stagedSizeBytes: asset.stagedSizeBytes || 0,
    stagedWidth: asset.stagedWidth || 0,
    stagedHeight: asset.stagedHeight || 0,
    savedOutputPath: asset.savedOutputPath || '',
    runId: asset.runId || '',
    runFolderName: asset.runFolderName || '',
    stagedToolId: asset.stagedToolId || '',
    saveSignature: asset.saveSignature || '',
  }
}

function markAssetPreviewStale(asset, toolId) {
  if (asset.stagedToolId !== toolId) return asset
  if (!['staged', 'saving', 'previewed'].includes(asset.previewStatus)) return asset
  return {
    ...asset,
    previewStatus: 'stale',
  }
}

function applyProcessedAsset(asset, processed, result) {
  if (result.mode === 'preview-save' || result.mode === 'preview-only') {
    const isBatchResult = result.mode === 'preview-save'
    return {
      ...asset,
      status: 'done',
      error: '',
      outputPath: '',
      previewStatus: processed.previewStatus || (isBatchResult ? 'staged' : 'previewed'),
      previewUrl: processed.previewUrl || '',
      stagedOutputPath: isBatchResult ? processed.stagedPath || '' : '',
      stagedOutputName: isBatchResult ? processed.outputName || '' : '',
      stagedSizeBytes: processed.outputSizeBytes || 0,
      stagedWidth: processed.width || 0,
      stagedHeight: processed.height || 0,
      savedOutputPath: '',
      runId: isBatchResult ? processed.runId || result.runId || '' : '',
      runFolderName: isBatchResult ? processed.runFolderName || result.runFolderName || '' : '',
      stagedToolId: result.toolId,
      saveSignature: processed.saveSignature || '',
    }
  }

  if (result.mode === 'save') {
    const nextSavedPath = processed.savedOutputPath ?? processed.outputPath ?? ''
    return {
      ...asset,
      status: 'done',
      error: '',
      outputPath: processed.outputPath || '',
      previewStatus: 'saved',
      savedOutputPath: nextSavedPath,
      stagedOutputPath: nextSavedPath ? asset.stagedOutputPath : '',
      stagedOutputName: nextSavedPath ? asset.stagedOutputName : '',
      runId: asset.runId || result.runId || '',
      runFolderName: asset.runFolderName || result.runFolderName || '',
    }
  }

  return {
    ...asset,
    status: 'done',
    outputPath: processed.outputPath || '',
    savedOutputPath: processed.outputPath || '',
    previewStatus: 'saved',
    error: '',
  }
}

function buildResultView(result, assets = []) {
  const processed = Array.isArray(result?.processed) ? result.processed : []
  const failed = Array.isArray(result?.failed) ? result.failed : []
  const assetMap = new Map((assets || []).map((asset) => [asset.id, asset]))
  const items = processed
    .map((item) => buildResultViewItem(item, assetMap.get(item.assetId)))
    .filter((item) => item.outputPath)

  return {
    runId: result?.runId || '',
    toolId: result?.toolId || '',
    mode: result?.mode || 'direct',
    items,
    failed,
    createdAt: Date.now(),
  }
}

function buildResultViewItem(processed, asset) {
  const sourceName = asset?.name || processed?.name || processed?.outputName || ''
  const resultName = processed?.outputName || getPathFileName(processed?.savedOutputPath || processed?.outputPath || processed?.stagedPath) || sourceName
  const resultWidth = processed?.width || asset?.stagedWidth || asset?.width || 0
  const resultHeight = processed?.height || asset?.stagedHeight || asset?.height || 0
  const resultSizeBytes = processed?.outputSizeBytes || asset?.stagedSizeBytes || asset?.sizeBytes || 0
  const outputPath = processed?.savedOutputPath || processed?.outputPath || processed?.stagedPath || asset?.savedOutputPath || asset?.stagedOutputPath || ''

  return {
    assetId: processed?.assetId || asset?.id || '',
    name: sourceName,
    beforeUrl: asset?.thumbnailUrl || '',
    afterUrl: processed?.previewUrl || processed?.outputPath || processed?.savedOutputPath || processed?.stagedPath || '',
    outputPath,
    source: {
      name: sourceName,
      sizeBytes: asset?.sizeBytes || 0,
      width: asset?.width || 0,
      height: asset?.height || 0,
    },
    result: {
      name: resultName,
      sizeBytes: resultSizeBytes,
      width: resultWidth,
      height: resultHeight,
    },
    summary: processed?.summary || '',
  }
}

function getPathFileName(value = '') {
  const normalized = String(value || '').replaceAll('\\', '/')
  return normalized.split('/').pop() || ''
}

function emit() {
  for (const listener of listeners) listener(state)
}
