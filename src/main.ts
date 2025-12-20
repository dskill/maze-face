import p5 from 'p5'
import type { DensityMap, MazeGrid } from './types'
import { processImage, autoLevels, defaultImageParams, type ImageProcessingParams } from './processing/ImageProcessor'
import { createDensityMap } from './processing/DensityMap'
import { generateMaze, type MazeGenParams } from './maze/MazeGenerator'
import { renderMaze } from './rendering/MazeRenderer'
import { exportSvg } from './rendering/SvgExporter'

// State
let sourceImage: p5.Image | null = null
let processedPixels: Uint8ClampedArray | null = null
let densityMap: DensityMap | null = null
let maze: MazeGrid | null = null

// Parameters
let imageParams: ImageProcessingParams = { ...defaultImageParams }
let mazeParams: MazeGenParams = {
  seed: 12345,
  wallRemovalStrength: 0.7,
  extraWallsStrength: 0.5,
}
let complexity = 50
let lineWidth = 0.5

// Debounce helper
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeout: number | undefined
  return (...args: Parameters<T>) => {
    clearTimeout(timeout)
    timeout = window.setTimeout(() => fn(...args), delay)
  }
}

// p5 instances
let previewP5: p5
let mazeP5: p5

// Preview sketch - shows processed image
const previewSketch = (p: p5) => {
  p.setup = () => {
    const container = document.getElementById('preview-container')!
    const size = Math.min(container.clientWidth, 400)
    p.createCanvas(size, size)
    p.pixelDensity(1)
    p.noLoop()
  }

  p.draw = () => {
    p.background(245)
    if (processedPixels && sourceImage) {
      // Draw the processed grayscale image
      const imgWidth = sourceImage.width
      const imgHeight = sourceImage.height
      const pg = p.createGraphics(imgWidth, imgHeight)
      pg.pixelDensity(1)
      pg.loadPixels()
      for (let i = 0; i < processedPixels.length; i++) {
        pg.pixels[i] = processedPixels[i]
      }
      pg.updatePixels()

      // Scale to fit canvas
      const imgScale = Math.min(p.width / imgWidth, p.height / imgHeight)
      const w = imgWidth * imgScale
      const h = imgHeight * imgScale
      const x = (p.width - w) / 2
      const y = (p.height - h) / 2
      p.image(pg, x, y, w, h)
    } else if (sourceImage) {
      const imgScale = Math.min(p.width / sourceImage.width, p.height / sourceImage.height)
      const w = sourceImage.width * imgScale
      const h = sourceImage.height * imgScale
      const x = (p.width - w) / 2
      const y = (p.height - h) / 2
      p.image(sourceImage, x, y, w, h)
    } else {
      p.fill(150)
      p.noStroke()
      p.textAlign(p.CENTER, p.CENTER)
      p.textSize(14)
      p.text('Upload an image', p.width / 2, p.height / 2)
    }
  }
}

// Maze sketch - shows generated maze
const mazeSketch = (p: p5) => {
  p.setup = () => {
    const container = document.getElementById('maze-container')!
    const size = Math.min(container.clientWidth, 400)
    p.createCanvas(size, size)
    p.pixelDensity(1)
    p.noLoop()
  }

  p.draw = () => {
    p.background(255)
    if (maze) {
      renderMaze(p, maze)
    } else {
      p.fill(150)
      p.noStroke()
      p.textAlign(p.CENTER, p.CENTER)
      p.textSize(14)
      p.text('Maze will appear here', p.width / 2, p.height / 2)
    }
  }
}

function processSourceImage() {
  if (!sourceImage) return

  // Get raw pixels from source image
  sourceImage.loadPixels()
  const rawPixels = new Uint8ClampedArray(sourceImage.pixels)

  // Apply image processing
  processedPixels = processImage(
    rawPixels,
    sourceImage.width,
    sourceImage.height,
    imageParams
  )

  previewP5.redraw()
}

function regenerateMaze() {
  if (!sourceImage || !processedPixels) return

  // Create density map from processed pixels
  const imageData = new ImageData(
    processedPixels,
    sourceImage.width,
    sourceImage.height
  )

  densityMap = createDensityMap(imageData, complexity, complexity)

  // Generate maze
  maze = generateMaze(densityMap, mazeParams.seed, mazeParams)

  mazeP5.redraw()

  // Enable export button
  const exportBtn = document.getElementById('export-btn') as HTMLButtonElement
  exportBtn.disabled = false
}

const debouncedProcessAndGenerate = debounce(() => {
  processSourceImage()
  regenerateMaze()
}, 150)

const debouncedGenerate = debounce(regenerateMaze, 150)

function handleImageLoad(img: p5.Image) {
  sourceImage = img
  processSourceImage()
  regenerateMaze()
}

