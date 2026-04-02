import { TOOL_MAP } from '../config/tools.js'
import { getFormatCapability } from '../services/ztools-bridge.js'

const PREVIEW_SAVE_TOOLS = new Set(['compression', 'format', 'resize', 'watermark', 'corners', 'padding', 'crop', 'rotate', 'flip'])
const QUEUE_VIRTUALIZE_THRESHOLD = 40
const QUEUE_VIRTUAL_OVERSCAN = 8
const QUEUE_ITEM_ESTIMATED_HEIGHT = {
  regular: 118,
  compact: 86,
}
const WATERMARK_POSITION_LABELS = {
  'top-left': '左上',
  'top-center': '上方居中',
  'top-right': '右上',
  'middle-left': '左侧居中',
  center: '正中',
  'middle-right': '右侧居中',
  'bottom-left': '左下',
  'bottom-center': '下方居中',
  'bottom-right': '右下',
}

export function renderImageQueue(state, viewport = null) {
  const tool = TOOL_MAP[state.activeTool]
  const assets = state.assets
  const compactLayout = isCompactQueueLayout()
  const queueWindow = getQueueRenderWindow(assets.length, compactLayout, viewport)
  const visibleAssets = queueWindow
    ? assets.slice(queueWindow.startIndex, queueWindow.endIndex)
    : assets

  return `
    <section class="queue" data-role="drop-surface" data-scroll-role="queue">
      ${assets.length ? `
        <div class="queue-list${queueWindow ? ' queue-list--virtual' : ''}">
          ${queueWindow ? `<div class="queue-list__spacer" style="height:${queueWindow.topSpacer}px;" aria-hidden="true"></div>` : ''}
          ${visibleAssets.map((asset, index) => {
            const absoluteIndex = queueWindow ? queueWindow.startIndex + index : index
            return renderQueueItem(asset, tool, state, absoluteIndex, assets.length, compactLayout)
          }).join('')}
          ${queueWindow ? `<div class="queue-list__spacer" style="height:${queueWindow.bottomSpacer}px;" aria-hidden="true"></div>` : ''}
        </div>
      ` : `
        <div class="empty-state empty-state--queue">
          <span class="badge">队列为空</span>
          <h3 class="queue-title">添加图片开始处理</h3>
          <div class="queue-empty-actions">
            <button class="primary-button" data-action="open-folder-input">选择文件夹</button>
            <button class="secondary-button" data-action="open-file-input">选择图片</button>
          </div>
        </div>
      `}
      <div class="queue-footer">
        <div class="queue-toolbar">
          <button class="icon-button queue-toolbar__button" data-action="open-folder-input" data-tooltip="选择文件夹并导入其中的图片" aria-label="选择文件夹并导入其中的图片">
            <span class="material-symbols-outlined">folder_open</span>
          </button>
          <button class="icon-button queue-toolbar__button" data-action="open-file-input" data-tooltip="选择图片" aria-label="选择图片">
            <span class="material-symbols-outlined">add_photo_alternate</span>
          </button>
          <button class="icon-button queue-toolbar__button" data-action="clear-assets" data-tooltip="清空" aria-label="清空" ${state.assets.length ? '' : 'disabled'}>
            <span class="material-symbols-outlined">delete_sweep</span>
          </button>
          <button class="icon-button queue-toolbar__button" data-action="open-settings" data-tooltip="设置" aria-label="设置">
            <span class="material-symbols-outlined">settings</span>
          </button>
        </div>
      </div>
    </section>
  `
}

export function shouldVirtualizeQueue(total = 0) {
  return Number(total) >= QUEUE_VIRTUALIZE_THRESHOLD
}

