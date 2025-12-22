/**
 * EBB (EiBotBoard) command interface for AxiDraw
 * Reference: https://evil-mad.github.io/EggBot/ebb.html
 *
 * Key command mapping:
 * - SC,4 = Servo_Min register, used by SP,1 (pen UP)
 * - SC,5 = Servo_Max register, used by SP,0 (pen DOWN)
 * - S2,pos,pin,rate = Direct servo positioning (bypasses SP state machine)
 */

import { AxiDrawConnection, sendCommand } from './connection';

// Servo position units are in 1/12MHz increments (~83.3ns)
// Standard RC servo range is ~1ms to ~2ms
// 1ms = 12000 units
// 2ms = 24000 units
// Smaller values = shorter pulse
// Larger values = longer pulse
const SERVO_MIN = 12000;  // ~1ms pulse (Standard 'Up' for AxiDraw)
const SERVO_MAX = 24000;  // ~2ms pulse (Standard 'Down' for AxiDraw)

// Pen servo is on RB1 (pin 1) on AxiDraw
const PEN_SERVO_PIN = 1;

export interface EBBConfig {
  penUpPosition: number;    // 0-100 scale (100 = highest)
  penDownLight: number;     // 0-100 scale for light strokes
  penDownDark: number;      // 0-100 scale for dark strokes
  servoRate: number;        // Rate of pen movement (higher = faster)
  stepRate: number;         // Steps per second for movement
  invertPenLift: boolean;   // Invert servo direction
}

export const DEFAULT_CONFIG: EBBConfig = {
  penUpPosition: 70,
  penDownLight: 45,
  penDownDark: 25,
  servoRate: 150,
  stepRate: 1000,
  invertPenLift: false,
};

/**
 * EBB command builder and executor
 */
export class EBB {
  private conn: AxiDrawConnection;
  private config: EBBConfig;
  private currentPenUp: boolean = true;
  private currentPenHeight: number = 70;
  private currentX: number = 0;
  private currentY: number = 0;

  constructor(conn: AxiDrawConnection, config: Partial<EBBConfig> = {}) {
    this.conn = conn;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentPenHeight = this.config.penUpPosition;
  }

  /**
   * Convert 0-100 scale to servo position units
   */
  private getServoPos(height: number): number {
    const clamped = Math.max(0, Math.min(100, height));
    
    // Default: High height (100) -> SERVO_MIN (12000)
    //          Low height (0)   -> SERVO_MAX (24000)
    
    if (this.config.invertPenLift) {
      // Inverted: High height (100) -> SERVO_MAX (24000)
      return Math.round(SERVO_MIN + (clamped / 100) * (SERVO_MAX - SERVO_MIN));
    } else {
      // Standard: High height (100) -> SERVO_MIN (12000)
      return Math.round(SERVO_MIN + (100 - clamped) / 100 * (SERVO_MAX - SERVO_MIN));
    }
  }

  /**
   * Set the pen height using SC + SP, which is widely supported/reliable.
   * This works by updating the target register and then commanding the pen state machine.
   */
  private async setPenHeightViaSP(height: number, duration = 500): Promise<void> {
    const pos = this.getServoPos(height);

    // Treat any height >= configured up position as "up"
    const isUp = height >= this.config.penUpPosition;

    if (isUp) {
      // SC,4 = Servo_Min; SP,1 moves to Servo_Min
      await sendCommand(this.conn, `SC,4,${pos}`);
      await sendCommand(this.conn, `SP,1,${duration}`);
      this.currentPenUp = true;
    } else {
      // SC,5 = Servo_Max; SP,0 moves to Servo_Max
      await sendCommand(this.conn, `SC,5,${pos}`);
      await sendCommand(this.conn, `SP,0,${duration}`);
      this.currentPenUp = false;
    }

    this.currentPenHeight = height;
    await this.delay(duration);
  }

  /**
   * Query firmware version
   */
  async version(): Promise<string> {
    return sendCommand(this.conn, 'V');
  }

  /**
   * Reset the EBB
   */
  async reset(): Promise<void> {
    await sendCommand(this.conn, 'R');
  }

  /**
   * Enable motors
   */
  async enableMotors(): Promise<void> {
    await sendCommand(this.conn, 'EM,1,1');
  }

  /**
   * Disable motors
   */
  async disableMotors(): Promise<void> {
    await sendCommand(this.conn, 'EM,0,0');
  }

  /**
   * Configure servo positions for SP commands
   * SC,4 = Servo_Min = pen UP position (used by SP,1)
   * SC,5 = Servo_Max = pen DOWN position (used by SP,0)
   */
  async configureServo(): Promise<void> {
    const upPos = this.getServoPos(this.config.penUpPosition);
    const downPos = this.getServoPos(this.config.penDownLight);

    // SC,4 = Servo_Min = pen UP (SP,1 goes here)
    await sendCommand(this.conn, `SC,4,${upPos}`);
    // SC,5 = Servo_Max = pen DOWN (SP,0 goes here)
    await sendCommand(this.conn, `SC,5,${downPos}`);
    // SC,10 = servo rate
    await sendCommand(this.conn, `SC,10,${this.config.servoRate}`);
  }

