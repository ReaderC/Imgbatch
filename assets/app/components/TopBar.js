import { TOOL_MAP } from '../config/tools.js'

const PREVIEW_SAVE_TOOLS = new Set(['compression', 'format', 'resize'])

export function renderTopBar(state) {
  const tool = TOOL_MAP[state.activeTool]
  const canSaveAll = PREVIEW_SAVE_TOOLS.has(tool.id) && state.assets.some((asset) => asset.stagedToolId === tool.id && asset.previewStatus === 'staged' && asset.stagedOutputPath)
  const savePathLabel = state.settings?.defaultSavePath ? `默认保存：${escapeHtml(state.settings.defaultSavePath)}` : '默认保存：未设置'

  return `
    <header class="topbar">
      <div>
        <div class="topbar__title">${tool.label}</div>
        <div class="sidebar__brand-subtitle">Imgbatch · ${tool.mode === 'sort' ? '排序队列' : tool.mode === 'manual' ? '手动编辑器' : '效果预览'}</div>
      </div>
      <div class="topbar__actions">
        <label class="search">
          <span class="material-symbols-outlined">search</span>
          <input data-role="search-input" value="${escapeHtml(state.searchQuery)}" placeholder="搜索图片..." />
        </label>
        <div class="topbar__meta">
          <span class="badge">${state.assets.length} images</span>
          <span class="badge" title="${savePathLabel}">${savePathLabel}</span>
          ${canSaveAll ? `<button class="secondary-button" data-action="save-all-results" ${state.isProcessing ? 'disabled' : ''}>全部保存</button>` : ''}
          <button class="icon-button" data-action="open-settings" title="设置"><span class="material-symbols-outlined">settings</span></button>
          <button class="icon-button" title="帮助"><span class="material-symbols-outlined">help</span></button>
          <button class="primary-button" data-action="process-current" ${state.isProcessing ? 'disabled' : ''}>${state.isProcessing ? '处理中...' : '开始处理'}</button>
        </div>
      </div>
    </header>
  `
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
