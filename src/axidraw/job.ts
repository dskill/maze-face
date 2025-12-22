/**
 * Plot job generator - converts maze data to plotter segments
 */

import { Plotter, PlotSegment } from './plotter';

// Re-export for convenience
export type { PlotSegment };

/**
 * Maze node structure (matching App.tsx)
 */
export interface MazeNode {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rawBrightness: number;
  visited: boolean;
  neighbors: { node: MazeNode; side: string; mid: { x: number; y: number } }[];
  connections: Map<MazeNode, { x: number; y: number }>;
}

export interface MazeData {
  nodes: MazeNode[];
  solution: MazeNode[];
  startNode: MazeNode | null;
  endNode: MazeNode | null;
  width: number;
  height: number;
}

interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  brightness: number;
}

/**
 * Generate plot segments from maze data
 */
export function generatePlotJob(
  mazeData: MazeData,
  plotter: Plotter,
  options: {
    wallThickness?: number;
    shadingIntensity?: number;
    minStroke?: number;
    maxStroke?: number;
  } = {}
): PlotSegment[] {
  const {
    wallThickness = 1.2,
    shadingIntensity = 2.0,
    minStroke = 0.5,
    maxStroke = 3,
  } = options;

  // First, extract all wall segments with their brightness
  const walls = extractWalls(mazeData);

  // Sort walls for optimal plotting path (minimize travel)
  const sortedWalls = optimizePath(walls);

  // Convert to plot segments with plotter coordinates
  const segments: PlotSegment[] = [];

  for (const wall of sortedWalls) {
    const start = plotter.mazeToSteps(wall.x1, wall.y1, mazeData.width, mazeData.height);
    const end = plotter.mazeToSteps(wall.x2, wall.y2, mazeData.width, mazeData.height);

    // Calculate stroke width based on brightness
    const strokeWidth = calculateStrokeWidth(wall.brightness, wallThickness, shadingIntensity);
    const penHeight = plotter.strokeToHeight(strokeWidth, minStroke, maxStroke);

    segments.push({
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      penHeight,
    });
  }

  return segments;
}

/**
 * Extract wall segments from maze data
 * Based on renderMaze logic in App.tsx
 */
function extractWalls(mazeData: MazeData): WallSegment[] {
  const walls: WallSegment[] = [];
  const { nodes } = mazeData;

  for (const node of nodes) {
    const { x, y, w, h, rawBrightness, neighbors, connections } = node;

    // Check each side for walls
    const sides = ['top', 'right', 'bottom', 'left'];

    for (const side of sides) {
      // Find neighbor on this side
      const neighborInfo = neighbors.find(n => n.side === side);

      // Draw wall if:
      // 1. No neighbor on this side (edge of maze), OR
      // 2. Has neighbor but no connection (wall not removed by maze algorithm)
      const hasNeighbor = neighborInfo !== undefined;
      const hasConnection = hasNeighbor && connections.has(neighborInfo.node);

      if (!hasNeighbor || !hasConnection) {
        // Calculate wall endpoints based on side
        let x1: number, y1: number, x2: number, y2: number;

        switch (side) {
          case 'top':
            x1 = x;
            y1 = y;
            x2 = x + w;
            y2 = y;
            break;
          case 'right':
            x1 = x + w;
            y1 = y;
            x2 = x + w;
            y2 = y + h;
            break;
          case 'bottom':
            x1 = x;
            y1 = y + h;
            x2 = x + w;
            y2 = y + h;
            break;
          case 'left':
            x1 = x;
            y1 = y;
            x2 = x;
            y2 = y + h;
            break;
          default:
            continue;
        }

        walls.push({
          x1,
          y1,
          x2,
          y2,
          brightness: rawBrightness,
        });
      }
    }
  }

  // Remove duplicate walls (shared edges)
  return deduplicateWalls(walls);
}

/**
 * Remove duplicate walls (when two cells share an edge, both will report the wall)
 */
function deduplicateWalls(walls: WallSegment[]): WallSegment[] {
  const seen = new Set<string>();
  const unique: WallSegment[] = [];

  for (const wall of walls) {
    // Normalize wall direction (always left-to-right or top-to-bottom)
    let x1 = wall.x1, y1 = wall.y1, x2 = wall.x2, y2 = wall.y2;
    if (x1 > x2 || (x1 === x2 && y1 > y2)) {
      [x1, x2] = [x2, x1];
      [y1, y2] = [y2, y1];
    }

    const key = `${x1},${y1}-${x2},${y2}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({ ...wall, x1, y1, x2, y2 });
    }
  }

  return unique;
}

/**
 * Optimize path to minimize pen travel (greedy nearest neighbor)
 */
function optimizePath(walls: WallSegment[]): WallSegment[] {
  if (walls.length === 0) return [];

  const result: WallSegment[] = [];
  const remaining = [...walls];

  // Start from origin
  let currentX = 0;
  let currentY = 0;

  while (remaining.length > 0) {
    // Find nearest wall endpoint
    let nearestIdx = 0;
    let nearestDist = Infinity;
    let useReverse = false;

    for (let i = 0; i < remaining.length; i++) {
      const wall = remaining[i];

      // Check distance to wall start
      const dist1 = Math.hypot(wall.x1 - currentX, wall.y1 - currentY);
      if (dist1 < nearestDist) {
        nearestDist = dist1;
        nearestIdx = i;
        useReverse = false;
      }

      // Check distance to wall end
      const dist2 = Math.hypot(wall.x2 - currentX, wall.y2 - currentY);
      if (dist2 < nearestDist) {
        nearestDist = dist2;
        nearestIdx = i;
        useReverse = true;
      }
    }

    // Add wall to result
    const wall = remaining.splice(nearestIdx, 1)[0];
    if (useReverse) {
      // Swap endpoints to minimize travel
      result.push({
        ...wall,
        x1: wall.x2,
        y1: wall.y2,
        x2: wall.x1,
        y2: wall.y1,
      });
      currentX = wall.x1;
      currentY = wall.y1;
    } else {
      result.push(wall);
      currentX = wall.x2;
      currentY = wall.y2;
    }
  }

  return result;
}

/**
 * Calculate stroke width based on brightness
 * Based on getWallThickness in App.tsx
 */
function calculateStrokeWidth(
  brightness: number,
  wallThickness: number,
  shadingIntensity: number
): number {
  // Darker areas = thicker lines
  const darkness = 1 - brightness / 255;
  return wallThickness * (1 + darkness * shadingIntensity);
}

/**
 * Estimate plot time in seconds
 */
export function estimatePlotTime(
  segments: PlotSegment[],
  speedPercent: number = 50
): number {
  if (segments.length === 0) return 0;

  // Speed 1-100 maps to step rate 200-2000 steps/sec
  const stepRate = 200 + (speedPercent / 100) * 1800;

  let totalSteps = 0;
  let lastX = 0;
  let lastY = 0;

  for (const seg of segments) {
    // Travel to start
    totalSteps += Math.hypot(seg.x1 - lastX, seg.y1 - lastY);
    // Draw segment
    totalSteps += Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    lastX = seg.x2;
    lastY = seg.y2;
  }

  // Add pen up/down time (approx 0.3s each)
  const penMoves = segments.length * 2;
  const penTime = penMoves * 0.3;

  return totalSteps / stepRate + penTime;
}

/**
 * Format time as human readable string
 */
export function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}