  /**
   * Move servo to absolute position using S2 command
   * This bypasses the SP state machine and reliably positions the servo
   * @param height 0-100 scale (100 = highest, 0 = most pressure)
   * @param duration Movement duration in ms
   */
  async setServoPosition(height: number, duration = 500): Promise<void> {
    const pos = this.getServoPos(height);
    // S2,position,pin,rate - rate controls movement speed
    // Rate is change per 24ms period. Calculate for smooth movement over duration.
    const currentPos = this.getServoPos(this.currentPenHeight);
    const delta = Math.abs(pos - currentPos);
    const periods = Math.max(1, duration / 24);
    const rate = Math.max(1, Math.ceil(delta / periods));

    await sendCommand(this.conn, `S2,${pos},${PEN_SERVO_PIN},${rate}`);
    this.currentPenHeight = height;
    this.currentPenUp = height >= 50; // Rough heuristic
    await this.delay(duration);
  }

  /**
   * Raise the pen to the configured up position
   */
  async penUp(duration = 300): Promise<void> {
    await this.setPenHeightViaSP(this.config.penUpPosition, duration);
  }

  /**
   * Lower the pen to the current down position
   */
  async penDown(duration = 300): Promise<void> {
    await this.setPenHeightViaSP(this.config.penDownLight, duration);
  }

  /**
   * Set pen height directly using S2 (for testing/calibration)
   * This reliably moves to an absolute position
   */
  async setPenHeight(height: number): Promise<void> {
    // Use SC+SP path by default; this makes the UI "Test" buttons reliable.
    await this.setPenHeightViaSP(height, 500);
  }

  /**
   * Set pen down height for variable thickness during plotting
   * Updates SC,5 (Servo_Max) for next SP,0 command
   */
  async setPenDownHeight(height: number): Promise<void> {
    // Maintain legacy helper: update SC,5 only (no motion) for code that wants to
    // issue SP,0 later. (Most callers should use setPenHeight instead.)
    const pos = this.getServoPos(height);
    await sendCommand(this.conn, `SC,5,${pos}`);
    this.currentPenHeight = height;
  }

  /**
   * Move to absolute position (in steps)
   * AxiDraw uses a CoreXY kinematic, so we need to convert X,Y to motor A,B
   */
  async moveTo(x: number, y: number, duration?: number): Promise<void> {
    const dx = x - this.currentX;
    const dy = y - this.currentY;

    if (dx === 0 && dy === 0) return;

    // CoreXY kinematics: Motor A = X + Y, Motor B = X - Y
    const stepsA = Math.round(dx + dy);
    const stepsB = Math.round(dx - dy);

    if (duration === undefined) {
      const distance = Math.sqrt(dx * dx + dy * dy);
      duration = Math.max(1, Math.round(distance / this.config.stepRate * 1000));
    }

    await sendCommand(this.conn, `SM,${duration},${stepsA},${stepsB}`);

    this.currentX = x;
    this.currentY = y;

    await this.delay(duration);
  }

  /**
   * Move with synchronized pen height change
   * Uses the 3D plotting technique from lurkertech.com
   */
  async moveWithHeight(
    x: number,
    y: number,
    targetHeight: number,
    duration?: number
  ): Promise<void> {
    // Simpler + reliable behavior: set pen height first, then move.
    // This makes per-segment pen height (and the test buttons) behave predictably.
    const dx = x - this.currentX;
    const dy = y - this.currentY;

    if (dx === 0 && dy === 0) {
      await this.setPenHeight(targetHeight);
      return;
    }

    if (this.currentPenHeight !== targetHeight) {
      await this.setPenHeight(targetHeight);
    } else if (this.currentPenUp) {
      // If we're "up" but asked to draw, re-assert down at the current height.
      await this.setPenHeight(targetHeight);
    }

    await this.moveTo(x, y, duration);
  }

  /**
   * Draw a line from current position to target with specified thickness
   */
  async lineTo(x: number, y: number, thickness: number = 50): Promise<void> {
    await this.moveWithHeight(x, y, thickness);
  }

  /**
   * Move without drawing (pen up)
   */
  async moveToWithoutDrawing(x: number, y: number): Promise<void> {
    await this.penUp();
    await this.moveTo(x, y);
  }

  /**
   * Return to home position
   */
  async home(): Promise<void> {
    await this.penUp();
    await this.moveTo(0, 0);
    this.currentX = 0;
    this.currentY = 0;
  }

  /**
   * Get current position
   */
  getPosition(): { x: number; y: number } {
    return { x: this.currentX, y: this.currentY };
  }

  /**
   * Helper to wait
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<EBBConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): EBBConfig {
    return { ...this.config };
  }
}
