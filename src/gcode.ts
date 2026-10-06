import type { NormalizedGeometry, Point } from './svg.js';

export type ToolMode = 'laser' | 'pen' | 'spindle';

export interface GcodeOptions {
  feedRate: number;
  drawFeedRate: number;
  travelFeedRate: number;
  safeZ: number;
  toolMode: ToolMode;
  toolOnCommand: string;
  toolOffCommand: string;
  laserOnCommand: string;
  laserOffCommand: string;
  laserDelay: number;
  laserPower: number;
  penUpZ: number;
  penDownZ: number;
  penUpCommand: string;
  penDownCommand: string;
  penDelay: number;
  passes: number;
  passDepth: number;
  offsetX: number;
  offsetY: number;
  mirrorX: boolean;
  mirrorY: boolean;
  returnToOrigin: boolean;
}

interface ToolController {
  begin(): string[];
  end(): string[];
  travel(point: Point): string[];
  draw(points: Point[]): string[];
}

function formatNumber(value: number): string {
  const rounded = Math.abs(value) < 0.000001 ? 0 : value;
  return rounded.toFixed(4).replace(/\.?0+$/, '');
}

function formatPoint(point: Point): string {
  return `X${formatNumber(point.x)} Y${formatNumber(point.y)}`;
}

function pushCommand(lines: string[], command: string): void {
  const trimmed = command.trim();
  if (trimmed) lines.push(trimmed);
}

function transformPoint(point: Point, scale: number, targetWidthMm: number, targetHeightMm: number, options: GcodeOptions): Point {
  const scaledX = point.x * scale;
  const scaledY = point.y * scale;
  return {
    x: (options.mirrorX ? targetWidthMm - scaledX : scaledX) + options.offsetX,
    y: (options.mirrorY ? targetHeightMm - scaledY : scaledY) + options.offsetY
  };
}

class LaserToolController implements ToolController {
  constructor(private readonly options: GcodeOptions) {}

  private delay(): string {
    return `G4 P${formatNumber(this.options.laserDelay)}`;
  }

  begin(): string[] {
    return [
      this.options.laserOffCommand,
      this.delay(),
      '',
      'G90',
      'G21',
      `G1 F${formatNumber(this.options.travelFeedRate)}`
    ];
  }

  end(): string[] {
    return [
      `G1 F${formatNumber(this.options.travelFeedRate)}`,
      'G1 X0 Y0',
      this.options.laserOffCommand
    ];
  }

  travel(point: Point): string[] {
    return [
      this.options.laserOffCommand,
      this.delay(),
      '',
      `G1 F${formatNumber(this.options.travelFeedRate)}`,
      `G1 ${formatPoint(point)}`,
      '',
      this.delay()
    ];
  }

  draw(points: Point[]): string[] {
    const lines = [
      '',
      this.options.laserOnCommand,
      this.delay(),
      '',
      `G1 F${formatNumber(this.options.drawFeedRate)}`
    ];
    for (const point of points.slice(1)) {
      lines.push(`G1 ${formatPoint(point)}`);
    }
    lines.push('');
    lines.push(this.delay());
    lines.push('');
    lines.push(this.options.laserOffCommand);
    lines.push(this.delay());
    return lines;
  }
}

class PenToolController implements ToolController {
  constructor(private readonly options: GcodeOptions) {}

  private delay(): string {
    return `G4 P${formatNumber(this.options.penDelay)}`;
  }

  begin(): string[] {
    return [
      this.options.penUpCommand,
      this.delay(),
      '',
      'G90',
      'G21',
      `G1 F${formatNumber(this.options.travelFeedRate)}`
    ];
  }

  end(): string[] {
    return [
      this.options.penUpCommand,
      this.delay()
    ];
  }

  travel(point: Point): string[] {
    return [
      '; PEN UP',
      this.options.penUpCommand,
      this.delay(),
      '',
      '; TRAVEL',
      `G1 F${formatNumber(this.options.travelFeedRate)}`,
      `G1 ${formatPoint(point)}`
    ];
  }

  draw(points: Point[]): string[] {
    const lines = [
      '',
      '; PEN DOWN',
      this.options.penDownCommand,
      this.delay(),
      '',
      '; DRAW',
      `G1 F${formatNumber(this.options.drawFeedRate)}`
    ];
    for (const point of points.slice(1)) {
      lines.push(`G1 ${formatPoint(point)}`);
    }
    lines.push('');
    lines.push('; PEN UP');
    lines.push(this.options.penUpCommand);
    lines.push(this.delay());
    return lines;
  }
}

class SpindleToolController implements ToolController {
  constructor(private readonly options: GcodeOptions) {}

  begin(): string[] {
    return [
      `G0 Z${formatNumber(this.options.safeZ)}`,
      this.options.toolOffCommand
    ];
  }

  end(): string[] {
    return [
      this.options.toolOffCommand,
      `G0 Z${formatNumber(this.options.safeZ)}`
    ];
  }

  travel(point: Point): string[] {
    return [
      this.options.toolOffCommand,
      `G0 Z${formatNumber(this.options.safeZ)}`,
      `G0 ${formatPoint(point)} F${formatNumber(this.options.travelFeedRate)}`
    ];
  }

  draw(points: Point[]): string[] {
    const lines = [
      this.options.toolOnCommand,
      `G1 Z${formatNumber(this.options.penDownZ)} F${formatNumber(this.options.drawFeedRate)}`
    ];
    for (const point of points.slice(1)) {
      lines.push(`G1 ${formatPoint(point)} F${formatNumber(this.options.drawFeedRate)}`);
    }
    lines.push(`G0 Z${formatNumber(this.options.safeZ)}`);
    lines.push(this.options.toolOffCommand);
    return lines;
  }
}

function createToolController(options: GcodeOptions): ToolController {
  if (options.toolMode === 'laser') return new LaserToolController(options);
  if (options.toolMode === 'pen') return new PenToolController(options);
  if (options.toolMode === 'spindle') return new SpindleToolController(options);
  throw new Error(`TOOL_MODE tidak didukung: ${options.toolMode}`);
}

export function generateGcode(geometry: NormalizedGeometry, targetWidthMm: number, options: GcodeOptions): string {
  if (geometry.width <= 0) {
    throw new Error('SVG geometry width harus lebih dari 0.');
  }

  const scale = targetWidthMm / geometry.width;
  const targetHeightMm = geometry.height * scale;
  const tool = createToolController(options);
  const lines: string[] = [
    '; Generated by autogcode',
    `; Target width: ${targetWidthMm}mm`,
    '; === START ==='
  ];

  for (const command of tool.begin()) {
    pushCommand(lines, command);
  }

  let pathNumber = 0;
  for (const polyline of geometry.polylines) {
    if (polyline.length < 2) continue;
    const points = polyline.map((point) => transformPoint(point, scale, targetWidthMm, targetHeightMm, options));
    const first = points[0];
    if (!first) continue;

    pathNumber += 1;
    lines.push('');
    lines.push(`; === STROKE ${pathNumber} ===`);

    for (const command of tool.travel(first)) {
      pushCommand(lines, command);
    }

    for (const command of tool.draw(points)) {
      pushCommand(lines, command);
    }
  }

  lines.push('');
  lines.push('; === END ===');
  if (options.returnToOrigin) {
    const origin: Point = { x: options.offsetX, y: options.offsetY };
    for (const command of tool.travel(origin)) {
      pushCommand(lines, command);
    }
    lines.push('');
  }
  for (const command of tool.end()) {
    pushCommand(lines, command);
  }

  return `${lines.join('\n')}\n`;
}
