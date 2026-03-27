import { TOOL_MAP } from '../config/tools.js'

const FORMAT_OPTIONS = ['PNG', 'JPEG', 'JPG', 'WebP', 'TIFF', 'AVIF', 'BMP', 'GIF', 'ICO']
const RESIZE_PRESETS = [
  { label: 'Social 1080×1080', width: '1080px', height: '1080px' },
  { label: 'HD Thumbnail', width: '1280px', height: '720px' },
  { label: '4K Render', width: '3840px', height: '2160px' },
]
const WATERMARK_POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]
const CROP_RATIOS = ['Original', '1:1', '4:3', '3:2', '16:9', '9:16', '21:9', 'Custom']
const MANUAL_CROP_RATIOS = [
  { label: '1:1 Square', value: '1:1' },
  { label: '4:5 Portrait', value: '4:5' },
  { label: '16:9 Cinema', value: '16:9' },
  { label: '9:16 Story', value: '9:16' },
]

export function renderCompressionPage(toolId, state) {
  const tool = TOOL_MAP[toolId]
  const config = state.configs[toolId]

  return `
    <section class="panel panel--dense" data-role="drop-surface" data-scroll-role="panel">
      <div class="panel-hero panel-hero--compact panel-hero--minimal">
        <div>
          <h2 class="hero-title">${tool.label}</h2>
        </div>
        <div class="panel-hero__actions">
          <button class="ghost-button" data-action="save-preset" data-tool-id="${toolId}">保存预设</button>
        </div>
      </div>

      <div class="settings-shell settings-shell--compact">
        ${renderPrimaryCard(toolId, config)}
      </div>
    </section>
  `
}

