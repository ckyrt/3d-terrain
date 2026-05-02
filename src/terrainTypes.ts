export type TerrainSettings = {
  seed: number;
  chunkSize: number;
  resolution: number;
  renderDistance: number;
  frequency: number;
  amplitude: number;
  lacunarity: number;
  gain: number;
  octaves: number;
  erosion: number;
  rivers: number;
  riverWidth: number;
  waterLevel: number;
};

export type ChunkRequest = {
  id: number;
  chunkX: number;
  chunkZ: number;
  settings: TerrainSettings;
};

export type ChunkPayload = {
  id: number;
  chunkX: number;
  chunkZ: number;
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  minHeight: number;
  maxHeight: number;
};
