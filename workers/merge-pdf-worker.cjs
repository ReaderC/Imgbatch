const fs = require('fs')
const os = require('os')
const path = require('path')

const CPU_COUNT = Math.max(1, os.cpus()?.length || 1)
const ALPHA_CAPABLE_FORMATS = new Set(['png', 'webp', 'tiff', 'avif', 'gif', 'ico'])
const PDF_PAGE_SIZES = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
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

function getPerformanceProfile(mode) {
  const normalized = mode === 'compatible' || mode === 'balanced' || mode === 'max' ? mode : 'balanced'
  if (normalized === 'compatible') {
    return { heavyConcurrency: Math.max(1, Math.min(3, Math.floor(CPU_COUNT / 6) || 1)), sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.5) || 1)), cacheMemory: Math.min(256, Math.max(96, CPU_COUNT * 8)), cacheItems: Math.max(32, CPU_COUNT * 4) }
  }
  if (normalized === 'max') {
    return { heavyConcurrency: Math.max(1, Math.min(8, Math.floor(CPU_COUNT / 3) || 1)), sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.9) || 1)), cacheMemory: Math.min(768, Math.max(160, CPU_COUNT * 24)), cacheItems: Math.max(96, CPU_COUNT * 12) }
  }
  return { heavyConcurrency: Math.max(1, Math.min(6, Math.floor(CPU_COUNT / 4) || 1)), sharpConcurrency: Math.max(1, Math.min(CPU_COUNT, Math.floor(CPU_COUNT * 0.75) || 1)), cacheMemory: Math.min(512, Math.max(128, CPU_COUNT * 16)), cacheItems: Math.max(64, CPU_COUNT * 8) }
}

function postProgress(detail) {
  if (typeof process.send === 'function') {
    process.send({ type: 'progress', detail })
  }
}

function mapWithConcurrency(items, concurrency, worker) {
  const source = Array.isArray(items) ? items : []
  const limit = Math.max(1, Math.min(source.length || 1, concurrency || 1))
  if (source.length <= 1 || limit <= 1) {
    return Promise.all(source.map((item, index) => worker(item, index)))
  }
  const results = new Array(source.length)
  let nextIndex = 0
  const runners = Array.from({ length: limit }, async () => {
    while (nextIndex < source.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(source[currentIndex], currentIndex)
    }
  })
  return Promise.all(runners).then(() => results)
}

