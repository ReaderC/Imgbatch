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
  const completedCount = config.completedIds.length
  const skippedCount = config.skippedIds.length
  const pendingCount = Math.max(0, state.assets.length - completedCount - skippedCount)
  const progressLabel = state.assets.length
    ? `${Math.min(config.currentIndex + 1, state.assets.length)} / ${state.assets.length}`
    : '0 / 0'
  const currentRatio = MANUAL_CROP_RATIO_OPTIONS.find((item) => item.label === config.ratio) || MANUAL_CROP_RATIO_OPTIONS[2]
  const cropArea = current ? resolveCropArea(current, config) : null
  const displaySize = current ? getPreviewDisplaySize(current, config) : { width: 1, height: 1 }
  const cropStyle = cropArea
    ? `left:${cropArea.xPct}%;top:${cropArea.yPct}%;width:${cropArea.widthPct}%;height:${cropArea.heightPct}%;`
    : ''
  const stageStyle = current
    ? `style="--display-width:${displaySize.width};--display-height:${displaySize.height};"`
    : ''
  const hasCurrent = Boolean(current)
  const svgMarkup = hasCurrent ? getPreviewSvgMarkup(current, config, displaySize) : ''

  return `
    <div class="manual-shell">
      <header class="manual-header">
        <h2 class="manual-title">手动裁剪</h2>
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
        <div class="manual-canvas__stage">
          <button class="manual-stage-nav manual-stage-nav--prev" data-action="manual-crop-prev" title="上一张" ${config.currentIndex <= 0 ? 'disabled' : ''}>
            <span class="material-symbols-outlined">navigate_before</span>
          </button>
          <div
            class="manual-canvas__image"
            ${hasCurrent
              ? `data-role="manual-crop-stage" data-asset-id="${current.id}" data-asset-width="${displaySize.width}" data-asset-height="${displaySize.height}" ${stageStyle}`
              : ''}
          >
            ${hasCurrent ? `
              <div class="manual-canvas__content">
                <div class="manual-canvas__preview" data-role="manual-crop-preview">
                  ${svgMarkup}
                </div>
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
              </div>
            ` : `
              <div class="manual-canvas__empty">先导入图片，再拖动裁剪框开始裁剪</div>
            `}
          </div>
          <button class="manual-stage-nav manual-stage-nav--next" data-action="manual-crop-next" title="下一张" ${!hasCurrent || config.currentIndex >= state.assets.length - 1 ? 'disabled' : ''}>
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
            <div class="select-shell select-shell--up manual-footer__ratio-shell">
              <button
                type="button"
                class="icon-button manual-footer__ratio-trigger"
                data-action="toggle-config-select"
                aria-haspopup="listbox"
                aria-expanded="false"
                title="裁剪比例：${escapeHtml(currentRatio.value)}"
              >
                <span class="material-symbols-outlined">aspect_ratio</span>
              </button>
              <div class="select-shell__menu" role="listbox">
                ${MANUAL_CROP_RATIO_OPTIONS.map((item) => `
                  <button
                    type="button"
                    class="select-shell__option ${config.ratio === item.label ? 'is-active' : ''}"
                    data-action="set-manual-crop-ratio"
                    data-label="${item.label}"
                    data-value="${item.value}"
                  >${item.value}</button>
                `).join('')}
              </div>
            </div>
            <button class="icon-button" data-action="manual-crop-rotate-left" title="向左旋转 90°">
              <span class="material-symbols-outlined">rotate_90_degrees_ccw</span>
            </button>
            <button class="icon-button" data-action="manual-crop-rotate-right" title="向右旋转 90°">
              <span class="material-symbols-outlined">rotate_90_degrees_cw</span>
            </button>
            <button class="icon-button ${config.flipHorizontal ? 'is-active' : ''}" data-action="manual-crop-flip-horizontal" title="左右翻转" aria-pressed="${config.flipHorizontal ? 'true' : 'false'}">
              <span class="material-symbols-outlined">flip</span>
            </button>
            <button class="icon-button ${config.flipVertical ? 'is-active' : ''}" data-action="manual-crop-flip-vertical" title="上下翻转" aria-pressed="${config.flipVertical ? 'true' : 'false'}">
              <span class="material-symbols-outlined">swap_vert</span>
            </button>
            <div class="manual-footer__toggle">
              <span class="manual-footer__toggle-label">保持原格式</span>
              <button class="switch ${config.keepOriginalFormat ? 'is-on' : ''}" data-action="toggle-manual-crop-keep-format" aria-pressed="${config.keepOriginalFormat ? 'true' : 'false'}"></button>
            </div>
          </div>
        </div>
        <div class="manual-footer__right">
          <div class="manual-toolbar manual-toolbar--crop manual-toolbar--crop-actions">
            <button class="footer-button" data-action="manual-crop-skip" ${!hasCurrent ? 'disabled' : ''}>跳过并下一张</button>
            <button class="footer-button primary" data-action="manual-crop-complete" ${!hasCurrent ? 'disabled' : ''}>标记并下一张</button>
            <button class="primary-button ${state.isProcessing ? 'is-processing' : ''}" data-action="process-current" ${!hasCurrent || state.isProcessing ? 'disabled' : ''}>
              ${state.isProcessing
                ? `${progress?.completed || 0}/${progress?.total || 0} 裁剪中`
                : completedCount
                  ? `开始裁剪 ${completedCount} 张`
                  : '先标记图片'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  `
}