export function renderQueueItemFragments(asset, tool, state, index, total, compactLayout = isCompactQueueLayout()) {
  const assetFormat = getAssetFormatLabel(asset)
  const sortable = tool.mode === 'sort'
  const previewStatus = getToolPreviewStatus(asset, tool.id)
  const summaryText = asset.error ? `错误：${escapeHtml(asset.error)}` : getToolSummary(tool.id, state, asset)
  const compactTickerText = compactLayout ? getCompactQueueTickerText(asset, tool, state, assetFormat, summaryText) : ''
  const resultMetaMarkup = renderResultMeta(asset, tool, previewStatus)
  const primaryActionMarkup = sortable ? '' : renderPrimaryAction(asset, tool, previewStatus)
  return {
    itemClassName: `queue-item${sortable ? ' queue-item--sortable' : ''}`,
    draggable: sortable,
    contentSignature: [
      asset.name,
      asset.sizeBytes,
      asset.width,
      asset.height,
      assetFormat,
      asset.error || '',
      summaryText,
      compactTickerText,
      previewStatus,
      asset.stagedSizeBytes,
      asset.stagedWidth,
      asset.stagedHeight,
      asset.savedOutputPath,
      asset.outputPath,
      asset.warning || '',
    ].join('\u0001'),
    controlsSignature: [
      tool.id,
      sortable ? 'sort' : 'preview',
      previewStatus,
      index,
      total,
    ].join('\u0001'),
    contentMarkup: `
      <p class="queue-item__name" data-tooltip="${escapeHtml(asset.name)}" data-tooltip-overflow="true">${escapeHtml(asset.name)}</p>
      <div class="queue-item__subline queue-item__subline--meta">
        <span class="queue-pill">${formatBytes(asset.sizeBytes)}</span>
        <span class="queue-pill">${asset.width || '—'} × ${asset.height || '—'}</span>
        <span class="queue-pill">${assetFormat}</span>
      </div>
      <div class="queue-item__subline queue-item__subline--summary${asset.error ? ' queue-item__subline--summary-error' : ''}">
        <span class="queue-summary-text">${summaryText}</span>
      </div>
      ${compactLayout ? renderCompactQueueTicker(compactTickerText, !!asset.error) : ''}
      ${resultMetaMarkup}
      ${asset.savedOutputPath && asset.savedOutputPath !== asset.outputPath ? `<div class="queue-item__subline"><span>已保存：${escapeHtml(asset.savedOutputPath)}</span></div>` : ''}
      ${asset.warning ? `<div class="queue-item__subline queue-item__subline--hint"><span>提示：${escapeHtml(asset.warning)}</span></div>` : ''}
    `,
    controlsMarkup: sortable ? `
      <button class="icon-button" data-action="move-asset" data-direction="up" data-asset-id="${asset.id}" ${index === 0 ? 'disabled' : ''}>
        <span class="material-symbols-outlined">keyboard_arrow_up</span>
      </button>
      <button class="icon-button" data-action="move-asset" data-direction="down" data-asset-id="${asset.id}" ${index === total - 1 ? 'disabled' : ''}>
        <span class="material-symbols-outlined">keyboard_arrow_down</span>
      </button>
      <span class="material-symbols-outlined queue-item__drag" data-tooltip="拖动排序" aria-label="拖动排序">drag_indicator</span>
      <button class="icon-button" data-action="remove-asset" data-asset-id="${asset.id}" data-tooltip="移除" aria-label="移除">
        <span class="material-symbols-outlined">close</span>
      </button>
    ` : `
      ${primaryActionMarkup}
      <button class="icon-button" data-action="remove-asset" data-asset-id="${asset.id}" data-tooltip="移除" aria-label="移除">
        <span class="material-symbols-outlined">close</span>
      </button>
    `,
  }
}

function getQueueRenderWindow(total, compactLayout, viewport) {
  if (!shouldVirtualizeQueue(total)) return null
  const scrollTop = Math.max(0, Number(viewport?.scrollTop) || 0)
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0)
  if (!viewportHeight) return null
  const itemHeight = compactLayout ? QUEUE_ITEM_ESTIMATED_HEIGHT.compact : QUEUE_ITEM_ESTIMATED_HEIGHT.regular
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / itemHeight))
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - QUEUE_VIRTUAL_OVERSCAN)
  const endIndex = Math.min(total, startIndex + visibleCount + QUEUE_VIRTUAL_OVERSCAN * 2)
  return {
    startIndex,
    endIndex,
    topSpacer: startIndex * itemHeight,
    bottomSpacer: Math.max(0, total - endIndex) * itemHeight,
  }
}

