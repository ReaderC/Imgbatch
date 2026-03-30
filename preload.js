const { nativeImage, shell } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.tif', '.avif', '.ico'
])
const TRANSPARENT_BG = { r: 0, g: 0, b: 0, alpha: 0 }
const OPAQUE_WHITE_BG = { r: 255, g: 255, b: 255, alpha: 1 }
const SHARP_INPUT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'avif', 'gif'])
const SHARP_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp', 'tiff', 'avif', 'gif'])
const CUSTOM_OUTPUT_FORMATS = new Set(['bmp', 'ico'])
const TARGET_COMPRESSION_FORMATS = new Set(['jpeg', 'webp', 'avif'])
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
const WATERMARK_IMAGE_CACHE = new Map()
const WATERMARK_OVERLAY_CACHE = new Map()
const WATERMARK_TEXT_CACHE = new Map()
const WATERMARK_TILED_CACHE = new Map()
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
  if (toolId === 'format') return `输出 ${config.targetFormat}${config.mode === 'quality' ? ` / 质量 ${config.quality}%` : ' / 仅转换'}`
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
  if (toolId === 'merge-image') return `${config.direction === 'vertical' ? '纵向' : '横向'}拼接 ${config.pageWidth}px${config.preventUpscale ? ' / 小图原尺寸' : ''}`
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

function copyAssetToOutput(asset, outputPath, sourceInput = null, fallback = asset) {
  if (sourceInput) fs.writeFileSync(outputPath, sourceInput)
  else fs.copyFileSync(asset.sourcePath, outputPath)
  return createOutputMeta(outputPath, {
    size: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
  }, fallback)
}

async function writeTransformedAsset(transformer, format, quality, outputPath, fallback = {}) {
  if (format === 'bmp') {
    const buffer = await createBmpBuffer(transformer)
    fs.writeFileSync(outputPath, buffer)
    return createOutputMeta(outputPath, { size: buffer.length }, fallback)
  }

  if (format === 'ico') {
    const { data, info } = await transformer
      .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer({ resolveWithObject: true })
    const buffer = createIcoBuffer(data, info.width || 256, info.height || 256)
    fs.writeFileSync(outputPath, buffer)
    return createOutputMeta(outputPath, {
      size: buffer.length,
      width: info.width || fallback.width || 256,
      height: info.height || fallback.height || 256,
    }, fallback)
  }

  const info = await withOutputFormat(transformer, format, quality).toFile(outputPath)
  return createOutputMeta(outputPath, info, fallback)
}

function estimateCompressionQuality(originalSizeBytes, targetBytes) {
  if (!originalSizeBytes || !targetBytes) return 75
  const ratio = Math.max(0.02, Math.min(0.98, targetBytes / originalSizeBytes))
  const estimated = Math.round(12 + (78 * Math.sqrt(ratio)))
  return Math.max(1, Math.min(90, estimated))
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

  return createOutputMeta(targetPath, {
    size: stagedItem?.outputSizeBytes,
    width: stagedItem?.width,
    height: stagedItem?.height,
  }, stagedItem)
}

async function stageResultToProcessed(asset, result, payload, sharpLib = null) {
  const stagedPath = typeof result === 'string' ? result : result.outputPath
  const meta = (typeof result === 'object' && result?.outputPath && result?.outputSizeBytes
    ? createOutputMeta(stagedPath, result, result)
    : null) || await readOutputMeta(stagedPath, sharpLib)
  const previewUrl = toPublicFileUrl(stagedPath)
  const cacheBustedPreviewUrl = previewUrl && payload.runId ? `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(payload.runId)}` : previewUrl
  return {
    assetId: asset.id,
    name: asset.name,
    mode: payload.mode,
    previewStatus: payload.mode === 'preview-save' ? 'staged' : 'previewed',
    outputName: meta.outputName,
    stagedPath,
    previewUrl: cacheBustedPreviewUrl,
    outputSizeBytes: typeof result === 'object' && result.outputSizeBytes ? result.outputSizeBytes : meta.outputSizeBytes,
    width: meta.width,
    height: meta.height,
    warning: result?.warning || '',
    saveSignature: createPreviewSignature(payload.toolId, payload.config),
    runId: payload.runId,
    runFolderName: payload.runFolderName,
    savedOutputPath: '',
  }
}

