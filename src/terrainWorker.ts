import type { ChunkPayload, ChunkRequest, TerrainSettings } from "./terrainTypes";

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<ChunkRequest>) => void) | null;
  postMessage: (message: ChunkPayload, transfer: Transferable[]) => void;
};

ctx.onmessage = (event: MessageEvent<ChunkRequest>) => {
  const payload = buildChunk(event.data);
  ctx.postMessage(payload, [
    payload.positions.buffer,
    payload.colors.buffer,
    payload.indices.buffer,
  ]);
};

function buildChunk(request: ChunkRequest): ChunkPayload {
  const { chunkX, chunkZ, settings } = request;
  const verticesPerSide = settings.resolution + 1;
  const vertexCount = verticesPerSide * verticesPerSide;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const heights = new Float32Array(vertexCount);
  const indices = new Uint32Array(settings.resolution * settings.resolution * 6);
  const half = settings.chunkSize / 2;
  const originX = chunkX * settings.chunkSize;
  const originZ = chunkZ * settings.chunkSize;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let cursor = 0;

  for (let z = 0; z < verticesPerSide; z += 1) {
    for (let x = 0; x < verticesPerSide; x += 1) {
      const u = x / settings.resolution;
      const v = z / settings.resolution;
      const localX = u * settings.chunkSize - half;
      const localZ = v * settings.chunkSize - half;
      const worldX = originX + localX;
      const worldZ = originZ + localZ;
      const height = sampleHeight(worldX, worldZ, settings);

      positions[cursor * 3] = localX;
      positions[cursor * 3 + 1] = height;
      positions[cursor * 3 + 2] = localZ;
      heights[cursor] = height;

      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
      cursor += 1;
    }
  }

  for (let z = 0; z < verticesPerSide; z += 1) {
    for (let x = 0; x < verticesPerSide; x += 1) {
      const index = z * verticesPerSide + x;
      const left = heights[z * verticesPerSide + Math.max(0, x - 1)];
      const right = heights[z * verticesPerSide + Math.min(verticesPerSide - 1, x + 1)];
      const down = heights[Math.max(0, z - 1) * verticesPerSide + x];
      const up = heights[Math.min(verticesPerSide - 1, z + 1) * verticesPerSide + x];
      const slope = Math.hypot(right - left, up - down) / (settings.chunkSize / settings.resolution);
      const localX = positions[index * 3];
      const localZ = positions[index * 3 + 2];
      paintVertex(
        colors,
        index,
        heights[index],
        slope,
        settings,
        originX + localX,
        originZ + localZ,
      );
    }
  }

  let indexCursor = 0;
  for (let z = 0; z < settings.resolution; z += 1) {
    for (let x = 0; x < settings.resolution; x += 1) {
      const a = z * verticesPerSide + x;
      const b = a + 1;
      const c = a + verticesPerSide;
      const d = c + 1;
      indices[indexCursor++] = a;
      indices[indexCursor++] = c;
      indices[indexCursor++] = b;
      indices[indexCursor++] = b;
      indices[indexCursor++] = c;
      indices[indexCursor++] = d;
    }
  }

  return {
    id: request.id,
    chunkX,
    chunkZ,
    positions,
    colors,
    indices,
    minHeight,
    maxHeight,
  };
}

function sampleHeight(x: number, z: number, settings: TerrainSettings): number {
  const continent = fbmValue(x, z, settings.seed + 19, 0.00165, 4, 2.05, 0.53);
  const mountainMask = smoothstep(-0.12, 0.72, continent);
  const ridgeBase = fbmValue(x, z, settings.seed + 47, settings.frequency * 0.72, 5, 2.18, 0.5);
  const ridges = Math.pow(1 - Math.abs(ridgeBase), 2.15);
  const folds = fbm(x * 0.78, z * 1.12, settings);
  const smallDetail = fbmValue(x, z, settings.seed + 133, settings.frequency * 3.2, 3, 2.4, 0.42);
  const riverNoise = Math.abs(fbmValue(x, z, settings.seed + 97, settings.frequency * 0.34, 4, 2, 0.48));
  const riverMask = 1 - smoothstep(settings.riverWidth, settings.riverWidth + 0.13, riverNoise);
  const valleyCut = riverMask * settings.rivers * (18 + mountainMask * 30);
  const plains = fbmValue(x, z, settings.seed + 211, 0.004, 3, 2, 0.45) * 16;
  const uplift = mountainMask * settings.amplitude * 0.52;
  const peaks = Math.pow(ridges, 1.45) * settings.amplitude * 1.08 * mountainMask;
  const erodedRoughness = smallDetail * settings.amplitude * 0.18 * mountainMask * settings.erosion;
  const valleyFloor = (1 - mountainMask) * plains - 8;
  const height = valleyFloor + uplift + peaks + folds * settings.amplitude * 0.24 + erodedRoughness - valleyCut;

  return Math.max(settings.waterLevel - 5, height);
}

