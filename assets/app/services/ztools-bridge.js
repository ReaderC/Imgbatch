export function hasBridge() {
  return typeof window !== 'undefined' && !!window.imgbatch
}

export async function importItems(items) {
  if (hasBridge()) {
    return window.imgbatch.loadInputs(items)
  }

  return browserImportItems(items)
}

export async function savePreset(toolId, preset) {
  if (!hasBridge()) return []
  return window.imgbatch.savePreset(toolId, preset)
}

export async function loadPresets(toolId) {
  if (!hasBridge()) return []
  return window.imgbatch.loadPresets(toolId)
}

export async function runTool(toolId, config, assets, destinationPath) {
  if (!hasBridge()) {
    return {
      ok: false,
      toolId,
      config,
      assets,
      destinationPath,
      message: `处理占位：${toolId} 尚未接入宿主执行管线`,
    }
  }

  return window.imgbatch.runTool(toolId, config, assets, destinationPath)
}

export async function getLaunchInputs() {
  if (!hasBridge() || typeof window.imgbatch.getLaunchInputs !== 'function') return []
  return window.imgbatch.getLaunchInputs()
}

export function subscribeLaunchInputs(callback) {
  if (!hasBridge() || typeof window.imgbatch.subscribeLaunchInputs !== 'function') return false
  return window.imgbatch.subscribeLaunchInputs(callback)
}

export function getEnvironment() {
  if (!hasBridge()) {
    return {
      appName: 'Browser',
      isWindows: false,
      isMacOS: false,
      isLinux: false,
    }
  }

  return window.imgbatch.getEnvironment()
}

async function browserImportItems(items = []) {
  const files = items.filter((item) => item instanceof File && item.type.startsWith('image/'))
  return Promise.all(files.map(readBrowserFileMeta))
}

async function readBrowserFileMeta(file, index) {
  const thumbnailUrl = URL.createObjectURL(file)
  const dimensions = await readImageDimensions(thumbnailUrl)
  return {
    id: `browser-${index}-${crypto.randomUUID()}`,
    sourcePath: file.name,
    name: file.name,
    ext: file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'image',
    sizeBytes: file.size,
    width: dimensions.width,
    height: dimensions.height,
    thumbnailUrl,
    status: 'idle',
    outputPath: '',
    error: '',
    selected: false,
    overrides: {},
  }
}

function readImageDimensions(src) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ width: 0, height: 0 })
    image.src = src
  })
}
