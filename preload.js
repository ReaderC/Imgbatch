const { nativeImage, shell } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.tif', '.avif', '.ico'
])
const SHARP_INPUT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'avif', 'gif'])
const SHARP_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp', 'tiff', 'avif', 'gif'])
const CUSTOM_OUTPUT_FORMATS = new Set(['bmp', 'ico'])
const LOSSY_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp', 'avif', 'gif'])
const ALPHA_CAPABLE_FORMATS = new Set(['png', 'webp', 'tiff', 'avif', 'gif', 'ico'])
const OUTPUT_DIR_NAME = 'Imgbatch Output'
const PREVIEW_DIR_NAME = 'Imgbatch Preview'
const SETTINGS_STORAGE_KEY = 'imgbatch:settings'
const SAVE_LOCATION_MODES = new Set(['source', 'downloads', 'pictures', 'desktop', 'custom'])
const PERFORMANCE_MODES = new Set(['compatible', 'balanced', 'max'])
const PREVIEW_SAVE_TOOLS = new Set(['compression', 'format', 'resize', 'watermark', 'corners', 'padding', 'crop', 'rotate', 'flip'])
const CPU_COUNT = Math.max(1, os.cpus()?.length || 1)
const HEAVY_ASSET_TOOLS = new Set(['compression', 'watermark', 'corners'])
const MEDIUM_ASSET_TOOLS = new Set(['format', 'resize', 'padding', 'crop', 'manual-crop', 'rotate', 'flip'])
const PDF_PAGE_SIZES = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
}

const TOOL_LABELS = {
  compression: '图片压缩',
  format: '格式转换',
  resize: '修改尺寸',
  watermark: '添加水印',
  corners: '添加圆角',
  padding: '补边留白',
  crop: '裁剪',
  rotate: '旋转',
  flip: '翻转',
  'merge-pdf': '合并为 PDF',
  'merge-image': '合并为图片',
  'merge-gif': '合并为 GIF',
  'manual-crop': '手动裁剪',
}

function summarizeConfig(toolId, config = {}) {
  if (toolId === 'compression') return config.mode === 'quality' ? `压缩质量 ${config.quality}%` : `目标大小 ${config.targetSizeKb} KB`
  if (toolId === 'format') return `输出 ${config.targetFormat}`
  if (toolId === 'resize') return `尺寸 ${config.width.value}${config.width.unit} × ${config.height.value}${config.height.unit}`
  if (toolId === 'watermark') return `${config.type === 'text' ? '文本' : '图片'}水印 ${config.position}`
  if (toolId === 'corners') return `圆角 ${formatMeasureValue(config.radius, config.unit || 'px')}`
  if (toolId === 'padding') return `留白 ${config.top}/${config.right}/${config.bottom}/${config.left}px`
  if (toolId === 'crop') return `裁剪 ${config.ratio}`
  if (toolId === 'rotate') return `旋转 ${toNumber(config.angle, 0)}°`
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

function toNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const normalized = String(value ?? '').trim().replace(/[a-zA-Z%]+$/g, '')
  const numeric = Number.parseFloat(normalized)
  return Number.isFinite(numeric) ? numeric : fallback
}

function toInteger(value, fallback = 0) {
  return Math.round(toNumber(value, fallback))
}

function clampNumber(value, min, max, fallback = min) {
  const numeric = toNumber(value, fallback)
  return Math.min(max, Math.max(min, numeric))
}

function sanitizeText(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function pickOption(value, options, fallback) {
  return options.includes(value) ? value : fallback
}

function uniqueStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => sanitizeText(value)).filter(Boolean)))
}

function inferMeasureUnit(value, fallbackUnit = 'px') {
  const raw = String(value ?? '').trim()
  if (raw.endsWith('%')) return '%'
  if (raw.endsWith('px')) return 'px'
  return fallbackUnit
}

function normalizeMeasure(value, fallbackValue, fallbackUnit = 'px') {
  const raw = String(value ?? '').trim()
  const unit = inferMeasureUnit(raw, fallbackUnit)
  const numericValue = Math.max(0, toNumber(raw, fallbackValue))
  return {
    value: numericValue,
    unit,
    raw: raw || `${fallbackValue}${unit}`,
  }
}

function formatMeasureValue(value, fallbackUnit = 'px') {
  const raw = String(value ?? '').trim()
  if (!raw) return `0${fallbackUnit}`
  if (raw.endsWith('px') || raw.endsWith('%')) return raw
  return `${raw}${fallbackUnit}`
}

function normalizeRunAssets(assets = []) {
  return assets.map((asset, index) => {
    const sourcePath = sanitizeText(asset?.sourcePath)
    const resolvedSourcePath = sourcePath ? path.resolve(sourcePath) : ''
    const sourceDir = resolvedSourcePath ? path.dirname(resolvedSourcePath) : ''
    const fallbackName = resolvedSourcePath ? path.basename(resolvedSourcePath) : `asset-${index + 1}`

    return {
      id: sanitizeText(asset?.id, `asset-${index + 1}`),
      sourcePath: resolvedSourcePath,
      sourceDir,
      name: sanitizeText(asset?.name, fallbackName),
      ext: sanitizeText(asset?.ext, resolvedSourcePath ? path.extname(resolvedSourcePath).replace('.', '').toLowerCase() : ''),
      width: Math.max(0, toInteger(asset?.width, 0)),
      height: Math.max(0, toInteger(asset?.height, 0)),
      sizeBytes: Math.max(0, toInteger(asset?.sizeBytes, 0)),
    }
  })
}

function getCommonParentDirectory(paths = []) {
  const absolutePaths = paths.map((item) => sanitizeText(item)).filter(Boolean).map((item) => path.resolve(item))
  if (!absolutePaths.length) return ''

  const roots = Array.from(new Set(absolutePaths.map((item) => path.parse(item).root.toLowerCase())))
  if (roots.length !== 1) return ''

  const firstRoot = path.parse(absolutePaths[0]).root
  const segmentLists = absolutePaths.map((item) => item.slice(path.parse(item).root.length).split(path.sep).filter(Boolean))
  const commonSegments = []

  for (let index = 0; index < segmentLists[0].length; index += 1) {
    const segment = segmentLists[0][index]
    const matches = segmentLists.every((segments) => segments[index] && segments[index].toLowerCase() === segment.toLowerCase())
    if (!matches) break
    commonSegments.push(segment)
  }

  if (!commonSegments.length) return ''
  return path.join(firstRoot, ...commonSegments)
}

function getWindowsKnownFolderFromRegistry(valueName, fallbackPath) {
  try {
    const output = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', valueName], {
      encoding: 'utf8',
      windowsHide: true,
    })
    const line = output.split(/\r?\n/).find((item) => item.includes(valueName))
    if (!line) return fallbackPath
    const match = line.match(/REG_\w+\s+(.+)$/)
    if (!match?.[1]) return fallbackPath
    const resolved = match[1].trim().replace(/%([^%]+)%/g, (_, key) => process.env[key] || '')
    return resolved || fallbackPath
  } catch {
    return fallbackPath
  }
}

function getSystemFolderPath(name) {
  const hostApi = getHostApi()
  const names = Array.isArray(name) ? name : [name]
  for (const item of names) {
    const resolved = sanitizeText(hostApi.getPath?.(item))
    if (resolved) return path.resolve(resolved)
  }

  if (process.platform === 'win32') {
    if (names.includes('desktop')) return path.resolve(getWindowsKnownFolderFromRegistry('Desktop', path.join(os.homedir(), 'Desktop')))
    if (names.includes('downloads')) return path.resolve(getWindowsKnownFolderFromRegistry('{374DE290-123F-4565-9164-39C4925E467B}', path.join(os.homedir(), 'Downloads')))
    if (names.includes('pictures')) return path.resolve(getWindowsKnownFolderFromRegistry('My Pictures', path.join(os.homedir(), 'Pictures')))
  }

  if (names.includes('desktop')) return path.join(os.homedir(), 'Desktop')
  if (names.includes('downloads')) return path.join(os.homedir(), 'Downloads')
  if (names.includes('pictures')) return path.join(os.homedir(), 'Pictures')
  return ''
}

function resolveConfiguredSavePath(settings = {}, assets = []) {
  const mode = SAVE_LOCATION_MODES.has(settings?.saveLocationMode) ? settings.saveLocationMode : 'source'
  const customPath = sanitizeText(settings?.saveLocationCustomPath || settings?.defaultSavePath)

  if (mode === 'custom' && customPath) {
    return {
      destinationPath: path.resolve(customPath),
      strategy: 'custom-setting',
    }
  }

  if (mode === 'downloads') {
    const targetPath = getSystemFolderPath(['downloads', 'download'])
    return {
      destinationPath: targetPath,
      strategy: 'downloads',
    }
  }

  if (mode === 'pictures') {
    const targetPath = getSystemFolderPath(['pictures', 'picture', 'images'])
    return {
      destinationPath: targetPath,
      strategy: 'pictures',
    }
  }

  if (mode === 'desktop') {
    const targetPath = getSystemFolderPath('desktop')
    return {
      destinationPath: targetPath,
      strategy: 'desktop',
    }
  }

  const sourceDirs = Array.from(new Set(assets.map((asset) => asset.sourceDir).filter(Boolean)))
  if (!sourceDirs.length) {
    return {
      destinationPath: '',
      strategy: 'unresolved',
    }
  }

  if (sourceDirs.length === 1) {
    return {
      destinationPath: sourceDirs[0],
      strategy: 'source-directory',
    }
  }

  const commonParent = getCommonParentDirectory(sourceDirs)
  if (commonParent) {
    return {
      destinationPath: commonParent,
      strategy: 'shared-parent',
    }
  }

  return {
    destinationPath: sourceDirs[0],
    strategy: 'first-source',
  }
}

function resolveDestinationPath(destinationPath, assets = [], settings = {}) {
  const customDestination = sanitizeText(destinationPath)
  if (customDestination) {
    return {
      destinationPath: path.resolve(customDestination),
      strategy: 'custom',
    }
  }

  return resolveConfiguredSavePath(settings, assets)
}

function buildRunFolderName(createdAt, toolId) {
  const stamp = new Date(createdAt || Date.now()).toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '')
  return `${stamp}-${toolId}`
}

function createRunDescriptor(baseDestinationPath, toolId, createdAt) {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const runFolderName = buildRunFolderName(createdAt, toolId)
  const runPath = path.join(baseDestinationPath, runFolderName)
  return {
    runId,
    runFolderName,
    runPath,
  }
}

function createPreviewDirectory(toolId, createdAt) {
  const basePreviewPath = path.join(os.tmpdir(), PREVIEW_DIR_NAME)
  const runFolderName = buildRunFolderName(createdAt, toolId)
  const runPath = path.join(basePreviewPath, runFolderName)
  return {
    basePreviewPath,
    runFolderName,
    runPath,
  }
}

function getAppSettings() {
  const hostApi = getHostApi()
  return hostApi.dbStorage?.getItem?.(SETTINGS_STORAGE_KEY) || {}
}

function isPreviewSaveTool(toolId) {
  return PREVIEW_SAVE_TOOLS.has(toolId)
}

