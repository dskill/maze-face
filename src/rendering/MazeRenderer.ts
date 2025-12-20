import type p5 from 'p5'
import type { MazeGrid } from '../types'

export function renderMaze(p: p5, maze: MazeGrid): void {
  const cellWidth = p.width / maze.width
  const cellHeight = p.height / maze.height

  p.stroke(0)
  p.strokeWeight(1)

  // Draw cell walls
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      const cell = maze.cells[y][x]
      const left = x * cellWidth
      const top = y * cellHeight

      if (cell.walls.north) {
        p.line(left, top, left + cellWidth, top)
      }
      if (cell.walls.west) {
        p.line(left, top, left, top + cellHeight)
      }
      // East wall only on rightmost column
      if (x === maze.width - 1 && cell.walls.east) {
        p.line(left + cellWidth, top, left + cellWidth, top + cellHeight)
      }
      // South wall only on bottom row
      if (y === maze.height - 1 && cell.walls.south) {
        p.line(left, top + cellHeight, left + cellWidth, top + cellHeight)
      }
    }
  }

  // Draw entrance and exit markers
  p.fill(0, 150, 0)
  p.noStroke()
  const entranceX = maze.entranceX * cellWidth + cellWidth / 2
  p.triangle(
    entranceX - 5,
    -2,
    entranceX + 5,
    -2,
    entranceX,
    cellHeight / 3
  )

  p.fill(150, 0, 0)
  const exitX = maze.exitX * cellWidth + cellWidth / 2
  const exitY = maze.height * cellHeight
  p.triangle(
    exitX - 5,
    exitY + 2,
    exitX + 5,
    exitY + 2,
    exitX,
    exitY - cellHeight / 3
  )
}
