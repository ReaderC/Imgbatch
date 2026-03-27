import { TOOL_MAP } from '../config/tools.js'
import { renderSideNav } from './SideNav.js'
import { renderTopBar } from './TopBar.js'
import { renderImageQueue } from './ImageQueueList.js'
import { renderToolPage } from '../pages/index.js'

export function renderAppShell(state) {
  const tool = TOOL_MAP[state.activeTool]

  if (tool.mode === 'manual') {
    return renderToolPage(tool.id, state)
  }

  return `
    <div class="app-shell">
      ${renderSideNav(state.activeTool)}
      ${renderTopBar(state)}
      <div class="workspace">
        ${renderToolPage(tool.id, state)}
        ${renderImageQueue(state)}
      </div>
      ${renderPreviewModal(state.previewModal)}
    </div>
  `
}

function renderPreviewModal(preview) {
  if (!preview?.url) return ''
  return `
    <div class="preview-modal" data-action="close-preview-modal">
      <div class="preview-modal__dialog">
        <button class="preview-modal__close" data-action="close-preview-modal" title="关闭">
          <span class="material-symbols-outlined">close</span>
        </button>
        <div class="preview-modal__meta">
          <div class="preview-modal__title">${escapeHtml(preview.name || '预览')}</div>
          <div class="preview-modal__subtitle">${escapeHtml(preview.summary || '')}</div>
        </div>
        <div class="preview-modal__body">
          <img src="${preview.url}" alt="${escapeHtml(preview.name || '预览')}" />
        </div>
      </div>
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
