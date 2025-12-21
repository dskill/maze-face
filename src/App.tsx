import React, { useState, useRef, useEffect } from 'react';
import { Download, Play, Eye, EyeOff, Camera, PenTool, Sliders, Type, Monitor, Layers, Zap, Maximize } from 'lucide-react';

interface MazeNode {
  id: number;
  x: number;
  y: number;
  w: number;
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
}

const App = () => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [params, setParams] = useState({
    densityBias: 1.2,
    contrast: 1.5,
    minCellSize: 4,
    edgeFocus: 1.0,
    invert: false,
    wallThickness: 1.2,
    shadingIntensity: 2.0,
    showSolution: false,
    showImage: false,
    resolution: 800
  });
  const [status, setStatus] = useState('Waiting for image...');
  const [isGenerating, setIsGenerating] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mazeData = useRef<MazeData>({ nodes: [], solution: [], startNode: null, endNode: null });

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

  const handleCameraClick = () => {
    const input = fileInputRef.current;
    if (input) {
      input.setAttribute('capture', 'environment');
      input.click();
      setTimeout(() => input.removeAttribute('capture'), 100);
    }
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
      const size = params.resolution;
      const nodes: MazeNode[] = [];

      const offC = document.createElement('canvas');
      offC.width = offC.height = 256;
      const offCtx = offC.getContext('2d')!;
      offCtx.drawImage(image, 0, 0, 256, 256);
      const imgData = offCtx.getImageData(0, 0, 256, 256).data;

      const getRawPixelB = (gx: number, gy: number) => {
        const sx = Math.max(0, Math.min(255, Math.floor((gx / size) * 255)));
        const sy = Math.max(0, Math.min(255, Math.floor((gy / size) * 255)));
        const idx = (sy * 256 + sx) * 4;
        return (imgData[idx] + imgData[idx + 1] + imgData[idx + 2]) / 3;
      };

      const subdivide = (x: number, y: number, w: number) => {
        const rawB = getRawPixelB(x + w / 2, y + w / 2);
        const rawTL = getRawPixelB(x, y);
        const rawBR = getRawPixelB(x + w, y + w);

        const bMid = params.contrast * (rawB - 128) + 128;
        const bTL = params.contrast * (rawTL - 128) + 128;
        const bBR = params.contrast * (rawBR - 128) + 128;

        const edgeStrength = Math.abs(bTL - bBR);
        const toneThreshold = ((params.invert ? 255 - bMid : bMid) / 255) * 45 * params.densityBias;
        const finalThreshold = toneThreshold - (edgeStrength / 255) * 30 * params.edgeFocus;

        if (w > params.minCellSize && w > finalThreshold) {
          const hw = w / 2;
          subdivide(x, y, hw);
          subdivide(x + hw, y, hw);
          subdivide(x, y + hw, hw);
          subdivide(x + hw, y + hw, hw);
        } else {
          nodes.push({
            id: nodes.length,
            x,
            y,
            w,
            rawBrightness: rawB,
            visited: false,
            neighbors: [],
            connections: new Map()
          });
        }
      };
      subdivide(0, 0, size);

      const centerX = size / 2;
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
        if (node.y + node.w > size - edgeEps) {
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
          const yOverlap = Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y);
          const isAdjacent =
            (xOverlap > nEps &&
              (Math.abs(a.y - b.y) <= nEps ||
                Math.abs(a.y + a.w - b.y) <= nEps ||
                Math.abs(a.y - (b.y + b.w)) <= nEps)) ||
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
              midY = a.y < b.y ? a.y + a.w : b.y + b.w;
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

      mazeData.current = { nodes, solution, startNode, endNode };
      render();
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
    ctx.font = 'bold 14px Courier, monospace';
    ctx.textAlign = 'center';

    const { nodes, startNode, endNode } = mazeData.current;

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
              ctx.lineTo(node.x + node.w, node.y + node.w);
            } else if (side === 'bottom') {
              ctx.moveTo(node.x, node.y + node.w);
              ctx.lineTo(node.x + node.w, node.y + node.w);
            } else if (side === 'left') {
              ctx.moveTo(node.x, node.y);
              ctx.lineTo(node.x, node.y + node.w);
            }
            ctx.stroke();
          }
        } else {
          boundaryNeighbors.forEach((nb) => {
            if (node.id < nb.node.id && !node.connections.has(nb.node)) {
              ctx.beginPath();
              ctx.lineWidth = getWallThickness(node, nb.node);
              if (side === 'top' || side === 'bottom') {
                const y = side === 'top' ? node.y : node.y + node.w;
                ctx.moveTo(Math.max(node.x, nb.node.x), y);
                ctx.lineTo(Math.min(node.x + node.w, nb.node.x + nb.node.w), y);
              } else {
                const x = side === 'left' ? node.x : node.x + node.w;
                ctx.moveTo(x, Math.max(node.y, nb.node.y));
                ctx.lineTo(x, Math.min(node.y + node.w, nb.node.y + nb.node.w));
              }
              ctx.stroke();
            }
          });
        }
      });
    });

    ctx.fillStyle = 'black';
    if (startNode) {
      ctx.textBaseline = 'bottom';
      ctx.fillText('START', startNode.x + startNode.w / 2, startNode.y - 5);
    }
    if (endNode) {
      ctx.textBaseline = 'top';
      ctx.fillText('END', endNode.x + endNode.w / 2, endNode.y + endNode.w + 5);
    }

    if (params.showSolution && mazeData.current.solution.length > 0) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2.0;
      ctx.shadowBlur = 4;
      ctx.shadowColor = '#3b82f6';
      ctx.beginPath();
      const sol = mazeData.current.solution;
      ctx.moveTo(sol[0].x + sol[0].w / 2, sol[0].y);
      ctx.lineTo(sol[0].x + sol[0].w / 2, sol[0].y + sol[0].w / 2);
      for (let i = 0; i < sol.length - 1; i++) {
        const sharedMid = sol[i].connections.get(sol[i + 1]);
        if (sharedMid) {
          ctx.lineTo(sharedMid.x, sharedMid.y);
          ctx.lineTo(sol[i + 1].x + sol[i + 1].w / 2, sol[i + 1].y + sol[i + 1].w / 2);
        }
      }
      ctx.lineTo(
        sol[sol.length - 1].x + sol[sol.length - 1].w / 2,
        sol[sol.length - 1].y + sol[sol.length - 1].w
      );
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  };

  const downloadSVG = () => {
    const { nodes, startNode, endNode } = mazeData.current;
    if (!nodes.length) return;
    const res = params.resolution;
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
              d = `M ${node.x + node.w} ${node.y} L ${node.x + node.w} ${node.y + node.w}`;
            else if (side === 'bottom')
              d = `M ${node.x} ${node.y + node.w} L ${node.x + node.w} ${node.y + node.w}`;
            else if (side === 'left') d = `M ${node.x} ${node.y} L ${node.x} ${node.y + node.w}`;
            svgPaths += `<path d="${d}" stroke="black" stroke-width="${weight.toFixed(2)}" fill="none" stroke-linecap="square" />\n`;
          }
        } else {
          boundaryNeighbors.forEach((nb) => {
            if (node.id < nb.node.id && !node.connections.has(nb.node)) {
              let d = '';
              const weight = getWallThickness(node, nb.node);
              if (side === 'top' || side === 'bottom') {
                const y = side === 'top' ? node.y : node.y + node.w;
                d = `M ${Math.max(node.x, nb.node.x)} ${y} L ${Math.min(node.x + node.w, nb.node.x + nb.node.w)} ${y}`;
              } else {
                const x = side === 'left' ? node.x : node.x + node.w;
                d = `M ${x} ${Math.max(node.y, nb.node.y)} L ${x} ${Math.min(node.y + node.w, nb.node.y + nb.node.w)}`;
              }
              svgPaths += `<path d="${d}" stroke="black" stroke-width="${weight.toFixed(2)}" fill="none" stroke-linecap="square" />\n`;
            }
          });
        }
      });
    });

    let labels = `<text x="${startNode!.x + startNode!.w / 2}" y="${startNode!.y - 5}" font-family="Courier, monospace" font-size="14" font-weight="bold" fill="black" text-anchor="middle">START</text>`;
    labels += `<text x="${endNode!.x + endNode!.w / 2}" y="${endNode!.y + endNode!.w + 15}" font-family="Courier, monospace" font-size="14" font-weight="bold" fill="black" text-anchor="middle">END</text>`;

    const svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="${res}" height="${res}" viewBox="0 -20 ${res} ${res + 40}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${res}" height="${res}" fill="white" />
  <g id="maze_walls">${svgPaths}</g>
  <g id="labels">${labels}</g>
</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `portrait_maze_plotter.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    render();
  }, [
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
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleUpload}
                className="flex-1 text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
              />
              <button
                onClick={handleCameraClick}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center gap-1 text-xs font-bold transition-all"
                title="Take photo with camera"
              >
                <Camera size={14} />
              </button>
            </div>
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
        </div>
      </div>

      <div className="flex-1 p-4 md:p-8 flex flex-col items-center justify-center gap-4 relative overflow-hidden bg-slate-900">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent pointer-events-none" />
        <div
          className="relative group transition-all duration-300"
          style={{ width: '100%', maxWidth: `${params.resolution}px` }}
        >
          <canvas
            ref={canvasRef}
            width={params.resolution}
            height={params.resolution}
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
            <Maximize size={10} /> {params.resolution}px
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