function renderQueueItem(asset, tool, state, index, total, compactLayout = false) {
  const fragments = renderQueueItemFragments(asset, tool, state, index, total, compactLayout)
  const sortableAttrs = ` data-asset-id="${asset.id}"${fragments.draggable ? ' draggable="true"' : ''}`
  return `
    <article class="${fragments.itemClassName}"${sortableAttrs}>
      <div class="queue-item__thumb">
        ${asset.listThumbnailUrl
          ? `<img src="${asset.listThumbnailUrl}" alt="${escapeHtml(asset.name)}" loading="lazy" decoding="async" />`
          : '<div class="queue-item__thumb-placeholder" aria-hidden="true"></div>'}
      </div>
      <div class="queue-item__content" data-render-signature="${escapeHtml(fragments.contentSignature)}">${fragments.contentMarkup}</div>
      <div class="queue-item__controls" data-render-signature="${escapeHtml(fragments.controlsSignature)}">${fragments.controlsMarkup}</div>
    </article>
  `
}

function getCompactQueueTickerText(asset, tool, state, assetFormat = getAssetFormatLabel(asset), summaryText = getToolSummary(tool.id, state, asset)) {
  if (asset.error) return `错误：${asset.error}`
  return [
    assetFormat,
    summaryText,
    formatBytes(asset.sizeBytes),
    `${asset.width || '—'} × ${asset.height || '—'}`,
    asset.warning || '',
  ].join(' · ')
}

function renderCompactQueueTicker(text, isError = false) {
  return `
    <div class="queue-item__compact-ticker${isError ? ' queue-item__compact-ticker--error' : ''}" aria-label="${escapeHtml(text)}">
      <div class="queue-item__compact-track">
        <span>${escapeHtml(text)}</span>
        <span aria-hidden="true">${escapeHtml(text)}</span>
      </div>
    </div>
  `
}

function isCompactQueueLayout() {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= 1040
}

function getAssetFormatLabel(asset) {
  const format = String(asset?.inputFormat || asset?.ext || '').trim().toLowerCase()
  if (!format) return '—'
  if (format === 'jpg') return 'JPEG'
  if (format === 'tif') return 'TIFF'
  return format.toUpperCase()
}

function renderPrimaryAction(asset, tool, previewStatus = getToolPreviewStatus(asset, tool.id)) {
  if (!PREVIEW_SAVE_TOOLS.has(tool.id)) {
    return `<button class="queue-item__action" data-action="preview-asset" data-asset-id="${asset.id}">预览</button>`
  }
  if (previewStatus === 'saved') {
    return `
      <div class="queue-item__action-stack">
        <button class="queue-item__action" data-action="preview-asset" data-asset-id="${asset.id}">预览</button>
        <button class="queue-item__action secondary" data-action="open-asset-result" data-asset-id="${asset.id}">打开目录</button>
        <button class="queue-item__action secondary" data-action="replace-asset-original" data-asset-id="${asset.id}">替换原图</button>
      </div>
    `
  }

  return `<button class="queue-item__action" data-action="preview-asset" data-asset-id="${asset.id}">${previewStatus === 'stale' ? '重新预览' : '预览'}</button>`
}

function renderResultMeta(asset, tool, previewStatus = getToolPreviewStatus(asset, tool.id)) {
  if (!PREVIEW_SAVE_TOOLS.has(tool.id)) return ''
  if (previewStatus === 'previewed') {
    return `<div class="queue-item__subline queue-item__subline--summary"><span class="queue-summary-text">预览结果：${formatBytes(asset.stagedSizeBytes)} · ${asset.stagedWidth || '—'} × ${asset.stagedHeight || '—'}</span></div>`
  }
  if (previewStatus === 'staged') {
    return `<div class="queue-item__subline queue-item__subline--summary"><span class="queue-summary-text">处理结果：${formatBytes(asset.stagedSizeBytes)} · ${asset.stagedWidth || '—'} × ${asset.stagedHeight || '—'}</span></div>`
  }
  if (previewStatus === 'saved') {
    return `<div class="queue-item__subline queue-item__subline--summary"><span class="queue-summary-text">已保存结果：${formatBytes(asset.stagedSizeBytes || asset.sizeBytes)} · ${asset.stagedWidth || asset.width || '—'} × ${asset.stagedHeight || asset.height || '—'}</span></div>`
  }
  if (previewStatus === 'stale') {
    return '<div class="queue-item__subline queue-item__subline--hint"><span>当前预览已过期，修改参数后请重新预览或重新处理。</span></div>'
  }
  return ''
}

