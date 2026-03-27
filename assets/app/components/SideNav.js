import { TOOLS } from '../config/tools.js'

export function renderSideNav(activeTool) {
  return `
    <aside class="sidebar">
      <div class="sidebar__brand">
        <div class="sidebar__brand-title">Precision Atelier</div>
        <div class="sidebar__brand-subtitle">Batch Processor</div>
      </div>
      <nav class="sidebar__nav" data-scroll-role="sidebar-nav">
        ${TOOLS.map((tool) => `
          <button class="nav-item ${tool.id === activeTool ? 'is-active' : ''}" data-action="activate-tool" data-tool-id="${tool.id}">
            <span class="material-symbols-outlined">${tool.icon}</span>
            <span>${tool.label}</span>
          </button>
        `).join('')}
      </nav>
    </aside>
  `
}
