import { TOOL_MAP } from '../config/tools.js'
import { renderSideNav } from './SideNav.js'
import { renderTopBar } from './TopBar.js'
import { renderImageQueue } from './ImageQueueList.js'
import { renderToolPage } from '../pages/index.js'

export function renderAppShell(state) {
  const tool = TOOL_MAP[state.activeTool]
  const isResultView = !!state.resultView?.items?.length
  const isSettingsView = !!state.settingsDialog?.visible

  if (tool.mode === 'manual' && !isResultView) {
    return renderToolPage(tool.id, state)
  }

  return `
    <div class="app-shell ${state.sidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}">
      ${renderSideNav(state.activeTool, state.sidebarCollapsed)}
      ${renderTopBar(state)}
      ${isSettingsView
        ? `<div class="workspace workspace--settings">${renderSettingsWorkspace(state.settingsDialog)}</div>`
        : isResultView
        ? `<div class="workspace workspace--result">${renderResultWorkspace(state)}</div>`
        : `
          <div class="workspace">
            ${renderToolPage(tool.id, state)}
            ${renderImageQueue(state)}
          </div>
        `}
      ${renderPresetModal(state)}
      ${renderConfirmModal(state.confirmDialog)}
      ${renderPreviewModal(state.previewModal)}
    </div>
  `
}

function renderSettingsWorkspace(dialog) {
  if (!dialog?.visible) return ''

  const mode = dialog.saveLocationMode || 'source'
  const customPath = dialog.saveLocationCustomPath || ''
  const options = [
    ['source', '原图目录'],
    ['downloads', '下载目录'],
    ['pictures', '图片目录'],
    ['desktop', '桌面'],
    ['custom', '手动选择'],
  ]

  return `
    <section class="settings-page">
      <div class="settings-page__header">
        <div>
          <h2 class="hero-title">设置</h2>
          <div class="queue-subtitle">配置默认图片保存位置与基础偏好</div>
        </div>
        <button class="secondary-button" data-action="close-settings-modal">返回</button>
      </div>
      <div class="settings-page__content">
        <div class="settings-panel">
          <div class="settings-panel__group">
            <div class="settings-panel__label">默认保存位置</div>
            <div class="select-shell settings-select ${dialog.settingsSelectOpen ? 'is-open' : ''}">
              <button type="button" class="select-shell__value" data-action="toggle-config-select" aria-haspopup="listbox" aria-expanded="${dialog.settingsSelectOpen ? 'true' : 'false'}">
                <span class="select-shell__text">${escapeHtml((options.find(([value]) => value === mode) || options[0])[1])}</span>
                <span class="material-symbols-outlined select-shell__icon">expand_more</span>
              </button>
              <div class="select-shell__menu" role="listbox">
                ${options.map(([value, label]) => `
                <button
                  type="button"
                  class="select-shell__option ${mode === value ? 'is-active' : ''}"
                  data-action="set-settings-save-mode"
                  data-value="${value}"
                >${label}</button>
                `).join('')}
              </div>
            </div>
          </div>
          <div class="settings-panel__group">
            <div class="settings-panel__label">当前路径</div>
            <div class="settings-path-row">
              <div class="settings-path">${escapeHtml(getSaveLocationSummary(mode, customPath))}</div>
              ${mode === 'custom'
                ? `<button type="button" class="secondary-button" data-action="pick-settings-custom-path">选择位置</button>`
                : ''}
            </div>
          </div>
        </div>
        <div class="settings-page__actions">
          <button type="button" class="secondary-button" data-action="close-settings-modal">取消</button>
          <button type="button" class="primary-button" data-action="save-settings-dialog">保存设置</button>
        </div>
      </div>
    </section>
  `
}