function renderDropZone() {
  return `
    <div class="dropzone dropzone--compact" data-role="drop-surface">
      <div>
        <div class="dropzone__title">拖入图片或文件夹</div>
        <div class="dropzone__subtitle">支持直接拖入，也可以用下面的按钮导入。</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="primary-button" data-action="open-file-input">选择图片</button>
        <button class="secondary-button" data-action="open-folder-input">选择文件夹</button>
      </div>
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
  const qualityPercent = `${config.quality}%`
  const estimated = estimateCompression(config)
  return renderSettingsSection('核心参数', '压缩配置', '质量和目标体积二选一。', `
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
      hint: config.mode === 'quality' ? '按当前质量输出。' : '可先拖动估算质量。',
    })}
    ${renderFieldGrid(`
      ${renderInputField({ label: '目标大小 KB', toolId: 'compression', key: 'targetSizeKb', type: 'number', value: config.targetSizeKb, min: 1, hint: '按体积模式下优先逼近目标大小。' })}
    `)}
    ${renderInfoRow('当前策略', config.mode === 'quality' ? `优先按 ${qualityPercent} 输出` : `优先压到 ${config.targetSizeKb} KB 左右`, `预计 ${estimated}`)}
  `)
}

function renderFormatConfig(config) {
  return renderSettingsSection('输出设置', '格式转换', '完整支持 PNG、JPEG、JPG、WebP、TIFF、AVIF、BMP、GIF、ICO。', `
    ${renderSelectField({ label: '目标格式', toolId: 'format', key: 'targetFormat', value: config.targetFormat, options: FORMAT_OPTIONS, hint: '处理后先预览结果，再决定是否保存。' })}
    ${renderFieldGrid(`
      ${renderInputField({ label: '质量', toolId: 'format', key: 'quality', type: 'number', value: config.quality, min: 1, max: 100 })}
      ${renderInputField({ label: '颜色配置', toolId: 'format', key: 'colorProfile', value: config.colorProfile || 'sRGB' })}
    `)}
    ${renderToggleRow('保留透明通道', '对 PNG / WebP / AVIF 生效', 'format', 'keepTransparency', config.keepTransparency)}
    ${renderInfoRow('当前输出', `会统一转为 ${config.targetFormat}，并在结果里展示处理后大小`, config.targetFormat)}
  `)
}

function renderResizeConfig(config) {
  return renderSettingsSection('尺寸设置', '修改尺寸', '支持 px / % 混合输入、比例锁定和常用尺寸预设。', `
    ${renderFieldGrid(`
      ${renderInputField({ label: '宽度', toolId: 'resize', key: 'width', value: config.width, hint: '可直接输入 1920px 或 80%' })}
      ${renderInputField({ label: '高度', toolId: 'resize', key: 'height', value: config.height, hint: '处理后先显示新尺寸，再手动保存。' })}
    `)}
    ${renderFieldGrid(`
      ${renderSelectField({ label: '宽度单位', toolId: 'resize', key: 'widthUnit', value: config.widthUnit || inferUnit(config.width), options: ['px', '%'] })}
      ${renderSelectField({ label: '高度单位', toolId: 'resize', key: 'heightUnit', value: config.heightUnit || inferUnit(config.height), options: ['px', '%'] })}
    `)}
    ${renderToggleRow('锁定比例', '支持 px / % 混合输入', 'resize', 'lockAspectRatio', config.lockAspectRatio)}
    <div>
      <div class="card-label" style="margin-bottom:10px;">常用尺寸</div>
      <div class="preset-row">
        ${RESIZE_PRESETS.map((preset) => `<button class="secondary-button" data-action="apply-resize-preset" data-width="${preset.width}" data-height="${preset.height}">${preset.label}</button>`).join('')}
      </div>
    </div>
  `)
}

function renderWatermarkConfig(config) {
  return renderSettingsSection('水印模式', '添加水印', '', `
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
          <button class="secondary-button" data-action="pick-watermark-image">选择文件</button>
        </div>`}
    ${renderFieldGrid(`
      ${renderInputField({ label: '字体大小', toolId: 'watermark', key: 'fontSize', type: 'number', value: config.fontSize, min: 8, max: 240, disabled: config.type !== 'text' })}
      ${renderInputField({ label: '颜色', toolId: 'watermark', key: 'color', value: config.color, disabled: config.type !== 'text' })}
      ${renderInputField({ label: '旋转角度', toolId: 'watermark', key: 'rotation', type: 'number', value: config.rotation, min: -180, max: 180 })}
      ${renderInputField({ label: '边距', toolId: 'watermark', key: 'margin', type: 'number', value: config.margin, min: 0, disabled: config.tiled })}
    `)}
    ${renderRangeField({
      label: '透明度',
      toolId: 'watermark',
      key: 'opacity',
      min: 0,
      max: 100,
      value: config.opacity,
      suffix: '%',
    })}
    ${config.tiled ? renderRangeField({
      label: '平铺密度',
      toolId: 'watermark',
      key: 'density',
      min: 20,
      max: 200,
      value: config.density || 100,
      suffix: '%',
    }) : ''}
    ${config.tiled ? '' : `
      <div>
        <div class="card-label" style="margin-bottom:10px;">锚点位置</div>
        <div class="position-grid">
          ${WATERMARK_POSITIONS.map((position) => `
            <button class="position-dot ${config.position === position ? 'is-active' : ''}" data-action="set-config" data-tool-id="watermark" data-key="position" data-value="${position}" title="${position}">
              <span></span>
            </button>
          `).join('')}
        </div>
      </div>
    `}
    ${renderToggleRow('平铺模式', '', 'watermark', 'tiled', config.tiled)}
  `)
}

function renderCornersConfig(config) {
  return renderSettingsSection('圆角控制', '添加圆角', '支持 px / % 半径与背景填充。', `
    ${renderFieldGrid(`
      ${renderInputField({ label: '圆角半径', toolId: 'corners', key: 'radius', type: 'number', value: config.radius, min: 0 })}
      ${renderSelectField({ label: '单位', toolId: 'corners', key: 'unit', value: config.unit, options: ['px', '%'] })}
    `)}
    ${renderToggleRow('保留透明背景', '关闭后用背景色填充圆角外区域', 'corners', 'keepTransparency', config.keepTransparency)}
    ${renderInputField({ label: '背景填充色', toolId: 'corners', key: 'background', value: config.background })}
    ${renderInfoRow('当前半径', '输出时统一应用到全部队列图片', `${config.radius}${config.unit}`)}
  `)
}

