/**
 * WebSerial connection management for AxiDraw
 */

// WebSerial API types (not yet in lib.dom.d.ts)
declare global {
  interface Navigator {
    serial: {
      requestPort(options?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }): Promise<SerialPort>;
    };
  }

  interface SerialPort {
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
  }
}

export interface AxiDrawConnection {
  port: SerialPort;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
}

// AxiDraw uses 38400 baud by default
const BAUD_RATE = 38400;

/**
 * Request user to select and connect to AxiDraw via WebSerial
 */
export async function connectAxiDraw(): Promise<AxiDrawConnection> {
  if (!('serial' in navigator)) {
    throw new Error('WebSerial not supported. Please use Chrome or Edge.');
  }

  // Request port - this will show browser permission dialog
  const port = await navigator.serial.requestPort({
    // EBB boards use these USB vendor/product IDs
    filters: [
      { usbVendorId: 0x04D8, usbProductId: 0xFD92 }, // EBB
    ]
  });

  await port.open({ baudRate: BAUD_RATE });

  if (!port.readable || !port.writable) {
    throw new Error('Failed to open port streams');
  }

  const reader = port.readable.getReader();
  const writer = port.writable.getWriter();

  return { port, reader, writer };
}

/**
 * Disconnect from AxiDraw
 */
export async function disconnectAxiDraw(conn: AxiDrawConnection): Promise<void> {
  try {
    conn.reader.releaseLock();
    conn.writer.releaseLock();
    await conn.port.close();
  } catch (e) {
    console.warn('Error during disconnect:', e);
  }
}

/**
 * Send a command and wait for response
 */
export async function sendCommand(
  conn: AxiDrawConnection,
  command: string,
  timeout = 5000
): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Send command with \r terminator
  await conn.writer.write(encoder.encode(command + '\r'));

  // Read response
  let response = '';
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const { value, done } = await Promise.race([
      conn.reader.read(),
      new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), 100)
      )
    ]);

    if (done || !value) {
      // Check if we have a complete response
      if (response.includes('\r') || response.includes('OK')) {
        break;
      }
      continue;
    }

    response += decoder.decode(value);

    // EBB responses end with \r or OK\r\n
    if (response.includes('OK') || response.endsWith('\r')) {
      break;
    }
  }

  return response.trim();
}

/**
 * Check if WebSerial is available in this browser
 */
export function isWebSerialSupported(): boolean {
  return 'serial' in navigator;
}
