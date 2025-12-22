# Maze Face

Turn portraits into solvable mazes. The maze structure adapts to image features—denser in detailed areas, sparser in smooth regions.

**[Try it live →](https://dskill.github.io/maze-face/)**

![Example maze portrait](https://via.placeholder.com/600x400?text=Example+Coming+Soon)

## Features

- **Adaptive quadtree maze generation** — Cell density follows image brightness and edges
- **Variable line weights** — Darker areas get thicker walls, creating shading
- **SVG export** — For printing, laser cutting, or pen plotting
- **AxiDraw integration** — Plot directly with variable pen pressure (Chrome/Edge)

## Usage

1. Upload a portrait image
2. Adjust detail level and contrast
3. Generate the maze
4. Export SVG or plot directly

## Local Development

```bash
npm install
npm run dev
```

## Plotter Notes

The AxiDraw integration uses WebSerial (Chrome/Edge only). Connect your plotter, calibrate pen heights with the test buttons, then plot.

## License

MIT