function renderPaddingConfig(config) {
  return renderSettingsSection('边距设置', '补边留白', '保留四边留白、背景色和透明度控制。', `
    ${renderFieldGrid(`
      ${renderInputField({ label: '上边距', toolId: 'padding', key: 'top', type: 'number', value: config.top, min: 0 })}
      ${renderInputField({ label: '右边距', toolId: 'padding', key: 'right', type: 'number', value: config.right, min: 0 })}
      ${renderInputField({ label: '下边距', toolId: 'padding', key: 'bottom', type: 'number', value: config.bottom, min: 0 })}
      ${renderInputField({ label: '左边距', toolId: 'padding', key: 'left', type: 'number', value: config.left, min: 0 })}
    `)}
    ${renderFieldGrid(`
      ${renderInputField({ label: '背景色', toolId: 'padding', key: 'color', value: config.color })}
    `)}
    ${renderRangeField({
      label: '透明度',
      toolId: 'padding',
      key: 'opacity',
      min: 0,
      max: 100,
      value: config.opacity,
      suffix: '%',
      hint: '拖动时直接看到当前透明度。',
    })}
    ${renderInfoRow('总留白', '当前配置会在四边额外扩展画布', `${config.top + config.right + config.bottom + config.left}px`)}
  `)
}

function renderCropConfig(config) {
  const isCustom = config.ratio === 'Custom' || config.useCustomRatio
  return renderSettingsSection('裁剪参数', '裁剪', '保留比例选择、自定义比例和裁剪框坐标。', `
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
    ${renderInfoRow('当前输出框', isCustom ? `自定义比例 ${config.customRatioX}:${config.customRatioY}` : `预设比例 ${config.ratio}`, `${config.width} × ${config.height}`)}
  `)
}

function renderRotateConfig(config) {
  const signedAngle = config.direction === 'clockwise' ? Number(config.angle) : -Number(config.angle)
  const normalizedAngle = ((signedAngle % 360) + 360) % 360
  const dialRadians = (normalizedAngle - 90) * (Math.PI / 180)
  const knobX = 120 + Math.cos(dialRadians) * 92
  const knobY = 120 + Math.sin(dialRadians) * 92

  return renderSettingsSection('旋转控制', '旋转', '', `
    <div class="rotate-card">
      <div class="rotate-dial" data-role="rotate-dial" data-tool-id="rotate">
        <div class="rotate-dial__ring"></div>
        <div class="rotate-dial__guide"></div>
        <div class="rotate-dial__disc"></div>
        <div class="rotate-dial__value">${Math.abs(config.angle)}°</div>
        <button class="rotate-dial__knob" data-action="drag-rotate" data-tool-id="rotate" style="left:${knobX}px;top:${knobY}px;" aria-label="拖动旋转角度"></button>
      </div>
      <div class="rotate-card__summary">${config.direction === 'clockwise' ? '顺时针' : '逆时针'} ${config.angle}°</div>
    </div>
    ${renderFieldGrid(`
      ${renderInputField({ label: '精确角度', toolId: 'rotate', key: 'angle', type: 'number', value: config.angle, min: 0, max: 360 })}
      ${renderSelectField({ label: '方向', toolId: 'rotate', key: 'direction', value: config.direction, options: [
        ['clockwise', 'clockwise'],
        ['anticlockwise', 'anticlockwise'],
      ] })}
    `)}
    <div class="preset-row">
      <button class="secondary-button" data-action="set-config" data-tool-id="rotate" data-key="angle" data-value="90">90°</button>
      <button class="secondary-button" data-action="set-config" data-tool-id="rotate" data-key="angle" data-value="180">180°</button>
      <button class="secondary-button" data-action="set-config" data-tool-id="rotate" data-key="angle" data-value="270">270°</button>
    </div>
    ${renderToggleRow('自动裁切画布', '旋转后按当前策略处理边缘', 'rotate', 'autoCrop', config.autoCrop)}
    ${renderToggleRow('保持比例', '旋转后避免过度拉伸', 'rotate', 'keepAspectRatio', config.keepAspectRatio)}
  `)
}