function resolveCropArea(asset, config) {
  const saved = config.cropAreas?.[asset.id]
  const { width, height } = getPreviewDisplaySize(asset, config)
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
  if (!seed) return null
  if (String(seed.ratioValue || '') !== String(config.ratioValue || currentRatioValue(config))) return null
  const { width, height } = getPreviewDisplaySize(asset, config)
  if (seed?.area && (seed.assetWidth || 0) === width && (seed.assetHeight || 0) === height) {
    return { ...seed.area }
  }
  if (!seed?.normalizedArea) return null
  const referenceSize = Math.max(1, Math.min(width, height))
  const ratio = Math.max(1 / 1000, Number(seed.normalizedArea.ratio) || 1)
  const cropWidth = Math.max(40, Math.round(Number(seed.normalizedArea.scale || 0) * referenceSize))
  const cropHeight = Math.max(40, Math.round(cropWidth / ratio))
  const centerX = Math.round(Number(seed.normalizedArea.centerX || 0.5) * width)
  const centerY = Math.round(Number(seed.normalizedArea.centerY || 0.5) * height)
  return clampCropAreaToAsset({
    x: Math.round(centerX - cropWidth / 2),
    y: Math.round(centerY - cropHeight / 2),
    width: cropWidth,
    height: cropHeight,
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

function getPreviewDisplaySize(asset, config) {
  const width = Math.max(1, Number(asset?.width) || 1)
  const height = Math.max(1, Number(asset?.height) || 1)
  const normalizedAngle = Math.abs(Number(config?.angle) || 0) % 180
  return normalizedAngle === 90
    ? { width: height, height: width }
    : { width, height }
}

function getPreviewSvgMarkup(asset, config, displaySize) {
  const sourceWidth = Math.max(1, Number(asset?.width) || 1)
  const sourceHeight = Math.max(1, Number(asset?.height) || 1)
  const matrix = getPreviewMatrix(sourceWidth, sourceHeight, config)
  return `
    <svg class="manual-canvas__preview-svg" viewBox="0 0 ${displaySize.width} ${displaySize.height}" preserveAspectRatio="none" aria-hidden="true">
      <g transform="matrix(${matrix.join(' ')})">
        <image href="${asset.thumbnailUrl}" x="0" y="0" width="${sourceWidth}" height="${sourceHeight}" preserveAspectRatio="none"></image>
      </g>
    </svg>
  `
}

function getPreviewMatrix(sourceWidth, sourceHeight, config) {
  let matrix = [1, 0, 0, 1, 0, 0]
  if (config.flipHorizontal) matrix = composeSvgMatrix(matrix, [-1, 0, 0, 1, sourceWidth, 0])
  if (config.flipVertical) matrix = composeSvgMatrix(matrix, [1, 0, 0, -1, 0, sourceHeight])
  const normalizedAngle = ((Math.round(Number(config.angle) || 0) % 360) + 360) % 360
  if (normalizedAngle === 90) matrix = composeSvgMatrix(matrix, [0, 1, -1, 0, sourceHeight, 0])
  if (normalizedAngle === 180) matrix = composeSvgMatrix(matrix, [-1, 0, 0, -1, sourceWidth, sourceHeight])
  if (normalizedAngle === 270) matrix = composeSvgMatrix(matrix, [0, -1, 1, 0, 0, sourceWidth])
  return matrix.map((value) => Number(value.toFixed(6)))
}

function composeSvgMatrix(first, second) {
  const [a1, b1, c1, d1, e1, f1] = first
  const [a2, b2, c2, d2, e2, f2] = second
  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2,
  ]
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
