/**
 * AxiDraw integration module
 */

export { connectAxiDraw, isWebSerialSupported } from './connection';
export type { AxiDrawConnection } from './connection';

export { EBB, DEFAULT_CONFIG } from './ebb';
export type { EBBConfig } from './ebb';

export { Plotter, PAPER_SIZES, DEFAULT_PLOTTER_CONFIG } from './plotter';
export type { PlotterConfig, PlotterState, PlotterStatus, PlotSegment } from './plotter';

export { generatePlotJob, estimatePlotTime, formatTime } from './job';
export type { MazeNode, MazeData } from './job';