function createPreviewSignature(toolId, config) {
  return JSON.stringify({ toolId, config })
}

function toPublicFileUrl(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/')
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`
  return encodeURI(`file://${prefixed}`)
}

async function readOutputMeta(outputPath, sharpLib = null) {
  const stat = fs.statSync(outputPath)
  let width = 0
  let height = 0

  if (sharpLib) {
    try {
      const metadata = await sharpLib(outputPath).metadata()
      width = metadata.width || 0
      height = metadata.height || 0
    } catch {
      width = 0
      height = 0
    }
  } else {
    const image = nativeImage.createFromPath(outputPath)
    const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize()
    width = size.width
    height = size.height
  }

  return {
    outputPath,
    outputName: path.basename(outputPath),
    outputSizeBytes: stat.size,
    width,
    height,
  }
}

function createOutputMeta(outputPath, info = {}, fallback = {}) {
  return {
    outputPath,
    outputName: path.basename(outputPath),
    outputSizeBytes: Number(info.size) || Number(fallback.outputSizeBytes) || 0,
    width: Number(info.width) || Number(fallback.width) || 0,
    height: Number(info.height) || Number(fallback.height) || 0,
  }
}

async function writeTransformedAsset(transformer, format, quality, outputPath, fallback = {}) {
  const info = await withOutputFormat(transformer, format, quality).toFile(outputPath)
  return createOutputMeta(outputPath, info, fallback)
}

function resolveSaveTargetPath(baseDestinationPath, runFolderName, outputName) {
  const finalDirectory = path.join(baseDestinationPath, runFolderName)
  ensureDirectory(finalDirectory)
  return path.join(finalDirectory, outputName)
}

async function savePreviewResult(baseDestinationPath, runFolderName, stagedItem) {
  const sourcePath = sanitizeText(stagedItem?.stagedPath)
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('预览结果不存在，无法保存')
  }

  const targetPath = resolveSaveTargetPath(baseDestinationPath, runFolderName, stagedItem.outputName || path.basename(sourcePath))
  if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
    fs.copyFileSync(sourcePath, targetPath)
  }

  return readOutputMeta(targetPath)
}

function normalizePreviewResult(item = {}, payload) {
  const isBatchPreview = payload.mode === 'preview-save'
  const stagedPath = item.stagedPath || item.outputPath || ''
  const previewUrl = item.previewUrl || (stagedPath ? toPublicFileUrl(stagedPath) : '')
  const cacheBustedPreviewUrl = previewUrl && payload.runId ? `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(payload.runId)}` : previewUrl
  return {
    ...item,
    mode: payload.mode,
    previewStatus: isBatchPreview ? 'staged' : 'previewed',
    stagedPath,
    previewUrl: cacheBustedPreviewUrl,
    saveSignature: createPreviewSignature(payload.toolId, payload.config),
    runId: payload.runId,
    runFolderName: payload.runFolderName,
    savedOutputPath: item.savedOutputPath || '',
  }
}

function normalizeDirectResult(item = {}) {
  return {
    ...item,
    mode: 'direct',
    previewStatus: 'saved',
    savedOutputPath: item.outputPath || '',
  }
}

async function stageResultToProcessed(asset, result, payload, sharpLib = null) {
  const stagedPath = typeof result === 'string' ? result : result.outputPath
  const meta = typeof result === 'object' && result?.outputPath && result?.outputSizeBytes
    ? createOutputMeta(stagedPath, result, result)
    : await readOutputMeta(stagedPath, sharpLib)
  return normalizePreviewResult({
    assetId: asset.id,
    name: asset.name,
    outputName: meta.outputName,
    stagedPath,
    previewUrl: toPublicFileUrl(stagedPath),
    outputSizeBytes: typeof result === 'object' && result.outputSizeBytes ? result.outputSizeBytes : meta.outputSizeBytes,
    width: meta.width,
    height: meta.height,
  }, payload)
}

async function directResultToProcessed(asset, result, sharpLib = null) {
  const outputPath = typeof result === 'string' ? result : result.outputPath
  const meta = typeof result === 'object' && result?.outputPath && result?.outputSizeBytes
    ? createOutputMeta(outputPath, result, result)
    : await readOutputMeta(outputPath, sharpLib)
  return normalizeDirectResult({
    assetId: asset.id,
    name: asset.name,
    outputPath,
    outputName: meta.outputName,
    outputSizeBytes: typeof result === 'object' && result.outputSizeBytes ? result.outputSizeBytes : meta.outputSizeBytes,
    width: meta.width,
    height: meta.height,
  })
}

