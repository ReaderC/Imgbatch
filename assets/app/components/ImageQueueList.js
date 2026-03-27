import { TOOL_MAP } from '../config/tools.js'

const PREVIEW_SAVE_TOOLS = new Set(['compression', 'format', 'resize'])

export function renderImageQueue(state) {
  const tool = TOOL_MAP[state.activeTool]
  const query = state.searchQuery.trim().toLowerCase()
  const assets = query
    ? state.assets.filter((item) => [item.name, item.ext].join(' ').toLowerCase().includes(query))
    : state.assets

  if (!assets.length) {
    return `
      <section class="queue" data-role="drop-surface" data-scroll-role="queue">
        <div class="empty-state">
          <span class="badge">Queue Empty</span>
          <h3 class="queue-title">拖入图片开始批处理</h3>
          <p class="queue-subtitle">支持把图片、文件夹直接拖到右侧队列。预览型页面会先生成结果，再手动保存；合并型页面保留直接输出。</p>
        </div>
      </section>
    `
  }

  return `
    <section class="queue" data-role="drop-surface" data-scroll-role="queue">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
        <div style="font-size:13px;color:var(--on-surface-variant);">${tool.mode === 'sort' ? '图片顺序会直接影响最终导出结果。' : PREVIEW_SAVE_TOOLS.has(tool.id) ? '先生成预览结果，再决定单张保存或全部保存。' : '图片列表支持拖入、预览与移除。'}</div>
        <span class="badge">${assets.length} selected</span>
      </div>
      <div class="queue-list">
        ${assets.map((asset, index) => renderQueueItem(asset, tool, state, index, assets.length)).join('')}
      </div>
    </section>
  `
}

function renderQueueItem(asset, tool, state, index, total) {
  const resultMeta = renderResultMeta(asset, tool)
  const primaryAction = renderPrimaryAction(asset, tool)

  return `
    <article class="queue-item">
      <div class="queue-item__thumb">
        <img src="${asset.thumbnailUrl}" alt="${escapeHtml(asset.name)}" />
      </div>
      <div class="queue-item__content">
        <p class="queue-item__name" title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</p>
        <div class="queue-item__subline">
          <span>${formatBytes(asset.sizeBytes)}</span>
          <span>${asset.width || '—'} × ${asset.height || '—'}</span>
          <span>${asset.ext.toUpperCase()}</span>
        </div>
        <div class="queue-item__subline" style="margin-top:6px;">
          <span>${getToolSummary(tool.id, state)}</span>
        </div>
        ${resultMeta}
        ${asset.outputPath ? `<div class="queue-item__subline" style="margin-top:6px;"><span>输出：${escapeHtml(asset.outputPath)}</span></div>` : ''}
        ${asset.savedOutputPath && asset.savedOutputPath !== asset.outputPath ? `<div class="queue-item__subline" style="margin-top:6px;"><span>已保存：${escapeHtml(asset.savedOutputPath)}</span></div>` : ''}
        ${asset.error ? `<div class="queue-item__subline" style="margin-top:6px;color:#a8364b;"><span>错误：${escapeHtml(asset.error)}</span></div>` : ''}
      </div>
      <div class="queue-item__controls">
        ${tool.mode === 'sort' ? `
          <button class="icon-button" data-action="move-asset" data-direction="up" data-asset-id="${asset.id}" ${index === 0 ? 'disabled' : ''}>
            <span class="material-symbols-outlined">keyboard_arrow_up</span>
          </button>
          <button class="icon-button" data-action="move-asset" data-direction="down" data-asset-id="${asset.id}" ${index === total - 1 ? 'disabled' : ''}>
            <span class="material-symbols-outlined">keyboard_arrow_down</span>
          </button>
          <span class="material-symbols-outlined queue-item__drag">drag_indicator</span>
        ` : primaryAction}
        <button class="icon-button" data-action="remove-asset" data-asset-id="${asset.id}" title="移除">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </article>
  `
}

