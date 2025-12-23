/**
 * Plotter controller - coordinate conversion and high-level plotting
 */

import { EBB, EBBConfig, DEFAULT_CONFIG } from './ebb';
import { AxiDrawConnection } from './connection';

// AxiDraw V3 specifications
// Steps per mm: approximately 80 (at 1/16 microstepping)
// Steps per inch: 2032
const STEPS_PER_MM = 80;

// Default paper sizes in mm
export const PAPER_SIZES = {
  '4x6': { width: 102, height: 152 },
  '6x4': { width: 152, height: 102 },
  '6x6': { width: 152, height: 152 },
  '8x8': { width: 203, height: 203 },
  '8x10': { width: 203, height: 254 },
  'A5': { width: 148, height: 210 },
  'A4': { width: 210, height: 297 },
  'Letter': { width: 216, height: 279 },
} as const;

export interface PlotterConfig extends EBBConfig {
  paperWidth: number;      // mm
  paperHeight: number;     // mm
  marginX: number;         // mm - left margin
  marginY: number;         // mm - top margin
  plotWidth: number;       // mm - actual plot area width
  plotHeight: number;      // mm - actual plot area height
  speed: number;           // 1-100 scale
  penDownLight: number;    // 0-100 pen height for lightest strokes
  penDownDark: number;     // 0-100 pen height for darkest strokes
  invertPenLift: boolean;  // Invert servo direction
}

export const DEFAULT_PLOTTER_CONFIG: PlotterConfig = {
  ...DEFAULT_CONFIG,
  paperWidth: 152,   // 6 inches
  paperHeight: 152,  // 6 inches
  marginX: 10,
  marginY: 10,
  plotWidth: 132,    // 152 - 2*10
  plotHeight: 132,
  speed: 50,
  penDownLight: 45,  // Lighter touch for bright areas
  penDownDark: 25,   // Heavier pressure for dark areas
  invertPenLift: false,
};

export type PlotterState = 'disconnected' | 'connected' | 'plotting' | 'paused';

export interface PlotterStatus {
  state: PlotterState;
  progress: number;  // 0-100
  currentSegment: number;
  totalSegments: number;
}

/**
 * High-level plotter controller
 */
export class Plotter {
  private ebb: EBB | null = null;
  private conn: AxiDrawConnection | null = null;
  private config: PlotterConfig;
  private state: PlotterState = 'disconnected';
  private abortController: AbortController | null = null;
  private pausePromise: Promise<void> | null = null;
  private pauseResolve: (() => void) | null = null;
  private progress = { current: 0, total: 0 };
  private onStatusChange: ((status: PlotterStatus) => void) | null = null;

  constructor(config: Partial<PlotterConfig> = {}) {
    this.config = { ...DEFAULT_PLOTTER_CONFIG, ...config };
  }

  /**
   * Connect to AxiDraw
   */
  async connect(conn: AxiDrawConnection): Promise<void> {
    this.conn = conn;
    this.ebb = new EBB(conn, this.config);

    // Test connection
    const version = await this.ebb.version();
    console.log('AxiDraw connected:', version);

    // Configure servo
    await this.ebb.configureServo();
    await this.ebb.enableMotors();
    
    // Lift pen to start
    await this.ebb.penUp();

    this.state = 'connected';
    this.notifyStatus();
  }

  /**
   * Disconnect from AxiDraw
   */
  async disconnect(): Promise<void> {
    if (this.ebb) {
      await this.ebb.disableMotors();
      this.ebb = null;
    }
    if (this.conn) {
      try {
        this.conn.reader.releaseLock();
        this.conn.writer.releaseLock();
        await this.conn.port.close();
      } catch (e) {
        console.warn('Error closing connection:', e);
      }
      this.conn = null;
    }
    this.state = 'disconnected';
    this.notifyStatus();
  }