function mergeResultToProcessed(result) {
  return normalizeDirectResult(result)
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return []

  const workerCount = Math.max(1, Math.min(concurrency || 1, list.length))
  const results = new Array(list.length)
  let cursor = 0

  async function worker() {
    while (cursor < list.length) {
      const index = cursor
      cursor += 1
      results[index] = await iteratee(list[index], index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

function getAssetProcessingConcurrency(payload) {
  if (payload.mode === 'preview-only') return 1
  if (isMergeTool(payload.toolId)) return 1
  if (payload.assets.length <= 1) return 1
  const profile = getPerformanceProfile(getAppSettings().performanceMode)
  if (HEAVY_ASSET_TOOLS.has(payload.toolId)) {
    return Math.min(payload.assets.length, profile.heavyConcurrency)
  }
  if (MEDIUM_ASSET_TOOLS.has(payload.toolId)) {
    return Math.min(payload.assets.length, profile.mediumConcurrency)
  }
  return Math.min(payload.assets.length, profile.defaultConcurrency)
}

function formatResultMessage(payload, processed, failed) {
  const ok = processed.length > 0 && failed.length === 0
  const partial = processed.length > 0 && failed.length > 0
  if (payload.mode === 'preview-only') {
    if (ok) return `已生成 ${payload.toolLabel} 单张预览，可继续调整参数。`
    if (partial) return `${payload.toolLabel} 预览部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
    return `${payload.toolLabel} 预览失败：${failed[0]?.error || '没有可处理的图片'}`
  }
  if (payload.mode === 'preview-save') {
    if (ok) return `已生成 ${payload.toolLabel} 处理结果：${processed.length} 项，可继续保存。`
    if (partial) return `${payload.toolLabel} 处理部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
    return `${payload.toolLabel} 处理失败：${failed[0]?.error || '没有可处理的图片'}`
  }
  if (ok) return `已完成 ${payload.toolLabel}：${processed.length} 项，输出到 ${payload.destinationPath}`
  if (partial) return `${payload.toolLabel} 部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
  return `${payload.toolLabel} 执行失败：${failed[0]?.error || '没有可处理的图片'}`
}

function createResultEnvelope(payload, processed, failed) {
  const ok = processed.length > 0 && failed.length === 0
  const partial = processed.length > 0 && failed.length > 0
  return {
    ok,
    partial,
    ...payload,
    processed,
    failed,
    message: formatResultMessage(payload, processed, failed),
  }
}

function buildSavedResult(payload, processed, failed) {
  return createResultEnvelope({ ...payload, mode: 'save' }, processed, failed)
}

function buildSavedResultWithReveal(payload, processed, failed) {
  return revealResultDirectoryIfNeeded(buildSavedResult(payload, processed, failed))
}

function buildSettingsPayload(settings = {}) {
  const defaultPresetByTool = settings?.defaultPresetByTool && typeof settings.defaultPresetByTool === 'object'
    ? Object.fromEntries(Object.entries(settings.defaultPresetByTool).map(([toolId, presetId]) => [sanitizeText(toolId), sanitizeText(presetId)]).filter((entry) => entry[0] && entry[1]))
    : {}
  const saveLocationMode = SAVE_LOCATION_MODES.has(settings?.saveLocationMode) ? settings.saveLocationMode : 'source'
  const saveLocationCustomPath = sanitizeText(settings?.saveLocationCustomPath || settings?.defaultSavePath)
  const performanceMode = PERFORMANCE_MODES.has(settings?.performanceMode) ? settings.performanceMode : 'balanced'
  return {
    defaultSavePath: saveLocationMode === 'custom' ? saveLocationCustomPath : '',
    saveLocationMode,
    saveLocationCustomPath,
    performanceMode,
    defaultPresetByTool,
  }
}

function createPreviewPayload(toolId, config, assets, destinationPath, mode = 'preview-save') {
  const payload = prepareRunPayload(toolId, config, assets, destinationPath)
  if (mode !== 'preview-only') {
    return {
      ...payload,
      mode,
    }
  }

  const preview = createPreviewDirectory(toolId, payload.createdAt)
  return {
    ...payload,
    destinationPath: preview.runPath,
    baseDestinationPath: preview.basePreviewPath,
    runFolderName: preview.runFolderName,
    mode,
  }
}

function createDirectPayload(toolId, config, assets, destinationPath) {
  const payload = prepareRunPayload(toolId, config, assets, destinationPath)
  return {
    ...payload,
    mode: 'direct',
  }
}

function createSavePayload(toolId, stagedItems = [], destinationPath) {
  const output = resolveDestinationPath(destinationPath, [], getAppSettings())
  const normalizedItems = Array.isArray(stagedItems) ? stagedItems : []
  const firstItem = normalizedItems[0] || {}
  return {
    toolId,
    toolLabel: TOOL_LABELS[toolId] || toolId,
    destinationPath: output.destinationPath,
    output,
    mode: 'save',
    stagedItems: normalizedItems,
    runId: firstItem.runId || '',
    runFolderName: firstItem.runFolderName || buildRunFolderName(new Date().toISOString(), toolId),
    createdAt: new Date().toISOString(),
  }
}

function normalizeRunConfig(toolId, config = {}) {
  if (toolId === 'compression') {
    return {
      mode: pickOption(config.mode, ['quality', 'target'], 'quality'),
      quality: clampNumber(config.quality, 1, 100, 85),
      targetSizeKb: Math.max(1, toInteger(config.targetSizeKb, 250)),
    }
  }

  if (toolId === 'format') {
    return {
      targetFormat: pickOption(String(config.targetFormat || '').toUpperCase(), ['PNG', 'JPEG', 'JPG', 'WEBP', 'TIFF', 'AVIF', 'GIF', 'BMP', 'ICO'], 'JPEG'),
      quality: clampNumber(config.quality, 1, 100, 90),
      keepTransparency: Boolean(config.keepTransparency),
      colorProfile: pickOption(String(config.colorProfile || '').toLowerCase(), ['srgb', 'p3', 'cmyk'], 'srgb'),
    }
  }

  if (toolId === 'resize') {
    return {
      width: normalizeMeasure(config.width, 1920, inferMeasureUnit(config.width, 'px')),
      height: normalizeMeasure(config.height, 1080, inferMeasureUnit(config.height, 'px')),
      lockAspectRatio: Boolean(config.lockAspectRatio),
    }
  }

  if (toolId === 'watermark') {
    const normalizedPosition = String(config.position || '').replace('center-left', 'middle-left').replace('center-right', 'middle-right')
    return {
      type: pickOption(config.type, ['text', 'image'], 'text'),
      text: sanitizeText(config.text, '批量处理'),
      position: pickOption(normalizedPosition, ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'], 'center'),
      opacity: clampNumber(config.opacity, 0, 100, 60),
      fontSize: Math.max(1, toInteger(config.fontSize, 32)),
      color: sanitizeText(config.color, '#FFFFFF'),
      rotation: toNumber(config.rotation, 0),
      margin: Math.max(0, toInteger(config.margin, 24)),
      tiled: Boolean(config.tiled),
      density: clampNumber(config.density, 20, 250, 100),
      imagePath: sanitizeText(config.imagePath),
    }
  }

  if (toolId === 'corners') {
    return {
      radius: Math.max(0, toNumber(config.radius, 24)),
      unit: inferMeasureUnit(config.radius, 'px'),
      background: sanitizeText(config.background, '#ffffff'),
      keepTransparency: Boolean(config.keepTransparency),
    }
  }

  if (toolId === 'padding') {
    return {
      top: Math.max(0, toInteger(config.top, 20)),
      right: Math.max(0, toInteger(config.right, 20)),
      bottom: Math.max(0, toInteger(config.bottom, 20)),
      left: Math.max(0, toInteger(config.left, 20)),
      color: sanitizeText(config.color, '#ffffff'),
      opacity: clampNumber(config.opacity, 0, 100, 100),
    }
  }

  if (toolId === 'crop') {
    const customRatioX = Math.max(1, toInteger(config.customRatioX, 16))
    const customRatioY = Math.max(1, toInteger(config.customRatioY, 9))
    const useCustomRatio = Boolean(config.useCustomRatio) || config.ratio === 'Custom'

    return {
      ratio: useCustomRatio ? `${customRatioX}:${customRatioY}` : sanitizeText(config.ratio, '16:9'),
      useCustomRatio,
      customRatio: {
        x: customRatioX,
        y: customRatioY,
      },
      area: {
        x: Math.max(0, toInteger(config.x, 0)),
        y: Math.max(0, toInteger(config.y, 0)),
        width: Math.max(1, toInteger(config.width, 1920)),
        height: Math.max(1, toInteger(config.height, 1080)),
      },
    }
  }

  if (toolId === 'rotate') {
    return {
      angle: clampNumber(config.angle, -360, 360, 0),
      autoCrop: Boolean(config.autoCrop),
      keepAspectRatio: Boolean(config.keepAspectRatio),
      background: sanitizeText(config.background, '#ffffff'),
    }
  }

  if (toolId === 'flip') {
    return {
      horizontal: Boolean(config.horizontal),
      vertical: Boolean(config.vertical),
      preserveMetadata: Boolean(config.preserveMetadata),
      autoCropTransparent: Boolean(config.autoCropTransparent),
      outputFormat: sanitizeText(config.outputFormat, 'Keep Original'),
    }
  }

  if (toolId === 'merge-pdf') {
    return {
      pageSize: pickOption(String(config.pageSize || ''), ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Original'], 'A4'),
      margin: pickOption(String(config.margin || ''), ['none', 'narrow', 'normal', 'wide'], 'narrow'),
      background: sanitizeText(config.background, '#ffffff'),
      autoPaginate: Boolean(config.autoPaginate),
    }
  }

  if (toolId === 'merge-image') {
    return {
      direction: pickOption(config.direction, ['vertical', 'horizontal'], 'vertical'),
      pageWidth: Math.max(1, toInteger(config.pageWidth, 1920)),
      spacing: Math.max(0, toInteger(config.spacing, 24)),
      background: sanitizeText(config.background, '#ffffff'),
      align: pickOption(String(config.align || ''), ['start', 'center'], 'start'),
    }
  }

  if (toolId === 'merge-gif') {
    return {
      width: Math.max(1, toInteger(config.width, 1080)),
      height: Math.max(1, toInteger(config.height, 1080)),
      interval: Math.max(0.01, toNumber(config.interval, 0.5)),
      background: sanitizeText(config.background, '#ffffff'),
      loop: config.loop !== false,
    }
  }

  if (toolId === 'manual-crop') {
    return {
      ratio: sanitizeText(config.ratio, '16:9 Cinema'),
      ratioValue: sanitizeText(config.ratioValue, '16:9'),
      currentIndex: Math.max(0, toInteger(config.currentIndex, 0)),
      completedIds: uniqueStrings(config.completedIds),
      skippedIds: uniqueStrings(config.skippedIds),
      cropAreas: config.cropAreas && typeof config.cropAreas === 'object' ? config.cropAreas : {},
    }
  }

  return { ...config }
}

function prepareRunPayload(toolId, config, assets, destinationPath) {
  const normalizedAssets = normalizeRunAssets(Array.isArray(assets) ? assets : [])
  const normalizedConfig = normalizeRunConfig(toolId, config)
  const output = resolveDestinationPath(destinationPath, normalizedAssets, getAppSettings())
  const createdAt = new Date().toISOString()
  const run = createRunDescriptor(output.destinationPath, toolId, createdAt)

  return {
    toolId,
    toolLabel: TOOL_LABELS[toolId] || toolId,
    config: normalizedConfig,
    assets: normalizedAssets,
    destinationPath: run.runPath,
    baseDestinationPath: output.destinationPath,
    output,
    queuedCount: normalizedAssets.length,
    summary: summarizeConfig(toolId, normalizedConfig),
    createdAt,
    runId: run.runId,
    runFolderName: run.runFolderName,
  }
}

const pendingLaunchValues = []
const launchWaiters = new Set()
const launchSubscribers = new Set()
let launchHooksInstalled = false

function getHostApi() {
  return globalThis.ztools || {}
}

function resolveLaunchWaiters() {
  for (const waiter of launchWaiters) waiter()
  launchWaiters.clear()
}

function enqueueLaunchValue(value) {
  if (value == null) return
  pendingLaunchValues.push(value)
  resolveLaunchWaiters()
  void flushLaunchSubscribers()
}

function installLaunchHooks() {
  if (launchHooksInstalled) return
  launchHooksInstalled = true

  const hostApi = getHostApi()
  const handleLaunch = (param) => {
    enqueueLaunchValue(param)
    if (param?.payload != null && param.payload !== param) {
      enqueueLaunchValue(param.payload)
    }
  }

  hostApi.onPluginEnter?.(handleLaunch)
  hostApi.onPluginReady?.(handleLaunch)
}

async function waitForLaunchValue(timeoutMs = 160) {
  installLaunchHooks()
  if (pendingLaunchValues.length) return

  await new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      launchWaiters.delete(finish)
      resolve()
    }

    const timer = setTimeout(finish, timeoutMs)
    launchWaiters.add(finish)
  })
}

function consumePendingLaunchValues() {
  if (!pendingLaunchValues.length) return []
  return pendingLaunchValues.splice(0, pendingLaunchValues.length)
}

async function flushLaunchSubscribers() {
  if (!launchSubscribers.size || !pendingLaunchValues.length) return

  const values = consumePendingLaunchValues()
  for (const subscriber of launchSubscribers) {
    try {
      await subscriber(values)
    } catch {
      // ignore subscriber errors so launch delivery keeps working
    }
  }
}

function extractLaunchItems(value, visited = new Set()) {
  if (!value || visited.has(value)) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((item) => extractLaunchItems(item, visited))
  if (typeof value !== 'object') return []

  visited.add(value)

  const directKeys = ['files', 'paths', 'items', 'argv', 'arguments', 'args', 'payload', 'data', 'input', 'inputs', 'list', 'selected', 'selection', 'value', 'values', 'text', 'texts', 'pathList', 'fileList']
  for (const key of directKeys) {
    if (value[key]) {
      const extracted = extractLaunchItems(value[key], visited)
      if (extracted.length) return extracted
    }
  }

  if (typeof value.path === 'string') return [value.path]
  if (typeof value.filePath === 'string') return [value.filePath]
  if (typeof value.sourcePath === 'string') return [value.sourcePath]

  return Object.values(value).flatMap((item) => extractLaunchItems(item, visited))
}

function supportsLocalProcessing(toolId) {
  return ['compression', 'format', 'resize', 'watermark', 'rotate', 'flip', 'corners', 'padding', 'crop', 'manual-crop', 'merge-image', 'merge-pdf', 'merge-gif'].includes(toolId)
}

function getPerformanceProfile(mode) {
  const normalized = PERFORMANCE_MODES.has(mode) ? mode : 'balanced'
  if (normalized === 'compatible') {
    return {
      mode: normalized,
      heavyConcurrency: Math.max(1, Math.min(3, Math.floor(CPU_COUNT / 6) || 1)),
      mediumConcurrency: Math.max(1, Math.min(6, Math.floor(CPU_COUNT / 3) || 1)),
      defaultConcurrency: Math.max(1, Math.min(4, Math.floor(CPU_COUNT / 4) || 1)),
      sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.5) || 1)),
      cacheMemory: Math.min(256, Math.max(96, CPU_COUNT * 8)),
      cacheItems: Math.max(32, CPU_COUNT * 4),
    }
  }
  if (normalized === 'max') {
    return {
      mode: normalized,
      heavyConcurrency: Math.max(1, Math.min(8, Math.floor(CPU_COUNT / 3) || 1)),
      mediumConcurrency: Math.max(1, Math.min(16, Math.floor(CPU_COUNT * 0.75) || 1)),
      defaultConcurrency: Math.max(1, Math.min(12, Math.floor(CPU_COUNT / 2) || 1)),
      sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.9) || 1)),
      cacheMemory: Math.min(768, Math.max(160, CPU_COUNT * 24)),
      cacheItems: Math.max(96, CPU_COUNT * 12),
    }
  }
  return {
    mode: normalized,
    heavyConcurrency: Math.max(1, Math.min(6, Math.floor(CPU_COUNT / 4) || 1)),
    mediumConcurrency: Math.max(1, Math.min(12, Math.floor(CPU_COUNT / 2) || 1)),
    defaultConcurrency: Math.max(1, Math.min(8, Math.floor(CPU_COUNT / 3) || 1)),
    sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.75) || 1)),
    cacheMemory: Math.min(512, Math.max(128, CPU_COUNT * 16)),
    cacheItems: Math.max(64, CPU_COUNT * 8),
  }
}

function getSharp() {
  try {
    const sharp = require('sharp')
    const profile = getPerformanceProfile(getAppSettings().performanceMode)
    if (getSharp.configuredMode !== profile.mode) {
      sharp.concurrency(profile.sharpConcurrency)
      sharp.cache({ memory: profile.cacheMemory, items: profile.cacheItems, files: 0 })
      getSharp.configuredMode = profile.mode
    }
    return sharp
  } catch {
    return null
  }
}

function getPdfLib() {
  try {
    return require('pdf-lib')
  } catch {
    return null
  }
}

function getGifEncoder() {
  try {
    return require('gifenc')
  } catch {
    return null
  }
}

function ensureDirectory(targetPath) {
  if (!targetPath) return
  fs.mkdirSync(targetPath, { recursive: true })
}

function isProcessableAsset(asset) {
  return asset.sourcePath && SHARP_INPUT_EXTENSIONS.has(asset.ext)
}

function mapOutputFormat(toolId, asset, config) {
  if (toolId === 'format') {
    const requested = String(config.targetFormat || '').toLowerCase()
    if (requested === 'jpg') return 'jpeg'
    if (CUSTOM_OUTPUT_FORMATS.has(requested)) return requested
    return SHARP_OUTPUT_FORMATS.has(requested) ? requested : 'jpeg'
  }

  const original = String(asset.ext || '').toLowerCase()
  if (original === 'jpg') return 'jpeg'
  return SHARP_OUTPUT_FORMATS.has(original) ? original : 'png'
}

function mapOutputExtension(format) {
  if (format === 'jpeg') return 'jpg'
  return format
}

function isAlphaCapableFormat(format) {
  return ALPHA_CAPABLE_FORMATS.has(String(format || '').toLowerCase())
}

function resolveSharpIccProfile(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'p3' || normalized === 'display-p3' || normalized === 'display p3') return 'p3'
  if (normalized === 'cmyk') return 'cmyk'
  return 'srgb'
}

function getOutputName(asset, toolId, format) {
  const parsed = path.parse(asset.name || path.basename(asset.sourcePath))
  return `${parsed.name}-${toolId}.${mapOutputExtension(format)}`
}

function createTransformer(sharpLib, asset) {
  return sharpLib(asset.sourcePath, { animated: String(asset.ext).toLowerCase() === 'gif' })
}

function applyResizeOperation(transformer, asset, config) {
  const width = config.width.unit === '%' ? Math.max(1, Math.round((asset.width || 0) * (config.width.value / 100))) : Math.max(1, Math.round(config.width.value))
  const height = config.height.unit === '%' ? Math.max(1, Math.round((asset.height || 0) * (config.height.value / 100))) : Math.max(1, Math.round(config.height.value))

  return transformer.resize({
    width,
    height,
    fit: config.lockAspectRatio ? 'inside' : 'fill',
  })
}

function withOutputFormat(transformer, format, quality) {
  if (format === 'jpeg') return transformer.jpeg({ quality, mozjpeg: true })
  if (format === 'png') {
    const compressionLevel = Math.max(0, Math.min(9, Math.round((100 - quality) / 11)))
    return transformer.png({
      compressionLevel,
      palette: quality < 100,
      quality: Math.max(1, Math.round(quality)),
      effort: 10,
    })
  }
  if (format === 'webp') return transformer.webp({ quality })
  if (format === 'tiff') return transformer.tiff({ quality })
  if (format === 'avif') return transformer.avif({ quality })
  if (format === 'gif') return transformer.gif({ effort: 7 })
  return transformer.png({ compressionLevel: 6 })
}

function applyColorProfile(transformer, colorProfile) {
  if (typeof transformer.withIccProfile !== 'function') return transformer
  return transformer.withIccProfile(resolveSharpIccProfile(colorProfile))
}

function applyMetadataPolicy(transformer, preserveMetadata) {
  if (!preserveMetadata || typeof transformer.keepMetadata !== 'function') return transformer
  return transformer.keepMetadata()
}

function applyTransparencyPolicy(transformer, format, keepTransparency, background = '#ffffff') {
  if (keepTransparency && isAlphaCapableFormat(format)) return transformer
  return transformer.flatten({ background: hexToRgbaObject(background, 1) })
}

async function createBmpBuffer(transformer) {
  const { data, info } = await transformer
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const width = Math.max(1, info.width || 1)
  const height = Math.max(1, info.height || 1)
  const channels = Math.max(3, info.channels || 3)
  const rowStride = Math.ceil((width * 3) / 4) * 4
  const pixelDataSize = rowStride * height
  const fileHeaderSize = 14
  const dibHeaderSize = 40
  const fileSize = fileHeaderSize + dibHeaderSize + pixelDataSize
  const buffer = Buffer.alloc(fileSize)

  buffer.write('BM', 0, 2, 'ascii')
  buffer.writeUInt32LE(fileSize, 2)
  buffer.writeUInt32LE(fileHeaderSize + dibHeaderSize, 10)
  buffer.writeUInt32LE(dibHeaderSize, 14)
  buffer.writeInt32LE(width, 18)
  buffer.writeInt32LE(height, 22)
  buffer.writeUInt16LE(1, 26)
  buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(0, 30)
  buffer.writeUInt32LE(pixelDataSize, 34)
  buffer.writeInt32LE(2835, 38)
  buffer.writeInt32LE(2835, 42)

  const pixelOffset = fileHeaderSize + dibHeaderSize
  for (let y = 0; y < height; y += 1) {
    const srcY = height - 1 - y
    const dstRowOffset = pixelOffset + y * rowStride
    for (let x = 0; x < width; x += 1) {
      const srcOffset = (srcY * width + x) * channels
      const dstOffset = dstRowOffset + x * 3
      buffer[dstOffset] = data[srcOffset + 2] || 0
      buffer[dstOffset + 1] = data[srcOffset + 1] || 0
      buffer[dstOffset + 2] = data[srcOffset] || 0
    }
  }

  return buffer
}

function createIcoBuffer(pngBuffer, width, height) {
  const entryWidth = width >= 256 ? 0 : width
  const entryHeight = height >= 256 ? 0 : height
  const header = Buffer.alloc(6 + 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header.writeUInt8(entryWidth, 6)
  header.writeUInt8(entryHeight, 7)
  header.writeUInt8(0, 8)
  header.writeUInt8(0, 9)
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(pngBuffer.length, 14)
  header.writeUInt32LE(22, 18)
  return Buffer.concat([header, pngBuffer])
}

async function writeCompressionAsset(sharpLib, asset, config, destinationPath) {
  const format = mapOutputFormat('compression', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'compression', format))
  const originalSizeBytes = Math.max(0, Number(asset?.sizeBytes) || 0)

  const ensureCompressedOutputIsSmaller = (outputSizeBytes) => {
    if (!originalSizeBytes || outputSizeBytes < originalSizeBytes) return
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
    throw new Error('压缩结果未小于原图，已跳过该文件')
  }

  if (config.mode !== 'target' || !LOSSY_OUTPUT_FORMATS.has(format)) {
    const output = await writeTransformedAsset(createTransformer(sharpLib, asset), format, Math.round(config.quality), outputPath, {
      width: asset.width,
      height: asset.height,
    })
    ensureCompressedOutputIsSmaller(output.outputSizeBytes)
    return output
  }

  const qualitySteps = [90, 80, 70, 60, 50, 40, 30, 20, 10]
  const targetBytes = config.targetSizeKb * 1024
  if (originalSizeBytes && targetBytes >= originalSizeBytes) {
    throw new Error('目标大小未小于原图，已跳过该文件')
  }
  const cache = new Map()
  const encodeAtQuality = async (quality) => {
    const normalizedQuality = Math.max(10, Math.min(90, Math.round(quality)))
    if (cache.has(normalizedQuality)) return cache.get(normalizedQuality)
    const buffer = await withOutputFormat(createTransformer(sharpLib, asset), format, normalizedQuality).toBuffer()
    cache.set(normalizedQuality, buffer)
    return buffer
  }

  const highQuality = qualitySteps[0]
  const highBuffer = await encodeAtQuality(highQuality)
  let chosenBuffer = highBuffer
  if (highBuffer.length > targetBytes) {
    const lowQuality = qualitySteps[qualitySteps.length - 1]
    const lowBuffer = await encodeAtQuality(lowQuality)
    chosenBuffer = lowBuffer

    if (lowBuffer.length <= targetBytes) {
      let bestBuffer = lowBuffer
      let left = lowQuality + 1
      let right = highQuality - 1

      while (left <= right) {
        const mid = Math.floor((left + right) / 2)
        const buffer = await encodeAtQuality(mid)
        if (buffer.length <= targetBytes) {
          bestBuffer = buffer
          left = mid + 1
        } else {
          right = mid - 1
        }
      }

      chosenBuffer = bestBuffer
    }
  }

  fs.writeFileSync(outputPath, chosenBuffer)
  ensureCompressedOutputIsSmaller(chosenBuffer.length)
  return {
    outputPath,
    outputName: path.basename(outputPath),
    outputSizeBytes: chosenBuffer.length,
    width: asset.width || 0,
    height: asset.height || 0,
  }
}

async function writeFormatAsset(sharpLib, asset, config, destinationPath) {
  const format = mapOutputFormat('format', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'format', format))
  let transformed = applyColorProfile(createTransformer(sharpLib, asset), config.colorProfile)
  transformed = applyTransparencyPolicy(transformed, format, config.keepTransparency)

  if (format === 'bmp') {
    const buffer = await createBmpBuffer(transformed)
    fs.writeFileSync(outputPath, buffer)
    return { outputPath, outputSizeBytes: buffer.length }
  }

  if (format === 'ico') {
    const pngBuffer = await transformed
      .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    const iconMeta = await sharpLib(pngBuffer).metadata()
    const buffer = createIcoBuffer(pngBuffer, iconMeta.width || 256, iconMeta.height || 256)
    fs.writeFileSync(outputPath, buffer)
    return { outputPath, outputSizeBytes: buffer.length }
  }

  return writeTransformedAsset(transformed, format, Math.round(config.quality), outputPath, {
    width: asset.width,
    height: asset.height,
  })
}

async function writeResizeAsset(sharpLib, asset, config, destinationPath) {
  const format = mapOutputFormat('resize', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'resize', format))
  const resized = applyResizeOperation(createTransformer(sharpLib, asset), asset, config)
  return writeTransformedAsset(resized, format, 90, outputPath)
}

function normalizeHexColor(value, alpha = 1) {
  const color = sanitizeText(value, '#FFFFFF').replace('#', '')
  const normalized = color.length === 3 ? color.split('').map((item) => item + item).join('') : color.padEnd(6, 'F').slice(0, 6)
  const numericAlpha = Math.max(0, Math.min(1, alpha))
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${numericAlpha})`
}

function hexToRgbaObject(value, alpha = 1) {
  const color = sanitizeText(value, '#ffffff').replace('#', '')
  const normalized = color.length === 3 ? color.split('').map((item) => item + item).join('') : color.padEnd(6, 'f').slice(0, 6)
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    alpha,
  }
}

function getWatermarkGravity(position) {
  const mapping = {
    'top-left': 'northwest',
    'top-center': 'north',
    'top-right': 'northeast',
    'middle-left': 'west',
    center: 'centre',
    'middle-right': 'east',
    'bottom-left': 'southwest',
    'bottom-center': 'south',
    'bottom-right': 'southeast',
  }
  return mapping[position] || 'centre'
}

function getWatermarkOffsets(position, margin) {
  const horizontal = position.includes('left') ? margin : position.includes('right') ? -margin : 0
  const vertical = position.startsWith('top') ? margin : position.startsWith('bottom') ? -margin : 0
  return { left: horizontal, top: vertical }
}

function escapeSvgText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getWatermarkRenderScale(asset) {
  const width = Math.max(asset.width || 0, 1)
  const height = Math.max(asset.height || 0, 1)
  const baseDimension = Math.min(width, height)
  return Math.max(0.6, Math.min(2.2, baseDimension / 1080))
}

function buildTextWatermarkSvg(asset, config) {
  const color = normalizeHexColor(config.color, config.opacity / 100)
  const text = escapeSvgText(config.text)
  const renderScale = getWatermarkRenderScale(asset)
  const renderFontSize = Math.max(12, Math.round(config.fontSize * renderScale))
  const textLength = Math.max(String(config.text || '').length, 2)
  const textBoxWidth = Math.max(renderFontSize * textLength * 0.82, renderFontSize * 2.2)
  const textBoxHeight = Math.max(renderFontSize * 1.9, renderFontSize + 14)
  const rotation = Math.abs(toNumber(config.rotation, 0)) % 180
  const radians = rotation * (Math.PI / 180)
  const rotatedWidth = Math.abs(textBoxWidth * Math.cos(radians)) + Math.abs(textBoxHeight * Math.sin(radians))
  const rotatedHeight = Math.abs(textBoxWidth * Math.sin(radians)) + Math.abs(textBoxHeight * Math.cos(radians))
  const padding = Math.max(18, Math.round(renderFontSize * 1.1))
  const width = Math.ceil(rotatedWidth + padding * 2)
  const height = Math.ceil(rotatedHeight + padding * 2)
  const x = Math.round(width / 2)
  const y = Math.round(height / 2)
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <style>
        text { font-family: Arial, Helvetica, sans-serif; font-weight: 600; }
      </style>
      <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="${renderFontSize}" fill="${color}" transform="rotate(${config.rotation} ${x} ${y})">${text}</text>
    </svg>
  `)
}

async function createTiledWatermarkBuffer(sharpLib, input, density) {
  const meta = await sharpLib(input).metadata()
  const width = Math.max(1, meta.width || 1)
  const height = Math.max(1, meta.height || 1)
  const clampedDensity = clampNumber(density, 20, 250, 100)
  const densityProgress = (clampedDensity - 20) / 230
  const gapRatio = 0.42 - densityProgress * 0.405
  const gap = Math.max(2, Math.round(Math.max(width, height) * gapRatio))
  const canvasWidth = width + gap
  const canvasHeight = height + gap
  const left = Math.max(0, Math.round((canvasWidth - width) / 2))
  const top = Math.max(0, Math.round((canvasHeight - height) / 2))

  return sharpLib({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input, left, top }])
    .png()
    .toBuffer()
}

async function createImageWatermarkBuffer(sharpLib, asset, config) {
  const imagePath = sanitizeText(config.imagePath)
  if (!imagePath) {
    throw new Error('图片水印文件不存在')
  }

  const isDataUrl = imagePath.startsWith('data:image/')
  const input = isDataUrl
    ? Buffer.from(imagePath.slice(imagePath.indexOf(',') + 1), 'base64')
    : imagePath

  if (!isDataUrl && !fs.existsSync(imagePath)) {
    throw new Error('图片水印文件不存在')
  }

  const renderScale = getWatermarkRenderScale(asset)
  const baseWidth = Math.max(asset.width || 1920, 1)
  const watermarkWidth = Math.max(32, Math.round(baseWidth * 0.18 * renderScale))
  return sharpLib(input)
    .rotate(config.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: watermarkWidth, withoutEnlargement: true })
    .ensureAlpha(config.opacity / 100)
    .png()
    .toBuffer()
}

async function buildWatermarkComposite(sharpLib, asset, config) {
  let input = config.type === 'image'
    ? await createImageWatermarkBuffer(sharpLib, asset, config)
    : buildTextWatermarkSvg(asset, config)

  if (config.type === 'text') {
    input = await sharpLib(input)
      .trim()
      .png()
      .toBuffer()
  }

  if (config.tiled) {
    input = await createTiledWatermarkBuffer(sharpLib, input, config.density)
    return {
      input,
      tile: true,
      gravity: 'centre',
    }
  }

  const overlayMeta = await sharpLib(input).metadata()
  const overlayWidth = Math.max(1, overlayMeta.width || 1)
  const overlayHeight = Math.max(1, overlayMeta.height || 1)
  const assetWidth = Math.max(1, asset.width || 1)
  const assetHeight = Math.max(1, asset.height || 1)
  const margin = Math.max(0, config.margin || 0)
  const horizontal = config.position.includes('left')
    ? margin
    : config.position.includes('right')
      ? Math.max(0, assetWidth - overlayWidth - margin)
      : Math.round((assetWidth - overlayWidth) / 2)
  const vertical = config.position.startsWith('top')
    ? margin
    : config.position.startsWith('bottom')
      ? Math.max(0, assetHeight - overlayHeight - margin)
      : Math.round((assetHeight - overlayHeight) / 2)

  return {
    input,
    left: Math.max(0, horizontal),
    top: Math.max(0, vertical),
  }
}

function resolvePathForReveal(targetPath) {
  if (!targetPath) return ''
  try {
    const stat = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null
    if (stat?.isDirectory()) return targetPath
    return path.dirname(targetPath)
  } catch {
    return ''
  }
}

async function revealPath(targetPath) {
  const normalizedTarget = path.normalize(sanitizeText(targetPath))
  const resolved = resolvePathForReveal(normalizedTarget)
  if (!resolved) return false
  try {
    if (typeof shell.showItemInFolder === 'function' && normalizedTarget && fs.existsSync(normalizedTarget) && !fs.statSync(normalizedTarget).isDirectory()) {
      shell.showItemInFolder(normalizedTarget)
      return true
    }
    const directoryEntry = path.join(resolved, '.')
    if (typeof shell.showItemInFolder === 'function' && fs.existsSync(resolved)) {
      shell.showItemInFolder(directoryEntry)
      return true
    }
    const error = await shell.openPath(resolved)
    return !error
  } catch {
    return false
  }
}

function normalizeFsPath(value, fallback = '') {
  const text = sanitizeText(value, fallback)
  if (!text) return ''
  const normalized = text.replaceAll('/', path.sep).replace(/^([A-Za-z]):(?![\\/])/, `$1:${path.sep}`)
  return path.resolve(path.normalize(normalized))
}

function resolveExistingResultPath(item = {}) {
  const candidates = [
    item.resultPath,
  ].map((value) => normalizeFsPath(value)).filter(Boolean)

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0] || ''
}

function overwriteFile(sourcePath, targetPath) {
  const tempPath = `${targetPath}.imgbatch-replace-${Date.now()}`
  ensureDirectory(path.dirname(targetPath))
  if (fs.existsSync(targetPath)) {
    try {
      fs.chmodSync(targetPath, 0o666)
    } catch {
      // Keep overwrite flow going even if chmod is unsupported.
    }
  }
  fs.copyFileSync(sourcePath, tempPath)
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath)
  }
  fs.renameSync(tempPath, targetPath)
}

function replaceOriginalWithSaved(item = {}) {
  const sourcePath = resolveExistingResultPath(item)
  const targetPath = normalizeFsPath(item.sourcePath)
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('处理结果不存在，无法替换原图')
  }
  if (!targetPath) {
    throw new Error('原图不存在，无法替换')
  }
  overwriteFile(sourcePath, targetPath)
  if (path.resolve(sourcePath) !== path.resolve(targetPath) && fs.existsSync(sourcePath)) {
    fs.unlinkSync(sourcePath)
  }
  return {
    assetId: item.assetId,
    name: item.name,
    outputPath: '',
    savedOutputPath: '',
    sourcePath: targetPath,
  }
}

async function replaceOriginals(items = []) {
  const processed = []
  const failed = []
  for (const item of items) {
    try {
      processed.push(replaceOriginalWithSaved(item))
    } catch (error) {
      failed.push({ assetId: item.assetId, name: item.name, error: error?.message || '替换失败' })
    }
  }
  return {
    ok: processed.length > 0 && failed.length === 0,
    partial: processed.length > 0 && failed.length > 0,
    processed,
    failed,
    message: processed.length > 0 && failed.length === 0
      ? `已替换 ${processed.length} 张原图。`
      : processed.length > 0
        ? `替换原图部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
        : failed[0]?.error || '替换原图失败。',
  }
}

function resolveInputPaths(items = []) {
  return toolsApi.normalizeInput(items)
}

function revealResultDirectoryIfNeeded(result) {
  if (!['save', 'direct'].includes(result?.mode)) return result
  const targetPath = result.destinationPath || result.baseDestinationPath || ''
  if (targetPath && (result.ok || result.partial)) {
    void revealPath(targetPath)
  }
  return result
}

function buildSavedResultWithReveal(payload, processed, failed) {
  return revealResultDirectoryIfNeeded(buildSavedResult(payload, processed, failed))
}

function buildEnvelopeWithReveal(payload, processed, failed) {
  return revealResultDirectoryIfNeeded(createResultEnvelope(payload, processed, failed))
}

function buildFallbackFailureWithReveal(payload, message) {
  return revealResultDirectoryIfNeeded(createFallbackFailure(payload, message))
}

async function writeWatermarkAsset(sharpLib, asset, config, destinationPath) {
  const format = mapOutputFormat('watermark', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'watermark', format))
  const composite = await buildWatermarkComposite(sharpLib, asset, config)
  const transformed = createTransformer(sharpLib, asset).composite([composite])
  return writeTransformedAsset(transformed, format, 90, outputPath)
}

function getRotateBackground(value) {
  return hexToRgbaObject(value, 1)
}

function mapFlipOutputFormat(asset, config) {
  const requested = String(config.outputFormat || '').toLowerCase()
  if (!requested || requested === 'keep original') return mapOutputFormat('flip', asset, config)
  if (requested === 'jpg') return 'jpeg'
  if (requested === 'webp') return 'webp'
  if (requested === 'png') return 'png'
  if (requested === 'jpeg') return 'jpeg'
  return mapOutputFormat('flip', asset, config)
}

async function writeRotateAsset(sharpLib, asset, config, destinationPath) {
  const format = mapOutputFormat('rotate', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'rotate', format))
  let transformed = null

  if (config.autoCrop) {
    transformed = createTransformer(sharpLib, asset)
      .ensureAlpha()
      .rotate(config.angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .trim()
  } else {
    transformed = createTransformer(sharpLib, asset).rotate(config.angle, { background: getRotateBackground(config.background) })
  }

  if (config.keepAspectRatio && asset.width && asset.height) {
    transformed = transformed.resize({
      width: asset.width,
      height: asset.height,
      fit: 'contain',
      background: config.autoCrop ? { r: 0, g: 0, b: 0, alpha: 0 } : getRotateBackground(config.background),
    })
  }

  if (config.autoCrop && !isAlphaCapableFormat(format)) {
    transformed = transformed.flatten({ background: getRotateBackground(config.background) })
  }

  return writeTransformedAsset(transformed, format, 90, outputPath)
}

async function writeFlipAsset(sharpLib, asset, config, destinationPath) {
  const format = mapFlipOutputFormat(asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'flip', format))
  let transformed = createTransformer(sharpLib, asset)

  if (config.horizontal) transformed = transformed.flop()
  if (config.vertical) transformed = transformed.flip()
  if (config.autoCropTransparent) transformed = transformed.ensureAlpha().trim()
  if (config.autoCropTransparent && !isAlphaCapableFormat(format)) {
    transformed = transformed.flatten({ background: hexToRgbaObject('#ffffff', 1) })
  }
  transformed = applyMetadataPolicy(transformed, config.preserveMetadata)

  return writeTransformedAsset(transformed, format, 90, outputPath)
}

