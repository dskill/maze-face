import type { DensityMap, MazeGrid, Cell } from '../types'
import { SeededRandom } from '../utils/seedRandom'
import { getDensity } from '../processing/DensityMap'

type Direction = 'north' | 'south' | 'east' | 'west'

const DIRECTIONS: Direction[] = ['north', 'south', 'east', 'west']
const DX: Record<Direction, number> = { north: 0, south: 0, east: 1, west: -1 }
const DY: Record<Direction, number> = { north: -1, south: 1, east: 0, west: 0 }
const OPPOSITE: Record<Direction, Direction> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
}

export interface MazeGenParams {
  seed: number
  wallRemovalStrength: number  // 0-1: how aggressively to remove walls in light areas
  extraWallsStrength: number   // 0-1: how much to add complexity in dark areas
}

function createCell(x: number, y: number, density: number): Cell {
  return {
    x,
    y,
    walls: { north: true, east: true, south: true, west: true },
    visited: false,
    density,
  }
}

function removeWall(cell: Cell, neighbor: Cell, dir: Direction) {
  cell.walls[dir] = false
  neighbor.walls[OPPOSITE[dir]] = false
}

export function generateMaze(
  densityMap: DensityMap,
  seed: number,
  params?: Partial<MazeGenParams>
): MazeGrid {
  const fullParams: MazeGenParams = {
    seed,
    wallRemovalStrength: params?.wallRemovalStrength ?? 0.7,
    extraWallsStrength: params?.extraWallsStrength ?? 0.5,
  }

  const rng = new SeededRandom(seed)
  const width = densityMap.width
  const height = densityMap.height

  // Initialize grid
  const cells: Cell[][] = []
  for (let y = 0; y < height; y++) {
    cells[y] = []
    for (let x = 0; x < width; x++) {
      cells[y][x] = createCell(x, y, getDensity(densityMap, x, y))
    }
  }

  // Entrance and exit positions (centered)
  const entranceX = Math.floor(width / 2)
  const exitX = Math.floor(width / 2)

  // Phase 1: Generate base maze using Growing Tree
  generateBaseMaze(cells, width, height, entranceX, rng)

  // Phase 2: Remove walls in light areas to create visible density variation
  removeWallsInLightAreas(cells, width, height, fullParams, rng)

  // Phase 3: Add extra complexity in dark areas
  addExtraComplexity(cells, width, height, fullParams, rng)

  // Ensure entrance and exit are open
  cells[0][entranceX].walls.north = false
  cells[height - 1][exitX].walls.south = false

  return { width, height, cells, entranceX, exitX }
}

function generateBaseMaze(
  cells: Cell[][],
  width: number,
  height: number,
  entranceX: number,
  rng: SeededRandom
): void {
  const active: Cell[] = []
  const start = cells[0][entranceX]
  start.visited = true
  active.push(start)

  while (active.length > 0) {
    // Prefer newest cell (creates longer passages)
    const index = rng.next() < 0.75 ? active.length - 1 : rng.nextInt(0, active.length)
    const current = active[index]

    // Find unvisited neighbors
    const neighbors: { cell: Cell; dir: Direction }[] = []
    for (const dir of DIRECTIONS) {
      const nx = current.x + DX[dir]
      const ny = current.y + DY[dir]
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const neighbor = cells[ny][nx]
        if (!neighbor.visited) {
          neighbors.push({ cell: neighbor, dir })
        }
      }
    }

    if (neighbors.length > 0) {
      // Slight preference for lower density (lighter) areas
      const weights = neighbors.map((n) => 1 - n.cell.density * 0.3)
      const chosen = rng.weightedPick(neighbors, weights)
      removeWall(current, chosen.cell, chosen.dir)
      chosen.cell.visited = true
      active.push(chosen.cell)
    } else {
      active.splice(index, 1)
    }
  }
}

function removeWallsInLightAreas(
  cells: Cell[][],
  width: number,
  height: number,
  params: MazeGenParams,
  rng: SeededRandom
): void {
  // Remove walls in light areas to create open spaces
  // The lighter the area, the more walls we remove

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y][x]
      const density = cell.density

      // Only remove walls in lighter areas (density < 0.5)
      if (density >= 0.5) continue

      // Probability of removing a wall scales with lightness
      const lightness = 1 - density  // 0.5 to 1.0
      const removalProb = (lightness - 0.5) * 2 * params.wallRemovalStrength

      // Try to remove internal walls
      const dirs: Direction[] = rng.shuffle([...DIRECTIONS])

      for (const dir of dirs) {
        if (!cell.walls[dir]) continue  // Already open

        const nx = x + DX[dir]
        const ny = y + DY[dir]

        // Don't remove border walls
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue

        // Don't create too many 2x2 open areas (preserve maze character)
        if (wouldCreateLargeOpen(cells, x, y, dir, width, height)) continue

        if (rng.next() < removalProb) {
          removeWall(cell, cells[ny][nx], dir)
          break  // Only remove one wall per cell
        }
      }
    }
  }
}

function wouldCreateLargeOpen(
  cells: Cell[][],
  x: number,
  y: number,
  dir: Direction,
  width: number,
  height: number
): boolean {
  // Check if removing this wall would create a 2x2 open area
  // This helps preserve maze structure while still opening light areas

  const nx = x + DX[dir]
  const ny = y + DY[dir]

  if (dir === 'east' || dir === 'west') {
    // Check above and below
    for (const checkY of [y - 1, y]) {
      if (checkY < 0 || checkY >= height - 1) continue
      const topLeft = cells[checkY][Math.min(x, nx)]
      const topRight = cells[checkY][Math.max(x, nx)]

      // If internal walls are already open, don't create 2x2 open area
      if (!topLeft.walls.south && !topLeft.walls.east && !topRight.walls.south) {
        return true
      }
    }
  } else {
    // Check left and right
    for (const checkX of [x - 1, x]) {
      if (checkX < 0 || checkX >= width - 1) continue
      const topLeft = cells[Math.min(y, ny)][checkX]
      const topRight = cells[Math.min(y, ny)][checkX + 1]

      if (!topLeft.walls.east && !topLeft.walls.south && !topRight.walls.south) {
        return true
      }
    }
  }

  return false
}

function addExtraComplexity(
  cells: Cell[][],
  width: number,
  height: number,
  params: MazeGenParams,
  rng: SeededRandom
): void {
  // In dark areas, we want MORE walls visible
  // Since the base maze is already generated, we add "blocking" walls
  // that create more dead-ends and complexity

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const cell = cells[y][x]
      const density = cell.density

      // Only add complexity in dark areas (density > 0.6)
      if (density <= 0.6) continue

      const darkness = density  // 0.6 to 1.0
      const addProb = (darkness - 0.6) * 2.5 * params.extraWallsStrength

      if (rng.next() < addProb) {
        // Try to add a wall that creates a dead-end
        // by finding an open passage and partially blocking it
        const openDirs = DIRECTIONS.filter(d => !cell.walls[d])

        if (openDirs.length >= 3) {
          // Cell has 3+ open sides, can safely add a wall
          const dirToClose = rng.pick(openDirs)
          const nx = x + DX[dirToClose]
          const ny = y + DY[dirToClose]

          if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1) {
            const neighbor = cells[ny][nx]
            // Make sure neighbor still has at least 2 open sides after
            const neighborOpen = DIRECTIONS.filter(d => !neighbor.walls[d]).length
            if (neighborOpen >= 2) {
              cell.walls[dirToClose] = true
              neighbor.walls[OPPOSITE[dirToClose]] = true
            }
          }
        }
      }
    }
  }
}