function renderPrimaryAction(asset, tool) {
  if (!PREVIEW_SAVE_TOOLS.has(tool.id)) {
    return `<button class="queue-item__action" data-action="preview-asset" data-asset-id="${asset.id}">效果预览</button>`
  }

  const previewStatus = getToolPreviewStatus(asset, tool.id)
  if (previewStatus === 'staged' && asset.stagedOutputPath) {
    return `<button class="queue-item__action" data-action="save-asset-result" data-asset-id="${asset.id}">保存</button>`
  }

  if (previewStatus === 'saved') {
    return `<button class="queue-item__action" data-action="preview-asset" data-asset-id="${asset.id}">查看结果</button>`
  }

  return `<button class="queue-item__action" data-action="preview-asset" data-asset-id="${asset.id}">${previewStatus === 'stale' ? '重新预览' : '预览效果'}</button>`
}

function renderResultMeta(asset, tool) {
  if (!PREVIEW_SAVE_TOOLS.has(tool.id)) return ''
  const previewStatus = getToolPreviewStatus(asset, tool.id)
  if (previewStatus === 'previewed') {
    return `<div class="queue-item__subline" style="margin-top:6px;"><span>预览结果：${formatBytes(asset.stagedSizeBytes)} · ${asset.stagedWidth || '—'} × ${asset.stagedHeight || '—'}</span></div>`
  }
  if (previewStatus === 'staged') {
    return `<div class="queue-item__subline" style="margin-top:6px;"><span>待保存结果：${formatBytes(asset.stagedSizeBytes)} · ${asset.stagedWidth || '—'} × ${asset.stagedHeight || '—'}</span></div>`
  }
  if (previewStatus === 'saved') {
    return `<div class="queue-item__subline" style="margin-top:6px;"><span>已保存结果：${formatBytes(asset.stagedSizeBytes || asset.sizeBytes)} · ${asset.stagedWidth || asset.width || '—'} × ${asset.stagedHeight || asset.height || '—'}</span></div>`
  }
  if (previewStatus === 'stale') {
    return `<div class="queue-item__subline" style="margin-top:6px;color:var(--tertiary);"><span>当前预览已过期，修改参数后请重新预览或重新处理。</span></div>`
  }
  return ''
}

function getToolPreviewStatus(asset, toolId) {
  return asset.stagedToolId === toolId ? asset.previewStatus : 'idle'
}

function getToolSummary(toolId, state) {
  const config = state.configs[toolId]
  if (toolId === 'compression') {
    return config.mode === 'quality' ? `压缩质量 ${config.quality}%` : `目标大小 ${config.targetSizeKb} KB`
  }
  if (toolId === 'format') {
    return `输出格式 ${config.targetFormat}`
  }
  if (toolId === 'resize') {
    const width = normalizeResizeValue(config.width, config.widthUnit)
    const height = normalizeResizeValue(config.height, config.heightUnit)
    return `目标尺寸 ${width} × ${height}`
  }
  if (toolId === 'watermark') {
    return `${config.type === 'text' ? '文本' : '图片'}水印 · ${config.position} · ${config.opacity}%`
  }
  if (toolId === 'corners') {
    return `圆角 ${config.radius}${config.unit} · ${config.keepTransparency ? '透明背景' : config.background}`
  }
  if (toolId === 'padding') {
    return `留白 ${config.top}/${config.right}/${config.bottom}/${config.left}px · ${config.opacity}%`
  }
  if (toolId === 'crop') {
    const ratio = config.ratio === 'Custom' ? `${config.customRatioX}:${config.customRatioY}` : config.ratio
    return `裁剪 ${ratio} · ${config.width}×${config.height}`
  }
  if (toolId === 'rotate') {
    return `${config.direction === 'clockwise' ? '顺时针' : '逆时针'} ${config.angle}°`
  }
  if (toolId === 'flip') {
    return `${config.horizontal ? '左右' : ''}${config.horizontal && config.vertical ? ' + ' : ''}${config.vertical ? '上下' : ''}${!config.horizontal && !config.vertical ? '未翻转' : '翻转'}`
  }
  if (toolId === 'merge-pdf') {
    return `页面 ${config.pageSize} · 边距 ${config.margin}`
  }
  if (toolId === 'merge-image') {
    return `${config.direction === 'vertical' ? '纵向' : '横向'} · 宽度 ${config.pageWidth}px`
  }
  if (toolId === 'merge-gif') {
    return `${config.width}×${config.height} · ${config.interval}s`
  }
  return '待处理'
}

function normalizeResizeValue(value, explicitUnit) {
  const stringValue = String(value).trim()
  if (stringValue.endsWith('px') || stringValue.endsWith('%')) return stringValue
  return `${stringValue}${explicitUnit || 'px'}`
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