function buildRoundedRectSvg(width, height, radius, fill) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${fill}" />
    </svg>
  `)
}

async function writeCornersAsset(sharpLib, asset, config, destinationPath) {
  const outputFormat = config.keepTransparency ? 'png' : mapOutputFormat('corners', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'corners', outputFormat))
  const metadata = await createTransformer(sharpLib, asset).metadata()
  const width = metadata.width || asset.width || 1
  const height = metadata.height || asset.height || 1
  const maxRadius = Math.min(width, height) / 2
  const radius = config.unit === '%' ? Math.round(maxRadius * (config.radius / 100)) : Math.min(maxRadius, Math.max(0, config.radius))
  const mask = buildRoundedRectSvg(width, height, radius, '#ffffff')

  let transformed = createTransformer(sharpLib, asset).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }])

  if (!config.keepTransparency) {
    const background = {
      create: {
        width,
        height,
        channels: 4,
        background: hexToRgbaObject(config.background, 1),
      },
    }
    const imageBuffer = await transformed.png().toBuffer()
    transformed = sharpLib(background).composite([{ input: imageBuffer }])
  }

  return writeTransformedAsset(transformed, outputFormat, 90, outputPath)
}

async function writePaddingAsset(sharpLib, asset, config, destinationPath) {
  const format = mapOutputFormat('padding', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'padding', format))
  const transformed = createTransformer(sharpLib, asset).extend({
    top: config.top,
    right: config.right,
    bottom: config.bottom,
    left: config.left,
    background: hexToRgbaObject(config.color, config.opacity / 100),
  })
  return writeTransformedAsset(transformed, format, 90, outputPath)
}

function normalizeCropBox(asset, config) {
  const assetWidth = Math.max(1, asset.width || 1)
  const assetHeight = Math.max(1, asset.height || 1)
  let width = Math.min(assetWidth, Math.max(1, toInteger(config.area?.width, assetWidth)))
  let height = Math.min(assetHeight, Math.max(1, toInteger(config.area?.height, assetHeight)))
  let left = Math.max(0, toInteger(config.area?.x, 0))
  let top = Math.max(0, toInteger(config.area?.y, 0))

  if (left + width > assetWidth) left = Math.max(0, assetWidth - width)
  if (top + height > assetHeight) top = Math.max(0, assetHeight - height)

  if (config.ratio !== 'Original') {
    const [ratioX, ratioY] = String(config.ratio).split(':').map((item) => Number.parseFloat(item))
    if (Number.isFinite(ratioX) && Number.isFinite(ratioY) && ratioX > 0 && ratioY > 0) {
      const targetRatio = ratioX / ratioY
      const currentRatio = width / height
      if (currentRatio > targetRatio) {
        width = Math.max(1, Math.min(assetWidth, Math.round(height * targetRatio)))
      } else {
        height = Math.max(1, Math.min(assetHeight, Math.round(width / targetRatio)))
      }
      if (left + width > assetWidth) left = Math.max(0, assetWidth - width)
      if (top + height > assetHeight) top = Math.max(0, assetHeight - height)
    }
  }

  return { left, top, width, height }
}

async function writeCropAsset(sharpLib, asset, config, destinationPath, suffix = 'crop') {
  const format = mapOutputFormat('crop', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, suffix, format))
  const box = normalizeCropBox(asset, config)
  const transformed = createTransformer(sharpLib, asset).extract(box)
  return writeTransformedAsset(transformed, format, 90, outputPath)
}

function getPdfMarginValue(margin, pageWidth) {
  if (margin === '无') return 0
  if (margin === 'wide') return Math.round(pageWidth * 0.08)
  return Math.round(pageWidth * 0.04)
}

function getPdfMarginValueResolved(margin, pageWidth) {
  if (margin === 'none') return 0
  if (margin === 'wide') return Math.round(pageWidth * 0.08)
  if (margin === 'normal') return Math.round(pageWidth * 0.06)
  return Math.round(pageWidth * 0.04)
}

async function writeMergeImageAsset(sharpLib, payload) {
  const format = 'png'
  const outputPath = path.join(payload.destinationPath, `merged-image.${format}`)
  const prepared = []

  for (const asset of payload.assets) {
    const fitWidth = payload.config.direction === 'vertical' ? payload.config.pageWidth : undefined
    const fitHeight = payload.config.direction === 'horizontal' ? payload.config.pageWidth : undefined
    const buffer = await sharpLib(asset.sourcePath)
      .resize({ width: fitWidth, height: fitHeight, fit: 'contain', background: hexToRgbaObject(payload.config.background, 1) })
      .png()
      .toBuffer()
    const meta = await sharpLib(buffer).metadata()
    prepared.push({ buffer, width: meta.width || 1, height: meta.height || 1, asset })
  }

  if (!prepared.length) throw new Error('没有可拼接的图片')

  const spacing = payload.config.spacing
  const totalWidth = payload.config.direction === 'vertical'
    ? Math.max(...prepared.map((item) => item.width))
    : prepared.reduce((sum, item) => sum + item.width, 0) + spacing * Math.max(0, prepared.length - 1)
  const totalHeight = payload.config.direction === 'vertical'
    ? prepared.reduce((sum, item) => sum + item.height, 0) + spacing * Math.max(0, prepared.length - 1)
    : Math.max(...prepared.map((item) => item.height))

  let cursorX = 0
  let cursorY = 0
  const composites = prepared.map((item) => {
    const composite = {
      input: item.buffer,
      left: payload.config.direction === 'vertical' && payload.config.align === 'center'
        ? Math.max(0, Math.round((totalWidth - item.width) / 2))
        : cursorX,
      top: payload.config.direction === 'horizontal' && payload.config.align === 'center'
        ? Math.max(0, Math.round((totalHeight - item.height) / 2))
        : cursorY,
    }
    if (payload.config.direction === 'vertical') {
      cursorY += item.height + spacing
    } else {
      cursorX += item.width + spacing
    }
    return composite
  })

  await sharpLib({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 4,
      background: hexToRgbaObject(payload.config.background, 1),
    },
  }).composite(composites).png().toFile(outputPath)

  return outputPath
}

async function writeMergePdfAsset(payload) {
  const pdfLib = getPdfLib()
  if (!pdfLib) throw new Error('缺少 pdf-lib 依赖')
  const outputPath = path.join(payload.destinationPath, 'merged.pdf')
  const pdf = await pdfLib.PDFDocument.create()
  const background = hexToRgbaObject(payload.config.background || '#ffffff', 1)

  for (const asset of payload.assets) {
    const imageBytes = fs.readFileSync(asset.sourcePath)
    const format = String(asset.ext || '').toLowerCase()
    const embedded = format === 'png' || format === 'webp' || format === 'avif' || format === 'gif'
      ? await pdf.embedPng(imageBytes)
      : await pdf.embedJpg(await require('sharp')(asset.sourcePath).jpeg().toBuffer())

    const pageSize = payload.config.pageSize === '与图片一致'
      ? [embedded.width, embedded.height]
      : (PDF_PAGE_SIZES[payload.config.pageSize] || PDF_PAGE_SIZES.A4)
    const page = pdf.addPage(pageSize)
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageSize[0],
      height: pageSize[1],
      color: pdfLib.rgb(background.r / 255, background.g / 255, background.b / 255),
    })
    const margin = getPdfMarginValueResolved(payload.config.margin, pageSize[0])
    const drawableWidth = pageSize[0] - margin * 2
    const drawableHeight = pageSize[1] - margin * 2
    const scale = Math.min(drawableWidth / embedded.width, drawableHeight / embedded.height)
    const width = embedded.width * scale
    const height = embedded.height * scale
    page.drawImage(embedded, {
      x: (pageSize[0] - width) / 2,
      y: (pageSize[1] - height) / 2,
      width,
      height,
    })
  }

  const bytes = await pdf.save()
  fs.writeFileSync(outputPath, bytes)
  return outputPath
}

async function writeMergePdfAssetReal(sharpLib, payload) {
  const pdfLib = getPdfLib()
  if (!pdfLib) throw new Error('缂哄皯 pdf-lib 渚濊禆')
  const outputPath = path.join(payload.destinationPath, 'merged.pdf')
  const pdf = await pdfLib.PDFDocument.create()
  const background = hexToRgbaObject(payload.config.background || '#ffffff', 1)

  for (const asset of payload.assets) {
    const imageBytes = fs.readFileSync(asset.sourcePath)
    const format = String(asset.ext || '').toLowerCase()
    const embedded = format === 'png' || format === 'webp' || format === 'avif' || format === 'gif'
      ? await pdf.embedPng(imageBytes)
      : await pdf.embedJpg(await sharpLib(asset.sourcePath).jpeg().toBuffer())
    const fixedPageSize = payload.config.pageSize === 'Original'
      ? null
      : (PDF_PAGE_SIZES[payload.config.pageSize] || PDF_PAGE_SIZES.A4)
    const margin = getPdfMarginValueResolved(payload.config.margin, fixedPageSize?.[0] || embedded.width)

    if (payload.config.pageSize === 'Original') {
      const pageSize = [embedded.width + margin * 2, embedded.height + margin * 2]
      const page = pdf.addPage(pageSize)
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageSize[0],
        height: pageSize[1],
        color: pdfLib.rgb(background.r / 255, background.g / 255, background.b / 255),
      })
      page.drawImage(embedded, {
        x: margin,
        y: margin,
        width: embedded.width,
        height: embedded.height,
      })
      continue
    }

    const pageSize = fixedPageSize || PDF_PAGE_SIZES.A4
    const drawableWidth = Math.max(1, pageSize[0] - margin * 2)
    const drawableHeight = Math.max(1, pageSize[1] - margin * 2)

    if (!payload.config.autoPaginate) {
      const page = pdf.addPage(pageSize)
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageSize[0],
        height: pageSize[1],
        color: pdfLib.rgb(background.r / 255, background.g / 255, background.b / 255),
      })
      const scale = Math.min(drawableWidth / embedded.width, drawableHeight / embedded.height)
      const width = embedded.width * scale
      const height = embedded.height * scale
      page.drawImage(embedded, {
        x: (pageSize[0] - width) / 2,
        y: (pageSize[1] - height) / 2,
        width,
        height,
      })
      continue
    }

    const sourceMeta = await sharpLib(asset.sourcePath).metadata()
    const sourceWidth = Math.max(1, sourceMeta.width || embedded.width || 1)
    const sourceHeight = Math.max(1, sourceMeta.height || embedded.height || 1)
    const scaledWidth = Math.max(1, Math.round(drawableWidth))
    const scaledHeight = Math.max(1, Math.round(sourceHeight * (scaledWidth / sourceWidth)))
    const scaledBuffer = await sharpLib(asset.sourcePath)
      .resize({ width: scaledWidth, fit: 'fill' })
      .png()
      .toBuffer()

    if (scaledHeight <= drawableHeight) {
      const paged = await pdf.embedPng(scaledBuffer)
      const page = pdf.addPage(pageSize)
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageSize[0],
        height: pageSize[1],
        color: pdfLib.rgb(background.r / 255, background.g / 255, background.b / 255),
      })
      page.drawImage(paged, {
        x: margin,
        y: (pageSize[1] - paged.height) / 2,
        width: paged.width,
        height: paged.height,
      })
      continue
    }

    let offsetY = 0
    while (offsetY < scaledHeight) {
      const sliceHeight = Math.min(Math.round(drawableHeight), scaledHeight - offsetY)
      const sliceBuffer = await sharpLib(scaledBuffer)
        .extract({ left: 0, top: offsetY, width: scaledWidth, height: sliceHeight })
        .png()
        .toBuffer()
      const pageImage = await pdf.embedPng(sliceBuffer)
      const page = pdf.addPage(pageSize)
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageSize[0],
        height: pageSize[1],
        color: pdfLib.rgb(background.r / 255, background.g / 255, background.b / 255),
      })
      page.drawImage(pageImage, {
        x: margin,
        y: pageSize[1] - margin - pageImage.height,
        width: pageImage.width,
        height: pageImage.height,
      })
      offsetY += sliceHeight
    }
  }

  const bytes = await pdf.save()
  fs.writeFileSync(outputPath, bytes)
  return outputPath
}

async function writeMergeGifAsset(sharpLib, payload) {
  const gifenc = getGifEncoder()
  if (!gifenc) throw new Error('缺少 gifenc 依赖')
  const outputPath = path.join(payload.destinationPath, 'merged.gif')
  const { GIFEncoder, quantize, applyPalette } = gifenc
  const encoder = GIFEncoder()

  for (const asset of payload.assets) {
    const { data } = await sharpLib(asset.sourcePath)
      .resize({ width: payload.config.width, height: payload.config.height, fit: 'contain', background: hexToRgbaObject(payload.config.background, 1) })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const rgba = new Uint8Array(data)
    const palette = quantize(rgba, 256)
    const index = applyPalette(rgba, palette)
    encoder.writeFrame(index, payload.config.width, payload.config.height, {
      palette,
      delay: Math.max(1, Math.round(payload.config.interval * 100)),
      repeat: payload.config.loop ? 0 : -1,
    })
  }

  encoder.finish()
  fs.writeFileSync(outputPath, Buffer.from(encoder.bytes()))
  return outputPath
}

async function executeSingleAssetToolLegacy(payload, sharpLib) {
  const processed = []
  const failed = []

  for (const asset of payload.assets) {
    if (!isProcessableAsset(asset)) {
      failed.push({ assetId: asset.id, name: asset.name, error: `暂不支持处理 ${asset.ext || 'unknown'} 格式` })
      continue
    }

    try {
      let result = null
      if (payload.toolId === 'compression') result = await writeCompressionAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'format') result = await writeFormatAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'resize') result = await writeResizeAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'watermark') result = await writeWatermarkAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'rotate') result = await writeRotateAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'flip') result = await writeFlipAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'corners') result = await writeCornersAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'padding') result = await writePaddingAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'crop') result = await writeCropAsset(sharpLib, asset, payload.config, payload.destinationPath, 'crop')
      if (payload.toolId === 'manual-crop') {
        const manualArea = payload.config.cropAreas?.[asset.id]
        const manualConfig = {
          ratio: payload.config.ratioValue || payload.config.ratio,
          area: manualArea || { x: 0, y: 0, width: asset.width, height: asset.height },
        }
        result = await writeCropAsset(sharpLib, asset, manualConfig, payload.destinationPath, 'manual-crop')
      }

      processed.push(payload.mode === 'direct'
        ? directResultToProcessed(asset, result)
        : stageResultToProcessed(asset, result, payload))
    } catch (error) {
      failed.push({ assetId: asset.id, name: asset.name, error: error?.message || '处理失败' })
    }
  }

  return { processed, failed }
}

function isMergeTool(toolId) {
  return ['merge-image', 'merge-pdf', 'merge-gif'].includes(toolId)
}

async function executeSingleAssetTool(payload, sharpLib) {
  const outcomes = await mapWithConcurrency(payload.assets, getAssetProcessingConcurrency(payload), async (asset) => {
    if (!isProcessableAsset(asset)) {
      return {
        processed: null,
        failed: { assetId: asset.id, name: asset.name, error: `暂不支持处理 ${asset.ext || 'unknown'} 格式` },
      }
    }

    try {
      let result = null
      if (payload.toolId === 'compression') result = await writeCompressionAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'format') result = await writeFormatAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'resize') result = await writeResizeAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'watermark') result = await writeWatermarkAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'rotate') result = await writeRotateAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'flip') result = await writeFlipAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'corners') result = await writeCornersAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'padding') result = await writePaddingAsset(sharpLib, asset, payload.config, payload.destinationPath)
      if (payload.toolId === 'crop') result = await writeCropAsset(sharpLib, asset, payload.config, payload.destinationPath, 'crop')
      if (payload.toolId === 'manual-crop') {
        const manualArea = payload.config.cropAreas?.[asset.id]
        const manualConfig = {
          ratio: payload.config.ratioValue || payload.config.ratio,
          area: manualArea || { x: 0, y: 0, width: asset.width, height: asset.height },
        }
        result = await writeCropAsset(sharpLib, asset, manualConfig, payload.destinationPath, 'manual-crop')
      }

      return {
        processed: await (payload.mode === 'direct'
          ? directResultToProcessed(asset, result, sharpLib)
          : stageResultToProcessed(asset, result, payload, sharpLib)),
        failed: null,
      }
    } catch (error) {
      return {
        processed: null,
        failed: { assetId: asset.id, name: asset.name, error: error?.message || '处理失败' },
      }
    }
  })

  return {
    processed: outcomes.map((item) => item?.processed).filter(Boolean),
    failed: outcomes.map((item) => item?.failed).filter(Boolean),
  }
}

function saveAppSettings(settings = {}) {
  const hostApi = getHostApi()
  const next = buildSettingsPayload({ ...getAppSettings(), ...settings })
  hostApi.dbStorage?.setItem?.(SETTINGS_STORAGE_KEY, next)
  return next
}

function buildStagedItemsFromAssets(assets = []) {
  return assets
    .filter((asset) => asset?.previewStatus === 'staged' && asset?.stagedOutputPath)
    .map((asset) => ({
      assetId: asset.id,
      name: asset.name,
      stagedPath: asset.stagedOutputPath,
      outputName: asset.stagedOutputName || path.basename(asset.stagedOutputPath),
      runId: asset.runId || '',
      runFolderName: asset.runFolderName || '',
      toolId: asset.stagedToolId || '',
    }))
}

function createFallbackFailure(payload, message) {
  return {
    ok: false,
    partial: false,
    ...payload,
    processed: [],
    failed: [{ assetId: payload.toolId, name: payload.toolLabel, error: message }],
    message,
  }
}

function resolveExecutionMode(toolId) {
  if (isMergeTool(toolId)) return 'direct'
  return isPreviewSaveTool(toolId) ? 'preview-save' : 'direct'
}

async function executeSaveFlow(payload) {
  if (!payload.stagedItems?.length) {
    return buildFallbackFailureWithReveal(payload, '没有可保存的预览结果。')
  }

  if (!payload.destinationPath) {
    return buildFallbackFailureWithReveal(payload, '无法解析保存目录。')
  }

  ensureDirectory(payload.destinationPath)
  const processed = []
  const failed = []

  for (const item of payload.stagedItems) {
    try {
      const saved = await savePreviewResult(payload.destinationPath, payload.runFolderName, item)
      processed.push(normalizeDirectResult({
        assetId: item.assetId,
        name: item.name,
        outputPath: saved.outputPath,
        outputName: saved.outputName,
        outputSizeBytes: saved.outputSizeBytes,
        width: saved.width,
        height: saved.height,
      }))
    } catch (error) {
      failed.push({ assetId: item.assetId, name: item.name, error: error?.message || '保存失败' })
    }
  }

  return buildSavedResultWithReveal(payload, processed, failed)
}

async function stageToolPreview(toolId, config, assets, destinationPath, mode = 'preview-save') {
  return executeLocalTool(createPreviewPayload(toolId, config, assets, destinationPath, mode))
}

async function saveStagedResult(toolId, stagedItem, destinationPath) {
  return executeSaveFlow(createSavePayload(toolId, [stagedItem], destinationPath))
}

async function saveAllStagedResults(toolId, stagedItems, destinationPath) {
  return executeSaveFlow(createSavePayload(toolId, stagedItems, destinationPath))
}

function loadSettings() {
  return buildSettingsPayload(getAppSettings())
}

function saveSettings(settings) {
  return saveAppSettings(settings)
}

function createPreparedRunPayload(toolId, config, assets, destinationPath) {
  return {
    ...prepareRunPayload(toolId, config, assets, destinationPath),
    mode: resolveExecutionMode(toolId),
  }
}

function createSavePayloadFromAssets(toolId, assets, destinationPath) {
  return createSavePayload(toolId, buildStagedItemsFromAssets(assets), destinationPath)
}

function createPreparedPreviewPayload(toolId, config, assets, destinationPath) {
  return createPreviewPayload(toolId, config, assets, destinationPath)
}

function createPreparedSavePayload(toolId, stagedItems, destinationPath) {
  return createSavePayload(toolId, stagedItems, destinationPath)
}

function createProcessedOutput(asset, result, payload) {
  return payload.mode === 'preview-save'
    ? stageResultToProcessed(asset, result, payload)
    : directResultToProcessed(asset, result)
}

async function createMergeOutput(outputPath, payload) {
  const meta = await readOutputMeta(outputPath)
  return mergeResultToProcessed({
    assetId: payload.assets[0]?.id || payload.toolId,
    name: path.basename(outputPath),
    outputPath,
    outputName: meta.outputName,
    outputSizeBytes: meta.outputSizeBytes,
    width: 0,
    height: 0,
  })
}

function resolveLocalRunPayload(toolId, config, assets, destinationPath) {
  return createPreparedRunPayload(toolId, config, assets, destinationPath)
}

function resolveLocalPreviewPayload(toolId, config, assets, destinationPath) {
  return createPreparedPreviewPayload(toolId, config, assets, destinationPath)
}

function resolveLocalSavePayload(toolId, stagedItems, destinationPath) {
  return createPreparedSavePayload(toolId, stagedItems, destinationPath)
}

function resolveLocalSaveItemsPayload(assets) {
  return buildStagedItemsFromAssets(assets)
}

function resolveLocalSettingsPayload() {
  return loadSettings()
}

function setLocalSettingsPayload(settings) {
  return saveSettings(settings)
}

async function executeMergeTool(payload, sharpLib) {
  const processed = []
  const failed = []
  try {
    let outputPath = ''
    if (payload.toolId === 'merge-image') outputPath = await writeMergeImageAsset(sharpLib, payload)
    if (payload.toolId === 'merge-pdf') outputPath = await writeMergePdfAssetReal(sharpLib, payload)
    if (payload.toolId === 'merge-gif') outputPath = await writeMergeGifAsset(sharpLib, payload)

    const stat = fs.statSync(outputPath)
    processed.push({
      assetId: payload.assets[0]?.id || payload.toolId,
      name: path.basename(outputPath),
      outputPath,
      outputName: path.basename(outputPath),
      outputSizeBytes: stat.size,
      width: 0,
      height: 0,
    })
  } catch (error) {
    failed.push({ assetId: payload.toolId, name: payload.toolLabel, error: error?.message || '处理失败' })
  }

  return { processed, failed }
}

async function executeLocalTool(payload) {
  const sharpLib = getSharp()
  if (!sharpLib) {
    return {
      ok: false,
      ...payload,
      message: '缺少 sharp 依赖，无法执行本地图片处理。请先安装依赖。',
    }
  }

  if (!payload.destinationPath) {
    return {
      ok: false,
      ...payload,
      message: '无法解析输出目录。',
    }
  }

  ensureDirectory(payload.destinationPath)

  const { processed, failed } = ['merge-image', 'merge-pdf', 'merge-gif'].includes(payload.toolId)
    ? await executeMergeTool(payload, sharpLib)
    : await executeSingleAssetTool(payload, sharpLib)

  const ok = processed.length > 0 && failed.length === 0
  const partial = processed.length > 0 && failed.length > 0
  const message = ok
    ? `已完成 ${payload.toolLabel}：${processed.length} 项，输出到 ${payload.destinationPath}`
    : partial
      ? `${payload.toolLabel} 部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
      : `${payload.toolLabel} 执行失败：${failed[0]?.error || '没有可处理的图片'}`

  return {
    ok,
    partial,
    ...payload,
    processed,
    failed,
    message,
  }
}

