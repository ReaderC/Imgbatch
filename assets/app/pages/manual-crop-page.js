const MANUAL_CROP_RATIO_OPTIONS = [
  { label: '1:1', value: '1:1' },
  { label: '4:5', value: '4:5' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:2', value: '3:2' },
  { label: '3:4', value: '3:4' },
  { label: '2:3', value: '2:3' },
  { label: '21:9', value: '21:9' },
]

export function renderManualCropPage(state) {
  const config = state.configs['manual-crop']
  const current = state.assets[config.currentIndex] || state.assets[0]
  const progress = state.processingProgress
  const hudCollapsed = config.hudCollapsed !== false
  const completedCount = config.completedIds.length
  const skippedCount = config.skippedIds.length
  const pendingCount = Math.max(0, state.assets.length - completedCount - skippedCount)
  const progressLabel = state.assets.length ? `${Math.min(config.currentIndex + 1, state.assets.length)} / ${state.assets.length}` : '0 / 0'
  const currentRatio = MANUAL_CROP_RATIO_OPTIONS.find((item) => item.label === config.ratio) || MANUAL_CROP_RATIO_OPTIONS[2]
  const cropArea = current ? resolveCropArea(current, config) : null
  const cropStyle = cropArea
    ? `left:${cropArea.xPct}%;top:${cropArea.yPct}%;width:${cropArea.widthPct}%;height:${cropArea.heightPct}%;`
    : ''
  const imageStyle = current
    ? `style="aspect-ratio:${Math.max(1, current.width || 1)} / ${Math.max(1, current.height || 1)};"`
    : ''

  return `
    <div class="manual-shell">
      <header class="manual-header">
        <div>
          <h2 class="manual-title">手动裁剪</h2>
        </div>
        <div class="manual-header__meta" data-horizontal-scroll>
          <span class="badge">${progressLabel}</span>
          <span class="badge">已标记 ${completedCount}</span>
          <span class="badge">待处理 ${pendingCount}</span>
          <button class="icon-button" data-action="activate-tool" data-tool-id="compression" title="关闭">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </header>
      <main class="manual-canvas" data-role="drop-surface" data-scroll-role="manual-canvas">
        <div class="manual-hud ${hudCollapsed ? 'manual-hud--collapsed' : ''}">
          <button class="manual-hud__toggle" data-action="toggle-manual-crop-hud" aria-expanded="${hudCollapsed ? 'false' : 'true'}">
            <span class="material-symbols-outlined">${hudCollapsed ? 'chevron_right' : 'expand_more'}</span>
            <span>${hudCollapsed ? '图片信息' : '收起信息'}</span>
          </button>
          ${hudCollapsed ? `
            <div class="manual-hud__compact">
              <span class="manual-hud__compact-text">${current ? escapeHtml(current.name) : '未选择图片'}</span>
              <span class="manual-hud__compact-divider"></span>
              <span class="manual-hud__compact-text">${current ? currentRatio.value : '—'}</span>
            </div>
          ` : `
            <div class="manual-hud__content">
              <div>
                <div class="card-label">原图尺寸</div>
                <div class="manual-hud__value">${current ? `${current.width || '—'} × ${current.height || '—'} px` : '未选择图片'}</div>
              </div>
              <div class="manual-hud__divider"></div>
              <div>
                <div class="card-label">目标比例</div>
                <div class="manual-hud__value manual-hud__value--primary">${current ? currentRatio.value : '—'}</div>
              </div>
              <div class="manual-hud__divider"></div>
              <div>
                <div class="card-label">当前图片</div>
                <div class="manual-hud__value manual-hud__value--name">${current ? escapeHtml(current.name) : '等待导入图片'}</div>
              </div>
            </div>
          `}
        </div>
        <div class="manual-canvas__stage">
          <button class="manual-stage-nav manual-stage-nav--prev" data-action="manual-crop-prev" title="上一张" ${config.currentIndex <= 0 ? 'disabled' : ''}>
            <span class="material-symbols-outlined">navigate_before</span>
          </button>
          <div class="manual-canvas__image" ${current ? `data-role="manual-crop-stage" data-asset-id="${current.id}" data-asset-width="${current.width || 1}" data-asset-height="${current.height || 1}" ${imageStyle}` : ''}>
            ${current ? `<img src="${current.thumbnailUrl}" alt="${escapeHtml(current.name)}" draggable="false" />` : `
              <div class="manual-canvas__empty">先导入图片，再拖动裁剪框开始裁剪</div>
            `}
            ${current ? `
              <div class="manual-crop-box" data-role="manual-crop-box" data-action="manual-crop-drag" style="${cropStyle}">
                <span class="manual-handle manual-handle--tl" data-action="manual-crop-resize" data-handle="tl"></span>
                <span class="manual-handle manual-handle--tr" data-action="manual-crop-resize" data-handle="tr"></span>
                <span class="manual-handle manual-handle--bl" data-action="manual-crop-resize" data-handle="bl"></span>
                <span class="manual-handle manual-handle--br" data-action="manual-crop-resize" data-handle="br"></span>
                <span class="manual-handle manual-handle--tm" data-action="manual-crop-resize" data-handle="tm"></span>
                <span class="manual-handle manual-handle--bm" data-action="manual-crop-resize" data-handle="bm"></span>
                <span class="manual-handle manual-handle--ml" data-action="manual-crop-resize" data-handle="ml"></span>
                <span class="manual-handle manual-handle--mr" data-action="manual-crop-resize" data-handle="mr"></span>
              </div>
            ` : ''}
          </div>
          <button class="manual-stage-nav manual-stage-nav--next" data-action="manual-crop-next" title="下一张" ${!current || config.currentIndex >= state.assets.length - 1 ? 'disabled' : ''}>
            <span class="material-symbols-outlined">navigate_next</span>
          </button>
        </div>
      </main>
      <footer class="manual-footer">
        <div class="manual-footer__left" data-horizontal-scroll>
          <div class="manual-toolbar manual-toolbar--crop">
            <button class="icon-button" data-action="open-folder-input" title="选择文件夹">
              <span class="material-symbols-outlined">folder_open</span>
            </button>
            <button class="icon-button" data-action="open-file-input" title="选择图片">
              <span class="material-symbols-outlined">add_photo_alternate</span>
            </button>
            ${MANUAL_CROP_RATIO_OPTIONS.map((item) => `
              <button class="${config.ratio === item.label ? 'footer-button primary' : 'footer-button'}" data-action="set-manual-crop-ratio" data-label="${item.label}" data-value="${item.value}">${item.value}</button>
            `).join('')}
          </div>
        </div>
        <div class="manual-footer__right">
          <div class="manual-toolbar manual-toolbar--crop manual-toolbar--crop-actions">
            <button class="footer-button" data-action="manual-crop-skip" ${!current ? 'disabled' : ''}>跳过并下一张</button>
            <button class="footer-button primary" data-action="manual-crop-complete" ${!current ? 'disabled' : ''}>标记并下一张</button>
            <button class="primary-button ${state.isProcessing ? 'is-processing' : ''}" data-action="process-current" ${!current || state.isProcessing ? 'disabled' : ''}>
              ${state.isProcessing
                ? `${progress?.completed || 0}/${progress?.total || 0} 裁剪中`
                : completedCount ? `开始裁剪 ${completedCount} 张` : '先标记图片'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  `
}

function resolveCropArea(asset, config) {
  const saved = config.cropAreas?.[asset.id]
  const width = Math.max(1, asset.width || 1)
  const height = Math.max(1, asset.height || 1)
  const area = saved || getInheritedCropArea(asset, config) || getDefaultCropArea(width, height, config.ratioValue || currentRatioValue(config))
  return {
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    xPct: (area.x / width) * 100,
    yPct: (area.y / height) * 100,
    widthPct: (area.width / width) * 100,
    heightPct: (area.height / height) * 100,
  }
}

function getInheritedCropArea(asset, config) {
  const seed = config.lastCompletedCropSeed
  if (String(seed.ratioValue || '') !== String(config.ratioValue || currentRatioValue(config))) return null
  if (seed?.area && (seed.assetWidth || 0) === (asset.width || 0) && (seed.assetHeight || 0) === (asset.height || 0)) {
    return { ...seed.area }
  }
  if (!seed?.normalizedArea) return null
  const width = Math.max(1, asset.width || 1)
  const height = Math.max(1, asset.height || 1)
  return clampCropAreaToAsset({
    x: Math.round(seed.normalizedArea.x * width),
    y: Math.round(seed.normalizedArea.y * height),
    width: Math.round(seed.normalizedArea.width * width),
    height: Math.round(seed.normalizedArea.height * height),
  }, width, height)
}

function clampCropAreaToAsset(area, width, height) {
  const nextWidth = Math.min(width, Math.max(40, Math.round(area.width)))
  const nextHeight = Math.min(height, Math.max(40, Math.round(area.height)))
  return {
    x: Math.max(0, Math.min(width - nextWidth, Math.round(area.x))),
    y: Math.max(0, Math.min(height - nextHeight, Math.round(area.y))),
    width: nextWidth,
    height: nextHeight,
  }
}

function getDefaultCropArea(width, height, ratioValue) {
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

function currentRatioValue(config) {
  const matched = MANUAL_CROP_RATIO_OPTIONS.find((item) => item.label === config.ratio)
  return matched?.value || config.ratioValue || '16:9'
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