function setupUI() {
  // File input
  const fileInput = document.getElementById('file-input') as HTMLInputElement
  fileInput.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      previewP5.loadImage(url, (img) => {
        URL.revokeObjectURL(url)
        handleImageLoad(img)
      })
    }
  })

  // Camera button
  const cameraBtn = document.getElementById('camera-btn')!
  cameraBtn.addEventListener('click', () => {
    fileInput.setAttribute('capture', 'environment')
    fileInput.click()
    fileInput.removeAttribute('capture')
  })

  // Image processing controls
  const brightnessInput = document.getElementById('brightness') as HTMLInputElement
  const brightnessValue = document.getElementById('brightness-value')!
  brightnessInput.addEventListener('input', () => {
    imageParams.brightness = parseInt(brightnessInput.value, 10)
    brightnessValue.textContent = imageParams.brightness.toString()
    debouncedProcessAndGenerate()
  })

  const imgContrastInput = document.getElementById('img-contrast') as HTMLInputElement
  const imgContrastValue = document.getElementById('img-contrast-value')!
  imgContrastInput.addEventListener('input', () => {
    imageParams.contrast = parseInt(imgContrastInput.value, 10) / 100
    imgContrastValue.textContent = imageParams.contrast.toFixed(1)
    debouncedProcessAndGenerate()
  })

  const blackPointInput = document.getElementById('black-point') as HTMLInputElement
  const blackPointValue = document.getElementById('black-point-value')!
  blackPointInput.addEventListener('input', () => {
    imageParams.levels.black = parseInt(blackPointInput.value, 10)
    blackPointValue.textContent = imageParams.levels.black.toString()
    debouncedProcessAndGenerate()
  })

  const whitePointInput = document.getElementById('white-point') as HTMLInputElement
  const whitePointValue = document.getElementById('white-point-value')!
  whitePointInput.addEventListener('input', () => {
    imageParams.levels.white = parseInt(whitePointInput.value, 10)
    whitePointValue.textContent = imageParams.levels.white.toString()
    debouncedProcessAndGenerate()
  })

  const gammaInput = document.getElementById('gamma') as HTMLInputElement
  const gammaValue = document.getElementById('gamma-value')!
  gammaInput.addEventListener('input', () => {
    imageParams.levels.gamma = parseInt(gammaInput.value, 10) / 100
    gammaValue.textContent = imageParams.levels.gamma.toFixed(1)
    debouncedProcessAndGenerate()
  })

  const invertInput = document.getElementById('invert') as HTMLInputElement
  invertInput.addEventListener('change', () => {
    imageParams.invert = invertInput.checked
    debouncedProcessAndGenerate()
  })

  // Auto levels button
  const autoLevelsBtn = document.getElementById('auto-levels')!
  autoLevelsBtn.addEventListener('click', () => {
    if (sourceImage) {
      sourceImage.loadPixels()
      const levels = autoLevels(new Uint8ClampedArray(sourceImage.pixels))
      imageParams.levels.black = levels.black
      imageParams.levels.white = levels.white
      blackPointInput.value = levels.black.toString()
      blackPointValue.textContent = levels.black.toString()
      whitePointInput.value = levels.white.toString()
      whitePointValue.textContent = levels.white.toString()
      debouncedProcessAndGenerate()
    }
  })

  // Maze controls
  const seedInput = document.getElementById('seed') as HTMLInputElement
  seedInput.addEventListener('change', () => {
    mazeParams.seed = parseInt(seedInput.value, 10) || 0
    debouncedGenerate()
  })

  const randomSeedBtn = document.getElementById('random-seed')!
  randomSeedBtn.addEventListener('click', () => {
    mazeParams.seed = Math.floor(Math.random() * 1000000)
    seedInput.value = mazeParams.seed.toString()
    debouncedGenerate()
  })

  const complexityInput = document.getElementById('complexity') as HTMLInputElement
  const complexityValue = document.getElementById('complexity-value')!
  complexityInput.addEventListener('input', () => {
    complexity = parseInt(complexityInput.value, 10)
    complexityValue.textContent = complexity.toString()
    debouncedGenerate()
  })

  const wallRemovalInput = document.getElementById('wall-removal') as HTMLInputElement
  const wallRemovalValue = document.getElementById('wall-removal-value')!
  wallRemovalInput.addEventListener('input', () => {
    mazeParams.wallRemovalStrength = parseInt(wallRemovalInput.value, 10) / 100
    wallRemovalValue.textContent = mazeParams.wallRemovalStrength.toFixed(1)
    debouncedGenerate()
  })

  const extraWallsInput = document.getElementById('extra-walls') as HTMLInputElement
  const extraWallsValue = document.getElementById('extra-walls-value')!
  extraWallsInput.addEventListener('input', () => {
    mazeParams.extraWallsStrength = parseInt(extraWallsInput.value, 10) / 100
    extraWallsValue.textContent = mazeParams.extraWallsStrength.toFixed(1)
    debouncedGenerate()
  })

  // Export controls
  const lineWidthInput = document.getElementById('line-width') as HTMLInputElement
  const lineWidthValue = document.getElementById('line-width-value')!
  lineWidthInput.addEventListener('input', () => {
    lineWidth = parseInt(lineWidthInput.value, 10) / 10
    lineWidthValue.textContent = lineWidth.toFixed(1)
  })

  const exportBtn = document.getElementById('export-btn')!
  exportBtn.addEventListener('click', () => {
    if (maze) {
      const svg = exportSvg(maze, lineWidth)
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mazeface-${mazeParams.seed}.svg`
      a.click()
      URL.revokeObjectURL(url)
    }
  })
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  previewP5 = new p5(previewSketch, document.getElementById('preview-container')!)
  mazeP5 = new p5(mazeSketch, document.getElementById('maze-container')!)
  setupUI()
})