async function run() {
  const sharp = require('sharp')
  const pdfLib = require('pdf-lib')
  const message = await new Promise((resolve) => {
    process.once('message', resolve)
  })
  const payload = message?.payload || null
  const performanceMode = message?.performanceMode || 'balanced'
  if (!payload?.destinationPath) throw new Error('Missing destination path')

  const profile = getPerformanceProfile(performanceMode)
  sharp.concurrency(profile.sharpConcurrency)
  sharp.cache({ memory: profile.cacheMemory, items: profile.cacheItems, files: 0 })

  const outputPath = path.join(payload.destinationPath, 'merged.pdf')
  const pdf = await pdfLib.PDFDocument.create()
  const background = hexToRgbaObject(payload.config?.background || '#ffffff', 1)
  const backgroundColor = pdfLib.rgb(background.r / 255, background.g / 255, background.b / 255)
  const prepareConcurrency = Math.max(1, Math.min((payload.assets || []).length, Math.min(profile.heavyConcurrency, 3)))
  const fixedPageSize = payload.config?.pageSize === 'Original'
    ? null
    : (PDF_PAGE_SIZES[payload.config?.pageSize] || PDF_PAGE_SIZES.A4)
  const autoPaginateFixedPage = Boolean(payload.config?.autoPaginate && fixedPageSize)
  const fixedMargin = fixedPageSize
    ? (payload.config?.margin === 'none'
      ? 0
      : payload.config?.margin === 'wide'
        ? Math.round(fixedPageSize[0] * 0.08)
        : payload.config?.margin === 'normal'
          ? Math.round(fixedPageSize[0] * 0.06)
          : Math.round(fixedPageSize[0] * 0.04))
    : null
  const fixedDrawableWidth = fixedPageSize ? Math.max(1, fixedPageSize[0] - fixedMargin * 2) : 0
  const fixedDrawableHeight = fixedPageSize ? Math.max(1, fixedPageSize[1] - fixedMargin * 2) : 0

  const paintPdfPageBackground = (page, pageSize) => {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageSize[0],
      height: pageSize[1],
      color: backgroundColor,
    })
  }

  let preparedCount = 0
  postProgress({
    phase: 'merge-pdf-prepare',
    total: Math.max(1, (payload.assets || []).length),
    completed: 0,
    succeeded: 0,
    failed: 0,
  })

  const prepareAsset = async (asset) => {
    const imageBytes = fs.readFileSync(asset.sourcePath)
    let metadata = null
    try {
      metadata = await sharp(asset.sourcePath).metadata()
    } catch {
      metadata = null
    }
    let sourceFormat = normalizeImageFormatName(metadata?.format || asset.inputFormat || asset.ext || path.extname(asset.sourcePath).replace('.', ''))
    let sourceWidth = Math.max(1, Number(metadata?.width) || Number(asset.width) || 1)
    let sourceHeight = Math.max(1, Number(metadata?.height) || Number(asset.height) || 1)
    const margin = fixedMargin ?? (payload.config?.margin === 'none'
      ? 0
      : payload.config?.margin === 'wide'
        ? Math.round(sourceWidth * 0.08)
        : payload.config?.margin === 'normal'
          ? Math.round(sourceWidth * 0.06)
          : Math.round(sourceWidth * 0.04))

    const prepared = {
      imageBytes,
      sourcePath: asset.sourcePath,
      sourceFormat,
      sourceWidth,
      sourceHeight,
      margin,
      drawableWidth: 0,
      drawableHeight: 0,
      scaledWidth: 0,
      scaledHeight: 0,
      pageSliceHeight: 0,
      scaledBuffer: null,
      embeddedBytes: null,
      embeddedKind: '',
      requiresSlicing: false,
    }

    if (sourceFormat !== 'png' && sourceFormat !== 'jpg' && sourceFormat !== 'jpeg') {
      const embeddedKind = isAlphaCapableFormat(sourceFormat) ? 'png' : 'jpg'
      prepared.embeddedBytes = embeddedKind === 'png'
        ? await sharp(asset.sourcePath).png().toBuffer()
        : await sharp(asset.sourcePath).jpeg().toBuffer()
      prepared.embeddedKind = embeddedKind
    }

    if (autoPaginateFixedPage) {
      prepared.drawableWidth = fixedDrawableWidth
      prepared.drawableHeight = fixedDrawableHeight
      prepared.scaledWidth = fixedDrawableWidth
      prepared.pageSliceHeight = fixedDrawableHeight
      prepared.scaledHeight = Math.max(1, Math.round(sourceHeight * (prepared.scaledWidth / sourceWidth)))
      prepared.requiresSlicing = prepared.scaledHeight > prepared.drawableHeight
      if (prepared.requiresSlicing) {
        prepared.scaledBuffer = await sharp(asset.sourcePath)
          .resize({ width: prepared.scaledWidth, fit: 'fill' })
          .png()
          .toBuffer()
      }
    }

    preparedCount += 1
    postProgress({
      phase: 'merge-pdf-prepare',
      total: Math.max(1, (payload.assets || []).length),
      completed: preparedCount,
      succeeded: 0,
      failed: 0,
    })
    return prepared
  }

  const preparedAssets = (payload.assets || []).length === 1
    ? [await prepareAsset(payload.assets[0])]
    : await mapWithConcurrency(payload.assets || [], prepareConcurrency, prepareAsset)

  postProgress({
    phase: 'merge-pdf-write',
    total: Math.max(1, preparedAssets.length),
    completed: 0,
    succeeded: 0,
    failed: 0,
  })

  let writtenCount = 0
  for (const prepared of preparedAssets) {
    const { imageBytes } = prepared
    let embedded = null
    let sourceWidth = prepared.sourceWidth
    let sourceHeight = prepared.sourceHeight
    const ensureEmbedded = async () => {
      if (embedded) return embedded
      try {
        if (prepared.embeddedKind === 'png' && prepared.embeddedBytes) {
          embedded = await pdf.embedPng(prepared.embeddedBytes)
        } else if (prepared.embeddedKind === 'jpg' && prepared.embeddedBytes) {
          embedded = await pdf.embedJpg(prepared.embeddedBytes)
        } else if (prepared.sourceFormat === 'png') {
          embedded = await pdf.embedPng(imageBytes)
        } else if (prepared.sourceFormat === 'jpg' || prepared.sourceFormat === 'jpeg') {
          embedded = await pdf.embedJpg(imageBytes)
        } else {
          embedded = await pdf.embedPng(prepared.embeddedBytes || await sharp(prepared.sourcePath).png().toBuffer())
        }
      } catch {
        const fallbackKind = isAlphaCapableFormat(prepared.sourceFormat) ? 'png' : 'jpg'
        if (fallbackKind === 'png') {
          prepared.embeddedBytes = await sharp(prepared.sourcePath).png().toBuffer()
          prepared.embeddedKind = 'png'
          embedded = await pdf.embedPng(prepared.embeddedBytes)
        } else {
          prepared.embeddedBytes = await sharp(prepared.sourcePath).jpeg().toBuffer()
          prepared.embeddedKind = 'jpg'
          embedded = await pdf.embedJpg(prepared.embeddedBytes)
        }
      }
      sourceWidth = Math.max(1, sourceWidth || embedded.width || 1)
      sourceHeight = Math.max(1, sourceHeight || embedded.height || 1)
      return embedded
    }

    const margin = prepared.margin
    if (!fixedPageSize) {
      const originalImage = await ensureEmbedded()
      const pageSize = [originalImage.width + margin * 2, originalImage.height + margin * 2]
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
      page.drawImage(originalImage, { x: margin, y: margin, width: originalImage.width, height: originalImage.height })
      writtenCount += 1
      postProgress({ phase: 'merge-pdf-write', total: Math.max(1, preparedAssets.length), completed: writtenCount, succeeded: 0, failed: 0 })
      continue
    }

    const pageSize = fixedPageSize
    const drawableWidth = prepared.drawableWidth || fixedDrawableWidth
    const drawableHeight = prepared.drawableHeight || fixedDrawableHeight

    if (!payload.config?.autoPaginate) {
      const pageImage = await ensureEmbedded()
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
      const scale = Math.min(drawableWidth / pageImage.width, drawableHeight / pageImage.height)
      const width = pageImage.width * scale
      const height = pageImage.height * scale
      page.drawImage(pageImage, { x: (pageSize[0] - width) / 2, y: (pageSize[1] - height) / 2, width, height })
      writtenCount += 1
      postProgress({ phase: 'merge-pdf-write', total: Math.max(1, preparedAssets.length), completed: writtenCount, succeeded: 0, failed: 0 })
      continue
    }

    const scaledWidth = prepared.scaledWidth || drawableWidth
    const pageSliceHeight = prepared.pageSliceHeight || drawableHeight
    const scaledHeight = prepared.scaledHeight || Math.max(1, Math.round(sourceHeight * (scaledWidth / sourceWidth)))

    if (prepared.requiresSlicing === false || scaledHeight <= drawableHeight) {
      const pageImage = await ensureEmbedded()
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
      page.drawImage(pageImage, { x: margin, y: (pageSize[1] - scaledHeight) / 2, width: scaledWidth, height: scaledHeight })
      writtenCount += 1
      postProgress({ phase: 'merge-pdf-write', total: Math.max(1, preparedAssets.length), completed: writtenCount, succeeded: 0, failed: 0 })
      continue
    }

    const scaledBuffer = prepared.scaledBuffer || await sharp(prepared.sourcePath)
      .resize({ width: scaledWidth, fit: 'fill' })
      .png()
      .toBuffer()
    const scaledImage = sharp(scaledBuffer)
    let offsetY = 0
    while (offsetY < scaledHeight) {
      const sliceHeight = Math.min(pageSliceHeight, scaledHeight - offsetY)
      const sliceBuffer = await scaledImage.clone()
        .extract({ left: 0, top: offsetY, width: scaledWidth, height: sliceHeight })
        .png()
        .toBuffer()
      const pageImage = await pdf.embedPng(sliceBuffer)
      const page = pdf.addPage(pageSize)
      paintPdfPageBackground(page, pageSize)
      page.drawImage(pageImage, {
        x: margin,
        y: pageSize[1] - margin - pageImage.height,
        width: pageImage.width,
        height: pageImage.height,
      })
      offsetY += sliceHeight
    }
    writtenCount += 1
    postProgress({ phase: 'merge-pdf-write', total: Math.max(1, preparedAssets.length), completed: writtenCount, succeeded: 0, failed: 0 })
  }

  const bytes = await pdf.save()
  fs.mkdirSync(payload.destinationPath, { recursive: true })
  fs.writeFileSync(outputPath, bytes)
  return {
    outputPath,
    outputSizeBytes: bytes.length,
    width: fixedPageSize?.[0] || 0,
    height: fixedPageSize?.[1] || 0,
  }
}

run()
  .then((result) => {
    if (typeof process.send === 'function') {
      process.send({ type: 'result', result })
    }
    process.exit(0)
  })
  .catch((error) => {
    if (typeof process.send === 'function') {
      process.send({
        type: 'error',
        error: error?.message || 'PDF merge failed',
        code: error?.code || '',
      })
    }
    process.exit(error?.code === 'RUN_CANCELLED' ? 1 : 2)
  })