  /**
   * Convert maze coordinates (0 to mazeSize) to plotter steps
   * Scales uniformly to fit plot area while preserving aspect ratio, centered
   */
  mazeToSteps(x: number, y: number, mazeWidth: number, mazeHeight: number): { x: number; y: number } {
    // Calculate uniform scale to fit while preserving aspect ratio
    const mazeAspect = mazeWidth / mazeHeight;
    const plotAspect = this.config.plotWidth / this.config.plotHeight;

    let scale: number;
    let offsetX: number;
    let offsetY: number;

    if (mazeAspect > plotAspect) {
      // Maze is wider than plot area - fit to width
      scale = this.config.plotWidth / mazeWidth;
      const scaledHeight = mazeHeight * scale;
      offsetX = 0;
      offsetY = (this.config.plotHeight - scaledHeight) / 2;
    } else {
      // Maze is taller than plot area - fit to height
      scale = this.config.plotHeight / mazeHeight;
      const scaledWidth = mazeWidth * scale;
      offsetX = (this.config.plotWidth - scaledWidth) / 2;
      offsetY = 0;
    }

    // Apply scale and centering, then add margins
    const plotX = this.config.marginX + offsetX + x * scale;
    const plotY = this.config.marginY + offsetY + y * scale;

    // Convert mm to steps
    return {
      x: Math.round(plotX * STEPS_PER_MM),
      y: Math.round(plotY * STEPS_PER_MM),
    };
  }

  /**
   * Convert stroke width (from maze) to pen height
   * Interpolates between penDownLight and penDownDark based on stroke width
   * Thicker strokes = closer to penDownDark (more pressure)
   */
  strokeToHeight(strokeWidth: number, minStroke = 0.5, maxStroke = 3): number {
    // Clamp stroke width
    const clamped = Math.max(minStroke, Math.min(maxStroke, strokeWidth));
    // Normalize to 0-1 range (0 = thinnest, 1 = thickest)
    const normalized = (clamped - minStroke) / (maxStroke - minStroke);
    // Interpolate: thin strokes → penDownLight, thick strokes → penDownDark
    const height = this.config.penDownLight - normalized * (this.config.penDownLight - this.config.penDownDark);
    return Math.round(height);
  }

  /**
   * Calculate movement duration based on distance and speed setting
   */
  calculateDuration(dx: number, dy: number): number {
    const distance = Math.sqrt(dx * dx + dy * dy);
    // Speed 1-100 maps to step rate 200-2000 steps/sec
    const stepRate = 200 + (this.config.speed / 100) * 1800;
    return Math.max(1, Math.round(distance / stepRate * 1000));
  }

  /**
   * Execute a plot job
   */
  async plot(
    segments: PlotSegment[],
    onProgress?: (status: PlotterStatus) => void
  ): Promise<void> {
    if (!this.ebb) throw new Error('Not connected');
    if (this.state === 'plotting') throw new Error('Already plotting');

    this.onStatusChange = onProgress || null;
    this.abortController = new AbortController();
    this.state = 'plotting';
    this.progress = { current: 0, total: segments.length };
    this.notifyStatus();

    try {
      // Ensure pen is up to start
      await this.ebb.penUp();

      for (let i = 0; i < segments.length; i++) {
        // Check for abort
        if (this.abortController.signal.aborted) {
          break;
        }

        // Check for pause
        if (this.pausePromise) {
          await this.pausePromise;
        }

        const segment = segments[i];
        this.progress.current = i + 1;
        this.notifyStatus();

        const pos = this.ebb.getPosition();
        const atStart = pos.x === segment.x1 && pos.y === segment.y1;

        if (!atStart) {
          // Reposition: pen up + travel to the segment start
          await this.ebb.moveToWithoutDrawing(segment.x1, segment.y1);
        }

        // Draw to end with specified pen height (keep pen down if already drawing)
        await this.ebb.lineTo(segment.x2, segment.y2, segment.penHeight);
      }

      // Return home
      await this.ebb.home();
    } finally {
      this.state = 'connected';
      this.abortController = null;
      this.onStatusChange = null;
      this.notifyStatus();
    }
  }

  /**
   * Pause plotting
   */
  pause(): void {
    if (this.state !== 'plotting') return;
    this.state = 'paused';
    this.pausePromise = new Promise(resolve => {
      this.pauseResolve = resolve;
    });
    this.notifyStatus();
  }

