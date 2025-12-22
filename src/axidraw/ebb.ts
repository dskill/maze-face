/**
 * EBB (EiBotBoard) command interface for AxiDraw
 * Reference: https://evil-mad.github.io/EggBot/ebb.html
 */

import { AxiDrawConnection, sendCommand } from './connection';

// Servo position units are in 83.3ns increments
// Typical range: 7500 (0.625ms) to 25000 (2.08ms)
// Default pen up: ~16000 (SERVO_MIN + ~60%), pen down: ~12000 (SERVO_MIN + ~30%)
const SERVO_MIN = 7500;   // Highest pen position
const SERVO_MAX = 28000;  // Lowest pen position (most pressure)

export interface EBBConfig {
  penUpPosition: number;    // 0-100 scale (100 = highest)
  penDownPosition: number;  // 0-100 scale (0 = lowest/most pressure)
  servoRate: number;        // Rate of pen movement (higher = faster)
  stepRate: number;         // Steps per second for movement
}

export const DEFAULT_CONFIG: EBBConfig = {
  penUpPosition: 60,
  penDownPosition: 40,
  servoRate: 150,
  stepRate: 1000,
};

/**
 * Convert 0-100 scale to servo position units
 */
function scaleToServoPos(value: number): number {
  // Invert: 100 = SERVO_MIN (high), 0 = SERVO_MAX (low)
  const clamped = Math.max(0, Math.min(100, value));
  return Math.round(SERVO_MIN + (100 - clamped) / 100 * (SERVO_MAX - SERVO_MIN));
}

/**
 * EBB command builder and executor
 */
export class EBB {
  private conn: AxiDrawConnection;
  private config: EBBConfig;
  private currentPenUp: boolean = true;
  private currentX: number = 0;
  private currentY: number = 0;

  constructor(conn: AxiDrawConnection, config: Partial<EBBConfig> = {}) {
    this.conn = conn;
    this.config = { ...DEFAULT_CONFIG, ...config };
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
    // EM,1,1 enables both motors at 1/16 microstepping
    await sendCommand(this.conn, 'EM,1,1');
  }

  /**
   * Disable motors
   */
  async disableMotors(): Promise<void> {
    await sendCommand(this.conn, 'EM,0,0');
  }

  /**
   * Configure servo positions
   */
  async configureServo(): Promise<void> {
    const upPos = scaleToServoPos(this.config.penUpPosition);
    const downPos = scaleToServoPos(this.config.penDownPosition);

    // SC,5,value - set pen UP position
    await sendCommand(this.conn, `SC,5,${upPos}`);
    // SC,4,value - set pen DOWN position
    await sendCommand(this.conn, `SC,4,${downPos}`);
    // SC,10,rate - set servo rate
    await sendCommand(this.conn, `SC,10,${this.config.servoRate}`);
  }

  /**
   * Raise the pen
   */
  async penUp(duration = 300): Promise<void> {
    if (this.currentPenUp) return;
    await sendCommand(this.conn, `SP,1,${duration}`);
    this.currentPenUp = true;
    // Wait for pen to raise
    await this.delay(duration);
  }

  /**
   * Lower the pen
   */
  async penDown(duration = 300): Promise<void> {
    if (!this.currentPenUp) return;
    await sendCommand(this.conn, `SP,0,${duration}`);
    this.currentPenUp = false;
    // Wait for pen to lower
    await this.delay(duration);
  }

  /**
   * Set pen height directly (0-100 scale)
   * 0 = maximum pressure (lowest), 100 = highest (no contact)
   */
  async setPenHeight(height: number): Promise<void> {
    const pos = scaleToServoPos(height);
    // S2 command for direct servo control
    // S2,position,pin - pin 0 is the pen servo
    await sendCommand(this.conn, `S2,${pos},0`);
  }

  /**
   * Set pen down height for variable thickness
   * This adjusts where "down" is for the next penDown command
   */
  async setPenDownHeight(height: number): Promise<void> {
    const pos = scaleToServoPos(height);
    await sendCommand(this.conn, `SC,4,${pos}`);
    this.config.penDownPosition = height;
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

    // Calculate duration based on distance if not specified
    if (duration === undefined) {
      const distance = Math.sqrt(dx * dx + dy * dy);
      duration = Math.max(1, Math.round(distance / this.config.stepRate * 1000));
    }

    // SM command: SM,duration,axisA,axisB
    await sendCommand(this.conn, `SM,${duration},${stepsA},${stepsB}`);

    this.currentX = x;
    this.currentY = y;

    // Wait for movement
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
    const dx = x - this.currentX;
    const dy = y - this.currentY;

    if (dx === 0 && dy === 0) {
      await this.setPenHeight(targetHeight);
      return;
    }

    // CoreXY kinematics
    const stepsA = Math.round(dx + dy);
    const stepsB = Math.round(dx - dy);

    // Calculate duration based on distance if not specified
    if (duration === undefined) {
      const distance = Math.sqrt(dx * dx + dy * dy);
      duration = Math.max(1, Math.round(distance / this.config.stepRate * 1000));
    }

    const targetPos = scaleToServoPos(targetHeight);

    // Calculate servo rate needed to reach target in the same duration
    // Rate is in units per 24ms interval
    const intervals = duration / 24;
    const currentPos = scaleToServoPos(this.config.penDownPosition);
    const posDelta = Math.abs(targetPos - currentPos);
    const rate = Math.max(1, Math.round(posDelta / intervals));

    // Set servo rate for synchronized movement
    await sendCommand(this.conn, `SC,10,${rate}`);
    // Set target pen position
    await sendCommand(this.conn, `SC,4,${targetPos}`);
    // Lower pen to new position if needed
    if (this.currentPenUp) {
      await sendCommand(this.conn, 'SP,0');
      this.currentPenUp = false;
    }
    // Execute XY movement
    await sendCommand(this.conn, `SM,${duration},${stepsA},${stepsB}`);

    this.currentX = x;
    this.currentY = y;
    this.config.penDownPosition = targetHeight;

    await this.delay(duration);
  }

  /**
   * Draw a line from current position to target with specified thickness
   * @param x Target X in steps
   * @param y Target Y in steps
   * @param thickness 0-100 where 0 = thickest (most pressure), 100 = thinnest
   */
  async lineTo(x: number, y: number, thickness: number = 50): Promise<void> {
    // Ensure pen is down at correct height
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