function getToolPreviewStatus(asset, toolId) {
  return asset.stagedToolId === toolId ? asset.previewStatus : 'idle'
}

function getToolSummary(toolId, state, asset) {
  const config = state.configs[toolId]
  if (toolId === 'compression') return getCompressionEstimateSummary(config, asset)
  if (toolId === 'format') return `输出格式 ${config.targetFormat}${config.mode === 'quality' ? ` · 质量 ${config.quality}%` : ' · 仅转换'}`
  if (toolId === 'resize') return `目标尺寸 ${normalizeResizeValue(config.width)} × ${normalizeResizeValue(config.height)}`
  if (toolId === 'watermark') return `${config.type === 'text' ? '文字' : '图片'}水印 · ${WATERMARK_POSITION_LABELS[config.position] || config.position} · ${config.opacity}%`
  if (toolId === 'corners') return `圆角 ${formatMeasureValue(config.radius, 'px')} · ${config.keepTransparency ? '透明背景' : config.background}`
  if (toolId === 'padding') return `留白 ${config.top}/${config.right}/${config.bottom}/${config.left}px · ${config.opacity}%`
  if (toolId === 'crop') return `裁剪 ${config.ratio === 'Custom' ? `${config.customRatioX}:${config.customRatioY}` : config.ratio} · ${config.width}×${config.height}`
  if (toolId === 'rotate') return `旋转 ${Number(config.angle) || 0}°`
  if (toolId === 'flip') {
    const directions = [config.horizontal ? '左右' : '', config.vertical ? '上下' : ''].filter(Boolean)
    return directions.length ? `${directions.join(' + ')}翻转` : '未翻转'
  }
  if (toolId === 'merge-pdf') return `页面 ${config.pageSize} · 边距 ${config.margin}`
  if (toolId === 'merge-image') {
    const outputFormat = String(config.outputFormat || 'JPEG')
    const qualitySupported = !!getFormatCapability(outputFormat)?.supportsQuality
    return `${config.direction === 'vertical' ? '纵向' : '横向'} · 宽度 ${config.pageWidth}px · ${outputFormat}${qualitySupported ? ` ${config.quality}%` : ''}${config.preventUpscale ? ' · 小图原尺寸' : ''}`
  }
  if (toolId === 'merge-gif') return `${config.width}×${config.height} · ${config.interval}ms`
  return '待处理'
}

function getCompressionEstimateSummary(config, asset) {
  const originalBytes = Math.max(0, Number(asset?.sizeBytes) || 0)
  if (config.mode === 'target') {
    const targetBytes = Math.max(1, Math.round((Number(config.targetSizeKb) || 0) * 1024))
    const estimated = originalBytes ? Math.min(originalBytes, targetBytes) : targetBytes
    return `预计大小 ${formatBytes(estimated)}`
  }
  const quality = Math.min(100, Math.max(1, Number(config.quality) || 85))
  const estimated = originalBytes ? Math.max(1, Math.round(originalBytes * (quality / 100))) : Math.round(1200 * 1024 * (quality / 100))
  return `预计大小 ${formatBytes(estimated)}`
}

function normalizeResizeValue(value) {
  const stringValue = String(value).trim()
  if (stringValue.endsWith('px') || stringValue.endsWith('%')) return stringValue
  return `${stringValue}px`
}

function formatMeasureValue(value, fallbackUnit = 'px') {
  const stringValue = String(value ?? '').trim()
  if (!stringValue) return `0${fallbackUnit}`
  if (stringValue.endsWith('px') || stringValue.endsWith('%')) return stringValue
  return `${stringValue}${fallbackUnit}`
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

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
