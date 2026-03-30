import { TOOL_MAP } from '../config/tools.js'

const FORMAT_OPTIONS = ['PNG', 'JPEG', 'JPG', 'WebP', 'TIFF', 'AVIF', 'GIF', 'BMP', 'ICO']
const FLIP_OUTPUT_OPTIONS = [['Keep Original', '保持原格式'], ...FORMAT_OPTIONS]
const COLOR_PROFILE_OPTIONS = [
  ['srgb', 'sRGB'],
  ['p3', 'Display P3'],
  ['cmyk', 'CMYK'],
]
const PDF_MARGIN_OPTIONS = [
  ['none', '无边距'],
  ['narrow', '窄'],
  ['normal', '普通'],
  ['wide', '宽'],
]
const PDF_PAGE_SIZE_OPTIONS = ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Original']
const RESIZE_PRESETS = [
  { label: '1080×1080', width: '1080px', height: '1080px' },
  { label: '1080×1350', width: '1080px', height: '1350px' },
  { label: '1080×1920', width: '1080px', height: '1920px' },
  { label: '1280×720', width: '1280px', height: '720px' },
  { label: '1920×1080', width: '1920px', height: '1080px' },
  { label: '2048×2048', width: '2048px', height: '2048px' },
  { label: '2560×1440', width: '2560px', height: '1440px' },
  { label: '3840×2160', width: '3840px', height: '2160px' },
]
const WATERMARK_POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]
const CROP_RATIOS = ['Original', '1:1', '4:3', '3:2', '16:9', '9:16', '21:9', 'Custom']