function renderFlipConfig(config) {
  return renderSettingsSection('翻转方向', '翻转', '保留左右 / 上下双方向切换。', `
    <button class="toggle-card" data-action="toggle-config" data-tool-id="flip" data-key="horizontal" style="border:${config.horizontal ? '2px solid var(--primary)' : '2px solid transparent'};">
      <div>
        <div class="toggle-card__label">左右翻转</div>
        <div class="muted" style="font-size:13px;">沿垂直轴镜像</div>
      </div>
      <span class="badge">${config.horizontal ? '开启' : '关闭'}</span>
    </button>
    <button class="toggle-card" data-action="toggle-config" data-tool-id="flip" data-key="vertical" style="border:${config.vertical ? '2px solid var(--primary)' : '2px solid transparent'};">
      <div>
        <div class="toggle-card__label">上下翻转</div>
        <div class="muted" style="font-size:13px;">沿水平轴镜像</div>
      </div>
      <span class="badge">${config.vertical ? '开启' : '关闭'}</span>
    </button>
    ${renderToggleRow('保留元数据', 'EXIF 等信息随输出保留', 'flip', 'preserveMetadata', config.preserveMetadata)}
    ${renderToggleRow('自动裁掉透明边', '适合翻转后重新导出 PNG', 'flip', 'autoCropTransparent', config.autoCropTransparent)}
    ${renderSelectField({ label: '输出格式', toolId: 'flip', key: 'outputFormat', value: config.outputFormat, options: ['Keep Original', 'PNG', 'JPEG', 'WebP'] })}
  `)
}

function renderMergePdfConfig(config) {
  return renderSettingsSection('导出版式', '合并为 PDF', '保持排序型队列，按页面大小与边距统一输出 PDF。', `
    ${renderFieldGrid(`
      ${renderSelectField({ label: '页面大小', toolId: 'merge-pdf', key: 'pageSize', value: config.pageSize, options: ['A4', 'A3', 'A5', 'Letter', '与图片一致'] })}
      ${renderSelectField({ label: '边距', toolId: 'merge-pdf', key: 'margin', value: config.margin, options: ['无', 'narrow', 'wide'] })}
    `)}
    ${renderInfoRow('当前版式', '导出前先在右侧调整图片顺序', `${config.pageSize} / ${config.margin}`)}
  `)
}

function renderMergeImageConfig(config) {
  return renderSettingsSection('拼接设置', '合并为图片', '按方向、宽度、间距和背景输出单张图片。', `
    ${renderSegmented('merge-image', 'direction', config.direction, [
      ['vertical', '纵向'],
      ['horizontal', '横向'],
    ])}
    ${renderFieldGrid(`
      ${renderInputField({ label: '页面宽度', toolId: 'merge-image', key: 'pageWidth', type: 'number', value: config.pageWidth, min: 1 })}
      ${renderInputField({ label: '图片间距', toolId: 'merge-image', key: 'spacing', type: 'number', value: config.spacing, min: 0 })}
    `)}
    ${renderInputField({ label: '背景色', toolId: 'merge-image', key: 'background', value: config.background })}
    ${renderInfoRow('当前拼接', '右侧队列顺序决定最终拼接顺序', `${config.direction === 'vertical' ? '纵向' : '横向'} / ${config.pageWidth}px`)}
  `)
}

function renderMergeGifConfig(config) {
  return renderSettingsSection('动图参数', '合并为 GIF', '按统一宽高和帧间隔生成 GIF。', `
    ${renderFieldGrid(`
      ${renderInputField({ label: '宽度', toolId: 'merge-gif', key: 'width', type: 'number', value: config.width, min: 1 })}
      ${renderInputField({ label: '高度', toolId: 'merge-gif', key: 'height', type: 'number', value: config.height, min: 1 })}
    `)}
    ${renderFieldGrid(`
      ${renderInputField({ label: '间隔秒数', toolId: 'merge-gif', key: 'interval', type: 'number', value: config.interval, min: 0.1, step: 0.1 })}
      ${renderInputField({ label: '背景色', toolId: 'merge-gif', key: 'background', value: config.background })}
    `)}
    ${renderInfoRow('当前动图', '帧顺序与右侧队列顺序一致', `${config.width}×${config.height} / ${config.interval}s`)}
  `)
}

function renderInsightCard(toolId, config, assetCount) {
  return ''
}

function renderSettingsSection(eyebrow, title, subtitle, content) {
  return `
    <section class="settings-section settings-section--compact">
      <div class="settings-section__header settings-section__header--compact">
        <h3 class="panel-title panel-title--compact">${title}</h3>
      </div>
      <div class="settings-list settings-list--compact">
        ${content}
      </div>
    </section>
  `
}