  /**
   * Resume plotting
   */
  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'plotting';
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pausePromise = null;
      this.pauseResolve = null;
    }
    this.notifyStatus();
  }

  /**
   * Stop plotting
   */
  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.pauseResolve) {
      this.pauseResolve();
    }
    this.state = 'connected';
    this.notifyStatus();
  }

  /**
   * Test pen at a specific height (0-100 scale)
   * 0 = maximum pressure (lowest), 100 = highest (no contact)
   */
  async testPenHeight(height: number): Promise<void> {
    if (!this.ebb) throw new Error('Not connected');
    await this.ebb.setPenHeight(height);
  }

  /**
   * Test pen up - moves to the configured pen up position
   */
  async testPenUp(): Promise<void> {
    if (!this.ebb) throw new Error('Not connected');
    await this.ebb.setPenHeight(this.config.penUpPosition);
  }

  /**
   * Test pen down at a specific height (0-100 scale)
   * 0 = maximum pressure (thickest), 100 = no contact (thinnest)
   */
  async testPenDown(height: number): Promise<void> {
    if (!this.ebb) throw new Error('Not connected');
    await this.ebb.setPenHeight(height);
  }

  /**
   * Draw a test pattern with graduated line weights
   * Draws 5 short horizontal lines interpolating from light to dark
   */
  async drawTestPattern(penDownLight: number, penDownDark: number): Promise<void> {
    if (!this.ebb) throw new Error('Not connected');

    // Pattern parameters (in mm, converted to steps)
    const startX = 20 * STEPS_PER_MM;  // 20mm from left
    const startY = 20 * STEPS_PER_MM;  // 20mm from top
    const lineLength = 30 * STEPS_PER_MM;  // 30mm lines
    const lineSpacing = 8 * STEPS_PER_MM;  // 8mm between lines

    // 5 lines interpolating from light to dark
    const steps = 5;

    await this.ebb.penUp();

    for (let i = 0; i < steps; i++) {
      // Interpolate from light (i=0) to dark (i=steps-1)
      const t = i / (steps - 1);
      const height = Math.round(penDownLight - t * (penDownLight - penDownDark));
      const y = startY + i * lineSpacing;

      // Move to line start
      await this.ebb.moveTo(startX, y);

      // Set pen height and lower
      await this.ebb.setPenHeight(height);

      // Draw line
      await this.ebb.moveTo(startX + lineLength, y);

      // Lift pen
      await this.ebb.penUp();
    }

    // Return home
    await this.ebb.home();
  }

  /**
   * Test plot bounds - traces the outline of the plot area with pen lifted
   * Useful for verifying paper placement before plotting
   */
  async testBounds(): Promise<void> {
    if (!this.ebb) throw new Error('Not connected');

    // Calculate corner positions in steps
    const left = this.config.marginX * STEPS_PER_MM;
    const top = this.config.marginY * STEPS_PER_MM;
    const right = (this.config.marginX + this.config.plotWidth) * STEPS_PER_MM;
    const bottom = (this.config.marginY + this.config.plotHeight) * STEPS_PER_MM;

    // Ensure pen is up
    await this.ebb.penUp();

    // Trace the rectangle: top-left → top-right → bottom-right → bottom-left → top-left
    await this.ebb.moveTo(left, top);
    await this.ebb.moveTo(right, top);
    await this.ebb.moveTo(right, bottom);
    await this.ebb.moveTo(left, bottom);
    await this.ebb.moveTo(left, top);

    // Return home
    await this.ebb.home();
  }

  /**
   * Move to home position
   */
  async goHome(): Promise<void> {
    if (!this.ebb) throw new Error('Not connected');
    await this.ebb.home();
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<PlotterConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.ebb) {
      this.ebb.setConfig(config);
    }
  }

  getConfig(): PlotterConfig {
    return { ...this.config };
  }

  getState(): PlotterState {
    return this.state;
  }

  getStatus(): PlotterStatus {
    return {
      state: this.state,
      progress: this.progress.total > 0
        ? Math.round((this.progress.current / this.progress.total) * 100)
        : 0,
      currentSegment: this.progress.current,
      totalSegments: this.progress.total,
    };
  }

  private notifyStatus(): void {
    if (this.onStatusChange) {
      this.onStatusChange(this.getStatus());
    }
  }
}

/**
 * A segment to plot (already converted to plotter coordinates)
 */
export interface PlotSegment {
  x1: number;  // steps
  y1: number;  // steps
  x2: number;  // steps
  y2: number;  // steps
  penHeight: number;  // 0-100
}
