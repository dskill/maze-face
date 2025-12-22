import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Download, Play, Eye, EyeOff, Camera, PenTool, Sliders, Type, Monitor, Layers, Zap, Maximize, Plug, Unplug, Square, Pause, Home, ChevronUp, ChevronDown } from 'lucide-react';
import {
  connectAxiDraw,
  isWebSerialSupported,
  Plotter,
  PlotterStatus,
  PAPER_SIZES,
  generatePlotJob,
  estimatePlotTime,
  formatTime,
} from './axidraw';

interface MazeNode {
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

interface MazeData {
  nodes: MazeNode[];
  solution: MazeNode[];
  startNode: MazeNode | null;
  endNode: MazeNode | null;
  width: number;
  height: number;
}

const App = () => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [params, setParams] = useState({
    densityBias: 0.2,
    contrast: 1.9,
    minCellSize: 8,
    edgeFocus: 2.7,
    invert: false,
    wallThickness: 1.0,
    svgIncludeLabels: false,
    shadingIntensity: 1.8,
    showSolution: false,
    showImage: false,
    resolution: 800
  });
  const [status, setStatus] = useState('Waiting for image...');
  const [isGenerating, setIsGenerating] = useState(false);
  const [mazeGenerated, setMazeGenerated] = useState(0);

