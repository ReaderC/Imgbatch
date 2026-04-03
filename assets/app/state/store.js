import { DEFAULT_TOOL } from '../config/tools.js'

const listeners = new Set()
const PREVIEW_SAVE_TOOLS = new Set(['compression', 'format', 'resize', 'watermark', 'corners', 'padding', 'crop', 'rotate', 'flip'])
const MERGE_OUTPUT_TOOLS = new Set(['merge-pdf', 'merge-image', 'merge-gif'])
let batchDepth = 0
let emitQueued = false

const DEFAULT_CONFIGS = {
  compression: { mode: 'quality', quality: 85, targetSizeKb: 250 },
  format: { mode: 'quality', targetFormat: 'JPEG', quality: 90, keepTransparency: true, colorProfile: 'srgb' },
  resize: { sizeMode: 'manual', width: '1920px', height: '1080px', lockAspectRatio: true, quality: 90 },
  watermark: { type: 'text', text: '批量处理', opacity: 60, position: 'center', fontSize: 32, color: '#FFFFFF', rotation: 0, margin: 24, tiled: false, density: 100, quality: 90 },
  corners: { radius: '24px', background: '#ffffff', keepTransparency: false, quality: 90 },
  padding: { top: '20px', right: '20px', bottom: '20px', left: '20px', unifiedMarginEnabled: false, unifiedMargin: '20px', color: '#ffffff', opacity: 100, quality: 90 },
  crop: { mode: 'ratio', ratio: '16:9', useCustomRatio: false, customRatioX: 16, customRatioY: 9, x: '0px', y: '0px', width: 1920, height: 1080, quality: 90 },
  rotate: { angle: 0, autoCrop: true, keepAspectRatio: false, background: '#ffffff', quality: 90 },
  flip: { horizontal: true, vertical: false, preserveMetadata: true, autoCropTransparent: false, outputFormat: 'Keep Original', quality: 90 },
  'merge-pdf': { pageSize: 'A4', margin: 'narrow', background: '#ffffff', autoPaginate: false },
  'merge-image': { direction: 'vertical', pageWidth: 1920, spacing: 24, background: '#ffffff', align: 'start', preventUpscale: false, useMaxAssetSize: false, outputFormat: 'JPEG', quality: 90 },
  'merge-gif': { width: 1080, height: 1080, interval: 500, background: '#ffffff', loop: true, useMaxAssetSize: false },
  'manual-crop': {
    ratio: '16:9 电影',
    ratioValue: '16:9',
    currentIndex: 0,
    completedIds: [],
    cropAreas: {},
    helpOpen: false,
    lastCompletedCropSeed: null,
    angle: 0,
    flipHorizontal: false,
    flipVertical: false,
    viewScale: 1,
    viewOffsetX: 0,
    viewOffsetY: 0,
    stageWidth: 1600,
    stageHeight: 900,
    outerAreaMode: 'trim',
    snapEnabled: true,
    snapStrength: 'low',
    lockAspectRatio: false,
    sessionOutputPath: '',
    keepOriginalFormat: true,
  },
}

function cloneDefaultConfigs() {
  return Object.fromEntries(
    Object.entries(DEFAULT_CONFIGS).map(([toolId, config]) => [toolId, { ...config }]),
  )
}

const state = {
  activeTool: DEFAULT_TOOL,
  lastWorkspaceTool: DEFAULT_TOOL,
  searchQuery: '',
  destinationPath: '',
  isProcessing: false,
  cancelRequested: false,
  processingProgress: null,
  activeRun: null,
  settings: {
    defaultSavePath: '',
    saveLocationMode: 'source',
    saveLocationCustomPath: '',
    performanceMode: 'balanced',
    queueThumbnailSize: '128',
    defaultPresetByTool: {},
  },
  settingsDialog: null,
  presetDialog: null,
  confirmDialog: null,
  presetsByTool: {},
  previewModal: null,
  resultView: null,
  sidebarCollapsed: false,
  assets: [],
  notifications: [],
  configs: cloneDefaultConfigs(),
}