function renderSummarySection(eyebrow, title, cards) {
  return `
    <section class="settings-section settings-section--summary">
      <div class="settings-section__header">
        <div class="section-eyebrow">${eyebrow}</div>
        <h3 class="panel-title">${title}</h3>
      </div>
      <div class="summary-grid">
        ${cards}
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

function renderInputField({ label, toolId, key, type = 'text', value = '', hint = '', placeholder = '', min, max, step, disabled = false }) {
  const resolvedHint = ''
  return `
    <label class="setting-row setting-row--stack ${disabled ? 'is-disabled' : ''}">
      <span class="setting-row__header">
        <span class="setting-row__label">${label}</span>
      </span>
      <span class="input-shell">
        <input
          class="text-input"
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
      </span>
      ${resolvedHint ? `<span class="setting-row__hint">${resolvedHint}</span>` : ''}
    </label>
  `
}

function renderSelectField({ label, toolId, key, value, options, hint = '' }) {
  const resolvedHint = ''
  return `
    <label class="setting-row setting-row--stack">
      <span class="setting-row__header">
        <span class="setting-row__label">${label}</span>
      </span>
      <span class="select-shell">
        <select class="text-input text-input--select" data-action="set-config-select" data-tool-id="${toolId}" data-key="${key}">
          ${options.map((option) => {
            const tuple = Array.isArray(option) ? option : [option, option]
            return `<option value="${escapeAttribute(tuple[0])}" ${tuple[0] === value ? 'selected' : ''}>${tuple[1]}</option>`
          }).join('')}
        </select>
        <span class="material-symbols-outlined select-shell__icon">expand_more</span>
      </span>
      ${resolvedHint ? `<span class="setting-row__hint">${resolvedHint}</span>` : ''}
    </label>
  `
}

function renderRangeField({ label, toolId, key, min, max, value, suffix = '', hint = '' }) {
  const resolvedHint = ''
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
      ${resolvedHint ? `<span class="setting-row__hint">${resolvedHint}</span>` : ''}
    </label>
  `
}

function renderToggleRow(label, hint, toolId, key, checked) {
  const resolvedHint = ''
  return `
    <div class="toggle-card toggle-card--compact">
      <div>
        <div class="toggle-card__label">${label}</div>
        ${resolvedHint ? `<div class="muted" style="font-size:12px;">${resolvedHint}</div>` : ''}
      </div>
      <button class="switch ${checked ? 'is-on' : ''}" data-action="toggle-config" data-tool-id="${toolId}" data-key="${key}"></button>
    </div>
  `
}

function renderInfoRow(label, hint, badge) {
  const resolvedHint = ''
  return `
    <div class="toggle-card toggle-card--compact">
      <div>
        <div class="toggle-card__label">${label}</div>
        ${resolvedHint ? `<div class="muted" style="font-size:12px;">${resolvedHint}</div>` : ''}
      </div>
      <div class="badge">${badge}</div>
    </div>
  `
}

function statCard(label, value) {
  return `
    <div class="stat-card">
      <div class="toggle-card__label">${label}</div>
      <div class="stat-card__value">${value}</div>
    </div>
  `
}

function inferUnit(value) {
  return String(value).trim().endsWith('%') ? '%' : 'px'
}

function normalizeResizeValue(value, explicitUnit) {
  const stringValue = String(value).trim()
  if (stringValue.endsWith('px') || stringValue.endsWith('%')) return stringValue
  return `${stringValue}${explicitUnit || 'px'}`
}

function estimateCompression(config) {
  if (config.mode === 'target') return `${config.targetSizeKb} KB`
  const estimated = Math.max(24, Math.round(1200 * (Number(config.quality) / 100)))
  return `${estimated} KB`
}

function getHeroCopy() {
  return ''
}

function getRangeProgress(value, min, max) {
  const current = Number(value)
  const start = Number(min)
  const end = Number(max)
  if (!Number.isFinite(current) || !Number.isFinite(start) || !Number.isFinite(end) || start === end) return 0
  return Math.max(0, Math.min(100, ((current - start) / (end - start)) * 100))
}

function escapeAttribute(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export { MANUAL_CROP_RATIOS }