function fbm(x: number, z: number, settings: TerrainSettings): number {
  return fbmValue(
    x,
    z,
    settings.seed,
    settings.frequency,
    settings.octaves,
    settings.lacunarity,
    settings.gain,
  );
}

function fbmValue(
  x: number,
  z: number,
  seed: number,
  frequency: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  let total = 0;
  let amp = 1;
  let freq = frequency;
  let norm = 0;

  for (let i = 0; i < octaves; i += 1) {
    total += noise2D(x * freq, z * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return total / norm;
}

function noise2D(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = fade(xf);
  const v = fade(zf);
  const aa = hash(xi, zi, seed);
  const ba = hash(xi + 1, zi, seed);
  const ab = hash(xi, zi + 1, seed);
  const bb = hash(xi + 1, zi + 1, seed);
  const x1 = lerp(grad(aa, xf, zf), grad(ba, xf - 1, zf), u);
  const x2 = lerp(grad(ab, xf, zf - 1), grad(bb, xf - 1, zf - 1), u);

  return lerp(x1, x2, v);
}

function hash(x: number, z: number, seed: number): number {
  let n = x * 374761393 + z * 668265263 + seed * 1442695041;
  n = (n ^ (n >> 13)) * 1274126177;
  return (n ^ (n >> 16)) >>> 0;
}

function grad(hashValue: number, x: number, z: number): number {
  switch (hashValue & 7) {
    case 0:
      return x + z;
    case 1:
      return -x + z;
    case 2:
      return x - z;
    case 3:
      return -x - z;
    case 4:
      return x;
    case 5:
      return -x;
    case 6:
      return z;
    default:
      return -z;
  }
}

function paintVertex(
  colors: Float32Array,
  index: number,
  height: number,
  slope: number,
  settings: TerrainSettings,
  x: number,
  z: number,
) {
  const wet = height <= settings.waterLevel + 1.5;
  const moisture = normalizedNoise(x * 0.018, z * 0.018, settings.seed + 301);
  const speckle = normalizedNoise(x * 0.09, z * 0.09, settings.seed + 302);
  const rock = smoothstep(0.42, 1.65, slope) * smoothstep(10, 130, height);
  const snow = smoothstep(100, 168, height) * (1 - smoothstep(0.08, 0.8, moisture));
  const shore = !wet ? 1 - smoothstep(settings.waterLevel + 1, settings.waterLevel + 15, height) : 0;
  const grass = mixColor([0.21, 0.4, 0.2], [0.43, 0.62, 0.34], moisture);
  const alpine = [0.38, 0.48, 0.39];
  const stone = mixColor([0.25, 0.28, 0.28], [0.58, 0.58, 0.52], smoothstep(0, 155, height));
  const snowColor = mixColor([0.78, 0.82, 0.8], [0.95, 0.96, 0.92], speckle);
  let color = wet ? [0.08, 0.27, 0.38] : mixColor(grass, alpine, smoothstep(44, 90, height));

  color = mixColor(color, [0.64, 0.57, 0.42], shore);
  color = mixColor(color, stone, rock);
  color = mixColor(color, snowColor, snow);
  color = shadeColor(color, 0.82 + speckle * 0.22);

  colors[index * 3] = color[0];
  colors[index * 3 + 1] = color[1];
  colors[index * 3 + 2] = color[2];
}

function normalizedNoise(x: number, z: number, seed: number): number {
  return noise2D(x, z, seed) * 0.5 + 0.5;
}

function mixColor(a: number[], b: number[], t: number): number[] {
  const amount = Math.min(1, Math.max(0, t));
  return [
    lerp(a[0], b[0], amount),
    lerp(a[1], b[1], amount),
    lerp(a[2], b[2], amount),
  ];
}

function shadeColor(color: number[], amount: number): number[] {
  return color.map((component) => Math.min(1, Math.max(0, component * amount)));
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