const toolsApi = {
  showOpenDialog(options = {}) {
    const hostApi = getHostApi()
    if (typeof hostApi.showOpenDialog !== 'function') return undefined
    return hostApi.showOpenDialog(options)
  },

  async showMainWindow() {
    const hostApi = getHostApi()
    if (typeof hostApi.showMainWindow !== 'function') return false
    return hostApi.showMainWindow()
  },

  async revealPath(targetPath) {
    return revealPath(targetPath)
  },

  async replaceOriginals(items = []) {
    return replaceOriginals(items)
  },

  resolveInputPaths(items = []) {
    return resolveInputPaths(items)
  },

  getEnvironment() {
    const hostApi = getHostApi()
    return {
      appName: hostApi.getAppName?.() || 'ZTools',
      isWindows: hostApi.isWindows?.() || false,
      isMacOS: hostApi.isMacOs?.() || hostApi.isMacOS?.() || false,
      isLinux: hostApi.isLinux?.() || false,
    }
  },

  normalizeInput(items = []) {
    const hostApi = getHostApi()
    const seedList = Array.isArray(items) ? items : [items]
    const list = seedList.flatMap((item) => {
      const extracted = extractLaunchItems(item)
      return extracted.length ? extracted : [item]
    })
    const paths = []

    for (const item of list) {
      if (!item) continue
      if (typeof item === 'string') {
        paths.push(item)
        continue
      }
      if (item.path) {
        paths.push(item.path)
        continue
      }
      if (item.filePath) {
        paths.push(item.filePath)
        continue
      }
      if (item.sourcePath) {
        paths.push(item.sourcePath)
        continue
      }
      if (hostApi.getPathForFile) {
        const filePath = hostApi.getPathForFile(item)
        if (filePath) {
          paths.push(filePath)
          continue
        }
      }
      if (typeof File !== 'undefined' && item instanceof File && hostApi.getPathForFile) {
        const filePath = hostApi.getPathForFile(item)
        if (filePath) paths.push(filePath)
      }
    }

    return Array.from(new Set(paths))
  },

  async collectImageFiles(inputPaths = []) {
    const result = []
    const visited = new Set()

    const walk = (targetPath) => {
      if (!targetPath || visited.has(targetPath) || !fs.existsSync(targetPath)) return
      visited.add(targetPath)
      const stat = fs.statSync(targetPath)
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(targetPath)) {
          walk(path.join(targetPath, entry))
        }
        return
      }

      const ext = path.extname(targetPath).toLowerCase()
      if (IMAGE_EXTENSIONS.has(ext)) {
        result.push(targetPath)
      }
    }

    for (const targetPath of inputPaths) walk(targetPath)
    return result
  },

  async readImageMeta(filePaths = []) {
    return filePaths.map((filePath, index) => {
      const stat = fs.statSync(filePath)
      const image = nativeImage.createFromPath(filePath)
      const { width, height } = image.isEmpty() ? { width: 0, height: 0 } : image.getSize()
      return {
        id: `asset-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        sourcePath: filePath,
        name: path.basename(filePath),
        ext: path.extname(filePath).replace('.', '').toLowerCase(),
        sizeBytes: stat.size,
        width,
        height,
        thumbnailUrl: this.pathToFileUrl(filePath),
        status: 'idle',
        outputPath: '',
        error: '',
        selected: false,
        overrides: {},
      }
    })
  },

  pathToFileUrl(filePath) {
    const normalized = String(filePath).replace(/\\/g, '/')
    const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`
    return encodeURI(`file://${prefixed}`)
  },

  async loadInputs(items = []) {
    const normalized = this.normalizeInput(items)
    const filePaths = await this.collectImageFiles(normalized)
    return this.readImageMeta(filePaths)
  },

  async resolveLaunchInputs(values = []) {
    const inputValues = Array.isArray(values) ? values : [values]
    const collected = []

    for (const value of inputValues) {
      const normalized = this.normalizeInput(extractLaunchItems(value))
      if (!normalized.length) continue
      const filePaths = await this.collectImageFiles(normalized)
      if (filePaths.length) {
        collected.push(...filePaths)
      }
    }

    if (!collected.length) return []
    return this.readImageMeta(Array.from(new Set(collected)))
  },

  async getLaunchInputs() {
    installLaunchHooks()
    await waitForLaunchValue()

    const pendingValues = consumePendingLaunchValues()
    const pendingAssets = await this.resolveLaunchInputs(pendingValues)
    if (pendingAssets.length) return pendingAssets

    const hostApi = getHostApi()
    const candidates = [
      hostApi.getLaunchData?.(),
      hostApi.getLaunchInputs?.(),
      hostApi.getCommandData?.(),
      hostApi.getCmdData?.(),
      hostApi.getFeature?.(),
      hostApi.getCurrentFeature?.(),
      hostApi.getSelectFiles?.(),
      hostApi.getSelectedFiles?.(),
      hostApi.getSelectedFilePaths?.(),
      hostApi.getFiles?.(),
      hostApi.getPaths?.(),
      hostApi.getArguments?.(),
      hostApi.arguments,
      hostApi.argv,
      hostApi.payload,
      hostApi.cmd,
      hostApi,
      globalThis.launchData,
      globalThis.pluginData,
      globalThis.input,
      globalThis.inputs,
    ]

    const resolvedCandidates = await Promise.all(candidates.map((candidate) => Promise.resolve(candidate)))
    return this.resolveLaunchInputs(resolvedCandidates)
  },

  subscribeLaunchInputs(callback) {
    installLaunchHooks()
    if (typeof callback !== 'function') return false
    launchSubscribers.add(callback)
    return true
  },

  async savePreset(toolId, preset) {
    const hostApi = getHostApi()
    const key = `imgbatch:preset:${toolId}`
    const current = hostApi.dbStorage?.getItem?.(key) || []
    const normalizedPreset = {
      id: sanitizeText(preset?.id, `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      name: sanitizeText(preset?.name, '未命名预设'),
      config: preset?.config && typeof preset.config === 'object' ? preset.config : {},
      createdAt: sanitizeText(preset?.createdAt, new Date().toISOString()),
    }
    const next = [...current, normalizedPreset]
    hostApi.dbStorage?.setItem?.(key, next)
    return next
  },

  async loadPresets(toolId) {
    const hostApi = getHostApi()
    const key = `imgbatch:preset:${toolId}`
    const current = hostApi.dbStorage?.getItem?.(key) || []
    const normalized = current.map((preset, index) => {
      const fallbackConfig = preset?.config && typeof preset.config === 'object'
        ? preset.config
        : Object.fromEntries(
            Object.entries(preset || {}).filter(([entryKey]) => !['id', 'name', 'createdAt'].includes(entryKey)),
          )
      return {
        id: sanitizeText(preset?.id, `preset-${Date.now()}-${index + 1}`),
        name: sanitizeText(preset?.name, `预设${index + 1}`),
        config: fallbackConfig && typeof fallbackConfig === 'object' ? fallbackConfig : {},
        createdAt: sanitizeText(preset?.createdAt, new Date().toISOString()),
      }
    })
    const changed = JSON.stringify(current) !== JSON.stringify(normalized)
    if (changed) hostApi.dbStorage?.setItem?.(key, normalized)
    return normalized
  },

  async renamePreset(toolId, presetId, name) {
    const hostApi = getHostApi()
    const key = `imgbatch:preset:${toolId}`
    const current = hostApi.dbStorage?.getItem?.(key) || []
    const next = current.map((preset) => (
      String(preset?.id) === String(presetId)
        ? { ...preset, name: sanitizeText(name, preset?.name || '未命名预设') }
        : preset
    ))
    hostApi.dbStorage?.setItem?.(key, next)
    return next
  },

  async deletePreset(toolId, presetId) {
    const hostApi = getHostApi()
    const key = `imgbatch:preset:${toolId}`
    const current = hostApi.dbStorage?.getItem?.(key) || []
    const next = current.filter((preset) => String(preset?.id) !== String(presetId))
    hostApi.dbStorage?.setItem?.(key, next)
    return next
  },

  prepareRunPayload(toolId, config, assets, destinationPath) {
    return resolveLocalRunPayload(toolId, config, assets, destinationPath)
  },

  async stageToolPreview(toolId, config, assets, destinationPath, mode) {
    return stageToolPreview(toolId, config, assets, destinationPath, mode)
  },

  async saveStagedResult(toolId, stagedItem, destinationPath) {
    return saveStagedResult(toolId, stagedItem, destinationPath)
  },

  async saveAllStagedResults(toolId, stagedItems, destinationPath) {
    return saveAllStagedResults(toolId, stagedItems, destinationPath)
  },

  loadSettings() {
    return resolveLocalSettingsPayload()
  },

  saveSettings(settings) {
    return setLocalSettingsPayload(settings)
  },

  buildStagedItems(assets = []) {
    return resolveLocalSaveItemsPayload(assets)
  },

  async runTool(toolId, config, assets, destinationPath) {
    const payload = resolveLocalRunPayload(toolId, config, assets, destinationPath)
    const hostApi = getHostApi()

    if (supportsLocalProcessing(payload.toolId)) {
      return executeLocalTool(payload)
    }

    if (typeof hostApi.runTool === 'function') {
      return hostApi.runTool(payload.toolId, payload.config, payload.assets, payload.destinationPath, payload)
    }

    return {
      ok: false,
      ...payload,
      message: `宿主处理管线待接入：${payload.toolLabel} · ${payload.queuedCount} 张 · ${payload.summary}`,
    }
  },
}

installLaunchHooks()

if (typeof window !== 'undefined') {
  window.imgbatch = toolsApi
}