async function directResultToProcessed(asset, result, sharpLib = null) {
  const outputPath = typeof result === 'string' ? result : result.outputPath
  const meta = (typeof result === 'object' && result?.outputPath && result?.outputSizeBytes
    ? createOutputMeta(outputPath, result, result)
    : null) || await readOutputMeta(outputPath, sharpLib)
  return {
    assetId: asset.id,
    name: asset.name,
    mode: 'direct',
    previewStatus: 'saved',
    outputPath,
    outputName: meta.outputName,
    outputSizeBytes: typeof result === 'object' && result.outputSizeBytes ? result.outputSizeBytes : meta.outputSizeBytes,
    width: meta.width,
    height: meta.height,
    warning: result?.warning || '',
    savedOutputPath: outputPath || '',
  }
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return []

  const workerCount = Math.max(1, Math.min(concurrency || 1, list.length))
  const results = new Array(list.length)
  let cursor = 0

  if (workerCount === 1) {
    for (let index = 0; index < list.length; index += 1) {
      results[index] = await iteratee(list[index], index)
    }
    return results
  }

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
  const targetKb = Number(payload?.config?.targetSizeKb) || 0
  const targetBytes = targetKb > 0 ? targetKb * 1024 : 0
  const warningCount = processed.filter((item) => {
    if (item?.warning) return true
    if (payload?.toolId !== 'compression' || payload?.config?.mode !== 'target') return false
    return targetBytes > 0 && Number(item?.outputSizeBytes) > targetBytes
  }).length
  const warningSuffix = warningCount ? ` 其中 ${warningCount} 项未达到目标体积，已输出可达到的最小结果。` : ''
  if (payload.mode === 'preview-only') {
    if (ok) return `已生成 ${payload.toolLabel} 单张预览，可继续调整参数。${warningSuffix}`
    if (partial) return `${payload.toolLabel} 预览部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
    return `${payload.toolLabel} 预览失败：${failed[0]?.error || '没有可处理的图片'}`
  }
  if (payload.mode === 'preview-save') {
    if (ok) return `已生成 ${payload.toolLabel} 处理结果：${processed.length} 项，可继续保存。${warningSuffix}`
    if (partial) return `${payload.toolLabel} 处理部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
    return `${payload.toolLabel} 处理失败：${failed[0]?.error || '没有可处理的图片'}`
  }
  if (ok) return `已完成 ${payload.toolLabel}：${processed.length} 项，输出到 ${payload.destinationPath}${warningSuffix}`
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
    elapsedMs: Number(payload?.elapsedMs) || 0,
    message: formatResultMessage(payload, processed, failed),
  }
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

  const basePreviewPath = path.join(os.tmpdir(), PREVIEW_DIR_NAME)
  const runFolderName = buildRunFolderName(payload.createdAt, toolId)
  const runPath = path.join(basePreviewPath, runFolderName)
  return {
    ...payload,
    destinationPath: runPath,
    baseDestinationPath: basePreviewPath,
    runFolderName,
    mode,
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
      mode: pickOption(config.mode, ['convert', 'quality'], 'convert'),
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
      preventUpscale: Boolean(config.preventUpscale),
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

function emitProcessingProgress(detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent('imgbatch-processing-progress', { detail }))
  } catch {
    // Ignore progress bridge errors so processing is not affected.
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

function normalizeImageFormatName(format) {
  const normalized = String(format || '').trim().toLowerCase()
  if (normalized === 'jpg') return 'jpeg'
  return normalized
}

function isAlphaCapableFormat(format) {
  return ALPHA_CAPABLE_FORMATS.has(String(format || '').toLowerCase())
}

function getOutputName(asset, toolId, format) {
  const parsed = path.parse(asset.name || path.basename(asset.sourcePath))
  const outputExtension = format === 'jpeg' ? 'jpg' : format
  return `${parsed.name}-${toolId}.${outputExtension}`
}

function createTransformerFromInput(sharpLib, input, ext = '') {
  return sharpLib(input, { animated: String(ext).toLowerCase() === 'gif' })
}

function createTransformer(sharpLib, asset) {
  return createTransformerFromInput(sharpLib, asset.sourcePath, asset.ext)
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
  const targetBytes = config.targetSizeKb * 1024
  const maxQuality = 90

  const ensureCompressedOutputIsSmaller = (outputSizeBytes) => {
    if (!originalSizeBytes || outputSizeBytes < originalSizeBytes) return
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
    throw new Error('压缩结果未小于原图，已跳过该文件')
  }

  if (config.mode === 'target' && originalSizeBytes && targetBytes >= originalSizeBytes) {
    throw new Error('目标大小未小于原图，已跳过该文件')
  }

  if (config.mode !== 'target' || !TARGET_COMPRESSION_FORMATS.has(format)) {
    const output = await writeTransformedAsset(createTransformer(sharpLib, asset), format, Math.round(config.quality), outputPath, {
      width: asset.width,
      height: asset.height,
    })
    ensureCompressedOutputIsSmaller(output.outputSizeBytes)
    if (config.mode !== 'target') return output
    const warning = output.outputSizeBytes > targetBytes
      ? `当前输出格式 ${String(format || '').toUpperCase()} 不支持精确按体积，已输出当前结果 ${Math.max(1, Math.round(output.outputSizeBytes / 1024))} KB。`
      : ''
    return warning ? { ...output, warning } : output
  }

  const sourceInput = fs.readFileSync(asset.sourcePath)
  const cache = new Map()
  const encodeAtQuality = async (quality) => {
    const normalizedQuality = Math.max(1, Math.min(maxQuality, Math.round(quality)))
    if (cache.has(normalizedQuality)) return cache.get(normalizedQuality)
    const buffer = await withOutputFormat(createTransformerFromInput(sharpLib, sourceInput, asset.ext), format, normalizedQuality).toBuffer()
    cache.set(normalizedQuality, buffer)
    return buffer
  }

  const estimatedQuality = estimateCompressionQuality(originalSizeBytes, targetBytes)
  const estimatedBuffer = await encodeAtQuality(estimatedQuality)
  let chosenBuffer = estimatedBuffer

  if (estimatedBuffer.length > targetBytes) {
    const lowQuality = 1
    const lowBuffer = estimatedQuality === lowQuality ? estimatedBuffer : await encodeAtQuality(lowQuality)
    chosenBuffer = lowBuffer

    if (lowBuffer.length <= targetBytes) {
      let bestBuffer = lowBuffer
      let left = lowQuality + 1
      let right = estimatedQuality - 1

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
  } else if (estimatedQuality < maxQuality) {
    let bestBuffer = estimatedBuffer
    let left = estimatedQuality + 1
    let right = maxQuality

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

  const warning = chosenBuffer.length > targetBytes
    ? `未达到目标体积 ${config.targetSizeKb} KB，已输出当前可达到的最小结果 ${Math.max(1, Math.round(chosenBuffer.length / 1024))} KB。`
    : ''
  fs.writeFileSync(outputPath, chosenBuffer)
  ensureCompressedOutputIsSmaller(chosenBuffer.length)
  return {
    outputPath,
    outputName: path.basename(outputPath),
    outputSizeBytes: chosenBuffer.length,
    width: asset.width || 0,
    height: asset.height || 0,
    warning,
  }
}

async function writeFormatAsset(sharpLib, asset, config, destinationPath) {
  const format = mapOutputFormat('format', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'format', format))
  let sourceFormat = normalizeImageFormatName(asset.ext)
  let sourceInput = null
  const shouldProbeSourceFormat = config.mode !== 'quality'
    && (sourceFormat === format || !SHARP_INPUT_EXTENSIONS.has(String(asset.ext || '').toLowerCase()))

  if (shouldProbeSourceFormat) {
    try {
      sourceInput = fs.readFileSync(asset.sourcePath)
      const metadata = await sharpLib(sourceInput).metadata()
      sourceFormat = normalizeImageFormatName(metadata?.format) || sourceFormat
    } catch {
      sourceFormat = normalizeImageFormatName(asset.ext)
      sourceInput = null
    }
  }

  if (config.mode !== 'quality' && sourceFormat === format) {
    return copyAssetToOutput(asset, outputPath, sourceInput)
  }

  const baseTransformer = sourceInput
    ? createTransformerFromInput(sharpLib, sourceInput, sourceFormat)
    : createTransformer(sharpLib, asset)
  let transformed = baseTransformer
  if (typeof transformed.withIccProfile === 'function') {
    transformed = transformed.withIccProfile(config.colorProfile || 'srgb')
  }
  if (!(config.keepTransparency && isAlphaCapableFormat(format))) {
    transformed = transformed.flatten({ background: hexToRgbaObject('#ffffff', 1) })
  }
  const quality = config.mode === 'quality' ? Math.round(config.quality) : 100

  return writeTransformedAsset(transformed, format, quality, outputPath, {
    width: asset.width,
    height: asset.height,
  })
}

async function writeResizeAsset(sharpLib, asset, config, destinationPath) {
  const format = mapOutputFormat('resize', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'resize', format))
  const width = config.width.unit === '%' ? Math.max(1, Math.round((asset.width || 0) * (config.width.value / 100))) : Math.max(1, Math.round(config.width.value))
  const height = config.height.unit === '%' ? Math.max(1, Math.round((asset.height || 0) * (config.height.value / 100))) : Math.max(1, Math.round(config.height.value))
  const sourceFormat = normalizeImageFormatName(asset.ext)
  const sourceWidth = Math.max(0, Number(asset.width) || 0)
  const sourceHeight = Math.max(0, Number(asset.height) || 0)

  if (sourceWidth > 0 && sourceHeight > 0 && sourceFormat === format && width === sourceWidth && height === sourceHeight) {
    return copyAssetToOutput(asset, outputPath)
  }
  if (sourceWidth > 0 && sourceHeight > 0 && width === sourceWidth && height === sourceHeight) {
    return writeTransformedAsset(createTransformer(sharpLib, asset), format, 90, outputPath, {
      width: sourceWidth,
      height: sourceHeight,
    })
  }

  const resized = createTransformer(sharpLib, asset).resize({
    width,
    height,
    fit: config.lockAspectRatio ? 'inside' : 'fill',
  })
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

async function createTiledWatermarkBuffer(sharpLib, input, density, sizeHint = null) {
  const width = Math.max(1, sizeHint?.width || 1)
  const height = Math.max(1, sizeHint?.height || 1)
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
      background: TRANSPARENT_BG,
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
  const imageSourceKey = isDataUrl ? imagePath : path.resolve(imagePath)

  if (!isDataUrl && !fs.existsSync(imageSourceKey)) {
    throw new Error('图片水印文件不存在')
  }

  const imageInput = WATERMARK_IMAGE_CACHE.get(imageSourceKey) || (() => {
    const buffer = isDataUrl
      ? Buffer.from(imagePath.slice(imagePath.indexOf(',') + 1), 'base64')
      : fs.readFileSync(imageSourceKey)
    WATERMARK_IMAGE_CACHE.set(imageSourceKey, buffer)
    return buffer
  })()

  const renderScale = getWatermarkRenderScale(asset)
  const baseWidth = Math.max(asset.width || 1920, 1)
  const watermarkWidth = Math.max(32, Math.round(baseWidth * 0.18 * renderScale))
  const rotation = Math.round(toNumber(config.rotation, 0))
  const opacity = Math.round(clampNumber(config.opacity, 0, 100, 60))
  const overlayCacheKey = [
    imageSourceKey,
    rotation,
    opacity,
    watermarkWidth,
  ].join('|')
  const cachedOverlay = WATERMARK_OVERLAY_CACHE.get(overlayCacheKey)
  if (cachedOverlay) return cachedOverlay

  let overlayTransformer = sharpLib(imageInput)
  if (rotation !== 0) {
    overlayTransformer = overlayTransformer.rotate(rotation, { background: TRANSPARENT_BG })
  }
  overlayTransformer = overlayTransformer.resize({ width: watermarkWidth, withoutEnlargement: true })
  if (opacity < 100) {
    overlayTransformer = overlayTransformer.ensureAlpha(opacity / 100)
  }
  const { data, info } = await overlayTransformer.png().toBuffer({ resolveWithObject: true })
  const overlay = {
    input: data,
    width: info.width || 1,
    height: info.height || 1,
    cacheKey: overlayCacheKey,
  }
  WATERMARK_OVERLAY_CACHE.set(overlayCacheKey, overlay)
  return overlay
}

async function buildWatermarkComposite(sharpLib, asset, config) {
  let overlay = config.type === 'image'
    ? await createImageWatermarkBuffer(sharpLib, asset, config)
    : null

  if (config.type === 'text') {
    const renderScaleKey = Math.round(getWatermarkRenderScale(asset) * 100)
    const textOverlayKey = [
      config.text,
      config.color,
      Math.round(clampNumber(config.opacity, 0, 100, 60)),
      Math.max(1, Math.round(config.fontSize || 32)),
      Math.round(toNumber(config.rotation, 0)),
      renderScaleKey,
    ].join('|')
    overlay = WATERMARK_TEXT_CACHE.get(textOverlayKey) || null
    if (!overlay) {
      const trimmed = await sharpLib(buildTextWatermarkSvg(asset, config))
        .trim()
        .png()
        .toBuffer({ resolveWithObject: true })
      overlay = {
        input: trimmed.data,
        width: trimmed.info.width || 1,
        height: trimmed.info.height || 1,
        cacheKey: textOverlayKey,
      }
      WATERMARK_TEXT_CACHE.set(textOverlayKey, overlay)
    }
  }

  if (config.tiled) {
    const tiledCacheKey = overlay?.cacheKey ? `${overlay.cacheKey}|tile|${clampNumber(config.density, 20, 250, 100)}` : ''
    const cachedTiledOverlay = tiledCacheKey ? WATERMARK_TILED_CACHE.get(tiledCacheKey) : null
    overlay = {
      input: cachedTiledOverlay
        ? cachedTiledOverlay
        : await createTiledWatermarkBuffer(sharpLib, overlay.input, config.density, overlay),
      width: 0,
      height: 0,
    }
    if (tiledCacheKey && !WATERMARK_TILED_CACHE.has(tiledCacheKey)) {
      WATERMARK_TILED_CACHE.set(tiledCacheKey, overlay.input)
    }
    return {
      input: overlay.input,
      tile: true,
      gravity: 'centre',
    }
  }

  const overlayWidth = Math.max(1, overlay.width || 1)
  const overlayHeight = Math.max(1, overlay.height || 1)
  const assetWidth = Math.max(1, asset.width || 1)
  const assetHeight = Math.max(1, asset.height || 1)
  const margin = Math.max(0, config.margin || 0)
  const position = String(config.position || 'center')
  const isLeft = position.includes('left')
  const isRight = position.includes('right')
  const isTop = position.startsWith('top')
  const isBottom = position.startsWith('bottom')
  const horizontal = isLeft
    ? margin
    : isRight
      ? Math.max(0, assetWidth - overlayWidth - margin)
      : Math.round((assetWidth - overlayWidth) / 2)
  const vertical = isTop
    ? margin
    : isBottom
      ? Math.max(0, assetHeight - overlayHeight - margin)
      : Math.round((assetHeight - overlayHeight) / 2)

  return {
    input: overlay.input,
    left: Math.max(0, horizontal),
    top: Math.max(0, vertical),
  }
}

async function revealPath(targetPath) {
  const normalizedTarget = path.normalize(sanitizeText(targetPath))
  let resolved = ''
  try {
    if (normalizedTarget && fs.statSync(normalizedTarget).isDirectory()) {
      resolved = normalizedTarget
    } else {
      resolved = normalizedTarget ? path.dirname(normalizedTarget) : ''
    }
  } catch {
    resolved = ''
  }
  if (!resolved) return false
  try {
    let targetStat = null
    try {
      targetStat = normalizedTarget ? fs.statSync(normalizedTarget) : null
    } catch {
      targetStat = null
    }
    if (typeof shell.showItemInFolder === 'function' && targetStat && !targetStat.isDirectory()) {
      shell.showItemInFolder(normalizedTarget)
      return true
    }
    const directoryEntry = path.join(resolved, '.')
    if (typeof shell.showItemInFolder === 'function') {
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

function removeEmptyDirectoryIfPossible(targetPath) {
  const directoryPath = path.dirname(targetPath)
  if (!directoryPath || !fs.existsSync(directoryPath)) return
  try {
    if (!fs.statSync(directoryPath).isDirectory()) return
    if ((fs.readdirSync(directoryPath) || []).length > 0) return
    fs.rmdirSync(directoryPath)
  } catch {
    // Ignore cleanup failures so replace succeeds even if folder removal does not.
  }
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
    removeEmptyDirectoryIfPossible(sourcePath)
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

function revealResultDirectoryIfNeeded(result) {
  if (!['save', 'direct'].includes(result?.mode)) return result
  const targetPath = result.destinationPath || result.baseDestinationPath || ''
  if (targetPath && (result.ok || result.partial)) {
    void revealPath(targetPath)
  }
  return result
}

async function writeWatermarkAsset(sharpLib, asset, config, destinationPath) {
  const format = mapOutputFormat('watermark', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'watermark', format))
  const sourceFormat = normalizeImageFormatName(asset.ext)
  const watermarkOpacity = Number(config.opacity) || 0
  const isEmptyTextWatermark = config.type === 'text' && !sanitizeText(config.text)
  const isZeroSizeTextWatermark = config.type === 'text' && Number(config.fontSize) <= 0

  if (watermarkOpacity <= 0 || isEmptyTextWatermark || isZeroSizeTextWatermark) {
    if (sourceFormat === format) {
      return copyAssetToOutput(asset, outputPath)
    }
    return writeTransformedAsset(createTransformer(sharpLib, asset), format, 90, outputPath)
  }

  const composite = await buildWatermarkComposite(sharpLib, asset, config)
  const transformed = createTransformer(sharpLib, asset).composite([composite])
  return writeTransformedAsset(transformed, format, 90, outputPath)
}

async function writeRotateAsset(sharpLib, asset, config, destinationPath) {
  const format = mapOutputFormat('rotate', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'rotate', format))
  const sourceFormat = normalizeImageFormatName(asset.ext)
  const normalizedAngle = ((Math.round(Number(config.angle) || 0) % 360) + 360) % 360

  if (sourceFormat === format && normalizedAngle === 0 && !config.keepAspectRatio && !config.autoCrop) {
    return copyAssetToOutput(asset, outputPath)
  }
  if (normalizedAngle === 0 && !config.keepAspectRatio && !config.autoCrop) {
    return writeTransformedAsset(createTransformer(sharpLib, asset), format, 90, outputPath, {
      width: asset.width,
      height: asset.height,
    })
  }

  const solidBackground = hexToRgbaObject(config.background, 1)
  let transformed = createTransformer(sharpLib, asset)

  if (config.autoCrop) {
    transformed = transformed
      .ensureAlpha()
      .rotate(config.angle, { background: TRANSPARENT_BG })
      .trim()
  } else {
    transformed = transformed.rotate(config.angle, { background: solidBackground })
  }

  if (config.keepAspectRatio && asset.width && asset.height) {
    transformed = transformed.resize({
      width: asset.width,
      height: asset.height,
      fit: 'contain',
      background: config.autoCrop ? TRANSPARENT_BG : solidBackground,
    })
  }

  if (config.autoCrop && !isAlphaCapableFormat(format)) {
    transformed = transformed.flatten({ background: solidBackground })
  }

  return writeTransformedAsset(transformed, format, 90, outputPath)
}

async function writeFlipAsset(sharpLib, asset, config, destinationPath) {
  const requestedOutputFormat = String(config.outputFormat || '').toLowerCase()
  const format = !requestedOutputFormat || requestedOutputFormat === 'keep original'
    ? mapOutputFormat('flip', asset, config)
    : mapOutputFormat('format', asset, { targetFormat: config.outputFormat })
  const outputPath = path.join(destinationPath, getOutputName(asset, 'flip', format))
  const sourceFormat = normalizeImageFormatName(asset.ext)
  const hasNoFlipTransform = !config.horizontal && !config.vertical && !config.autoCropTransparent

  if (sourceFormat === format && hasNoFlipTransform) {
    return copyAssetToOutput(asset, outputPath)
  }
  if (hasNoFlipTransform) {
    let transformed = createTransformer(sharpLib, asset)
    if (config.preserveMetadata && typeof transformed.keepMetadata === 'function') {
      transformed = transformed.keepMetadata()
    }
    return writeTransformedAsset(transformed, format, 90, outputPath, {
      width: asset.width,
      height: asset.height,
    })
  }

  let transformed = createTransformer(sharpLib, asset)

  if (config.horizontal) transformed = transformed.flop()
  if (config.vertical) transformed = transformed.flip()
  if (config.autoCropTransparent) transformed = transformed.ensureAlpha().trim()
  if (config.autoCropTransparent && !isAlphaCapableFormat(format)) {
    transformed = transformed.flatten({ background: OPAQUE_WHITE_BG })
  }
  if (config.preserveMetadata && typeof transformed.keepMetadata === 'function') {
    transformed = transformed.keepMetadata()
  }

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
  const baseTransformer = createTransformer(sharpLib, asset)
  const metadata = asset.width && asset.height ? null : await baseTransformer.clone().metadata()
  const width = asset.width || metadata?.width || 1
  const height = asset.height || metadata?.height || 1
  const maxRadius = Math.min(width, height) / 2
  const radius = config.unit === '%' ? Math.round(maxRadius * (config.radius / 100)) : Math.min(maxRadius, Math.max(0, config.radius))

  if (radius <= 0 && normalizeImageFormatName(asset.ext) === outputFormat) {
    return copyAssetToOutput(asset, outputPath, null, { ...asset, width, height })
  }
  if (radius <= 0) {
    return writeTransformedAsset(createTransformer(sharpLib, asset), outputFormat, 90, outputPath, { width, height })
  }

  const mask = buildRoundedRectSvg(width, height, radius, '#ffffff')

  let transformed = baseTransformer.ensureAlpha().composite([{ input: mask, blend: 'dest-in' }])

  if (!config.keepTransparency) {
    transformed = transformed.flatten({ background: hexToRgbaObject(config.background, 1) })
  }

  return writeTransformedAsset(transformed, outputFormat, 90, outputPath)
}

async function writePaddingAsset(sharpLib, asset, config, destinationPath) {
  const format = mapOutputFormat('padding', asset, config)
  const outputPath = path.join(destinationPath, getOutputName(asset, 'padding', format))
  const sourceFormat = normalizeImageFormatName(asset.ext)
  const noPadding = Number(config.top) === 0 && Number(config.right) === 0 && Number(config.bottom) === 0 && Number(config.left) === 0

  if (noPadding && sourceFormat === format) {
    return copyAssetToOutput(asset, outputPath)
  }
  if (noPadding) {
    return writeTransformedAsset(createTransformer(sharpLib, asset), format, 90, outputPath, {
      width: asset.width,
      height: asset.height,
    })
  }

  const background = hexToRgbaObject(config.color, config.opacity / 100)
  const transformed = createTransformer(sharpLib, asset).extend({
    top: config.top,
    right: config.right,
    bottom: config.bottom,
    left: config.left,
    background,
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
  const sourceFormat = normalizeImageFormatName(asset.ext)
  const sourceWidth = Math.max(0, Number(asset.width) || 0)
  const sourceHeight = Math.max(0, Number(asset.height) || 0)

  if (sourceWidth > 0 && sourceHeight > 0
    && sourceFormat === format
    && box.left === 0
    && box.top === 0
    && box.width === sourceWidth
    && box.height === sourceHeight) {
    return copyAssetToOutput(asset, outputPath)
  }
  if (sourceWidth > 0 && sourceHeight > 0
    && box.left === 0
    && box.top === 0
    && box.width === sourceWidth
    && box.height === sourceHeight) {
    return writeTransformedAsset(createTransformer(sharpLib, asset), format, 90, outputPath, {
      width: sourceWidth,
      height: sourceHeight,
    })
  }

  const transformed = createTransformer(sharpLib, asset).extract(box)
  return writeTransformedAsset(transformed, format, 90, outputPath)
}

async function writeMergeImageAsset(sharpLib, payload) {
  const format = 'png'
  const outputPath = path.join(payload.destinationPath, `merged-image.${format}`)
  const background = hexToRgbaObject(payload.config.background, 1)
  const isVertical = payload.config.direction === 'vertical'
  const isCentered = payload.config.align === 'center'
  const preventUpscale = Boolean(payload.config.preventUpscale)
  const fitWidth = isVertical ? payload.config.pageWidth : undefined
  const fitHeight = isVertical ? undefined : payload.config.pageWidth
  if (payload.assets.length === 1) {
    const asset = payload.assets[0]
    const sourceFormat = normalizeImageFormatName(asset.ext)
    const keepsOriginalSize = isVertical
      ? ((preventUpscale && Number(asset.width) <= payload.config.pageWidth) || Number(asset.width) === payload.config.pageWidth)
      : ((preventUpscale && Number(asset.height) <= payload.config.pageWidth) || Number(asset.height) === payload.config.pageWidth)
    if (sourceFormat === format && keepsOriginalSize) {
      return copyAssetToOutput(asset, outputPath)
    }
    const info = await sharpLib(asset.sourcePath)
      .resize({
        width: fitWidth,
        height: fitHeight,
        fit: 'contain',
        background,
        withoutEnlargement: preventUpscale,
      })
      .png()
      .toFile(outputPath)
    return {
      outputPath,
      outputSizeBytes: info.size || 0,
      outputWidth: info.width || 0,
      outputHeight: info.height || 0,
    }
  }
  const profile = getPerformanceProfile(getAppSettings().performanceMode)
  const prepareConcurrency = Math.max(1, Math.min(payload.assets.length, Math.min(profile.mediumConcurrency, 4)))
  const prepared = await mapWithConcurrency(payload.assets, prepareConcurrency, async (asset) => {
    const sourceFormat = normalizeImageFormatName(asset.ext)
    const sourceWidth = Math.max(0, Number(asset.width) || 0)
    const sourceHeight = Math.max(0, Number(asset.height) || 0)
    const keepsOriginalSize = isVertical
      ? ((preventUpscale && sourceWidth <= payload.config.pageWidth) || sourceWidth === payload.config.pageWidth)
      : ((preventUpscale && sourceHeight <= payload.config.pageWidth) || sourceHeight === payload.config.pageWidth)
    if (sourceFormat === format && sourceWidth > 0 && sourceHeight > 0 && keepsOriginalSize) {
      return {
        input: asset.sourcePath,
        width: sourceWidth,
        height: sourceHeight,
      }
    }
    const { data, info } = await sharpLib(asset.sourcePath)
      .resize({
        width: fitWidth,
        height: fitHeight,
        fit: 'contain',
        background,
        withoutEnlargement: preventUpscale,
      })
      .png()
      .toBuffer({ resolveWithObject: true })
    return {
      input: data,
      width: info.width || 1,
      height: info.height || 1,
    }
  })
  let contentWidth = 0
  let contentHeight = 0

  for (const item of prepared) {
    const { width, height } = item
    if (isVertical) {
      contentWidth = Math.max(contentWidth, width)
      contentHeight += height
    } else {
      contentWidth += width
      contentHeight = Math.max(contentHeight, height)
    }
  }

  if (!prepared.length) throw new Error('没有可拼接的图片')

  const spacing = payload.config.spacing
  const spacingTotal = spacing * Math.max(0, prepared.length - 1)
  const totalWidth = isVertical ? contentWidth : contentWidth + spacingTotal
  const totalHeight = isVertical ? contentHeight + spacingTotal : contentHeight

  let cursorX = 0
  let cursorY = 0
  const composites = prepared.map((item) => {
    const composite = {
      input: item.input,
      left: isVertical && isCentered
        ? Math.max(0, Math.round((totalWidth - item.width) / 2))
        : cursorX,
      top: !isVertical && isCentered
        ? Math.max(0, Math.round((totalHeight - item.height) / 2))
        : cursorY,
    }
    if (isVertical) {
      cursorY += item.height + spacing
    } else {
      cursorX += item.width + spacing
    }
    return composite
  })

  const info = await sharpLib({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 4,
      background,
    },
  }).composite(composites).png().toFile(outputPath)

  return {
    outputPath,
    outputSizeBytes: Number(info?.size) || 0,
  }
}

async function writeMergePdfAssetReal(sharpLib, payload) {
  const pdfLib = getPdfLib()
  if (!pdfLib) throw new Error('缺少 pdf-lib 依赖')
  const outputPath = path.join(payload.destinationPath, 'merged.pdf')
  const pdf = await pdfLib.PDFDocument.create()
  const background = hexToRgbaObject(payload.config.background || '#ffffff', 1)
  const backgroundColor = pdfLib.rgb(background.r / 255, background.g / 255, background.b / 255)
  const profile = getPerformanceProfile(getAppSettings().performanceMode)
  const prepareConcurrency = Math.max(1, Math.min(payload.assets.length, Math.min(profile.heavyConcurrency, 3)))
  const paintPdfPageBackground = (page, pageSize) => {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageSize[0],
      height: pageSize[1],
      color: backgroundColor,
    })
  }
  const prepareAsset = async (asset) => {
    const imageBytes = fs.readFileSync(asset.sourcePath)
    const fixedPageSize = payload.config.pageSize === 'Original'
      ? null
      : (PDF_PAGE_SIZES[payload.config.pageSize] || PDF_PAGE_SIZES.A4)
    let sourceWidth = Math.max(0, Number(asset.width) || 0)
    let sourceHeight = Math.max(0, Number(asset.height) || 0)
    const marginBaseWidth = fixedPageSize?.[0] || sourceWidth || 1
    const margin = payload.config.margin === 'none'
      ? 0
      : payload.config.margin === 'wide'
        ? Math.round(marginBaseWidth * 0.08)
        : payload.config.margin === 'normal'
          ? Math.round(marginBaseWidth * 0.06)
          : Math.round(marginBaseWidth * 0.04)
    const prepared = {
      asset,
      imageBytes,
      fixedPageSize,
      sourceFormat: String(asset.ext || '').toLowerCase(),
      sourceWidth,
      sourceHeight,
      margin,
      pageSize: fixedPageSize || PDF_PAGE_SIZES.A4,
      drawableWidth: 0,
      drawableHeight: 0,
      scaledWidth: 0,
      scaledHeight: 0,
      pageSliceHeight: 0,
      scaledBuffer: null,
      embeddedBytes: null,
      embeddedKind: '',
    }

    if (payload.config.autoPaginate && payload.config.pageSize !== 'Original') {
      if (!(sourceWidth > 0 && sourceHeight > 0)) {
        const metadata = await sharpLib(imageBytes).metadata()
        sourceWidth = Math.max(1, Number(metadata?.width) || sourceWidth || 1)
        sourceHeight = Math.max(1, Number(metadata?.height) || sourceHeight || 1)
        prepared.sourceWidth = sourceWidth
        prepared.sourceHeight = sourceHeight
      }
      prepared.drawableWidth = Math.max(1, prepared.pageSize[0] - margin * 2)
      prepared.drawableHeight = Math.max(1, prepared.pageSize[1] - margin * 2)
      prepared.scaledWidth = Math.max(1, Math.round(prepared.drawableWidth))
      prepared.pageSliceHeight = Math.max(1, Math.round(prepared.drawableHeight))
      prepared.scaledHeight = Math.max(1, Math.round(sourceHeight * (prepared.scaledWidth / sourceWidth)))
      if (prepared.scaledHeight > prepared.drawableHeight) {
        const scaled = await sharpLib(imageBytes)
          .resize({ width: prepared.scaledWidth, fit: 'fill' })
          .png()
          .toBuffer({ resolveWithObject: true })
        prepared.scaledBuffer = scaled.data
        prepared.scaledHeight = Math.max(1, scaled.info.height || prepared.scaledHeight)
      }
    } else if (!['png', 'webp', 'avif', 'gif', 'jpg', 'jpeg'].includes(prepared.sourceFormat)) {
      prepared.embeddedBytes = await sharpLib(imageBytes).jpeg().toBuffer()
      prepared.embeddedKind = 'jpg'
    }

    return prepared
  }
  const preparedAssets = payload.assets.length === 1
    ? [await prepareAsset(payload.assets[0])]
    : await mapWithConcurrency(payload.assets, prepareConcurrency, prepareAsset)

  for (const prepared of preparedAssets) {
    const { asset, imageBytes, fixedPageSize } = prepared
    let embedded = null
    let sourceWidth = prepared.sourceWidth
    let sourceHeight = prepared.sourceHeight
    const ensureEmbedded = async () => {
      if (embedded) return embedded
      if (prepared.embeddedKind === 'jpg' && prepared.embeddedBytes) {
        embedded = await pdf.embedJpg(prepared.embeddedBytes)
      } else if (prepared.sourceFormat === 'png' || prepared.sourceFormat === 'webp' || prepared.sourceFormat === 'avif' || prepared.sourceFormat === 'gif') {
        embedded = await pdf.embedPng(imageBytes)
      } else if (prepared.sourceFormat === 'jpg' || prepared.sourceFormat === 'jpeg') {
        embedded = await pdf.embedJpg(imageBytes)
      } else {
        embedded = await pdf.embedJpg(prepared.embeddedBytes || imageBytes)
      }
      sourceWidth = Math.max(1, sourceWidth || embedded.width || 1)
      sourceHeight = Math.max(1, sourceHeight || embedded.height || 1)
      return embedded
    }
    const margin = prepared.margin

    if (payload.config.pageSize === 'Original') {
      const originalImage = await ensureEmbedded()
      const pageSize = [originalImage.width + margin * 2, originalImage.height + margin * 2]
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
      page.drawImage(originalImage, {
        x: margin,
        y: margin,
        width: originalImage.width,
        height: originalImage.height,
      })
      continue
    }

    const pageSize = prepared.pageSize
    const drawableWidth = prepared.drawableWidth || Math.max(1, pageSize[0] - margin * 2)
    const drawableHeight = prepared.drawableHeight || Math.max(1, pageSize[1] - margin * 2)

    if (!payload.config.autoPaginate) {
      const pageImage = await ensureEmbedded()
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
      const scale = Math.min(drawableWidth / pageImage.width, drawableHeight / pageImage.height)
      const width = pageImage.width * scale
      const height = pageImage.height * scale
      page.drawImage(pageImage, {
        x: (pageSize[0] - width) / 2,
        y: (pageSize[1] - height) / 2,
        width,
        height,
      })
      continue
    }

    const scaledWidth = prepared.scaledWidth || Math.max(1, Math.round(drawableWidth))
    const pageSliceHeight = prepared.pageSliceHeight || Math.max(1, Math.round(drawableHeight))
    const scaledHeight = prepared.scaledHeight || Math.max(1, Math.round(sourceHeight * (scaledWidth / sourceWidth)))

    if (scaledHeight <= drawableHeight) {
      const pageImage = await ensureEmbedded()
      const width = scaledWidth
      const height = scaledHeight
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
      page.drawImage(pageImage, {
        x: margin,
        y: (pageSize[1] - height) / 2,
        width,
        height,
      })
      continue
    }

    const scaledBuffer = prepared.scaledBuffer
      || (await sharpLib(imageBytes)
        .resize({ width: scaledWidth, fit: 'fill' })
        .png()
        .toBuffer({ resolveWithObject: true })).data
    const scaledImage = sharpLib(scaledBuffer)
    let offsetY = 0
    while (offsetY < scaledHeight) {
      const sliceHeight = Math.min(pageSliceHeight, scaledHeight - offsetY)
      const sliceBuffer = await scaledImage.clone()
        .extract({ left: 0, top: offsetY, width: scaledWidth, height: sliceHeight })
        .png()
        .toBuffer()
      const pageImage = await pdf.embedPng(sliceBuffer)
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
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
  return {
    outputPath,
    outputSizeBytes: bytes.length,
  }
}

async function writeMergeGifAsset(sharpLib, payload) {
  const gifenc = getGifEncoder()
  if (!gifenc) throw new Error('缺少 gifenc 依赖')
  const outputPath = path.join(payload.destinationPath, 'merged.gif')
  const { GIFEncoder, quantize, applyPalette } = gifenc
  const encoder = GIFEncoder()
  const frameWidth = payload.config.width
  const frameHeight = payload.config.height
  const background = hexToRgbaObject(payload.config.background, 1)
  const delay = Math.max(1, Math.round(payload.config.interval * 100))
  const repeat = payload.config.loop ? 0 : -1
  const profile = getPerformanceProfile(getAppSettings().performanceMode)
  const frameConcurrency = Math.max(1, Math.min(payload.assets.length, Math.min(profile.mediumConcurrency, 4)))
  const prepareFrame = async (asset) => {
    const data = await sharpLib(asset.sourcePath)
      .resize({ width: frameWidth, height: frameHeight, fit: 'contain', background })
      .ensureAlpha()
      .raw()
      .toBuffer()
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    return { index, palette }
  }
  const preparedFrames = payload.assets.length === 1
    ? [await prepareFrame(payload.assets[0])]
    : await mapWithConcurrency(payload.assets, frameConcurrency, prepareFrame)

  for (const frame of preparedFrames) {
    encoder.writeFrame(frame.index, frameWidth, frameHeight, {
      palette: frame.palette,
      delay,
      repeat,
    })
  }

  encoder.finish()
  const bytes = Buffer.from(encoder.bytes())
  fs.writeFileSync(outputPath, bytes)
  return {
    outputPath,
    outputSizeBytes: bytes.length,
  }
}

async function executeAssetTool(sharpLib, payload, asset) {
  if (payload.toolId === 'compression') return writeCompressionAsset(sharpLib, asset, payload.config, payload.destinationPath)
  if (payload.toolId === 'format') return writeFormatAsset(sharpLib, asset, payload.config, payload.destinationPath)
  if (payload.toolId === 'resize') return writeResizeAsset(sharpLib, asset, payload.config, payload.destinationPath)
  if (payload.toolId === 'watermark') return writeWatermarkAsset(sharpLib, asset, payload.config, payload.destinationPath)
  if (payload.toolId === 'rotate') return writeRotateAsset(sharpLib, asset, payload.config, payload.destinationPath)
  if (payload.toolId === 'flip') return writeFlipAsset(sharpLib, asset, payload.config, payload.destinationPath)
  if (payload.toolId === 'corners') return writeCornersAsset(sharpLib, asset, payload.config, payload.destinationPath)
  if (payload.toolId === 'padding') return writePaddingAsset(sharpLib, asset, payload.config, payload.destinationPath)
  if (payload.toolId === 'crop') return writeCropAsset(sharpLib, asset, payload.config, payload.destinationPath, 'crop')
  if (payload.toolId === 'manual-crop') {
    const manualArea = payload.config.cropAreas?.[asset.id]
    return writeCropAsset(sharpLib, asset, {
      ratio: payload.config.ratioValue || payload.config.ratio,
      area: manualArea || { x: 0, y: 0, width: asset.width, height: asset.height },
    }, payload.destinationPath, 'manual-crop')
  }
  throw new Error(`未支持的工具：${payload.toolId}`)
}

function isMergeTool(toolId) {
  return ['merge-image', 'merge-pdf', 'merge-gif'].includes(toolId)
}

async function executeSingleAssetTool(payload, sharpLib) {
  let completedCount = 0
  let failedCount = 0
  const totalCount = payload.assets.length
  const emitAssetProgress = () => {
    emitProcessingProgress({
      phase: 'progress',
      runId: payload.runId,
      toolId: payload.toolId,
      toolLabel: payload.toolLabel,
      mode: payload.mode,
      total: totalCount,
      completed: completedCount + failedCount,
      succeeded: completedCount,
      failed: failedCount,
    })
  }
  const executeAsset = async (asset) => {
    if (!isProcessableAsset(asset)) {
      failedCount += 1
      emitAssetProgress()
      return {
        processed: null,
        failed: { assetId: asset.id, name: asset.name, error: `暂不支持处理 ${asset.ext || 'unknown'} 格式` },
      }
    }

    try {
      const result = await executeAssetTool(sharpLib, payload, asset)

      const processed = await (payload.mode === 'direct'
        ? directResultToProcessed(asset, result, sharpLib)
        : stageResultToProcessed(asset, result, payload, sharpLib))
      completedCount += 1
      emitAssetProgress()
      return {
        processed,
        failed: null,
      }
    } catch (error) {
      failedCount += 1
      emitAssetProgress()
      return {
        processed: null,
        failed: { assetId: asset.id, name: asset.name, error: error?.message || '处理失败' },
      }
    }
  }
  const outcomes = totalCount === 1
    ? [await executeAsset(payload.assets[0])]
    : await mapWithConcurrency(payload.assets, getAssetProcessingConcurrency(payload), executeAsset)

  const processed = []
  const failed = []
  for (const item of outcomes) {
    if (item?.processed) processed.push(item.processed)
    if (item?.failed) failed.push(item.failed)
  }

  return {
    processed,
    failed,
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
      outputSizeBytes: asset.stagedSizeBytes || 0,
      width: asset.stagedWidth || 0,
      height: asset.stagedHeight || 0,
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

async function executeSaveFlow(payload) {
  if (!payload.stagedItems?.length) {
    return revealResultDirectoryIfNeeded(createFallbackFailure(payload, '没有可保存的预览结果。'))
  }

  if (!payload.destinationPath) {
    return revealResultDirectoryIfNeeded(createFallbackFailure(payload, '无法解析保存目录。'))
  }

  ensureDirectory(payload.destinationPath)
  const processed = []
  const failed = []

  for (const item of payload.stagedItems) {
    try {
      const saved = await savePreviewResult(payload.destinationPath, payload.runFolderName, item)
      processed.push({
        assetId: item.assetId,
        name: item.name,
        mode: 'direct',
        previewStatus: 'saved',
        outputPath: saved.outputPath,
        outputName: saved.outputName,
        outputSizeBytes: saved.outputSizeBytes,
        width: saved.width,
        height: saved.height,
        savedOutputPath: saved.outputPath || '',
      })
    } catch (error) {
      failed.push({ assetId: item.assetId, name: item.name, error: error?.message || '保存失败' })
    }
  }

  return revealResultDirectoryIfNeeded(createResultEnvelope({ ...payload, mode: 'save' }, processed, failed))
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
    mode: isMergeTool(toolId) ? 'direct' : isPreviewSaveTool(toolId) ? 'preview-save' : 'direct',
  }
}

async function executeMergeTool(payload, sharpLib) {
  const processed = []
  const failed = []
  try {
    const mergeHandler = payload.toolId === 'merge-image'
      ? writeMergeImageAsset
      : payload.toolId === 'merge-pdf'
        ? writeMergePdfAssetReal
        : writeMergeGifAsset
    const result = await mergeHandler(sharpLib, payload)
    const outputPath = typeof result === 'string' ? result : result.outputPath
    const outputName = path.basename(outputPath)
    processed.push({
      assetId: payload.assets[0]?.id || payload.toolId,
      name: outputName,
      mode: 'direct',
      previewStatus: 'saved',
      outputPath,
      outputName,
      outputSizeBytes: Number(result?.outputSizeBytes) || 0,
      width: 0,
      height: 0,
      savedOutputPath: outputPath || '',
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
  const startedAt = Date.now()
  emitProcessingProgress({
    phase: 'start',
    runId: payload.runId,
    toolId: payload.toolId,
    toolLabel: payload.toolLabel,
    mode: payload.mode,
    total: Array.isArray(payload.assets) ? payload.assets.length : 0,
    completed: 0,
    succeeded: 0,
    failed: 0,
    startedAt,
  })

  const { processed, failed } = isMergeTool(payload.toolId)
    ? await executeMergeTool(payload, sharpLib)
    : await executeSingleAssetTool(payload, sharpLib)
  const elapsedMs = Date.now() - startedAt

  const ok = processed.length > 0 && failed.length === 0
  const partial = processed.length > 0 && failed.length > 0
  const message = ok
    ? `已完成 ${payload.toolLabel}：${processed.length} 项，输出到 ${payload.destinationPath}`
    : partial
      ? `${payload.toolLabel} 部分完成：成功 ${processed.length} 项，失败 ${failed.length} 项`
      : `${payload.toolLabel} 执行失败：${failed[0]?.error || '没有可处理的图片'}`

  emitProcessingProgress({
    phase: 'finish',
    runId: payload.runId,
    toolId: payload.toolId,
    toolLabel: payload.toolLabel,
    mode: payload.mode,
    total: Array.isArray(payload.assets) ? payload.assets.length : 0,
    completed: processed.length + failed.length,
    succeeded: processed.length,
    failed: failed.length,
    elapsedMs,
    startedAt,
  })

  return {
    ok,
    partial,
    ...payload,
    elapsedMs,
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
    return this.normalizeInput(items)
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
    return createPreparedRunPayload(toolId, config, assets, destinationPath)
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
    return loadSettings()
  },

  saveSettings(settings) {
    return saveSettings(settings)
  },

  buildStagedItems(assets = []) {
    return buildStagedItemsFromAssets(assets)
  },

  async runTool(toolId, config, assets, destinationPath) {
    const payload = createPreparedRunPayload(toolId, config, assets, destinationPath)
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
