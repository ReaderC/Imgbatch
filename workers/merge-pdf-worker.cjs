const fs = require('fs')
const os = require('os')

const { writeMergePdfAssetCore } = require('../lib/merge-pdf-core.cjs')

const CPU_COUNT = Math.max(1, os.cpus()?.length || 1)
const ALPHA_CAPABLE_FORMATS = new Set(['png', 'webp', 'tiff', 'avif', 'gif', 'ico'])
const PERFORMANCE_MODES = new Set(['compatible', 'balanced', 'max'])

function getPerformanceProfile(mode) {
  const normalized = PERFORMANCE_MODES.has(mode) ? mode : 'balanced'
  if (normalized === 'compatible') {
    return {
      heavyConcurrency: Math.max(1, Math.min(3, Math.floor(CPU_COUNT / 6) || 1)),
      sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.5) || 1)),
      cacheMemory: Math.min(256, Math.max(96, CPU_COUNT * 8)),
      cacheItems: Math.max(32, CPU_COUNT * 4),
    }
  }
  if (normalized === 'max') {
    return {
      heavyConcurrency: Math.max(1, Math.min(8, Math.floor(CPU_COUNT / 3) || 1)),
      sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.9) || 1)),
      cacheMemory: Math.min(768, Math.max(160, CPU_COUNT * 24)),
      cacheItems: Math.max(96, CPU_COUNT * 12),
    }
  }
  return {
    heavyConcurrency: Math.max(1, Math.min(6, Math.floor(CPU_COUNT / 4) || 1)),
    sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.75) || 1)),
    cacheMemory: Math.min(512, Math.max(128, CPU_COUNT * 16)),
    cacheItems: Math.max(64, CPU_COUNT * 8),
  }
}

function normalizeImageFormatName(format) {
  const normalized = String(format || '').trim().toLowerCase()
  if (normalized === 'jpg') return 'jpeg'
  if (normalized === 'tif') return 'tiff'
  return normalized
}

function isAlphaCapableFormat(format) {
  return ALPHA_CAPABLE_FORMATS.has(normalizeImageFormatName(format))
}

function hexToRgbaObject(value, alpha = 1) {
  const color = String(value || '#ffffff').trim().replace('#', '')
  const normalized = color.length === 3 ? color.split('').map((item) => item + item).join('') : color.padEnd(6, 'f').slice(0, 6)
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    alpha,
  }
}

async function getAssetInputFormat(sharpLib, asset) {
  const metadata = await sharpLib(asset.sourcePath).metadata()
  asset.inputMetadata = metadata
  const format = normalizeImageFormatName(metadata?.format || asset.inputFormat || asset.ext)
  asset.inputFormat = format
  return format
}

async function getAssetMetadata(sharpLib, asset) {
  if (asset?.inputMetadata) return asset.inputMetadata
  const metadata = await sharpLib(asset.sourcePath).metadata()
  asset.inputMetadata = metadata
  return metadata
}

function createTransformer(sharpLib, asset) {
  return sharpLib(asset.sourcePath)
}

function throwIfRunCancelled() {}

process.on('message', async (message) => {
  if (!message || message.type !== 'start') return
  try {
    const sharpLib = require('sharp')
    const pdfLib = require('pdf-lib')
    const performanceMode = message.performanceMode || 'balanced'
    const profile = getPerformanceProfile(performanceMode)
    sharpLib.concurrency(profile.sharpConcurrency)
    sharpLib.cache({ memory: profile.cacheMemory, items: profile.cacheItems, files: 0 })
    const result = await writeMergePdfAssetCore({
      sharpLib,
      pdfLib,
      payload: message.payload,
      getPerformanceProfile,
      performanceMode,
      hexToRgbaObject,
      normalizeImageFormatName,
      isAlphaCapableFormat,
      getAssetInputFormat,
      getAssetMetadata,
      createTransformer,
      throwIfRunCancelled,
    })
    if (typeof process.send === 'function') {
      process.send({ type: 'result', result })
    }
    process.exit(0)
  } catch (error) {
    if (typeof process.send === 'function') {
      process.send({
        type: 'error',
        error: error?.message || 'PDF 合并失败',
        code: error?.code || '',
      })
    }
    process.exit(1)
  }
})
