import type { DensityMap } from '../types'

export function createDensityMap(
  imageData: ImageData,
  gridWidth: number,
  gridHeight: number
): DensityMap {
  const { width: imgWidth, height: imgHeight, data } = imageData
  const cells = new Float32Array(gridWidth * gridHeight)

  const cellPixelWidth = imgWidth / gridWidth
  const cellPixelHeight = imgHeight / gridHeight

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      // Sample the corresponding region of the image
      const startX = Math.floor(gx * cellPixelWidth)
      const endX = Math.floor((gx + 1) * cellPixelWidth)
      const startY = Math.floor(gy * cellPixelHeight)
      const endY = Math.floor((gy + 1) * cellPixelHeight)

      let sum = 0
      let count = 0

      for (let py = startY; py < endY; py++) {
        for (let px = startX; px < endX; px++) {
          const i = (py * imgWidth + px) * 4
          // Already grayscale from preprocessing, just use R channel
          sum += data[i]
          count++
        }
      }

      // Average brightness (0-255), then invert and normalize to 0-1
      // Dark areas = high density (more walls), Light areas = low density (fewer walls)
      const avgBrightness = count > 0 ? sum / count : 128
      const density = 1 - avgBrightness / 255

      cells[gy * gridWidth + gx] = density
    }
  }

  return { width: gridWidth, height: gridHeight, cells }
}

export function getDensity(map: DensityMap, x: number, y: number): number {
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
    return 0.5
  }
  return map.cells[y * map.width + x]
}

// Get average density for a region
export function getRegionDensity(
  map: DensityMap,
  x: number,
  y: number,
  radius: number = 1
): number {
  let sum = 0
  let count = 0

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
        sum += map.cells[ny * map.width + nx]
        count++
      }
    }
  }

  return count > 0 ? sum / count : 0.5
}