  // Plotter state
  const [plotterSupported] = useState(isWebSerialSupported());
  const [plotterStatus, setPlotterStatus] = useState<PlotterStatus>({
    state: 'disconnected',
    progress: 0,
    currentSegment: 0,
    totalSegments: 0,
  });
  const [plotterSettings, setPlotterSettings] = useState({
    paperSize: '6x6' as keyof typeof PAPER_SIZES,
    speed: 50,
    penUpHeight: 60,
    penDownHeight: 40,
  });
  const [estimatedTime, setEstimatedTime] = useState<string | null>(null);
  const [testPenHeight, setTestPenHeight] = useState(50);
  const plotterRef = useRef<Plotter | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const mazeData = useRef<MazeData>({ nodes: [], solution: [], startNode: null, endNode: null, width: 0, height: 0 });

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setImage(img);
        updatePreview(img);
        setStatus('Image loaded. Ready to generate.');
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };


  const updatePreview = (img: HTMLImageElement) => {
    const canvas = previewRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, 200, 200);
    const imageData = ctx.getImageData(0, 0, 200, 200);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      let gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      gray = params.contrast * (gray - 128) + 128;
      if (params.invert) gray = 255 - gray;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, gray));
    }
    ctx.putImageData(imageData, 0, 0);
  };

  useEffect(() => {
    if (image) updatePreview(image);
  }, [params.contrast, params.invert, params.densityBias]);

  const generateMaze = () => {
    if (!image) return;
    setIsGenerating(true);
    setStatus('Analyzing features...');

    setTimeout(() => {
      // Calculate dimensions based on image aspect ratio
      const aspectRatio = image.width / image.height;
      let mazeWidth: number, mazeHeight: number;
      if (aspectRatio >= 1) {
        // Landscape or square
        mazeWidth = params.resolution;
        mazeHeight = Math.round(params.resolution / aspectRatio);
      } else {
        // Portrait
        mazeHeight = params.resolution;
        mazeWidth = Math.round(params.resolution * aspectRatio);
      }

      const nodes: MazeNode[] = [];

      const offC = document.createElement('canvas');
      offC.width = offC.height = 256;
      const offCtx = offC.getContext('2d')!;
      offCtx.drawImage(image, 0, 0, 256, 256);
      const imgData = offCtx.getImageData(0, 0, 256, 256).data;

      const getRawPixelB = (gx: number, gy: number) => {
        const sx = Math.max(0, Math.min(255, Math.floor((gx / mazeWidth) * 255)));
        const sy = Math.max(0, Math.min(255, Math.floor((gy / mazeHeight) * 255)));
        const idx = (sy * 256 + sx) * 4;
        return (imgData[idx] + imgData[idx + 1] + imgData[idx + 2]) / 3;
      };

      const subdivide = (x: number, y: number, w: number, h: number) => {
        const rawB = getRawPixelB(x + w / 2, y + h / 2);
        const rawTL = getRawPixelB(x, y);
        const rawBR = getRawPixelB(x + w, y + h);

        const bMid = params.contrast * (rawB - 128) + 128;
        const bTL = params.contrast * (rawTL - 128) + 128;
        const bBR = params.contrast * (rawBR - 128) + 128;

        const edgeStrength = Math.abs(bTL - bBR);
        const toneThreshold = ((params.invert ? 255 - bMid : bMid) / 255) * 45 * params.densityBias;
        const finalThreshold = toneThreshold - (edgeStrength / 255) * 30 * params.edgeFocus;

        const cellSize = Math.min(w, h);
        if (cellSize > params.minCellSize && cellSize > finalThreshold) {
          const hw = w / 2;
          const hh = h / 2;
          subdivide(x, y, hw, hh);
          subdivide(x + hw, y, hw, hh);
          subdivide(x, y + hh, hw, hh);
          subdivide(x + hw, y + hh, hw, hh);
        } else {
          nodes.push({
            id: nodes.length,
            x,
            y,
            w,
            h,
            rawBrightness: rawB,
            visited: false,
            neighbors: [],
            connections: new Map()
          });
        }
      };
      subdivide(0, 0, mazeWidth, mazeHeight);

      const centerX = mazeWidth / 2;
      let startNode = nodes[0];
      let endNode = nodes[nodes.length - 1];
      let minTopDist = Infinity;
      let minBottomDist = Infinity;
      const edgeEps = 1.0;

      nodes.forEach((node) => {
        if (node.y < edgeEps) {
          const dist = Math.abs(node.x + node.w / 2 - centerX);
          if (dist < minTopDist) {
            minTopDist = dist;
            startNode = node;
          }
        }
        if (node.y + node.h > mazeHeight - edgeEps) {
          const dist = Math.abs(node.x + node.w / 2 - centerX);
          if (dist < minBottomDist) {
            minBottomDist = dist;
            endNode = node;
          }
        }
      });

      nodes.forEach((a) => {
        a.neighbors = [];
        nodes.forEach((b) => {
          if (a.id === b.id) return;
          const nEps = 0.1;
          const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          const isAdjacent =
            (xOverlap > nEps &&
              (Math.abs(a.y - b.y) <= nEps ||
                Math.abs(a.y + a.h - b.y) <= nEps ||
                Math.abs(a.y - (b.y + b.h)) <= nEps)) ||
            (yOverlap > nEps &&
              (Math.abs(a.x - b.x) <= nEps ||
                Math.abs(a.x + a.w - b.x) <= nEps ||
                Math.abs(a.x - (b.x + b.w)) <= nEps));
          if (isAdjacent) {
            let side = '';
            let midX: number, midY: number;
            if (xOverlap > nEps) {
              side = a.y < b.y ? 'bottom' : 'top';
              midX = Math.max(a.x, b.x) + xOverlap / 2;
              midY = a.y < b.y ? a.y + a.h : b.y + b.h;
            } else {
              side = a.x < b.x ? 'right' : 'left';
              midX = a.x < b.x ? a.x + a.w : b.x + b.w;
              midY = Math.max(a.y, b.y) + yOverlap / 2;
            }
            a.neighbors.push({ node: b, side, mid: { x: midX, y: midY } });
          }
        });
      });

      const stack = [startNode];
      startNode.visited = true;
      while (stack.length > 0) {
        const curr = stack[stack.length - 1];
        const unvisited = curr.neighbors.filter((n) => !n.node.visited);
        if (unvisited.length > 0) {
          const nextData = unvisited[Math.floor(Math.random() * unvisited.length)];
          const next = nextData.node;
          next.visited = true;
          curr.connections.set(next, nextData.mid);
          next.connections.set(curr, nextData.mid);
          stack.push(next);
        } else {
          stack.pop();
        }
      }

      const queue: { node: MazeNode; path: MazeNode[] }[] = [{ node: startNode, path: [] }];
      const visited = new Set([startNode]);
      let solution: MazeNode[] = [];
      while (queue.length > 0) {
        const { node, path } = queue.shift()!;
        const curPath = [...path, node];
        if (node.id === endNode.id) {
          solution = curPath;
          break;
        }
        for (const [neighbor] of node.connections) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push({ node: neighbor, path: curPath });
          }
        }
      }

      mazeData.current = { nodes, solution, startNode, endNode, width: mazeWidth, height: mazeHeight };
      setMazeGenerated(prev => prev + 1);
      setIsGenerating(false);
      setStatus('Likeness captured.');
    }, 100);
  };

  const getWallThickness = (node: MazeNode, neighbor: MazeNode | null = null) => {
    let rawB = neighbor ? (node.rawBrightness + neighbor.rawBrightness) / 2 : node.rawBrightness;
    let b = params.contrast * (rawB - 128) + 128;
    if (params.invert) b = 255 - b;
    b = Math.max(0, Math.min(255, b));
    return params.wallThickness * (1 + ((1 - b / 255) * params.shadingIntensity));
  };

  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { nodes, startNode, endNode, width, height } = mazeData.current;

    // Update canvas size to match maze dimensions
    if (width > 0 && height > 0) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (params.showImage && image) {
      ctx.globalAlpha = 0.12;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1.0;
    }

    ctx.strokeStyle = 'black';
    ctx.lineCap = 'square';
    ctx.font = '12px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';

    nodes.forEach((node) => {
      const sides = ['top', 'right', 'bottom', 'left'];
      sides.forEach((side) => {
        const boundaryNeighbors = node.neighbors.filter((n) => n.side === side);
        if (boundaryNeighbors.length === 0) {
          const isOpen =
            (node.id === startNode?.id && side === 'top') ||
            (node.id === endNode?.id && side === 'bottom');
          if (!isOpen) {
            ctx.beginPath();
            ctx.lineWidth = getWallThickness(node);
            if (side === 'top') {
              ctx.moveTo(node.x, node.y);
              ctx.lineTo(node.x + node.w, node.y);
            } else if (side === 'right') {
              ctx.moveTo(node.x + node.w, node.y);
              ctx.lineTo(node.x + node.w, node.y + node.h);
            } else if (side === 'bottom') {
              ctx.moveTo(node.x, node.y + node.h);
              ctx.lineTo(node.x + node.w, node.y + node.h);
            } else if (side === 'left') {
              ctx.moveTo(node.x, node.y);
              ctx.lineTo(node.x, node.y + node.h);
            }
            ctx.stroke();
          }
        } else {
          boundaryNeighbors.forEach((nb) => {
            if (node.id < nb.node.id && !node.connections.has(nb.node)) {
              ctx.beginPath();
              ctx.lineWidth = getWallThickness(node, nb.node);
              if (side === 'top' || side === 'bottom') {
                const y = side === 'top' ? node.y : node.y + node.h;
                ctx.moveTo(Math.max(node.x, nb.node.x), y);
                ctx.lineTo(Math.min(node.x + node.w, nb.node.x + nb.node.w), y);
              } else {
                const x = side === 'left' ? node.x : node.x + node.w;
                ctx.moveTo(x, Math.max(node.y, nb.node.y));
                ctx.lineTo(x, Math.min(node.y + node.h, nb.node.y + nb.node.h));
              }
              ctx.stroke();
            }
          });
        }
      });
    });

    ctx.fillStyle = 'black';
    ctx.lineWidth = 0.75;
    if (startNode) {
      const startCenterX = startNode.x + startNode.w / 2;
      // START label with more padding
      ctx.textBaseline = 'bottom';
      ctx.fillText('START', startCenterX, startNode.y - 18);
      // Down arrow pointing into the maze
      ctx.beginPath();
      ctx.moveTo(startCenterX, startNode.y - 14);
      ctx.lineTo(startCenterX, startNode.y - 3);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(startCenterX - 3, startNode.y - 7);
      ctx.lineTo(startCenterX, startNode.y - 3);
      ctx.lineTo(startCenterX + 3, startNode.y - 7);
      ctx.stroke();
    }
    if (endNode) {
      const endCenterX = endNode.x + endNode.w / 2;
      const endBottom = endNode.y + endNode.h;
      // Down arrow coming out of the maze
      ctx.beginPath();
      ctx.moveTo(endCenterX, endBottom + 3);
      ctx.lineTo(endCenterX, endBottom + 14);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(endCenterX - 3, endBottom + 10);
      ctx.lineTo(endCenterX, endBottom + 14);
      ctx.lineTo(endCenterX + 3, endBottom + 10);
      ctx.stroke();
      // END label with more padding
      ctx.textBaseline = 'top';
      ctx.fillText('END', endCenterX, endBottom + 18);
    }

    if (params.showSolution && mazeData.current.solution.length > 0) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2.0;
      ctx.shadowBlur = 4;
      ctx.shadowColor = '#3b82f6';
      ctx.beginPath();
      const sol = mazeData.current.solution;
      ctx.moveTo(sol[0].x + sol[0].w / 2, sol[0].y);
      ctx.lineTo(sol[0].x + sol[0].w / 2, sol[0].y + sol[0].h / 2);
      for (let i = 0; i < sol.length - 1; i++) {
        const sharedMid = sol[i].connections.get(sol[i + 1]);
        if (sharedMid) {
          ctx.lineTo(sharedMid.x, sharedMid.y);
          ctx.lineTo(sol[i + 1].x + sol[i + 1].w / 2, sol[i + 1].y + sol[i + 1].h / 2);
        }
      }
      ctx.lineTo(
        sol[sol.length - 1].x + sol[sol.length - 1].w / 2,
        sol[sol.length - 1].y + sol[sol.length - 1].h
      );
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  };

  const downloadSVG = () => {
    const { nodes, startNode, endNode, width, height } = mazeData.current;
    if (!nodes.length) return;
    let svgPaths = '';

    nodes.forEach((node) => {
      const sides = ['top', 'right', 'bottom', 'left'];
      sides.forEach((side) => {
        const boundaryNeighbors = node.neighbors.filter((n) => n.side === side);
        if (boundaryNeighbors.length === 0) {
          const isOpen =
            (node.id === startNode?.id && side === 'top') ||
            (node.id === endNode?.id && side === 'bottom');
          if (!isOpen) {
            let d = '';
            const weight = getWallThickness(node);
            if (side === 'top') d = `M ${node.x} ${node.y} L ${node.x + node.w} ${node.y}`;
            else if (side === 'right')
              d = `M ${node.x + node.w} ${node.y} L ${node.x + node.w} ${node.y + node.h}`;
            else if (side === 'bottom')
              d = `M ${node.x} ${node.y + node.h} L ${node.x + node.w} ${node.y + node.h}`;
            else if (side === 'left') d = `M ${node.x} ${node.y} L ${node.x} ${node.y + node.h}`;
            svgPaths += `<path d="${d}" stroke="black" stroke-width="${weight.toFixed(2)}" fill="none" stroke-linecap="square" />\n`;
          }
        } else {
          boundaryNeighbors.forEach((nb) => {
            if (node.id < nb.node.id && !node.connections.has(nb.node)) {
              let d = '';
              const weight = getWallThickness(node, nb.node);
              if (side === 'top' || side === 'bottom') {
                const y = side === 'top' ? node.y : node.y + node.h;
                d = `M ${Math.max(node.x, nb.node.x)} ${y} L ${Math.min(node.x + node.w, nb.node.x + nb.node.w)} ${y}`;
              } else {
                const x = side === 'left' ? node.x : node.x + node.w;
                d = `M ${x} ${Math.max(node.y, nb.node.y)} L ${x} ${Math.min(node.y + node.h, nb.node.y + nb.node.h)}`;
              }
              svgPaths += `<path d="${d}" stroke="black" stroke-width="${weight.toFixed(2)}" fill="none" stroke-linecap="square" />\n`;
            }
          });
        }
      });
    });

    let labels = '';
    let viewBoxY = 0;
    let viewBoxHeight = height;

    if (params.svgIncludeLabels) {
      const startCenterX = startNode!.x + startNode!.w / 2;
      const endCenterX = endNode!.x + endNode!.w / 2;
      const endBottom = endNode!.y + endNode!.h;

      // START label and arrow
      labels = `<text x="${startCenterX}" y="${startNode!.y - 20}" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="black" text-anchor="middle">START</text>`;
      // Down arrow pointing into maze
      labels += `<path d="M ${startCenterX} ${startNode!.y - 14} L ${startCenterX} ${startNode!.y - 3}" stroke="black" stroke-width="0.75" fill="none" />`;
      labels += `<path d="M ${startCenterX - 3} ${startNode!.y - 7} L ${startCenterX} ${startNode!.y - 3} L ${startCenterX + 3} ${startNode!.y - 7}" stroke="black" stroke-width="0.75" fill="none" />`;

      // END arrow and label
      labels += `<path d="M ${endCenterX} ${endBottom + 3} L ${endCenterX} ${endBottom + 14}" stroke="black" stroke-width="0.75" fill="none" />`;
      labels += `<path d="M ${endCenterX - 3} ${endBottom + 10} L ${endCenterX} ${endBottom + 14} L ${endCenterX + 3} ${endBottom + 10}" stroke="black" stroke-width="0.75" fill="none" />`;
      labels += `<text x="${endCenterX}" y="${endBottom + 28}" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="black" text-anchor="middle">END</text>`;

      viewBoxY = -40;
      viewBoxHeight = height + 80;
    }

    const svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="${width}" height="${height}" viewBox="${viewBoxY} ${viewBoxY} ${width} ${viewBoxHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="${height}" fill="white" />
  <g id="maze_walls">${svgPaths}</g>
  ${labels ? `<g id="labels">${labels}</g>` : ''}
</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `maze_${width}x${height}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Plotter functions
  const handlePlotterConnect = useCallback(async () => {
    try {
      const conn = await connectAxiDraw();
      const paper = PAPER_SIZES[plotterSettings.paperSize];
      const plotter = new Plotter({
        paperWidth: paper.width,
        paperHeight: paper.height,
        plotWidth: paper.width - 20,
        plotHeight: paper.height - 20,
        marginX: 10,
        marginY: 10,
        speed: plotterSettings.speed,
        penUpPosition: plotterSettings.penUpHeight,
        penDownPosition: plotterSettings.penDownHeight,
      });
      await plotter.connect(conn);
      plotterRef.current = plotter;
      setPlotterStatus(plotter.getStatus());
      setStatus('AxiDraw connected');
    } catch (err) {
      console.error('Connection failed:', err);
      setStatus(`Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [plotterSettings]);

  const handlePlotterDisconnect = useCallback(async () => {
    if (plotterRef.current) {
      await plotterRef.current.disconnect();
      plotterRef.current = null;
      setPlotterStatus({ state: 'disconnected', progress: 0, currentSegment: 0, totalSegments: 0 });
      setStatus('AxiDraw disconnected');
    }
  }, []);

  const handlePlot = useCallback(async () => {
    const plotter = plotterRef.current;
    if (!plotter || mazeData.current.nodes.length === 0) return;

    try {
      const segments = generatePlotJob(mazeData.current, plotter, {
        wallThickness: params.wallThickness,
        shadingIntensity: params.shadingIntensity,
      });

      setStatus(`Plotting ${segments.length} segments...`);
      await plotter.plot(segments, (status) => {
        setPlotterStatus(status);
      });
      setStatus('Plot complete!');
    } catch (err) {
      console.error('Plot failed:', err);
      setStatus(`Plot failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [params.wallThickness, params.shadingIntensity]);

  const handlePlotterPause = useCallback(() => {
    plotterRef.current?.pause();
    setPlotterStatus(plotterRef.current?.getStatus() || plotterStatus);
  }, [plotterStatus]);

  const handlePlotterResume = useCallback(() => {
    plotterRef.current?.resume();
    setPlotterStatus(plotterRef.current?.getStatus() || plotterStatus);
  }, [plotterStatus]);

  const handlePlotterStop = useCallback(() => {
    plotterRef.current?.stop();
    setPlotterStatus(plotterRef.current?.getStatus() || plotterStatus);
    setStatus('Plot stopped');
  }, [plotterStatus]);

  const handlePlotterHome = useCallback(async () => {
    try {
      await plotterRef.current?.goHome();
      setStatus('Returned to home');
    } catch (err) {
      setStatus('Home failed');
    }
  }, []);

  const handleTestPenUp = useCallback(async () => {
    try {
      await plotterRef.current?.testPenUp();
    } catch (err) {
      setStatus('Pen up failed');
    }
  }, []);

  const handleTestPenDown = useCallback(async () => {
    try {
      await plotterRef.current?.testPenDown();
    } catch (err) {
      setStatus('Pen down failed');
    }
  }, []);

  const handleTestPenHeight = useCallback(async (height: number) => {
    try {
      await plotterRef.current?.testPenHeight(height);
    } catch (err) {
      setStatus('Pen height test failed');
    }
  }, []);

  // Update estimated time when maze or settings change
  useEffect(() => {
    if (mazeData.current.nodes.length > 0 && plotterRef.current) {
      const segments = generatePlotJob(mazeData.current, plotterRef.current, {
        wallThickness: params.wallThickness,
        shadingIntensity: params.shadingIntensity,
      });
      const time = estimatePlotTime(segments, plotterSettings.speed);
      setEstimatedTime(formatTime(time));
    }
  }, [params.wallThickness, params.shadingIntensity, plotterSettings.speed, plotterStatus.state]);

  // Update plotter config when settings change
  useEffect(() => {
    if (plotterRef.current) {
      const paper = PAPER_SIZES[plotterSettings.paperSize];
      plotterRef.current.setConfig({
        paperWidth: paper.width,
        paperHeight: paper.height,
        plotWidth: paper.width - 20,
        plotHeight: paper.height - 20,
        speed: plotterSettings.speed,
        penUpPosition: plotterSettings.penUpHeight,
        penDownPosition: plotterSettings.penDownHeight,
      });
    }
  }, [plotterSettings]);

  useEffect(() => {
    render();
  }, [
    mazeGenerated,
    params.showSolution,
    params.wallThickness,
    params.shadingIntensity,
    params.contrast,
    params.showImage,
    params.resolution
  ]);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-950 text-slate-200 font-sans">
      <div className="w-full md:w-80 border-r border-slate-800 bg-slate-900/50 backdrop-blur-xl p-6 flex flex-col gap-6 overflow-y-auto shrink-0 md:h-screen sticky top-0 custom-scroll">
        <div className="space-y-1">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent tracking-tight flex items-center gap-2">
            <PenTool size={20} className="text-emerald-400" /> Maze Architect
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
            Plotter Edition
          </p>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-slate-950 rounded-xl border border-white/5 space-y-3">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase">
              <Camera size={14} /> 1. Source Image
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleUpload}
              className="w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
            />
            <canvas
              ref={previewRef}
              width="200"
              height="200"
              className="w-full h-auto rounded-lg border border-slate-800"
            />
          </div>

          <div className="space-y-4 p-4 bg-slate-800/30 rounded-xl border border-white/5">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase">
              <Monitor size={14} /> 2. Grid Structure
            </label>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                <span>Canvas Size</span>
                <span>{params.resolution}px</span>
              </div>
              <select
                value={params.resolution}
                onChange={(e) => setParams({ ...params, resolution: parseInt(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-200 focus:outline-none"
              >
                <option value="600">600px (Coarse)</option>
                <option value="800">800px (Standard)</option>
                <option value="1000">1000px (Retina)</option>
                <option value="1200">1200px (Plotter)</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                <span className="flex items-center gap-1">
                  <Layers size={10} /> Min Cell Size
                </span>
                <span>{params.minCellSize}px</span>
              </div>
              <input
                type="range"
                min="2"
                max="16"
                step="1"
                value={params.minCellSize}
                onChange={(e) => setParams({ ...params, minCellSize: parseInt(e.target.value) })}
                className="w-full accent-blue-500"
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                <span className="flex items-center gap-1">
                  <Type size={10} /> Grid Density Bias
                </span>
                <span>{params.densityBias.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={params.densityBias}
                onChange={(e) => setParams({ ...params, densityBias: parseFloat(e.target.value) })}
                className="w-full accent-blue-500"
              />
            </div>
          </div>

          <div className="space-y-4 p-4 bg-slate-800/30 rounded-xl border border-white/5">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase">
              <Zap size={14} /> 3. Likeness Engine
            </label>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                <span>Visual Contrast</span>
                <span>{params.contrast.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={params.contrast}
                onChange={(e) => setParams({ ...params, contrast: parseFloat(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                <span>Edge Focus</span>
                <span>{params.edgeFocus.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="3"
                step="0.1"
                value={params.edgeFocus}
                onChange={(e) => setParams({ ...params, edgeFocus: parseFloat(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </div>
          </div>

          <div className="space-y-4 p-4 bg-slate-800/30 rounded-xl border border-white/5">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase">
              <Sliders size={14} /> 4. Ink Weight (Live)
            </label>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                <span>Base Line Weight</span>
                <span>{params.wallThickness.toFixed(1)}px</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="4"
                step="0.1"
                value={params.wallThickness}
                onChange={(e) => setParams({ ...params, wallThickness: parseFloat(e.target.value) })}
                className="w-full accent-white"
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                <span>Ink Shading Intensity</span>
                <span>{params.shadingIntensity.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0"
                max="8"
                step="0.1"
                value={params.shadingIntensity}
                onChange={(e) =>
                  setParams({ ...params, shadingIntensity: parseFloat(e.target.value) })
                }
                className="w-full accent-blue-400"
              />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                checked={params.showImage}
                onChange={(e) => setParams({ ...params, showImage: e.target.checked })}
                className="rounded border-slate-700 bg-slate-900"
              />
              <span className="text-xs text-slate-300 font-bold">Ghost Original</span>
            </div>
          </div>

          {/* AxiDraw Plotter Panel */}
          {plotterSupported && (
            <div className="space-y-4 p-4 bg-gradient-to-br from-emerald-900/20 to-blue-900/20 rounded-xl border border-emerald-500/20">
              <label className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase">
                <PenTool size={14} /> 5. AxiDraw Plotter
              </label>

              {/* Connection Status & Button */}
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  plotterStatus.state === 'disconnected' ? 'bg-slate-500' :
                  plotterStatus.state === 'connected' ? 'bg-emerald-500' :
                  plotterStatus.state === 'plotting' ? 'bg-blue-500 animate-pulse' :
                  'bg-yellow-500'
                }`} />
                <span className="text-xs text-slate-400 capitalize flex-1">{plotterStatus.state}</span>
                {plotterStatus.state === 'disconnected' ? (
                  <button
                    onClick={handlePlotterConnect}
                    className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-all"
                  >
                    <Plug size={12} /> Connect
                  </button>
                ) : (
                  <button
                    onClick={handlePlotterDisconnect}
                    disabled={plotterStatus.state === 'plotting'}
                    className="py-1.5 px-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-all"
                  >
                    <Unplug size={12} /> Disconnect
                  </button>
                )}
              </div>

              {/* Plotter Settings (only shown when connected) */}
              {plotterStatus.state !== 'disconnected' && (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                      <span>Paper Size</span>
                    </div>
                    <select
                      value={plotterSettings.paperSize}
                      onChange={(e) => setPlotterSettings({ ...plotterSettings, paperSize: e.target.value as keyof typeof PAPER_SIZES })}
                      disabled={plotterStatus.state === 'plotting'}
                      className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-200 focus:outline-none disabled:opacity-50"
                    >
                      {Object.keys(PAPER_SIZES).map((size) => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                      <span>Speed</span>
                      <span>{plotterSettings.speed}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      step="5"
                      value={plotterSettings.speed}
                      onChange={(e) => setPlotterSettings({ ...plotterSettings, speed: parseInt(e.target.value) })}
                      disabled={plotterStatus.state === 'plotting'}
                      className="w-full accent-emerald-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                        <span>Pen Up</span>
                        <span>{plotterSettings.penUpHeight}</span>
                      </div>
                      <input
                        type="range"
                        min="40"
                        max="100"
                        step="5"
                        value={plotterSettings.penUpHeight}
                        onChange={(e) => setPlotterSettings({ ...plotterSettings, penUpHeight: parseInt(e.target.value) })}
                        disabled={plotterStatus.state === 'plotting'}
                        className="w-full accent-emerald-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                        <span>Pen Down</span>
                        <span>{plotterSettings.penDownHeight}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="60"
                        step="5"
                        value={plotterSettings.penDownHeight}
                        onChange={(e) => setPlotterSettings({ ...plotterSettings, penDownHeight: parseInt(e.target.value) })}
                        disabled={plotterStatus.state === 'plotting'}
                        className="w-full accent-emerald-500"
                      />
                    </div>
                  </div>

                  {/* Test buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={handleTestPenUp}
                      disabled={plotterStatus.state === 'plotting'}
                      className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all"
                    >
                      <ChevronUp size={12} /> Up
                    </button>
                    <button
                      onClick={handleTestPenDown}
                      disabled={plotterStatus.state === 'plotting'}
                      className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all"
                    >
                      <ChevronDown size={12} /> Down
                    </button>
                    <button
                      onClick={handlePlotterHome}
                      disabled={plotterStatus.state === 'plotting'}
                      className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all"
                    >
                      <Home size={12} /> Home
                    </button>
                  </div>

                  {/* Test Pen Height Slider */}
                  <div className="space-y-1 p-2 bg-slate-800/50 rounded-lg">
                    <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                      <span>Test Stroke Height</span>
                      <span>{testPenHeight}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={testPenHeight}
                      onChange={(e) => {
                        const height = parseInt(e.target.value);
                        setTestPenHeight(height);
                        handleTestPenHeight(height);
                      }}
                      disabled={plotterStatus.state === 'plotting'}
                      className="w-full accent-emerald-500"
                    />
                    <div className="flex justify-between text-[9px] text-slate-600">
                      <span>Heavy (thick)</span>
                      <span>Light (thin)</span>
                    </div>
                  </div>

                  {/* Plot Progress */}
                  {plotterStatus.state === 'plotting' && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>Progress</span>
                        <span>{plotterStatus.currentSegment} / {plotterStatus.totalSegments}</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-300"
                          style={{ width: `${plotterStatus.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Estimated time */}
                  {estimatedTime && plotterStatus.state === 'connected' && mazeData.current.nodes.length > 0 && (
                    <div className="text-[10px] text-slate-500 text-center">
                      Estimated time: <span className="text-emerald-400 font-bold">{estimatedTime}</span>
                    </div>
                  )}

                  {/* Plot / Pause / Stop buttons */}
                  <div className="flex gap-2">
                    {plotterStatus.state === 'connected' && (
                      <button
                        onClick={handlePlot}
                        disabled={mazeData.current.nodes.length === 0}
                        className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all text-xs"
                      >
                        <Play size={14} /> Plot
                      </button>
                    )}
                    {plotterStatus.state === 'plotting' && (
                      <>
                        <button
                          onClick={handlePlotterPause}
                          className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all text-xs"
                        >
                          <Pause size={14} /> Pause
                        </button>
                        <button
                          onClick={handlePlotterStop}
                          className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all text-xs"
                        >
                          <Square size={14} /> Stop
                        </button>
                      </>
                    )}
                    {plotterStatus.state === 'paused' && (
                      <>
                        <button
                          onClick={handlePlotterResume}
                          className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all text-xs"
                        >
                          <Play size={14} /> Resume
                        </button>
                        <button
                          onClick={handlePlotterStop}
                          className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all text-xs"
                        >
                          <Square size={14} /> Stop
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* WebSerial not supported warning */}
          {!plotterSupported && (
            <div className="p-3 bg-yellow-900/20 border border-yellow-500/20 rounded-xl">
              <p className="text-xs text-yellow-400">
                AxiDraw integration requires Chrome or Edge browser.
              </p>
            </div>
          )}
        </div>

        <div className="mt-auto space-y-2 pb-4">
          <button
            onClick={generateMaze}
            disabled={!image || isGenerating}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95"
          >
            {isGenerating ? (
              'Building Structure...'
            ) : (
              <>
                <Play size={18} /> Generate Maze
              </>
            )}
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setParams({ ...params, showSolution: !params.showSolution })}
              className="py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold flex items-center justify-center gap-2 transition-all text-xs"
            >
              {params.showSolution ? <EyeOff size={14} /> : <Eye size={14} />} Sol.
            </button>
            <button
              onClick={downloadSVG}
              disabled={!mazeData.current.nodes.length}
              className="py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 rounded-xl font-bold flex items-center justify-center gap-2 transition-all text-xs"
            >
              <Download size={14} /> SVG
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={params.svgIncludeLabels}
              onChange={(e) => setParams({ ...params, svgIncludeLabels: e.target.checked })}
              className="rounded border-slate-700 bg-slate-900"
            />
            <span className="text-xs text-slate-400">Include START/END in SVG</span>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 md:p-8 flex flex-col items-center justify-center gap-4 relative overflow-hidden bg-slate-900">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent pointer-events-none" />
        <div
          className="relative group transition-all duration-300"
          style={{ width: '100%', maxWidth: `${mazeData.current.width || params.resolution}px` }}
        >
          <canvas
            ref={canvasRef}
            width={mazeData.current.width || params.resolution}
            height={mazeData.current.height || params.resolution}
            className="w-full h-auto bg-white rounded-2xl shadow-2xl transition-transform duration-500"
          />
          {isGenerating && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-4 z-20">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-blue-600 font-bold uppercase tracking-widest text-xs animate-pulse">
                {status}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest bg-slate-900/50 px-4 py-2 rounded-full border border-white/5">
          <span className="flex items-center gap-1">
            <Maximize size={10} /> {mazeData.current.width || params.resolution} x {mazeData.current.height || params.resolution}
          </span>
          <span className="w-1 h-1 bg-slate-700 rounded-full" />
          <span>LIVE INK WEIGHTING</span>
          <span className="w-1 h-1 bg-slate-700 rounded-full" />
          <span>ZERO LINE OVERLAP</span>
        </div>
      </div>
    </div>
  );
};

export default App;