function renderPresetModal(state) {
  const dialog = state.presetDialog
  if (!dialog?.visible) return ''

  const presets = state.presetsByTool?.[dialog.toolId] || []
  const toolLabel = TOOL_MAP[dialog.toolId]?.label || dialog.toolId
  const modeTitle = dialog.mode === 'save' ? '保存预设' : dialog.mode === 'rename' ? '重命名预设' : '使用预设'

  return `
    <div class="app-modal" data-action="close-preset-dialog">
      <div class="app-modal__dialog app-modal__dialog--preset">
        <button class="app-modal__close" data-action="close-preset-dialog" title="关闭">
          <span class="material-symbols-outlined">close</span>
        </button>
        <div class="app-modal__header">
          <div class="app-modal__title">${modeTitle}</div>
          <div class="app-modal__subtitle">${escapeHtml(toolLabel)}</div>
        </div>
        ${(dialog.mode === 'save' || dialog.mode === 'rename')
          ? `
            <div class="preset-form">
              <label class="setting-row setting-row--stack">
                <span class="setting-row__header">
                  <span class="setting-row__label">预设名称</span>
                </span>
                <input class="text-input" data-action="change-preset-name" value="${escapeHtml(dialog.name || '')}" placeholder="例如：电商白底图" />
              </label>
              <label class="checkbox-row">
                <input type="checkbox" data-action="toggle-preset-default" ${dialog.setAsDefault ? 'checked' : ''} />
                <span>设为当前工具默认配置</span>
              </label>
            </div>
          `
          : `
            <div class="preset-picker">
              ${presets.length
                ? presets.map((preset) => `
                    <button
                      type="button"
                      class="preset-card ${dialog.selectedPresetId === preset.id ? 'is-active' : ''}"
                      data-action="select-preset"
                      data-preset-id="${preset.id}"
                    >
                      <span class="preset-card__name">${escapeHtml(preset.name || '未命名预设')}</span>
                      <span class="preset-card__meta">${escapeHtml(formatPresetTime(preset.createdAt))}</span>
                    </button>
                  `).join('')
                : '<div class="preset-empty">当前工具还没有保存过预设。</div>'}
              <label class="checkbox-row">
                <input type="checkbox" data-action="toggle-preset-default" ${dialog.setAsDefault ? 'checked' : ''} />
                <span>设为当前工具默认配置</span>
              </label>
            </div>
          `}
        <div class="app-modal__footer">
          <button type="button" class="secondary-button" data-action="close-preset-dialog">取消</button>
          ${dialog.mode === 'apply' && dialog.selectedPresetId
            ? `<button type="button" class="secondary-button" data-action="rename-selected-preset">重命名</button>`
            : ''}
          ${dialog.mode === 'apply' && dialog.selectedPresetId
            ? `<button type="button" class="secondary-button" data-action="delete-selected-preset">删除</button>`
            : ''}
          <button
            type="button"
            class="primary-button"
            data-action="${dialog.mode === 'save' ? 'confirm-save-preset' : dialog.mode === 'rename' ? 'confirm-rename-preset' : 'confirm-apply-preset'}"
            ${dialog.mode === 'apply' && !dialog.selectedPresetId ? 'disabled' : ''}
          >${dialog.mode === 'save' ? '保存预设' : dialog.mode === 'rename' ? '保存名称' : '应用预设'}</button>
        </div>
      </div>
    </div>
  `
}

function renderConfirmModal(dialog) {
  if (!dialog?.visible) return ''

  return `
    <div class="app-modal" data-action="close-confirm-dialog">
      <div class="app-modal__dialog app-modal__dialog--preset">
        <button class="app-modal__close" data-action="close-confirm-dialog" title="关闭">
          <span class="material-symbols-outlined">close</span>
        </button>
        <div class="app-modal__header">
          <div class="app-modal__title">${escapeHtml(dialog.title || '请确认')}</div>
          ${dialog.subtitle ? `<div class="app-modal__subtitle">${escapeHtml(dialog.subtitle)}</div>` : ''}
        </div>
        <div class="preset-empty">${escapeHtml(dialog.message || '')}</div>
        <div class="app-modal__footer">
          <button type="button" class="secondary-button" data-action="close-confirm-dialog">取消</button>
          <button type="button" class="primary-button" data-action="${escapeHtml(dialog.confirmAction || '')}">${escapeHtml(dialog.confirmLabel || '确认')}</button>
        </div>
      </div>
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

function getSaveLocationSummary(mode, customPath) {
  if (mode === 'source') return '原图所在目录'
  if (mode === 'downloads') return '系统下载目录'
  if (mode === 'pictures') return '系统图片目录'
  if (mode === 'desktop') return '桌面'
  return customPath || '未选择自定义目录'
}

function formatPresetTime(value) {
  if (!value) return '未记录时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}
