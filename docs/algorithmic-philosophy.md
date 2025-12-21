# Contour Labyrinth

## Algorithmic Philosophy

The human face is not a grid. It flows—cheekbones curve into shadows, eyes nestle in orbits of bone, lips arc between expression and stillness. A maze that seeks to capture likeness must abandon the tyranny of the orthogonal and instead embrace the topology of flesh. This is Contour Labyrinth: where the maze becomes a living map of the face itself.

The foundation lies in **edge-aware flow fields**. Rather than forcing walls onto a rigid grid, we derive vector fields from the portrait's gradient—the mathematical representation of where light meets shadow, where features emerge from flatness. These gradients become the invisible rivers that guide our maze walls. In the valleys of dark pixels, passages compress and multiply; across the bright planes of forehead and cheek, the labyrinth opens into sparse, wandering paths. The meticulously crafted algorithm must compute Sobel or Scharr gradients to find edge direction, then use these vectors to warp the maze's underlying coordinate system.

**Organic deformation through layered noise** transforms mechanical precision into something that breathes. Every wall segment, every junction, receives perturbation from multiple octaves of Perlin noise—calibrated with painstaking care so that the macro structure follows the face while micro-details dance with life. The result: walls that seem hand-drawn, corners that soften into curves, dead-ends that spiral rather than terminate abruptly. A master-level implementation layers noise at different scales—large-scale warping for overall face-following, medium-scale for organic flow, fine-scale for pen-like texture.

The critical insight is **density as tone**. Traditional halftoning uses dots; we use maze complexity. Where the portrait is dark—pupils, nostrils, the shadow beneath the chin—the maze becomes a dense tangle of short walls and tight passages, creating visual weight through ink accumulation. Where light falls—highlights on the brow, the gleam of an eye—walls stretch long and sparse, passages widen, the labyrinth nearly dissolves. This is not simply removing walls; it is modulating wall length, passage width, junction frequency, and dead-end depth as continuous functions of local brightness.

Finally, **contour-aware path routing** ensures the maze honors the face's architecture. Major facial features—the edge of the jaw, the arc of eyebrows, the outline of lips—should align with primary maze passages or walls. Edge detection identifies these contours; the algorithm then biases path generation to flow along them rather than crossing perpendicular. The solution path itself might trace the profile, invisible yet structurally present. Every parameter refined through countless iterations, every threshold calibrated by someone at the absolute top of computational aesthetics.

## Implementation Techniques for Mazeface

### 1. Gradient-Based Coordinate Warping

```typescript
// Compute image gradients (Sobel operator)
function computeGradients(densityMap: DensityMap): { gx: Float32Array, gy: Float32Array } {
  const gx = new Float32Array(densityMap.width * densityMap.height)
  const gy = new Float32Array(densityMap.width * densityMap.height)

  for (let y = 1; y < densityMap.height - 1; y++) {
    for (let x = 1; x < densityMap.width - 1; x++) {
      // Sobel kernels for edge detection
      const idx = y * densityMap.width + x
      gx[idx] = (
        -getDensity(map, x-1, y-1) + getDensity(map, x+1, y-1) +
        -2*getDensity(map, x-1, y) + 2*getDensity(map, x+1, y) +
        -getDensity(map, x-1, y+1) + getDensity(map, x+1, y+1)
      ) / 4
      gy[idx] = (
        -getDensity(map, x-1, y-1) - 2*getDensity(map, x, y-1) - getDensity(map, x+1, y-1) +
        getDensity(map, x-1, y+1) + 2*getDensity(map, x, y+1) + getDensity(map, x+1, y+1)
      ) / 4
    }
  }
  return { gx, gy }
}

// Warp grid points based on gradients
function warpPoint(x: number, y: number, gradients, strength: number): {x: number, y: number} {
  const gx = sampleGradient(gradients.gx, x, y)
  const gy = sampleGradient(gradients.gy, x, y)
  // Perpendicular to gradient = along contour
  return {
    x: x + (-gy) * strength,
    y: y + gx * strength
  }
}
```

### 2. Organic Line Deformation with Noise

