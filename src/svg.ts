import { XMLParser } from 'fast-xml-parser';

export interface Point {
  x: number;
  y: number;
}

export interface NormalizedGeometry {
  polylines: Point[][];
  width: number;
  height: number;
}

type Matrix = [number, number, number, number, number, number];

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SUPPORTED_ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon']);

function attrNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return fallback;
  const match = value.trim().match(/^-?\d*\.?\d+(?:e[-+]?\d+)?/i);
  return match ? Number(match[0]) : fallback;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
}

function applyMatrix(point: Point, matrix: Matrix): Point {
  return {
    x: point.x * matrix[0] + point.y * matrix[2] + matrix[4],
    y: point.x * matrix[1] + point.y * matrix[3] + matrix[5]
  };
}

function parseTransform(transform: unknown): Matrix {
  if (typeof transform !== 'string' || !transform.trim()) return IDENTITY;
  let matrix = IDENTITY;
  const regex = /(translate|scale|rotate)\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(transform)) !== null) {
    const command = match[1]?.toLowerCase();
    const values = (match[2] ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);

    let next: Matrix = IDENTITY;
    if (command === 'translate') {
      next = [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0];
    } else if (command === 'scale') {
      const sx = values[0] ?? 1;
      const sy = values[1] ?? sx;
      next = [sx, 0, 0, sy, 0, 0];
    } else if (command === 'rotate') {
      const angle = ((values[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const cx = values[1] ?? 0;
      const cy = values[2] ?? 0;
      next = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    }
    matrix = multiply(matrix, next);
  }

  return matrix;
}

function transformPolyline(points: Point[], matrix: Matrix): Point[] {
  return points.map((point) => applyMatrix(point, matrix));
}

function parsePoints(value: unknown): Point[] {
  if (typeof value !== 'string') return [];
  const numbers = value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const points: Point[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index] ?? 0, y: numbers[index + 1] ?? 0 });
  }
  return points;
}

function tokenizePath(d: string): string[] {
  return d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
}

function isCommand(token: string | undefined): boolean {
  return !!token && /^[a-zA-Z]$/.test(token);
}

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point, steps = 16): Point[] {
  const points: Point[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    points.push({
      x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
      y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y
    });
  }
  return points;
}

function sampleQuadratic(p0: Point, p1: Point, p2: Point, steps = 16): Point[] {
  const points: Point[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    points.push({
      x: mt ** 2 * p0.x + 2 * mt * t * p1.x + t ** 2 * p2.x,
      y: mt ** 2 * p0.y + 2 * mt * t * p1.y + t ** 2 * p2.y
    });
  }
  return points;
}

function parsePath(d: unknown): Point[][] {
  if (typeof d !== 'string') return [];
  const tokens = tokenizePath(d);
  const polylines: Point[][] = [];
  let i = 0;
  let command = '';
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let currentLine: Point[] = [];
  let lastCubicControl: Point | null = null;
  let lastQuadraticControl: Point | null = null;

  const read = (): number => Number(tokens[i++] ?? 0);
  const point = (relative: boolean): Point => {
    const x = read();
    const y = read();
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };
  const flush = (): void => {
    if (currentLine.length > 1) polylines.push(currentLine);
    currentLine = [];
  };
  const add = (p: Point): void => {
    currentLine.push(p);
    current = p;
  };

  while (i < tokens.length) {
    if (isCommand(tokens[i])) {
      command = tokens[i++] ?? '';
    }
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();

    if (upper === 'M') {
      flush();
      const p = point(relative);
      current = p;
      start = p;
      currentLine = [p];
      command = relative ? 'l' : 'L';
      lastCubicControl = null;
      lastQuadraticControl = null;
    } else if (upper === 'L') {
      add(point(relative));
      lastCubicControl = null;
      lastQuadraticControl = null;
    } else if (upper === 'H') {
      const x = read();
      add({ x: relative ? current.x + x : x, y: current.y });
      lastCubicControl = null;
      lastQuadraticControl = null;
    } else if (upper === 'V') {
      const y = read();
      add({ x: current.x, y: relative ? current.y + y : y });
      lastCubicControl = null;
      lastQuadraticControl = null;
    } else if (upper === 'C') {
      const c1 = point(relative);
      const c2 = point(relative);
      const end = point(relative);
      currentLine.push(...sampleCubic(current, c1, c2, end));
      current = end;
      lastCubicControl = c2;
      lastQuadraticControl = null;
    } else if (upper === 'S') {
      const reflected = lastCubicControl
        ? { x: current.x * 2 - lastCubicControl.x, y: current.y * 2 - lastCubicControl.y }
        : current;
      const c2 = point(relative);
      const end = point(relative);
      currentLine.push(...sampleCubic(current, reflected, c2, end));
      current = end;
      lastCubicControl = c2;
      lastQuadraticControl = null;
    } else if (upper === 'Q') {
      const c = point(relative);
      const end = point(relative);
      currentLine.push(...sampleQuadratic(current, c, end));
      current = end;
      lastQuadraticControl = c;
      lastCubicControl = null;
    } else if (upper === 'T') {
      const reflected = lastQuadraticControl
        ? { x: current.x * 2 - lastQuadraticControl.x, y: current.y * 2 - lastQuadraticControl.y }
        : current;
      const end = point(relative);
      currentLine.push(...sampleQuadratic(current, reflected, end));
      current = end;
      lastQuadraticControl = reflected;
      lastCubicControl = null;
    } else if (upper === 'A') {
      i += 5;
      add(point(relative));
      lastCubicControl = null;
      lastQuadraticControl = null;
    } else if (upper === 'Z') {
      add(start);
      flush();
      current = start;
      lastCubicControl = null;
      lastQuadraticControl = null;
    } else {
      i += 1;
    }
  }

  flush();
  return polylines;
}

