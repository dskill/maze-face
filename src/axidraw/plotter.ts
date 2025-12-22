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
  'A4': { width: 210, height: 297 },
  'A5': { width: 148, height: 210 },
  'Letter': { width: 216, height: 279 },
  '6x6': { width: 152, height: 152 },
  '8x8': { width: 203, height: 203 },
  '8x10': { width: 203, height: 254 },
} as const;

export interface PlotterConfig extends EBBConfig {
  paperWidth: number;      // mm
  paperHeight: number;     // mm
  marginX: number;         // mm - left margin
  marginY: number;         // mm - top margin
  plotWidth: number;       // mm - actual plot area width
  plotHeight: number;      // mm - actual plot area height
  speed: number;           // 1-100 scale
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
   */
  mazeToSteps(x: number, y: number, mazeWidth: number, mazeHeight: number): { x: number; y: number } {
    // Scale maze coords to plot area in mm
    const plotX = this.config.marginX + (x / mazeWidth) * this.config.plotWidth;
    const plotY = this.config.marginY + (y / mazeHeight) * this.config.plotHeight;

    // Convert mm to steps
    return {
      x: Math.round(plotX * STEPS_PER_MM),
      y: Math.round(plotY * STEPS_PER_MM),
    };
  }

  /**
   * Convert stroke width (from maze) to pen height
   * Thicker strokes = lower pen height = more pressure
   */
  strokeToHeight(strokeWidth: number, minStroke = 0.5, maxStroke = 3): number {
    // Clamp stroke width
    const clamped = Math.max(minStroke, Math.min(maxStroke, strokeWidth));
    // Normalize to 0-1 range
    const normalized = (clamped - minStroke) / (maxStroke - minStroke);
    // Invert: thick strokes (high normalized) = low height (more pressure)
    // Map to 20-60 range (leaving room at extremes)
    return Math.round(60 - normalized * 40);
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
      // Ensure pen is up and at home
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

        // Move to start (pen up)
        await this.ebb.moveToWithoutDrawing(segment.x1, segment.y1);

        // Draw to end with specified pen height
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
   * Test pen up
   */
  async testPenUp(): Promise<void> {
    if (!this.ebb) throw new Error('Not connected');
    await this.ebb.penUp();
  }

  /**
   * Test pen down
   */
  async testPenDown(): Promise<void> {
    if (!this.ebb) throw new Error('Not connected');
    await this.ebb.penDown();
  }

  /**
   * Test pen at a specific height (0-100 scale)
   * Use this to preview line thickness positions
   * 0 = maximum pressure (thickest), 100 = no contact (thinnest)
   */
  async testPenHeight(height: number): Promise<void> {
    if (!this.ebb) throw new Error('Not connected');
    await this.ebb.setPenHeight(height);
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