export const MANUAL_CROP_RATIOS = [
  { label: '1:1', value: '1:1' },
  { label: '4:5', value: '4:5' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
]

export function renderCompressionPage(toolId, state) {
  const config = state.configs[toolId]
  return `
    <section class="panel panel--dense" data-role="drop-surface" data-scroll-role="panel">
      <div class="settings-shell settings-shell--compact">
        ${renderPrimaryCard(toolId, config)}
      </div>
      ${renderPresetFooter(toolId, state)}
    </section>
  `
}

export function renderToolHero(toolId) {
  const tool = TOOL_MAP[toolId]
  return `
    <div class="tool-hero">
      <span class="material-symbols-outlined tool-hero__icon">${tool?.icon || 'tune'}</span>
      <div>
        <div class="hero-title">${tool?.label || '工具配置'}</div>
      </div>
    </div>
  `
}

export function renderManualCropQuickRatios(activeRatio) {
  return `
    <div class="manual-ratio-row">
      ${MANUAL_CROP_RATIOS.map((ratio) => `
        <button
          class="secondary-button secondary-button--compact ${activeRatio === ratio.value ? 'is-active' : ''}"
          data-action="set-manual-ratio"
          data-value="${ratio.value}"
        >
          ${ratio.label}
        </button>
      `).join('')}
    </div>
  `
}

function renderPresetFooter(toolId, state) {
  const presets = state.presetsByTool?.[toolId] || []
  return `
    <div class="panel-footer-actions">
      <button class="queue-item__action" data-action="open-preset-dialog" data-tool-id="${toolId}">使用预设</button>
      <button class="queue-item__action" data-action="save-preset" data-tool-id="${toolId}">保存预设</button>
    </div>
  `
}

function renderPrimaryCard(toolId, config) {
  switch (toolId) {
    case 'compression':
      return renderCompressionConfig(config)
    case 'format':
      return renderFormatConfig(config)
    case 'resize':
      return renderResizeConfig(config)
    case 'watermark':
      return renderWatermarkConfig(config)
    case 'corners':
      return renderCornersConfig(config)
    case 'padding':
      return renderPaddingConfig(config)
    case 'crop':
      return renderCropConfig(config)
    case 'rotate':
      return renderRotateConfig(config)
    case 'flip':
      return renderFlipConfig(config)
    case 'merge-pdf':
      return renderMergePdfConfig(config)
    case 'merge-image':
      return renderMergeImageConfig(config)
    case 'merge-gif':
      return renderMergeGifConfig(config)
    default:
      return ''
  }
}

function renderCompressionConfig(config) {
  return renderSettingsSection(`
    ${renderSegmented('compression', 'mode', config.mode, [
      ['quality', '按质量'],
      ['target', '按体积'],
    ])}
    ${renderRangeField({
      label: '压缩质量',
      toolId: 'compression',
      key: 'quality',
      min: 1,
      max: 100,
      value: config.quality,
      suffix: '%',
    })}
    ${renderFieldGrid(`
      ${renderInputField({
        label: '目标大小 KB',
        toolId: 'compression',
        key: 'targetSizeKb',
        type: 'number',
        value: config.targetSizeKb,
        min: 1,
        hint: '极端情况下按体积无法严格命中目标值，系统会尽量压小。',
        hintClass: 'setting-row__hint--compression',
      })}
    `)}
  `)
}

function renderFormatConfig(config) {
  return renderSettingsSection(`
    ${renderSelectField({ label: '目标格式', toolId: 'format', key: 'targetFormat', value: config.targetFormat, options: FORMAT_OPTIONS })}
    ${renderFieldGrid(`
      ${renderInputField({ label: '质量', toolId: 'format', key: 'quality', type: 'number', value: config.quality, min: 1, max: 100 })}
      ${renderSelectField({ label: '颜色配置', toolId: 'format', key: 'colorProfile', value: config.colorProfile, options: COLOR_PROFILE_OPTIONS })}
    `)}
    ${renderToggleRow('保留透明通道', '', 'format', 'keepTransparency', config.keepTransparency)}
  `)
}

function renderResizeConfig(config) {
  return renderSettingsSection(`
    ${renderFieldGrid(`
      ${renderInputField({ label: '宽度', toolId: 'resize', key: 'width', value: getMeasureInputValue(config.width, '1920'), unitMode: getMeasureUnit(config.width, 'px') })}
      ${renderInputField({ label: '高度', toolId: 'resize', key: 'height', value: getMeasureInputValue(config.height, '1080'), unitMode: getMeasureUnit(config.height, 'px') })}
    `)}
    ${renderToggleRow('锁定比例', '', 'resize', 'lockAspectRatio', config.lockAspectRatio)}
    <div>
      <div class="card-label" style="margin-bottom:6px;">常用尺寸</div>
      <div class="preset-row">
        ${RESIZE_PRESETS.map((preset) => `<button class="secondary-button secondary-button--compact" data-action="apply-resize-preset" data-width="${preset.width}" data-height="${preset.height}">${preset.label}</button>`).join('')}
      </div>
    </div>
  `)
}

function renderWatermarkConfig(config) {
  return renderSettingsSection(`
    ${renderSegmented('watermark', 'type', config.type, [
      ['text', '文本'],
      ['image', '图片'],
    ])}
    ${config.type === 'text'
      ? renderInputField({ label: '水印文本', toolId: 'watermark', key: 'text', value: config.text })
      : `
        <div class="toggle-card toggle-card--compact">
          <div>
            <div class="toggle-card__label">图片水印</div>
            <div class="muted watermark-file-label">${escapeAttribute(config.imagePath || '未选择文件')}</div>
          </div>
          <button class="secondary-button secondary-button--compact" data-action="pick-watermark-image">选择文件</button>
        </div>`}
    ${renderFieldGrid(`
      ${renderInputField({ label: '字体大小', toolId: 'watermark', key: 'fontSize', type: 'number', value: config.fontSize, min: 8, max: 240, disabled: config.type !== 'text' })}
      ${renderColorField({ label: '颜色', toolId: 'watermark', key: 'color', value: config.color, disabled: config.type !== 'text' })}
      ${renderInputField({ label: '旋转角度', toolId: 'watermark', key: 'rotation', type: 'number', value: config.rotation, min: -180, max: 180 })}
      ${renderInputField({ label: '边距', toolId: 'watermark', key: 'margin', type: 'number', value: config.margin, min: 0, disabled: config.tiled })}
    `)}
    ${renderRangeField({ label: '透明度', toolId: 'watermark', key: 'opacity', min: 0, max: 100, value: config.opacity, suffix: '%' })}
    ${renderToggleRow('平铺模式', '', 'watermark', 'tiled', config.tiled)}
    ${config.tiled ? renderRangeField({ label: '平铺密度', toolId: 'watermark', key: 'density', min: 20, max: 250, value: config.density || 100, suffix: '%' }) : ''}
    ${config.tiled ? '' : `
      <div>
        <div class="card-label" style="margin-bottom:6px;">锚点位置</div>
        <div class="position-grid">
          ${WATERMARK_POSITIONS.map((position) => `
            <button class="position-dot ${config.position === position ? 'is-active' : ''}" data-action="set-config" data-tool-id="watermark" data-key="position" data-value="${position}" title="${position}">
              <span></span>
            </button>
          `).join('')}
        </div>
      </div>
    `}
  `)
}

function renderCornersConfig(config) {
  return renderSettingsSection(`
    ${renderFieldGrid(`
      ${renderInputField({ label: '圆角半径', toolId: 'corners', key: 'radius', value: getMeasureInputValue(config.radius, '24'), unitMode: getMeasureUnit(config.radius, 'px') })}
    `)}
    ${renderToggleRow('保留透明背景', '', 'corners', 'keepTransparency', config.keepTransparency)}
    ${renderColorField({ label: '背景填充色', toolId: 'corners', key: 'background', value: config.background })}
  `)
}

function renderPaddingConfig(config) {
  return renderSettingsSection(`
    ${renderFieldGrid(`
      ${renderInputField({ label: '上边距', toolId: 'padding', key: 'top', type: 'number', value: config.top, min: 0 })}
      ${renderInputField({ label: '右边距', toolId: 'padding', key: 'right', type: 'number', value: config.right, min: 0 })}
      ${renderInputField({ label: '下边距', toolId: 'padding', key: 'bottom', type: 'number', value: config.bottom, min: 0 })}
      ${renderInputField({ label: '左边距', toolId: 'padding', key: 'left', type: 'number', value: config.left, min: 0 })}
    `)}
    ${renderColorField({ label: '背景色', toolId: 'padding', key: 'color', value: config.color })}
    ${renderRangeField({ label: '透明度', toolId: 'padding', key: 'opacity', min: 0, max: 100, value: config.opacity, suffix: '%' })}
    ${renderInfoRow('总留白', '四边额外扩展画布', `${config.top + config.right + config.bottom + config.left}px`)}
  `)
}

function renderCropConfig(config) {
  const isCustom = config.ratio === 'Custom' || config.useCustomRatio
  return renderSettingsSection(`
    ${renderSelectField({ label: '裁剪比例', toolId: 'crop', key: 'ratio', value: config.ratio, options: CROP_RATIOS })}
    ${renderFieldGrid(`
      ${renderInputField({ label: '自定义比例 X', toolId: 'crop', key: 'customRatioX', type: 'number', value: config.customRatioX, min: 1, disabled: !isCustom })}
      ${renderInputField({ label: '自定义比例 Y', toolId: 'crop', key: 'customRatioY', type: 'number', value: config.customRatioY, min: 1, disabled: !isCustom })}
    `)}
    ${renderFieldGrid(`
      ${renderInputField({ label: '起始 X', toolId: 'crop', key: 'x', type: 'number', value: config.x, min: 0 })}
      ${renderInputField({ label: '起始 Y', toolId: 'crop', key: 'y', type: 'number', value: config.y, min: 0 })}
      ${renderInputField({ label: '宽度', toolId: 'crop', key: 'width', type: 'number', value: config.width, min: 1 })}
      ${renderInputField({ label: '高度', toolId: 'crop', key: 'height', type: 'number', value: config.height, min: 1 })}
    `)}
  `)
}

function renderRotateConfig(config) {
  const signedAngle = Number(config.angle) || 0
  const normalizedAngle = ((signedAngle % 360) + 360) % 360
  const dialRadians = (normalizedAngle - 90) * (Math.PI / 180)
  const dialCenter = 92
  const dialRadius = 68
  const knobX = dialCenter + Math.cos(dialRadians) * dialRadius
  const knobY = dialCenter + Math.sin(dialRadians) * dialRadius

  return renderSettingsSection(`
    <div class="rotate-card">
      <div class="rotate-dial" data-role="rotate-dial" data-tool-id="rotate">
        <div class="rotate-dial__ring"></div>
        <div class="rotate-dial__guide"></div>
        <div class="rotate-dial__disc"></div>
        <div class="rotate-dial__value">${signedAngle}°</div>
        <button class="rotate-dial__knob" data-action="drag-rotate" data-tool-id="rotate" style="left:${knobX}px;top:${knobY}px;" aria-label="拖动旋转角度"></button>
      </div>
      <div class="rotate-card__summary">当前角度 ${signedAngle}°</div>
    </div>
    ${renderFieldGrid(`
      ${renderInputField({ label: '精确角度', toolId: 'rotate', key: 'angle', type: 'number', value: signedAngle, min: -360, max: 360 })}
    `)}
    <div>
      <div class="card-label" style="margin-bottom:6px;">常用角度</div>
      <div class="preset-row">
        ${[-135, -90, -45, 0, 45, 90, 135, 180].map((angle) => `<button class="secondary-button secondary-button--compact" data-action="set-config" data-tool-id="rotate" data-key="angle" data-value="${angle}">${angle}°</button>`).join('')}
      </div>
    </div>
    ${renderToggleRow('自动裁切画布', '', 'rotate', 'autoCrop', config.autoCrop)}
    ${renderToggleRow('保持比例', '', 'rotate', 'keepAspectRatio', config.keepAspectRatio)}
    ${renderColorField({ label: '背景色', toolId: 'rotate', key: 'background', value: config.background || '#FFFFFF' })}
  `)
}

function renderFlipConfig(config) {
  return renderSettingsSection(`
    ${renderSelectField({ label: '输出格式', toolId: 'flip', key: 'outputFormat', value: config.outputFormat, options: FLIP_OUTPUT_OPTIONS })}
    ${renderToggleRow('左右翻转', '', 'flip', 'horizontal', config.horizontal)}
    ${renderToggleRow('上下翻转', '', 'flip', 'vertical', config.vertical)}
    ${renderToggleRow('保留元数据', '', 'flip', 'preserveMetadata', config.preserveMetadata)}
    ${renderToggleRow('自动裁掉透明边', '', 'flip', 'autoCropTransparent', config.autoCropTransparent)}
  `)
}

function renderMergePdfConfig(config) {
  return renderSettingsSection(`
    ${renderFieldGrid(`
      ${renderSelectField({ label: '页面尺寸', toolId: 'merge-pdf', key: 'pageSize', value: config.pageSize, options: PDF_PAGE_SIZE_OPTIONS })}
      ${renderSelectField({ label: '页边距', toolId: 'merge-pdf', key: 'margin', value: config.margin, options: PDF_MARGIN_OPTIONS })}
      ${renderColorField({ label: '背景色', toolId: 'merge-pdf', key: 'background', value: config.background || '#FFFFFF' })}
    `)}
    ${renderToggleRow('自动分页', '', 'merge-pdf', 'autoPaginate', config.autoPaginate)}
  `)
}

function renderMergeImageConfig(config) {
  return renderSettingsSection(`
    ${renderSegmented('merge-image', 'direction', config.direction, [
      ['vertical', '纵向'],
      ['horizontal', '横向'],
    ])}
    ${renderFieldGrid(`
      ${renderInputField({ label: '页面宽度', toolId: 'merge-image', key: 'pageWidth', type: 'number', value: config.pageWidth, min: 1 })}
      ${renderInputField({ label: '图片间距', toolId: 'merge-image', key: 'spacing', type: 'number', value: config.spacing, min: 0 })}
    `)}
    ${renderToggleRow('小图保持原尺寸', '小于目标宽度的图片不放大，按原尺寸居中留白', 'merge-image', 'preventUpscale', config.preventUpscale)}
    ${renderSelectField({ label: '对齐方式', toolId: 'merge-image', key: 'align', value: config.align, options: [['start', '起始对齐'], ['center', '居中对齐']] })}
    ${renderColorField({ label: '背景色', toolId: 'merge-image', key: 'background', value: config.background || '#FFFFFF' })}
  `)
}

function renderMergeGifConfig(config) {
  return renderSettingsSection(`
    ${renderFieldGrid(`
      ${renderInputField({ label: '宽度', toolId: 'merge-gif', key: 'width', type: 'number', value: config.width, min: 1 })}
      ${renderInputField({ label: '高度', toolId: 'merge-gif', key: 'height', type: 'number', value: config.height, min: 1 })}
      ${renderInputField({ label: '间隔秒数', toolId: 'merge-gif', key: 'interval', type: 'number', value: config.interval, min: 0.1, step: 0.1 })}
    `)}
    ${renderToggleRow('循环播放', '', 'merge-gif', 'loop', config.loop)}
    ${renderColorField({ label: '背景色', toolId: 'merge-gif', key: 'background', value: config.background || '#FFFFFF' })}
  `)
}

function renderSettingsSection(content) {
  return `
    <section class="settings-section settings-section--compact">
      <div class="settings-list settings-list--compact">
        ${content}
      </div>
    </section>
  `
}

function renderFieldGrid(content) {
  return `<div class="field-grid field-grid--dense">${content}</div>`
}

function renderSegmented(toolId, key, activeValue, options) {
  return `
    <div class="segmented">
      ${options.map(([value, label]) => `
        <button class="${activeValue === value ? 'is-active' : ''}" data-action="set-config" data-tool-id="${toolId}" data-key="${key}" data-value="${value}">${label}</button>
      `).join('')}
    </div>
  `
}

function renderInputField({ label, toolId, key, type = 'text', value = '', placeholder = '', min, max, step, disabled = false, hint = '', hintClass = '', unitMode = '' }) {
  const hasUnitSwitch = unitMode === 'px' || unitMode === '%'
  return `
    <label class="setting-row setting-row--stack ${disabled ? 'is-disabled' : ''}">
      <span class="setting-row__header">
        <span class="setting-row__label">${label}</span>
      </span>
      <span class="input-shell ${hasUnitSwitch ? 'input-shell--measure' : ''}">
        <input
          class="text-input ${hasUnitSwitch ? 'text-input--measure' : ''}"
          type="${type}"
          data-action="set-config-input"
          data-tool-id="${toolId}"
          data-key="${key}"
          value="${escapeAttribute(value)}"
          ${placeholder ? `placeholder="${escapeAttribute(placeholder)}"` : ''}
          ${min !== undefined ? `min="${min}"` : ''}
          ${max !== undefined ? `max="${max}"` : ''}
          ${step !== undefined ? `step="${step}"` : ''}
          ${disabled ? 'disabled' : ''}
        />
        ${hasUnitSwitch ? `
          <span class="measure-unit-toggle" role="group" aria-label="${escapeAttribute(label)} 单位切换">
            <button type="button" class="measure-unit-toggle__option ${unitMode === 'px' ? 'is-active' : ''}" data-action="set-measure-unit" data-tool-id="${toolId}" data-key="${key}" data-unit="px">px</button>
            <button type="button" class="measure-unit-toggle__option ${unitMode === '%' ? 'is-active' : ''}" data-action="set-measure-unit" data-tool-id="${toolId}" data-key="${key}" data-unit="%">%</button>
          </span>
        ` : ''}
      </span>
      ${hint ? `<span class="setting-row__hint ${escapeAttribute(hintClass)}">${escapeAttribute(hint)}</span>` : ''}
    </label>
  `
}

function renderSelectField({ label, toolId, key, value, options }) {
  const normalizedOptions = options.map((option) => Array.isArray(option) ? option : [option, option])
  const activeOption = normalizedOptions.find((option) => option[0] === value) || normalizedOptions[0] || ['', '']
  return `
    <label class="setting-row setting-row--stack">
      <span class="setting-row__header">
        <span class="setting-row__label">${label}</span>
      </span>
      <div class="select-shell">
        <button type="button" class="select-shell__value" data-action="toggle-config-select" aria-haspopup="listbox" aria-expanded="false">
          <span class="select-shell__text">${escapeAttribute(activeOption[1])}</span>
          <span class="material-symbols-outlined select-shell__icon">expand_more</span>
        </button>
        <div class="select-shell__menu" role="listbox">
          ${normalizedOptions.map((option) => `
            <button
              type="button"
              class="select-shell__option ${option[0] === value ? 'is-active' : ''}"
              data-action="set-config"
              data-tool-id="${toolId}"
              data-key="${key}"
              data-value="${escapeAttribute(option[0])}"
            >${escapeAttribute(option[1])}</button>
          `).join('')}
        </div>
      </div>
    </label>
  `
}

function renderColorField({ label, toolId, key, value = '#FFFFFF', disabled = false }) {
  const normalized = normalizeColorValue(value)
  return `
    <label class="setting-row setting-row--stack ${disabled ? 'is-disabled' : ''}">
      <span class="setting-row__header">
        <span class="setting-row__label">${label}</span>
      </span>
      <span class="color-field" style="--color-preview:${escapeAttribute(normalized)};">
        <button
          type="button"
          class="color-field__picker"
          data-action="open-color-picker"
          ${disabled ? 'disabled' : ''}
          aria-label="打开颜色选择器"
        ></button>
        <input
          class="color-field__native"
          type="color"
          value="${escapeAttribute(normalized)}"
          data-action="set-config-color"
          data-tool-id="${toolId}"
          data-key="${key}"
          ${disabled ? 'disabled' : ''}
          tabindex="-1"
          aria-hidden="true"
        />
        <input
          class="text-input color-field__value"
          type="text"
          value="${escapeAttribute(normalized)}"
          data-action="set-config-input"
          data-tool-id="${toolId}"
          data-key="${key}"
          ${disabled ? 'disabled' : ''}
        />
      </span>
    </label>
  `
}

function normalizeColorValue(value = '#FFFFFF') {
  const text = String(value || '').trim()
  return /^#([0-9a-f]{6})$/i.test(text) ? text.toUpperCase() : '#FFFFFF'
}

function renderRangeField({ label, toolId, key, min, max, value, suffix = '' }) {
  return `
    <label class="setting-row setting-row--range">
      <span class="setting-row__header">
        <span class="setting-row__label">${label}</span>
        <span class="setting-row__value" data-range-value>${value}${suffix}</span>
      </span>
      <span class="range-shell">
        <input
          class="range-input"
          type="range"
          min="${min}"
          max="${max}"
          value="${value}"
          data-action="set-config-range"
          data-tool-id="${toolId}"
          data-key="${key}"
          data-value-suffix="${escapeAttribute(suffix)}"
          style="--range-progress:${getRangeProgress(value, min, max)}%;"
        />
      </span>
    </label>
  `
}

function renderToggleRow(label, hint, toolId, key, checked) {
  return `
    <div class="toggle-card toggle-card--compact">
      <div>
        <div class="toggle-card__label">${label}</div>
        ${hint ? `<div class="muted" style="font-size:12px;">${hint}</div>` : ''}
      </div>
      <button class="switch ${checked ? 'is-on' : ''}" data-action="toggle-config" data-tool-id="${toolId}" data-key="${key}"></button>
    </div>
  `
}

function renderInfoRow(label, hint, badge) {
  return `
    <div class="toggle-card toggle-card--compact">
      <div>
        <div class="toggle-card__label">${label}</div>
        ${hint ? `<div class="muted" style="font-size:12px;">${hint}</div>` : ''}
      </div>
      <div class="badge">${badge}</div>
    </div>
  `
}

function getMeasureInputValue(value, fallback = '') {
  const stringValue = String(value ?? '').trim()
  if (!stringValue) return fallback
  if (stringValue.endsWith('px')) return stringValue.slice(0, -2)
  return stringValue
}

function getMeasureUnit(value, fallbackUnit = 'px') {
  const stringValue = String(value ?? '').trim()
  if (stringValue.endsWith('%')) return '%'
  return fallbackUnit
}

function getRangeProgress(value, min, max) {
  const current = Number(value)
  const start = Number(min)
  const end = Number(max)
  if (!Number.isFinite(current) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return ((current - start) / (end - start)) * 100
}

function escapeAttribute(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
