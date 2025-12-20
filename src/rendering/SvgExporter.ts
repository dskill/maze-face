import type { MazeGrid, Point } from '../types'

interface SvgLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

function extractWalls(maze: MazeGrid): SvgLine[] {
  const lines: SvgLine[] = []
  const cellWidth = 1
  const cellHeight = 1

  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      const cell = maze.cells[y][x]
      const left = x * cellWidth
      const top = y * cellHeight

      if (cell.walls.north) {
        lines.push({
          x1: left,
          y1: top,
          x2: left + cellWidth,
          y2: top,
        })
      }
      if (cell.walls.west) {
        lines.push({
          x1: left,
          y1: top,
          x2: left,
          y2: top + cellHeight,
        })
      }
      // East wall only on rightmost column
      if (x === maze.width - 1 && cell.walls.east) {
        lines.push({
          x1: left + cellWidth,
          y1: top,
          x2: left + cellWidth,
          y2: top + cellHeight,
        })
      }
      // South wall only on bottom row
      if (y === maze.height - 1 && cell.walls.south) {
        lines.push({
          x1: left,
          y1: top + cellHeight,
          x2: left + cellWidth,
          y2: top + cellHeight,
        })
      }
    }
  }

  return lines
}

// Merge collinear connected lines into paths
function mergeLines(lines: SvgLine[]): Point[][] {
  // Build adjacency map of endpoints
  const pointKey = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`

  // Group lines by their endpoints
  const endpointMap = new Map<string, SvgLine[]>()
  for (const line of lines) {
    const k1 = pointKey(line.x1, line.y1)
    const k2 = pointKey(line.x2, line.y2)
    if (!endpointMap.has(k1)) endpointMap.set(k1, [])
    if (!endpointMap.has(k2)) endpointMap.set(k2, [])
    endpointMap.get(k1)!.push(line)
    endpointMap.get(k2)!.push(line)
  }

  const used = new Set<SvgLine>()
  const paths: Point[][] = []

  for (const line of lines) {
    if (used.has(line)) continue

    // Start a new path
    const path: Point[] = [
      { x: line.x1, y: line.y1 },
      { x: line.x2, y: line.y2 },
    ]
    used.add(line)

    // Try to extend in both directions
    let extended = true
    while (extended) {
      extended = false

      // Try to extend from end
      const endKey = pointKey(path[path.length - 1].x, path[path.length - 1].y)
      const endCandidates = endpointMap.get(endKey) || []
      for (const candidate of endCandidates) {
        if (used.has(candidate)) continue

        // Check if collinear with last segment
        const lastDir = getDirection(path[path.length - 2], path[path.length - 1])
        let nextPoint: Point | null = null

        if (
          Math.abs(candidate.x1 - path[path.length - 1].x) < 0.0001 &&
          Math.abs(candidate.y1 - path[path.length - 1].y) < 0.0001
        ) {
          nextPoint = { x: candidate.x2, y: candidate.y2 }
        } else {
          nextPoint = { x: candidate.x1, y: candidate.y1 }
        }

        const nextDir = getDirection(path[path.length - 1], nextPoint)
        if (lastDir === nextDir) {
          path.push(nextPoint)
          used.add(candidate)
          extended = true
          break
        }
      }

      // Try to extend from start
      const startKey = pointKey(path[0].x, path[0].y)
      const startCandidates = endpointMap.get(startKey) || []
      for (const candidate of startCandidates) {
        if (used.has(candidate)) continue

        const firstDir = getDirection(path[1], path[0])
        let prevPoint: Point | null = null

        if (
          Math.abs(candidate.x1 - path[0].x) < 0.0001 &&
          Math.abs(candidate.y1 - path[0].y) < 0.0001
        ) {
          prevPoint = { x: candidate.x2, y: candidate.y2 }
        } else {
          prevPoint = { x: candidate.x1, y: candidate.y1 }
        }

        const prevDir = getDirection(path[0], prevPoint)
        if (firstDir === prevDir) {
          path.unshift(prevPoint)
          used.add(candidate)
          extended = true
          break
        }
      }
    }

    // Simplify path by removing collinear middle points
    const simplified: Point[] = [path[0]]
    for (let i = 1; i < path.length - 1; i++) {
      const dir1 = getDirection(path[i - 1], path[i])
      const dir2 = getDirection(path[i], path[i + 1])
      if (dir1 !== dir2) {
        simplified.push(path[i])
      }
    }
    simplified.push(path[path.length - 1])

    paths.push(simplified)
  }

  return paths
}

function getDirection(from: Point, to: Point): 'h' | 'v' | 'd' {
  const dx = Math.abs(to.x - from.x)
  const dy = Math.abs(to.y - from.y)
  if (dy < 0.0001) return 'h'
  if (dx < 0.0001) return 'v'
  return 'd'
}

// Greedy path ordering to minimize pen travel
function optimizePathOrder(paths: Point[][]): Point[][] {
  if (paths.length === 0) return []

  const ordered: Point[][] = []
  const remaining = new Set(paths)
  let currentEnd = { x: 0, y: 0 }

  while (remaining.size > 0) {
    let nearest: Point[] | null = null
    let nearestDist = Infinity
    let shouldReverse = false

    for (const path of remaining) {
      const startDist = distance(currentEnd, path[0])
      const endDist = distance(currentEnd, path[path.length - 1])

      if (startDist < nearestDist) {
        nearest = path
        nearestDist = startDist
        shouldReverse = false
      }
      if (endDist < nearestDist) {
        nearest = path
        nearestDist = endDist
        shouldReverse = true
      }
    }

    if (nearest) {
      if (shouldReverse) nearest.reverse()
      ordered.push(nearest)
      currentEnd = nearest[nearest.length - 1]
      remaining.delete(nearest)
    }
  }

  return ordered
}

function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

export function exportSvg(
  maze: MazeGrid,
  strokeWidth: number = 0.5,
  outputSizeMm: number = 100
): string {
  const walls = extractWalls(maze)
  const paths = mergeLines(walls)
  const optimized = optimizePathOrder(paths)

  const precision = 4
  const viewBoxWidth = maze.width
  const viewBoxHeight = maze.height

  // Scale stroke width relative to viewBox
  const scaledStroke = (strokeWidth / outputSizeMm) * viewBoxWidth

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${outputSizeMm}mm"
     height="${outputSizeMm}mm"
     viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
  <g fill="none" stroke="black" stroke-width="${scaledStroke.toFixed(precision)}" stroke-linecap="round" stroke-linejoin="round">
`

  for (const path of optimized) {
    if (path.length === 2) {
      // Simple line
      svg += `    <line x1="${path[0].x.toFixed(precision)}" y1="${path[0].y.toFixed(precision)}" x2="${path[1].x.toFixed(precision)}" y2="${path[1].y.toFixed(precision)}"/>\n`
    } else {
      // Polyline path
      const d = path
        .map(
          (pt, i) =>
            `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(precision)},${pt.y.toFixed(precision)}`
        )
        .join(' ')
      svg += `    <path d="${d}"/>\n`
    }
  }

  svg += `  </g>
</svg>`

  return svg
}