export function getState() {
  return state
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function batchStateUpdates(task) {
  if (typeof task !== 'function') return
  batchDepth += 1
  try {
    task()
  } finally {
    batchDepth = Math.max(0, batchDepth - 1)
    if (!batchDepth && emitQueued) {
      emitQueued = false
      emitNow()
    }
  }
}

export function setState(patch) {
  const entries = Object.entries(patch || {})
  if (!entries.length) return
  let changed = false
  for (const [key, value] of entries) {
    if (state[key] !== value) {
      changed = true
      break
    }
  }
  if (!changed) return
  Object.assign(state, patch)
  emit()
}

export function updateSettings(patch) {
  const entries = Object.entries(patch || {})
  if (!entries.length) return
  const nextSettings = { ...state.settings }
  let changed = false
  for (const [key, value] of entries) {
    if (nextSettings[key] !== value) {
      nextSettings[key] = value
      changed = true
    }
  }
  if (!changed) return
  state.settings = nextSettings
  emit()
}

export function setSettingsDialog(settingsDialog) {
  if (state.settingsDialog === settingsDialog) return
  state.settingsDialog = settingsDialog
  emit()
}

export function setPresetDialog(presetDialog) {
  if (state.presetDialog === presetDialog) return
  state.presetDialog = presetDialog
  emit()
}

export function setConfirmDialog(confirmDialog) {
  if (state.confirmDialog === confirmDialog) return
  state.confirmDialog = confirmDialog
  emit()
}

export function setToolPresets(toolId, presets, emitChange = true) {
  const nextPresets = Array.isArray(presets) ? presets : []
  if (state.presetsByTool?.[toolId] === nextPresets) return
  state.presetsByTool = {
    ...state.presetsByTool,
    [toolId]: nextPresets,
  }
  if (emitChange) emit()
}

export function setPreviewModal(previewModal) {
  if (state.previewModal === previewModal) return
  state.previewModal = previewModal
  emit()
}

export function setResultView(resultView) {
  if (state.resultView === resultView) return
  state.resultView = resultView
  emit()
}

function markPreviewAssetsStale(toolId) {
  if (!PREVIEW_SAVE_TOOLS.has(toolId)) return
  let nextAssets = null
  for (let index = 0; index < state.assets.length; index += 1) {
    const asset = state.assets[index]
    const nextAsset = markAssetPreviewStale(asset, toolId)
    if (nextAsset !== asset) {
      if (!nextAssets) nextAssets = [...state.assets]
      nextAssets[index] = nextAsset
    }
  }
  if (nextAssets) state.assets = nextAssets
}

export function updateConfig(toolId, patch) {
  const currentConfig = state.configs[toolId] || {}
  const entries = Object.entries(patch || {})
  if (!entries.length) return
  const hasConfigChanges = entries.some(([key, value]) => currentConfig[key] !== value)
  if (!hasConfigChanges) return
  state.configs[toolId] = { ...currentConfig, ...patch }
  markPreviewAssetsStale(toolId)
  emit()
}

export function replaceConfig(toolId, config) {
  const currentConfig = state.configs[toolId] || {}
  const nextConfig = {
    ...(DEFAULT_CONFIGS[toolId] ? { ...DEFAULT_CONFIGS[toolId] } : {}),
    ...(config && typeof config === 'object' ? config : {}),
  }
  const currentKeys = Object.keys(currentConfig)
  const nextKeys = Object.keys(nextConfig)
  const changed = currentKeys.length !== nextKeys.length
    || nextKeys.some((key) => currentConfig[key] !== nextConfig[key])
  if (!changed) return
  state.configs[toolId] = nextConfig
  markPreviewAssetsStale(toolId)
  emit()
}

export function setActiveTool(toolId) {
  const nextToolId = String(toolId || '').trim() || DEFAULT_TOOL
  const previousToolId = state.activeTool
  const previousLastWorkspaceTool = state.lastWorkspaceTool
  if (nextToolId !== 'manual-crop') {
    state.lastWorkspaceTool = nextToolId
  } else if (previousToolId && previousToolId !== 'manual-crop') {
    state.lastWorkspaceTool = previousToolId
  }
  if (previousToolId === nextToolId && previousLastWorkspaceTool === state.lastWorkspaceTool) return
  state.activeTool = nextToolId
  emit()
}

export function setSearchQuery(value) {
  if (state.searchQuery === value) return
  state.searchQuery = value
  emit()
}

export function replaceAssets(assets) {
  const nextAssets = assets.map(createAssetState)
  if (
    nextAssets.length === state.assets.length
    && nextAssets.every((asset, index) => state.assets[index]?.sourcePath === asset.sourcePath)
  ) return
  state.assets = nextAssets
  emit()
}

export function appendAssets(assets) {
  const known = new Set(state.assets.map((item) => item.sourcePath))
  const next = [...state.assets]
  let appended = false
  for (const asset of assets) {
    if (!known.has(asset.sourcePath)) {
      next.push(createAssetState(asset))
      known.add(asset.sourcePath)
      appended = true
    }
  }
  if (!appended) return
  state.assets = next
  emit()
}

export function removeAsset(assetId) {
  const assetIndex = state.assets.findIndex((item) => item.id === assetId)
  if (assetIndex === -1) return
  const nextAssets = [...state.assets]
  nextAssets.splice(assetIndex, 1)
  state.assets = nextAssets
  emit()
}

export function updateAssetListThumbnail(assetId, listThumbnailUrl, emitChange = true) {
  if (!assetId || !listThumbnailUrl) return
  let changed = false
  if (emitChange) {
    const assetIndex = state.assets.findIndex((asset) => asset.id === assetId)
    if (assetIndex !== -1 && state.assets[assetIndex]?.listThumbnailUrl !== listThumbnailUrl) {
      const nextAssets = [...state.assets]
      nextAssets[assetIndex] = {
        ...state.assets[assetIndex],
        listThumbnailUrl,
      }
      state.assets = nextAssets
      changed = true
    }
  } else {
    const asset = state.assets.find((entry) => entry.id === assetId)
    if (asset && asset.listThumbnailUrl !== listThumbnailUrl) {
      asset.listThumbnailUrl = listThumbnailUrl
      changed = true
    }
  }
  if (changed && emitChange) emit()
}

export function applyRunResult(result) {
  if (!result) return

  const processedMap = new Map((result.processed || []).map((item) => [item.assetId, item]))
  const failedMap = new Map((result.failed || []).map((item) => [item.assetId, item]))
  const isMergedOutput = MERGE_OUTPUT_TOOLS.has(result.toolId)

  state.activeRun = result.runId
    ? { runId: result.runId, runFolderName: result.runFolderName || '', toolId: result.toolId, mode: result.mode || 'direct' }
    : state.activeRun

  let nextAssets = null
  for (let index = 0; index < state.assets.length; index += 1) {
    const asset = state.assets[index]
    const processed = processedMap.get(asset.id)
    if (processed) {
      const nextAsset = applyProcessedAsset(asset, processed, result)
      if (nextAsset !== asset) {
        if (!nextAssets) nextAssets = [...state.assets]
        nextAssets[index] = nextAsset
      }
      continue
    }

    if (isMergedOutput && index === 0 && result.processed?.[0]) {
      const nextAsset = applyProcessedAsset(asset, result.processed[0], result)
      if (nextAsset !== asset) {
        if (!nextAssets) nextAssets = [...state.assets]
        nextAssets[index] = nextAsset
      }
      continue
    }

    const failed = failedMap.get(asset.id)
    if (failed) {
      const nextAsset = mergeAssetPatch(asset, {
        status: 'error',
        error: failed.error || '处理失败',
      })
      if (nextAsset !== asset) {
        if (!nextAssets) nextAssets = [...state.assets]
        nextAssets[index] = nextAsset
      }
      continue
    }
  }

  if (nextAssets) {
    state.assets = nextAssets
  }

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

export function moveAssetToTarget(assetId, targetAssetId, placement = 'before') {
  if (!assetId || !targetAssetId || assetId === targetAssetId) return
  const fromIndex = state.assets.findIndex((item) => item.id === assetId)
  const targetIndex = state.assets.findIndex((item) => item.id === targetAssetId)
  if (fromIndex === -1 || targetIndex === -1) return

  const next = [...state.assets]
  const [moved] = next.splice(fromIndex, 1)
  const adjustedTargetIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex
  const insertIndex = placement === 'after' ? adjustedTargetIndex + 1 : adjustedTargetIndex
  next.splice(Math.max(0, Math.min(insertIndex, next.length)), 0, moved)
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
  const normalizedFormat = normalizeAssetFormat(asset?.inputFormat || asset?.ext)
  return {
    ...asset,
    listThumbnailUrl: asset.listThumbnailUrl || asset.thumbnailUrl || '',
    ext: normalizedFormat || asset.ext || '',
    inputFormat: normalizedFormat || '',
    status: asset.status || 'idle',
    outputPath: asset.outputPath || '',
    error: asset.error || '',
    warning: asset.warning || '',
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

function normalizeAssetFormat(value) {
  const format = String(value || '').trim().toLowerCase()
  if (format === 'jpg') return 'jpeg'
  if (format === 'tif') return 'tiff'
  return format
}

function applyProcessedAsset(asset, processed, result) {
  const targetKb = Number(result?.config?.targetSizeKb) || 0
  const targetBytes = targetKb > 0 ? targetKb * 1024 : 0
  const derivedWarning = processed.warning
    || (result?.toolId === 'compression' && result?.config?.mode === 'target' && targetBytes > 0 && Number(processed?.outputSizeBytes) > targetBytes
      ? `未达到目标体积 ${targetKb} KB，当前结果约 ${Math.max(1, Math.round(Number(processed?.outputSizeBytes || 0) / 1024))} KB。`
      : '')

  if (result.mode === 'preview-save' || result.mode === 'preview-only') {
    const isBatchResult = result.mode === 'preview-save'
    return mergeAssetPatch(asset, {
      status: 'done',
      error: '',
      warning: derivedWarning,
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
    })
  }

  if (result.mode === 'save') {
    const nextSavedPath = processed.savedOutputPath ?? processed.outputPath ?? ''
    return mergeAssetPatch(asset, {
      status: 'done',
      error: '',
      warning: derivedWarning,
      outputPath: processed.outputPath || '',
      previewStatus: 'saved',
      savedOutputPath: nextSavedPath,
      stagedOutputName: processed.outputName || asset.stagedOutputName || '',
      stagedSizeBytes: processed.outputSizeBytes || asset.stagedSizeBytes || 0,
      stagedWidth: processed.width || asset.stagedWidth || 0,
      stagedHeight: processed.height || asset.stagedHeight || 0,
      stagedOutputPath: nextSavedPath ? asset.stagedOutputPath : '',
      runId: asset.runId || result.runId || '',
      runFolderName: asset.runFolderName || result.runFolderName || '',
    })
  }

  return mergeAssetPatch(asset, {
    status: 'done',
    outputPath: processed.outputPath || '',
    savedOutputPath: processed.outputPath || '',
    previewStatus: 'saved',
    stagedOutputName: processed.outputName || asset.stagedOutputName || '',
    stagedSizeBytes: processed.outputSizeBytes || asset.stagedSizeBytes || 0,
    stagedWidth: processed.width || asset.stagedWidth || 0,
    stagedHeight: processed.height || asset.stagedHeight || 0,
    error: '',
    warning: derivedWarning,
  })
}

function mergeAssetPatch(asset, patch) {
  if (!asset || !patch || typeof patch !== 'object') return asset
  let changed = false
  for (const [key, value] of Object.entries(patch)) {
    if (asset[key] !== value) {
      changed = true
      break
    }
  }
  return changed ? { ...asset, ...patch } : asset
}

function buildResultView(result, assets = []) {
  const processed = Array.isArray(result?.processed) ? result.processed : []
  const failed = Array.isArray(result?.failed) ? result.failed : []
  const isMergedOutput = MERGE_OUTPUT_TOOLS.has(result?.toolId)
  const assetMap = isMergedOutput ? null : new Map((assets || []).map((asset) => [asset.id, asset]))
  const items = []
  let totalSourceSizeBytes = 0
  let totalResultSizeBytes = 0
  for (const item of processed) {
    const nextItem = isMergedOutput
      ? buildMergedResultViewItem(item, assets)
      : buildResultViewItem(item, assetMap?.get(item.assetId))
    if (nextItem.outputPath) {
      items.push(nextItem)
      totalSourceSizeBytes += Math.max(0, Number(nextItem.source?.sizeBytes) || 0)
      totalResultSizeBytes += Math.max(0, Number(nextItem.result?.sizeBytes) || 0)
    }
  }

  return {
    runId: result?.runId || '',
    toolId: result?.toolId || '',
    mode: result?.mode || 'direct',
    items,
    failed,
    elapsedMs: Number(result?.elapsedMs) || 0,
    totalSourceSizeBytes,
    totalResultSizeBytes,
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

function buildMergedResultViewItem(processed, assets = []) {
  const sourceAssets = Array.isArray(assets) ? assets : []
  const sourceName = processed?.name || processed?.outputName || (sourceAssets[0]?.name || '')
  const resultName = processed?.outputName || getPathFileName(processed?.savedOutputPath || processed?.outputPath || processed?.stagedPath) || sourceName
  const resultWidth = processed?.width || 0
  const resultHeight = processed?.height || 0
  const resultSizeBytes = processed?.outputSizeBytes || 0
  const outputPath = processed?.savedOutputPath || processed?.outputPath || processed?.stagedPath || ''
  const sourceSizeBytes = sourceAssets.reduce((sum, asset) => sum + Math.max(0, Number(asset?.sizeBytes) || 0), 0)
  const sourceCount = sourceAssets.length

  return {
    assetId: processed?.assetId || sourceAssets[0]?.id || '',
    name: sourceName,
    beforeUrl: sourceAssets[0]?.thumbnailUrl || '',
    afterUrl: processed?.previewUrl || processed?.outputPath || processed?.savedOutputPath || processed?.stagedPath || '',
    outputPath,
    source: {
      name: sourceName,
      sizeBytes: sourceSizeBytes,
      width: 0,
      height: 0,
      dimensionsText: sourceCount ? `共 ${sourceCount} 张输入` : '-',
      isAggregate: true,
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

function emitNow() {
  for (const listener of listeners) listener(state)
}

function emit() {
  if (batchDepth > 0) {
    emitQueued = true
    return
  }
  emitNow()
}
