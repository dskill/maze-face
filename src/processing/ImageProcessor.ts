export interface ImageProcessingParams {
  brightness: number    // -100 to 100
  contrast: number      // 0.5 to 3.0
  levels: {
    black: number       // 0 to 255 - input black point
    white: number       // 0 to 255 - input white point
    gamma: number       // 0.5 to 2.0
  }
  invert: boolean
}

export const defaultImageParams: ImageProcessingParams = {
  brightness: 0,
  contrast: 1.0,
  levels: {
    black: 0,
    white: 255,
    gamma: 1.0
  },
  invert: false
}

export function processImage(
  pixels: Uint8ClampedArray,
  _width: number,
  _height: number,
  params: ImageProcessingParams
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(pixels.length)

  for (let i = 0; i < pixels.length; i += 4) {
    // Get RGB
    let r = pixels[i]
    let g = pixels[i + 1]
    let b = pixels[i + 2]
    const a = pixels[i + 3]

    // Convert to grayscale first (luminance)
    let gray = 0.299 * r + 0.587 * g + 0.114 * b

    // Apply levels - input range mapping
    const { black, white, gamma } = params.levels
    const range = Math.max(1, white - black)
    gray = (gray - black) / range * 255
    gray = Math.max(0, Math.min(255, gray))

    // Apply gamma
    gray = 255 * Math.pow(gray / 255, gamma)

    // Apply brightness
    gray = gray + params.brightness * 2.55

    // Apply contrast
    gray = ((gray - 128) * params.contrast) + 128

    // Clamp
    gray = Math.max(0, Math.min(255, gray))

    // Invert if requested
    if (params.invert) {
      gray = 255 - gray
    }

    result[i] = gray
    result[i + 1] = gray
    result[i + 2] = gray
    result[i + 3] = a
  }

  return result
}

// Auto-levels: stretch histogram to use full range
export function autoLevels(
  pixels: Uint8ClampedArray,
  percentile: number = 1
): { black: number; white: number } {
  // Build histogram
  const histogram = new Array(256).fill(0)
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2])
    histogram[gray]++
  }

  const totalPixels = pixels.length / 4
  const threshold = totalPixels * percentile / 100

  // Find black point (percentile from dark end)
  let count = 0
  let black = 0
  for (let i = 0; i < 256; i++) {
    count += histogram[i]
    if (count >= threshold) {
      black = i
      break
    }
  }

  // Find white point (percentile from light end)
  count = 0
  let white = 255
  for (let i = 255; i >= 0; i--) {
    count += histogram[i]
    if (count >= threshold) {
      white = i
      break
    }
  }

  return { black, white }
}