```typescript
// Deform wall segments with multi-octave noise
function deformWall(
  x1: number, y1: number,
  x2: number, y2: number,
  seed: number,
  params: { amplitude: number, frequency: number, octaves: number }
): Point[] {
  const points: Point[] = []
  const segments = Math.ceil(distance(x1, y1, x2, y2) * 3) // More points for curves

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    let x = lerp(x1, x2, t)
    let y = lerp(y1, y2, t)

    // Perpendicular direction for displacement
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.sqrt(dx*dx + dy*dy) || 1
    const perpX = -dy / len
    const perpY = dx / len

    // Multi-octave noise displacement
    let displacement = 0
    let amp = params.amplitude
    let freq = params.frequency
    for (let oct = 0; oct < params.octaves; oct++) {
      displacement += noise(x * freq + seed, y * freq) * amp
      amp *= 0.5
      freq *= 2
    }
    displacement -= params.amplitude * 0.5 // Center around zero

    points.push({
      x: x + perpX * displacement,
      y: y + perpY * displacement
    })
  }
  return points
}
```

### 3. Variable Passage Width Based on Brightness

```typescript
// Instead of uniform cell size, modulate based on density
function getCellSize(x: number, y: number, baseDensity: number): { width: number, height: number } {
  const density = getDensity(densityMap, x, y)

  // Light areas: larger cells (fewer walls visible)
  // Dark areas: smaller cells (more walls visible)
  const minScale = 0.6
  const maxScale = 1.4
  const scale = lerp(maxScale, minScale, density)

  return {
    width: baseCellSize * scale,
    height: baseCellSize * scale
  }
}
```

### 4. Edge-Aligned Wall Placement

```typescript
// Detect major contours and align maze walls to them
function computeContourField(densityMap: DensityMap): Float32Array {
  const angles = new Float32Array(densityMap.width * densityMap.height)
  const { gx, gy } = computeGradients(densityMap)

  for (let i = 0; i < angles.length; i++) {
    // Gradient direction = perpendicular to edge
    // We want walls to align WITH edges, not across them
    angles[i] = Math.atan2(gy[i], gx[i]) + Math.PI / 2
  }
  return angles
}

// When generating maze, bias direction choices toward contour alignment
function selectDirection(cell, neighbors, contourAngle: number): Direction {
  const dirAngles = {
    north: -Math.PI/2,
    south: Math.PI/2,
    east: 0,
    west: Math.PI
  }

  // Weight directions by how well they align with local contour
  const weights = neighbors.map(n => {
    const dirAngle = dirAngles[n.dir]
    const alignment = Math.cos(dirAngle - contourAngle)
    return 1 + alignment * contourAlignmentStrength
  })

  return weightedRandomSelect(neighbors, weights)
}
```

### 5. Density-Modulated Wall Length

```typescript
// In dark areas: many short walls (dense texture)
// In light areas: few long walls (sparse texture)
function shouldSubdivideWall(x: number, y: number, wallLength: number): boolean {
  const density = getDensity(densityMap, x, y)

  // High density = prefer short walls = subdivide more
  const subdivisionThreshold = lerp(3.0, 0.8, density)
  return wallLength > subdivisionThreshold
}

function shouldRemoveWall(x: number, y: number): boolean {
  const density = getDensity(densityMap, x, y)
  const rng = seededRandom(x * 1000 + y)

  // Low density = higher chance of wall removal
  return rng > density * 1.5
}
```

### 6. Curved Walls via Bezier Paths

```typescript
// Replace straight walls with gentle curves
function wallToBezier(x1, y1, x2, y2, curvature: number, seed: number): string {
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2

  // Perpendicular offset for control point
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx*dx + dy*dy)
  const perpX = -dy / len
  const perpY = dx / len

  // Noise-based offset
  const offset = (noise(midX * 0.1 + seed, midY * 0.1) - 0.5) * curvature * len

  const ctrlX = midX + perpX * offset
  const ctrlY = midY + perpY * offset

  return `M${x1},${y1} Q${ctrlX},${ctrlY} ${x2},${y2}`
}
```

## Key Parameters to Add

| Parameter | Range | Effect |
|-----------|-------|--------|
| `warpStrength` | 0-2 | How much gradients warp the grid |
| `noiseAmplitude` | 0-0.5 | Organic wiggle in wall lines |
| `noiseFrequency` | 0.01-0.1 | Scale of the wiggle pattern |
| `contourAlignment` | 0-1 | How much walls follow face edges |
| `curvature` | 0-1 | Straight walls vs bezier curves |
| `minCellScale` | 0.5-1 | Smallest cell size in dark areas |
| `maxCellScale` | 1-2 | Largest cell size in light areas |

## Recommended Implementation Order

1. **Add gradient computation** to DensityMap.ts
2. **Implement coordinate warping** in MazeGenerator.ts
3. **Add wall deformation** in SvgExporter.ts (post-process the paths)
4. **Add curvature parameter** to convert straight lines to bezier curves
5. **Tune parameters** until the likeness emerges
