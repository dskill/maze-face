export interface MazeParameters {
  seed: number
  complexity: number
  contrast: number
  lineWidth: number
}

export interface DensityMap {
  width: number
  height: number
  cells: Float32Array
}

export interface Cell {
  x: number
  y: number
  walls: {
    north: boolean
    east: boolean
    south: boolean
    west: boolean
  }
  visited: boolean
  density: number
}

export interface MazeGrid {
  width: number
  height: number
  cells: Cell[][]
  entranceX: number
  exitX: number
}

export interface Point {
  x: number
  y: number
}

export interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Path {
  points: Point[]
}
