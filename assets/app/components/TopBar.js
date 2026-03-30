import { TOOL_MAP } from '../config/tools.js'

export function renderTopBar(state) {
  const tool = TOOL_MAP[state.activeTool]
  const progress = state.processingProgress
  const sidebarLabel = state.sidebarCollapsed ? '展开导航' : '收起导航'
  const sidebarIcon = state.sidebarCollapsed ? 'right_panel_open' : 'left_panel_close'
  const modeLabel = tool.mode === 'sort'
    ? '排序队列'
    : tool.mode === 'manual'
      ? '手动裁剪'
      : '效果预览'

  return `
    <header class="topbar">
      <div class="topbar__heading">
        <button type="button" class="icon-button topbar__toggle" data-action="toggle-sidebar" title="${sidebarLabel}">
          <span class="material-symbols-outlined">${sidebarIcon}</span>
        </button>
        <div class="topbar__title-block">
          <div class="topbar__title">${tool.label}</div>
          <div class="sidebar__brand-subtitle">批量处理 · ${modeLabel}</div>
        </div>
      </div>
      <div class="topbar__actions">
        <div class="topbar__meta">
          <button class="primary-button ${state.isProcessing ? 'is-processing' : ''}" data-action="process-current" ${state.isProcessing ? 'disabled' : ''}>
            ${state.isProcessing
              ? `${progress?.completed || 0}/${progress?.total || 0} 处理中`
              : '开始处理'}
          </button>
        </div>
      </div>
    </header>
  `
}
