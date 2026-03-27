import { MANUAL_CROP_RATIOS } from './tool-pages.js'

export function renderManualCropPage(state) {
  const config = state.configs['manual-crop']
  const current = state.assets[config.currentIndex] || state.assets[0]
  const completedCount = config.completedIds.length
  const skippedCount = config.skippedIds.length
  const progressLabel = state.assets.length ? `${Math.min(config.currentIndex + 1, state.assets.length)} / ${state.assets.length}` : '0 / 0'
  const currentRatio = MANUAL_CROP_RATIOS.find((item) => item.label === config.ratio) || MANUAL_CROP_RATIOS[2]

  return `
    <div class="manual-shell">
      <header class="manual-header">
        <div>
          <div class="section-eyebrow">Precision Atelier</div>
          <h2 class="manual-title">手动裁剪</h2>
        </div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <span class="badge">${progressLabel}</span>
          <span class="badge">完成 ${completedCount}</span>
          <span class="badge">跳过 ${skippedCount}</span>
          <button class="icon-button" data-action="activate-tool" data-tool-id="compression" title="关闭"><span class="material-symbols-outlined">close</span></button>
        </div>
      </header>
      <main class="manual-canvas" data-role="drop-surface" data-scroll-role="manual-canvas">
        <div class="manual-hud">
          <div>
            <div class="card-label">Dimensions</div>
            <div style="font-weight:800;font-family:'Manrope',sans-serif;">${current ? `${current.width || '—'} × ${current.height || '—'} px` : '未选择图片'}</div>
          </div>
          <div style="width:1px;height:40px;background:rgba(171,179,185,.4);"></div>
          <div>
            <div class="card-label">Target</div>
            <div style="font-weight:800;font-family:'Manrope',sans-serif;color:var(--primary);">${current ? currentRatio.value : '—'} Ratio</div>
          </div>
          <div style="width:1px;height:40px;background:rgba(171,179,185,.4);"></div>
          <div>
            <div class="card-label">Current Asset</div>
            <div style="font-weight:800;font-family:'Manrope',sans-serif;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${current ? escapeHtml(current.name) : '等待导入图片'}</div>
          </div>
        </div>
        <div class="manual-canvas__stage">
          <div class="manual-canvas__image">
            ${current ? `<img src="${current.thumbnailUrl}" alt="${escapeHtml(current.name)}" />` : '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:var(--surface-container-high);color:var(--on-surface-variant);">拖入图片后开始裁剪</div>'}
            <div class="manual-crop-box">
              <span class="manual-handle manual-handle--tl"></span>
              <span class="manual-handle manual-handle--tr"></span>
              <span class="manual-handle manual-handle--bl"></span>
              <span class="manual-handle manual-handle--br"></span>
              <span class="manual-handle manual-handle--tm"></span>
              <span class="manual-handle manual-handle--bm"></span>
              <span class="manual-handle manual-handle--ml"></span>
              <span class="manual-handle manual-handle--mr"></span>
            </div>
          </div>
        </div>
      </main>
      <footer class="manual-footer">
        <div class="manual-footer__left">
          <div class="manual-toolbar" style="gap:10px;flex-wrap:wrap;">
            ${MANUAL_CROP_RATIOS.map((item) => `
              <button class="${config.ratio === item.label ? 'footer-button primary' : 'footer-button'}" data-action="set-manual-crop-ratio" data-label="${item.label}" data-value="${item.value}">${item.label}</button>
            `).join('')}
          </div>
        </div>
        <div class="manual-footer__right" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <button class="icon-button" data-action="manual-crop-prev" ${config.currentIndex <= 0 ? 'disabled' : ''}><span class="material-symbols-outlined">navigate_before</span></button>
          <button class="icon-button"><span class="material-symbols-outlined">rotate_left</span></button>
          <button class="icon-button"><span class="material-symbols-outlined">rotate_right</span></button>
          <button class="icon-button"><span class="material-symbols-outlined">flip</span></button>
          <button class="icon-button"><span class="material-symbols-outlined">swap_vert</span></button>
          <button class="footer-button" data-action="manual-crop-skip" ${!current ? 'disabled' : ''}>跳过并下一张</button>
          <button class="footer-button primary" data-action="manual-crop-complete" ${!current ? 'disabled' : ''}>裁剪并下一张</button>
          <button class="icon-button" data-action="manual-crop-next" ${!current || config.currentIndex >= state.assets.length - 1 ? 'disabled' : ''}><span class="material-symbols-outlined">navigate_next</span></button>
        </div>
      </footer>
    </div>
  `
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
