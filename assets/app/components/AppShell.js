import { TOOL_MAP } from '../config/tools.js'
import { renderSideNav } from './SideNav.js'
import { renderTopBar } from './TopBar.js'
import { renderImageQueue } from './ImageQueueList.js'
import { renderToolPage } from '../pages/index.js'

export function renderAppShell(state) {
  const tool = TOOL_MAP[state.activeTool]
  const isResultView = !!state.resultView?.items?.length

  if (tool.mode === 'manual' && !isResultView) {
    return renderToolPage(tool.id, state)
  }

  return `
    <div class="app-shell ${state.sidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}">
      ${renderSideNav(state.activeTool, state.sidebarCollapsed)}
      ${renderTopBar(state)}
      ${isResultView
        ? `<div class="workspace workspace--result">${renderResultWorkspace(state)}</div>`
        : `
          <div class="workspace">
            ${renderToolPage(tool.id, state)}
            ${renderImageQueue(state)}
          </div>
        `}
      ${renderPreviewModal(state.previewModal)}
    </div>
  `
}

function renderResultWorkspace(state) {
  const resultView = state.resultView
  if (!resultView?.items?.length) return ''

  const failedCount = resultView.failed?.length || 0
  const subtitle = failedCount
    ? `共 ${resultView.items.length} 项，失败 ${failedCount} 项`
    : `共 ${resultView.items.length} 项`

  return `
    <section class="result-page">
      <div class="result-page__header">
        <div>
          <h2 class="hero-title">处理结果对比</h2>
          <div class="queue-subtitle">${subtitle}</div>
        </div>
      </div>
      <div class="result-page__list">
        ${resultView.items.map((item) => `
          <section class="result-page__card">
            <div class="result-page__stats">
              ${renderResultStrip(
                '原',
                formatBytes(item.source?.sizeBytes || 0),
                formatDimensions(item.source?.width, item.source?.height),
              )}
              ${renderResultStrip(
                '后',
                formatSizeWithDelta(
                  formatBytes(item.result?.sizeBytes || 0),
                  getSizeDeltaText(item.source?.sizeBytes || 0, item.result?.sizeBytes || 0),
                  getSizeDeltaPercentText(item.source?.sizeBytes || 0, item.result?.sizeBytes || 0),
                ),
                formatResultStat(
                  formatDimensions(item.result?.width, item.result?.height),
                  formatDimensionDelta(
                    item.source?.width || 0,
                    item.source?.height || 0,
                    item.result?.width || 0,
                    item.result?.height || 0,
                  ),
                ),
              )}
            </div>
            ${item.outputPath
              ? `<button class="secondary-button result-page__open" data-action="open-result-path" data-path="${escapeHtml(item.outputPath)}">打开目录</button>`
              : ''}
          </section>
        `).join('')}
      </div>
    </section>
  `
}

function renderResultStrip(label, size, dimensions) {
  const normalizedSize = String(size || '0 B')
  const normalizedDimensions = String(dimensions || '-')
  return `
    <div class="result-strip">
      <span class="result-strip__label">${escapeHtml(label)}</span>
      <span class="result-strip__value">
        <span class="result-strip__marquee">${escapeHtml(normalizedSize)}</span>
      </span>
      <span class="result-strip__meta">
        <span class="result-strip__marquee">${escapeHtml(normalizedDimensions)}</span>
      </span>
    </div>
  `
}

function renderPreviewModal(preview) {
  if (!preview?.url) return ''
  const beforeUrl = preview.beforeUrl || preview.url
  const afterUrl = preview.afterUrl || preview.url
  return `
    <div class="preview-modal" data-action="close-preview-modal">
      <div class="preview-modal__dialog preview-modal__dialog--compare">
        <button class="preview-modal__close" data-action="close-preview-modal" title="关闭">
          <span class="material-symbols-outlined">close</span>
        </button>
        <div class="preview-modal__meta">
          <div class="preview-modal__title">${escapeHtml(preview.name || '预览')}</div>
          <div class="preview-modal__subtitle">${escapeHtml(preview.summary || '')}</div>
        </div>
        <div class="preview-modal__compare">
          <section class="preview-compare-card">
            <div class="preview-compare-card__label">处理前</div>
            <div class="preview-modal__body"><img src="${beforeUrl}" alt="${escapeHtml(preview.name || '原图')}" /></div>
          </section>
          <section class="preview-compare-card">
            <div class="preview-compare-card__label">处理后</div>
            <div class="preview-modal__body"><img src="${afterUrl}" alt="${escapeHtml(preview.name || '结果')}" /></div>
          </section>
        </div>
      </div>
    </div>
  `
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

function formatDimensions(width = 0, height = 0) {
  return `${width || '-'} × ${height || '-'}`
}

function formatResultStat(value, delta) {
  if (!delta || delta === '0' || delta === '0 B' || delta === '0 / 0') return value
  return `${value} (${delta})`
}

function getSizeDeltaText(before = 0, after = 0) {
  const delta = Number(after || 0) - Number(before || 0)
  if (!delta) return '0 B'
  const prefix = delta > 0 ? '+' : '-'
  return `${prefix}${formatBytes(Math.abs(delta))}`
}

function getSizeDeltaPercentText(before = 0, after = 0) {
  const base = Number(before || 0)
  const next = Number(after || 0)
  if (!base) return next ? 'new' : '0%'
  const percent = ((next - base) / base) * 100
  if (!percent) return '0%'
  const prefix = percent > 0 ? '+' : ''
  return `${prefix}${percent.toFixed(Math.abs(percent) >= 10 ? 0 : 1)}%`
}

function formatSizeWithDelta(value, delta, percent) {
  const details = [delta, percent].filter((item) => item && item !== '0 B' && item !== '0%')
  return details.length ? `${value} (${details.join(' / ')})` : value
}

function getDimensionDeltaText(before = 0, after = 0) {
  const delta = Number(after || 0) - Number(before || 0)
  if (!delta) return '0'
  return `${delta > 0 ? '+' : ''}${delta}`
}

function formatDimensionDelta(beforeWidth = 0, beforeHeight = 0, afterWidth = 0, afterHeight = 0) {
  return `${getDimensionDeltaText(beforeWidth, afterWidth)} / ${getDimensionDeltaText(beforeHeight, afterHeight)}`
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