function rectangle(node: Record<string, unknown>): Point[] {
  const x = attrNumber(node.x);
  const y = attrNumber(node.y);
  const width = attrNumber(node.width);
  const height = attrNumber(node.height);
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
    { x, y }
  ];
}

function circle(node: Record<string, unknown>): Point[] {
  const cx = attrNumber(node.cx);
  const cy = attrNumber(node.cy);
  const r = attrNumber(node.r);
  const points: Point[] = [];
  for (let index = 0; index <= 64; index += 1) {
    const angle = (Math.PI * 2 * index) / 64;
    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return points;
}

function line(node: Record<string, unknown>): Point[] {
  return [
    { x: attrNumber(node.x1), y: attrNumber(node.y1) },
    { x: attrNumber(node.x2), y: attrNumber(node.y2) }
  ];
}

function collectPolylines(node: unknown, inheritedMatrix: Matrix, output: Point[][]): void {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;

  for (const [name, rawValue] of Object.entries(record)) {
    if (name.startsWith('@_') || name === '#text') continue;
    if (!SUPPORTED_ELEMENTS.has(name)) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];

    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const element = value as Record<string, unknown>;
      const localMatrix = multiply(inheritedMatrix, parseTransform(element.transform));

      if (name === 'path') {
        for (const polyline of parsePath(element.d)) output.push(transformPolyline(polyline, localMatrix));
      } else if (name === 'rect') {
        output.push(transformPolyline(rectangle(element), localMatrix));
      } else if (name === 'circle') {
        output.push(transformPolyline(circle(element), localMatrix));
      } else if (name === 'line') {
        output.push(transformPolyline(line(element), localMatrix));
      } else if (name === 'polyline') {
        output.push(transformPolyline(parsePoints(element.points), localMatrix));
      } else if (name === 'polygon') {
        const points = parsePoints(element.points);
        if (points.length > 0) points.push(points[0] as Point);
        output.push(transformPolyline(points, localMatrix));
      }

      collectPolylines(element, localMatrix, output);
    }
  }
}

function computeBounds(polylines: Point[][]): Bounds {
  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };

  for (const polyline of polylines) {
    for (const point of polyline) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
  }

  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) {
    throw new Error('Tidak ada geometry SVG yang didukung.');
  }

  return bounds;
}

export function parseSvgGeometry(svgContent: string): NormalizedGeometry {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name) => ['g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon'].includes(name)
  });
  const parsed = parser.parse(svgContent) as Record<string, unknown>;
  const root = parsed.svg;
  if (!root || typeof root !== 'object') {
    throw new Error('File bukan SVG valid.');
  }

  const polylines: Point[][] = [];
  collectPolylines({ svg: root }, IDENTITY, polylines);
  const usefulPolylines = polylines.filter((polyline) => polyline.length >= 2);
  const bounds = computeBounds(usefulPolylines);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  if (width <= 0 || height < 0) {
    throw new Error('Bounding box SVG tidak valid.');
  }

  return {
    width,
    height,
    polylines: usefulPolylines.map((polyline) =>
      polyline.map((point) => ({
        x: point.x - bounds.minX,
        y: point.y - bounds.minY
      }))
    )
  };
}
