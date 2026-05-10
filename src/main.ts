import "./styles.css";
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DirectionalLight,
  Euler,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Timer,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";

type Biome = "water" | "sand" | "grass" | "forest" | "rock" | "road" | "building" | "snow";
type Weather = "clear" | "cloudy" | "rain" | "storm" | "fog";

type MapData = {
  width: number;
  height: number;
  layout: ImageData;
  heightmap: ImageData;
};

const DEFAULT_MAP = "/generated-heightmap.png";
const WORLD_SIZE = 4500;
const GRID_RESOLUTION = 260;
const HEIGHT_SCALE = 520;
const HEIGHT_CONTRAST = 1.03;
const WATER_LEVEL = 72;
const EYE_HEIGHT = 14;
const DEBUG_TERRAIN = true;

const biomeColors: Record<Biome, number[]> = {
  water: [0.05, 0.25, 0.34],
  sand: [0.68, 0.6, 0.42],
  grass: [0.24, 0.43, 0.2],
  forest: [0.08, 0.24, 0.08],
  rock: [0.42, 0.42, 0.39],
  road: [0.42, 0.4, 0.37],
  building: [0.55, 0.18, 0.12],
  snow: [0.82, 0.84, 0.8],
};

const biomeIds: Record<Biome, number> = {
  water: 0,
  sand: 1,
  grass: 2,
  forest: 3,
  rock: 4,
  road: 5,
  building: 6,
  snow: 7,
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App container was not found.");
}

app.innerHTML = `
  <main class="viewport">
    <section class="hud" aria-label="Terrain controls">
      <h1>World Map Terrain</h1>
      <div class="meta">
        <div class="metric"><span>Source</span><strong id="source">world map</strong></div>
        <div class="metric"><span>Resolution</span><strong>${GRID_RESOLUTION}</strong></div>
        <div class="metric"><span>Keys</span><strong id="keys">click scene</strong></div>
      </div>
      <div class="actions">
        <label class="file-button">
          Load map
          <input id="mapInput" type="file" accept="image/*">
        </label>
        <button id="reset" type="button">Reset view</button>
        <button id="time" type="button">Time</button>
        <button id="weather" type="button">Weather</button>
      </div>
    </section>
    <p class="hint">Click scene. WASD fly, mouse look, Space/E up, Ctrl/C down, Shift sprint, Esc releases mouse.</p>
  </main>
`;

const viewport = app.querySelector<HTMLElement>(".viewport")!;
const sourceMetric = app.querySelector<HTMLElement>("#source")!;
const keysMetric = app.querySelector<HTMLElement>("#keys")!;
const mapInput = app.querySelector<HTMLInputElement>("#mapInput")!;
const resetButton = app.querySelector<HTMLButtonElement>("#reset")!;
const timeButton = app.querySelector<HTMLButtonElement>("#time")!;
const weatherButton = app.querySelector<HTMLButtonElement>("#weather")!;
const textureLoader = new TextureLoader();
const gltfLoader = new GLTFLoader();
const vegetationAssets = {
  pines: [] as Group[],
  broadleaf: [] as Group[],
  bushes: [] as Group[],
  grasses: [] as Group[],
  loaded: false,
};
const terrainTextures = {
  grass: {
    albedo: loadTerrainTexture("/assets/textures/grass.jpg"),
    normal: loadLinearTexture("/assets/textures/grass-normal.jpg"),
    rough: loadLinearTexture("/assets/textures/grass-rough.jpg"),
  },
  forest: {
    albedo: loadTerrainTexture("/assets/textures/forest.jpg"),
    normal: loadLinearTexture("/assets/textures/forest-normal.jpg"),
    rough: loadLinearTexture("/assets/textures/forest-rough.jpg"),
  },
  sand: {
    albedo: loadTerrainTexture("/assets/textures/sand.jpg"),
    normal: loadLinearTexture("/assets/textures/sand-normal.jpg"),
    rough: loadLinearTexture("/assets/textures/sand-rough.jpg"),
  },
  rock: {
    albedo: loadTerrainTexture("/assets/textures/rock.jpg"),
    normal: loadLinearTexture("/assets/textures/rock-normal.jpg"),
    rough: loadLinearTexture("/assets/textures/rock-rough.jpg"),
  },
  road: {
    albedo: loadTerrainTexture("/assets/textures/road.jpg"),
    normal: loadLinearTexture("/assets/textures/road-normal.jpg"),
    rough: loadLinearTexture("/assets/textures/road-rough.jpg"),
  },
  mud: {
    albedo: loadTerrainTexture("/assets/textures/mud.jpg"),
    normal: loadLinearTexture("/assets/textures/mud-normal.jpg"),
    rough: loadLinearTexture("/assets/textures/mud-rough.jpg"),
  },
};
const renderer = new WebGLRenderer({ antialias: true });
const scene = new Scene();
const camera = new PerspectiveCamera(54, 1, 0.1, 4000);
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const ssaoPass = new SSAOPass(scene, camera, viewport.clientWidth, viewport.clientHeight);
const outputPass = new OutputPass();
const terrainMaterial = new MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.74,
  metalness: 0,
  envMapIntensity: 0.22,
});
const terrainSurfaceMaterials: Partial<Record<Biome, MeshStandardMaterial>> = {
  sand: new MeshStandardMaterial({
    vertexColors: true,
    map: terrainTextures.sand.albedo,
    normalMap: terrainTextures.sand.normal,
    roughnessMap: terrainTextures.sand.rough,
    roughness: 0.86,
    metalness: 0,
    envMapIntensity: 0.18,
  }),
  grass: new MeshStandardMaterial({
    vertexColors: true,
    map: terrainTextures.grass.albedo,
    normalMap: terrainTextures.grass.normal,
    roughnessMap: terrainTextures.grass.rough,
    roughness: 0.78,
    metalness: 0,
    envMapIntensity: 0.18,
  }),
  forest: new MeshStandardMaterial({
    vertexColors: true,
    map: terrainTextures.forest.albedo,
    normalMap: terrainTextures.forest.normal,
    roughnessMap: terrainTextures.forest.rough,
    roughness: 0.84,
    metalness: 0,
    envMapIntensity: 0.14,
  }),
  rock: new MeshStandardMaterial({
    vertexColors: true,
    map: terrainTextures.rock.albedo,
    normalMap: terrainTextures.rock.normal,
    roughnessMap: terrainTextures.rock.rough,
    roughness: 0.68,
    metalness: 0,
    envMapIntensity: 0.32,
  }),
};
const terrainShaderMaterial = new ShaderMaterial({
  name: "terrain-splat-triplanar",
  uniforms: {
    sunDirection: { value: new Vector3(-0.52, 0.74, 0.43).normalize() },
    fogColor: { value: new Color("#aebfc6") },
    fogNear: { value: 1600 },
    fogFar: { value: 5200 },
    grassMap: { value: terrainTextures.grass.albedo },
    forestMap: { value: terrainTextures.forest.albedo },
    sandMap: { value: terrainTextures.sand.albedo },
    rockMap: { value: terrainTextures.rock.albedo },
    roadMap: { value: terrainTextures.road.albedo },
    mudMap: { value: terrainTextures.mud.albedo },
    grassNormalMap: { value: terrainTextures.grass.normal },
    forestNormalMap: { value: terrainTextures.forest.normal },
    sandNormalMap: { value: terrainTextures.sand.normal },
    rockNormalMap: { value: terrainTextures.rock.normal },
    roadNormalMap: { value: terrainTextures.road.normal },
    mudNormalMap: { value: terrainTextures.mud.normal },
  },
  vertexShader: `
    attribute vec3 color;
    attribute float biome;
    attribute float terrainHeight;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying vec3 vVertexColor;
    varying float vBiome;
    varying float vHeight;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      vNormal = normalize(normalMatrix * normal);
      vVertexColor = color;
      vBiome = biome;
      vHeight = terrainHeight;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 sunDirection;
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    uniform sampler2D grassMap;
    uniform sampler2D forestMap;
    uniform sampler2D sandMap;
    uniform sampler2D rockMap;
    uniform sampler2D roadMap;
    uniform sampler2D mudMap;
    uniform sampler2D grassNormalMap;
    uniform sampler2D forestNormalMap;
    uniform sampler2D sandNormalMap;
    uniform sampler2D rockNormalMap;
    uniform sampler2D roadNormalMap;
    uniform sampler2D mudNormalMap;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying vec3 vVertexColor;
    varying float vBiome;
    varying float vHeight;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += noise(p) * a;
        p *= 2.03;
        a *= 0.5;
      }
      return v;
    }

    vec3 toLinear(vec3 color) {
      return pow(max(color, vec3(0.0)), vec3(2.2));
    }

    vec3 triPlanar(sampler2D tex, vec3 worldPos, vec3 normal, float scale) {
      vec3 blend = pow(abs(normal), vec3(4.0));
      blend /= max(blend.x + blend.y + blend.z, 0.0001);
      vec3 x = toLinear(texture2D(tex, worldPos.zy * scale).rgb);
      vec3 y = toLinear(texture2D(tex, worldPos.xz * scale).rgb);
      vec3 z = toLinear(texture2D(tex, worldPos.xy * scale).rgb);
      return x * blend.x + y * blend.y + z * blend.z;
    }

    vec3 layeredTexture(sampler2D tex, vec3 worldPos, vec3 normal, float scale, float detailScale) {
      vec3 broad = triPlanar(tex, worldPos, normal, scale);
      vec3 detail = triPlanar(tex, worldPos + vec3(37.0, 11.0, -23.0), normal, scale * detailScale);
      return mix(broad, detail, 0.28);
    }

    vec3 triPlanarNormal(sampler2D tex, vec3 worldPos, vec3 normal, float scale) {
      vec3 blend = pow(abs(normal), vec3(4.0));
      blend /= max(blend.x + blend.y + blend.z, 0.0001);
      vec3 nx = texture2D(tex, worldPos.zy * scale).xyz * 2.0 - 1.0;
      vec3 ny = texture2D(tex, worldPos.xz * scale).xyz * 2.0 - 1.0;
      vec3 nz = texture2D(tex, worldPos.xy * scale).xyz * 2.0 - 1.0;
      vec3 wx = normalize(vec3(nx.z, nx.x, nx.y));
      vec3 wy = normalize(vec3(ny.x, ny.z, ny.y));
      vec3 wz = normalize(vec3(nz.x, nz.y, nz.z));
      return normalize(wx * blend.x + wy * blend.y + wz * blend.z);
    }

    vec3 detailNormalForBiome(float id, vec3 worldPos, vec3 normal, float slope) {
      vec3 detail = triPlanarNormal(grassNormalMap, worldPos, normal, 0.042);
      if (id > 1.5 && id < 2.5) detail = triPlanarNormal(grassNormalMap, worldPos, normal, 0.045);
      if (id > 2.5 && id < 3.5) detail = triPlanarNormal(forestNormalMap, worldPos, normal, 0.044);
      if (id > 0.5 && id < 1.5) detail = triPlanarNormal(sandNormalMap, worldPos, normal, 0.060);
      if (id > 3.5 && id < 4.5) detail = triPlanarNormal(rockNormalMap, worldPos, normal, 0.033);
      if (id > 4.5 && id < 5.5) detail = triPlanarNormal(roadNormalMap, worldPos, normal, 0.065);
      if (id > 5.5 && id < 6.5) detail = triPlanarNormal(mudNormalMap, worldPos, normal, 0.045);
      return normalize(mix(normal, detail, mix(0.16, 0.44, smoothstep(0.18, 0.72, slope))));
    }

    float roughnessForBiome(float id, vec3 worldPos, vec3 normal) {
      float detail = fbm(worldPos.xz * 0.12);
      if (id < 1.5) return mix(0.82, 0.96, detail);
      if (id < 2.5) return mix(0.74, 0.92, detail);
      if (id < 3.5) return mix(0.82, 0.98, detail);
      if (id < 4.5) return mix(0.62, 0.84, detail);
      if (id < 5.5) return mix(0.88, 1.00, detail);
      if (id < 6.5) return mix(0.86, 1.00, detail);
      return 0.92;
    }

    vec3 biomeColor(float id, vec3 worldPos, vec3 normal, float slope) {
      vec2 p = worldPos.xz;
      float fine = fbm(p * 0.09);
      float coarse = fbm(p * 0.022);
      vec3 grassTex = layeredTexture(grassMap, worldPos, normal, 0.074, 2.1);
      vec3 forestTex = layeredTexture(forestMap, worldPos, normal, 0.068, 2.0);
      vec3 sandTex = layeredTexture(sandMap, worldPos, normal, 0.082, 1.9);
      vec3 rockTex = layeredTexture(rockMap, worldPos, normal, 0.052, 2.2);
      vec3 roadTex = layeredTexture(roadMap, worldPos, normal, 0.092, 1.8);
      vec3 mudTex = layeredTexture(mudMap, worldPos, normal, 0.070, 2.0);
      if (id < 0.5) return mix(vec3(0.00, 0.20, 0.34), vec3(0.03, 0.52, 0.64), fine);
      if (id < 1.5) {
        vec3 sandBase = mix(vec3(0.78, 0.62, 0.32), vec3(0.96, 0.80, 0.44), fine);
        return mix(sandBase, sandTex, 0.16);
      }
      if (id < 2.5) {
        vec3 grassBase = mix(vec3(0.15, 0.38, 0.10), vec3(0.38, 0.58, 0.18), fine * 0.7 + coarse * 0.3);
        return mix(grassBase, grassTex, 0.14);
      }
      if (id < 3.5) {
        vec3 forestBase = mix(vec3(0.035, 0.18, 0.055), vec3(0.11, 0.33, 0.09), fine);
        return mix(forestBase, forestTex, 0.10);
      }
      if (id < 4.5) {
        vec3 rockBase = mix(vec3(0.36, 0.35, 0.31), vec3(0.62, 0.58, 0.48), fine);
        return mix(rockBase, rockTex, 0.22);
      }
      if (id < 5.5) {
        vec3 roadBase = mix(vec3(0.28, 0.25, 0.21), vec3(0.48, 0.42, 0.34), fine);
        return mix(roadBase, roadTex, 0.18);
      }
      if (id < 6.5) {
        vec3 mudBase = mix(vec3(0.36, 0.22, 0.12), vec3(0.62, 0.42, 0.22), fine);
        return mix(mudBase, mudTex, 0.18);
      }
      return vec3(0.82, 0.84, 0.80);
    }

    void main() {
      vec3 geoNormal = normalize(vNormal);
      float slope = 1.0 - clamp(geoNormal.y, 0.0, 1.0);
      vec2 p = vWorldPosition.xz;
      vec3 n = detailNormalForBiome(vBiome, vWorldPosition, geoNormal, slope);
      float roughness = roughnessForBiome(vBiome, vWorldPosition, geoNormal);
      vec3 base = vVertexColor;
      vec3 materialDetail = biomeColor(vBiome, vWorldPosition, geoNormal, slope);
      float textureInfluence = vBiome < 0.5 ? 0.0 : vBiome < 1.5 ? 0.42 : vBiome < 2.5 ? 0.52 : vBiome < 3.5 ? 0.48 : vBiome < 4.5 ? 0.64 : 0.46;
      base = mix(base, materialDetail, textureInfluence);
      float macroBreakup = mix(0.76, 1.12, fbm(p * 0.006)) * mix(0.90, 1.08, fbm(p * 0.038));
      base *= macroBreakup;
      vec3 rock = layeredTexture(rockMap, vWorldPosition, geoNormal, 0.056, 2.1) * mix(vec3(0.48), vec3(0.96), fbm(p * 0.075));
      if ((vBiome > 1.5 && vBiome < 3.6) && slope > 0.34) {
        base = mix(base, rock, smoothstep(0.34, 0.78, slope) * 0.82);
      }
      if (vHeight > 50.0 && vBiome > 3.5 && vBiome < 4.7) {
        base = mix(base, vec3(0.48, 0.48, 0.43), smoothstep(50.0, 70.0, vHeight) * 0.12);
      }

      float terrainAO = mix(0.58, 1.0, fbm(p * 0.018));
      float fineDirt = mix(0.88, 1.08, fbm(p * 0.20));
      float diffuse = max(dot(n, normalize(sunDirection)), 0.0);
      float wrapped = diffuse * 0.82 + 0.18;
      float hemi = 0.26 + n.y * 0.52;
      float slopeShade = mix(1.0, 0.62, smoothstep(0.32, 0.86, slope));
      float heightShade = mix(0.92, 1.08, smoothstep(8.0, 58.0, vHeight));
      vec3 halfDir = normalize(normalize(sunDirection) + normalize(cameraPosition - vWorldPosition));
      float microSpec = pow(max(dot(n, halfDir), 0.0), mix(28.0, 5.0, roughness)) * (1.0 - roughness) * 0.10;
      vec3 color = base * (hemi + wrapped * 0.94) * terrainAO * fineDirt * slopeShade * heightShade;
      color = pow(max(color, vec3(0.0)), vec3(0.92));
      color += vec3(0.86, 0.78, 0.62) * microSpec;

      float dist = length(cameraPosition - vWorldPosition);
      float fogFactor = smoothstep(fogNear, fogFar, dist) * 0.34;
      gl_FragColor = vec4(mix(color, fogColor, fogFactor), 1.0);
    }
  `,
});
const roadMaterial = new MeshStandardMaterial({
  map: terrainTextures.road.albedo,
  normalMap: terrainTextures.road.normal,
  roughnessMap: terrainTextures.road.rough,
  color: "#9a9688",
  roughness: 1,
  metalness: 0,
});
const cityPadMaterial = new MeshStandardMaterial({
  map: terrainTextures.mud.albedo,
  normalMap: terrainTextures.mud.normal,
  roughnessMap: terrainTextures.mud.rough,
  color: "#8a8170",
  roughness: 1,
  metalness: 0,
});
const shorelineMaterial = new MeshStandardMaterial({
  color: "#d8eee7",
  transparent: true,
  opacity: 0.24,
  roughness: 0.88,
  metalness: 0,
  depthWrite: false,
});
const simpleWaterMaterial = new MeshStandardMaterial({
  color: "#0284bd",
  emissive: "#003c63",
  emissiveIntensity: 0.14,
  roughness: 0.18,
  metalness: 0,
  envMapIntensity: 0.75,
});
const waterMaterial = new ShaderMaterial({
  transparent: false,
  depthWrite: true,
  depthTest: true,
  side: DoubleSide,
  uniforms: {
    time: { value: 0 },
    deepColor: { value: new Color("#001c34") },
    shallowColor: { value: new Color("#005f86") },
    foamColor: { value: new Color("#d6f2ef") },
    sunDirection: { value: new Vector3(-0.52, 0.74, 0.43).normalize() },
    skyColor: { value: new Color("#0b2638") },
    stormFactor: { value: 0 },
  },
  vertexShader: `
    uniform float time;
    varying vec3 vWorldPosition;
    varying float vWave;
    varying vec2 vFlow;

    float wave(vec2 p, float t) {
      return sin(p.x * 0.052 + t * 1.7) * 0.46
        + sin((p.x + p.y) * 0.033 + t * 1.13) * 0.54
        + sin(p.y * 0.079 - t * 2.15) * 0.24
        + sin(length(p) * 0.046 - t * 1.25) * 0.25
        + sin((p.x * 0.41 - p.y * 0.23) + t * 4.1) * 0.045;
    }

    void main() {
      vec3 transformed = position;
      vWave = wave(position.xz, time);
      vFlow = vec2(
        sin(position.z * 0.035 + time * 0.7),
        cos(position.x * 0.028 - time * 0.9)
      );
      transformed.y += vWave;
      vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 deepColor;
    uniform vec3 shallowColor;
    uniform vec3 foamColor;
    uniform vec3 sunDirection;
    uniform vec3 skyColor;
    uniform float time;
    uniform float stormFactor;
    varying vec3 vWorldPosition;
    varying float vWave;
    varying vec2 vFlow;

    float rippleNoise(vec2 p) {
      return sin(p.x * 0.18 + time * 2.4) * sin(p.y * 0.21 - time * 1.7);
    }

    void main() {
      vec2 p = vWorldPosition.xz;
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      vec3 normal = normalize(vec3(vFlow.x * 0.16, 1.0, vFlow.y * 0.16));
      float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 4.4);
      float current = sin(p.x * 0.022 + time * 1.5) * sin(p.y * 0.018 - time * 0.9);
      float longWave = sin(p.x * 0.09 + time * 1.7) * 0.5 + 0.5;
      float travelingRipples = sin(p.x * 0.86 + p.y * 0.28 + time * 6.2) * 0.5 + 0.5;
      float crossRipples = sin(p.x * -0.38 + p.y * 0.92 - time * 5.0) * 0.5 + 0.5;
      float foam = smoothstep(0.78, 1.16, abs(vWave + current * 0.42));
      vec3 color = mix(vec3(0.0, 0.08, 0.22), vec3(0.0, 0.36, 0.58), 0.30 + longWave * 0.18);
      color += vec3(0.0, 0.24, 0.34) * travelingRipples * 0.14;
      color += vec3(0.12, 0.48, 0.58) * crossRipples * 0.09;
      float spec = pow(max(dot(reflect(-sunDirection, normal), viewDir), 0.0), 96.0);
      color += vec3(1.0, 0.86, 0.62) * spec * 0.55;
      color = mix(color, foamColor, foam * 0.08);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
const terrainGroup = new Group();
const scratchMatrix = new Matrix4();
const scratchQuat = new Quaternion();
const scratchEuler = new Euler();
const timer = new Timer();
timer.connect(document);
const moveKeys = new Set<string>();
const weatherModes: Weather[] = ["clear", "cloudy", "rain", "storm", "fog"];
const skyControls = {
  timeOfDay: 0.25,
  weatherIndex: 0,
  autoTime: false,
};
const terrainSample = {
  heights: undefined as Float32Array | undefined,
  verticesPerSide: 0,
};
const walkDirection = new Vector3();
const walkForward = new Vector3();
const walkRight = new Vector3();
let yaw = -0.74;
let pitch = -0.28;
let terrainMeshes: Mesh[] = [];
let waterMesh: Mesh<BufferGeometry, ShaderMaterial> | undefined;
let skyMaterial: ShaderMaterial | undefined;
let skyDome: Mesh<SphereGeometry, ShaderMaterial> | undefined;
let cloudMaterial: ShaderMaterial | undefined;
let cloudDeck: Mesh<PlaneGeometry, ShaderMaterial> | undefined;
let rain: Points<BufferGeometry, PointsMaterial> | undefined;
let currentMap: MapData | undefined;

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.setClearColor("#b9cbd2");
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
viewport.append(renderer.domElement);
viewport.tabIndex = 0;
renderer.domElement.tabIndex = 0;
ssaoPass.kernelRadius = 24;
ssaoPass.minDistance = 0.001;
ssaoPass.maxDistance = 0.24;
composer.addPass(renderPass);
composer.addPass(ssaoPass);
composer.addPass(outputPass);

scene.background = new Color("#aebfc6");
scene.fog = new Fog("#aebfc6", 1600, 5200);
scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new HemisphereLight("#eaf3f6", "#314128", 1.05));

const sun = new DirectionalLight("#ffe0b0", 4.6);
sun.position.set(-440, 620, 360);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 1600;
sun.shadow.camera.left = -620;
sun.shadow.camera.right = 620;
sun.shadow.camera.top = 620;
sun.shadow.camera.bottom = -620;
sun.shadow.bias = -0.00008;
sun.shadow.normalBias = 0.045;
scene.add(sun);
scene.add(terrainGroup);
addSkyDome();

attachUi();
resetCamera();
loadVegetationAssets()
  .catch((error) => {
    console.warn("Vegetation models failed to load; using procedural fallback.", error);
  })
  .finally(() => loadMap(DEFAULT_MAP, "world map").catch((error) => {
  sourceMetric.textContent = "load failed";
  console.error(error);
}));
animate();

function attachUi() {
  viewport.addEventListener("pointerdown", activateControls);
  renderer.domElement.addEventListener("pointerdown", activateControls);
  renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("mousemove", (event) => {
    if (!isPointerLocked()) return;
    yaw -= event.movementX * 0.0022;
    pitch -= event.movementY * 0.0022;
    pitch = Math.max(-1.25, Math.min(0.82, pitch));
    updateCameraRotation();
  });
  window.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keydown", handleKeyDown, true);
  viewport.addEventListener("keydown", handleKeyDown, true);
  renderer.domElement.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keyup", handleKeyUp, true);
  document.addEventListener("keyup", handleKeyUp, true);
  viewport.addEventListener("keyup", handleKeyUp, true);
  renderer.domElement.addEventListener("keyup", handleKeyUp, true);
  window.addEventListener("blur", () => moveKeys.clear());
  document.addEventListener("pointerlockchange", updateInputMetric);

  mapInput.addEventListener("change", () => {
    const file = mapInput.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    loadMap(url, file.name).finally(() => URL.revokeObjectURL(url));
  });

  resetButton.addEventListener("click", resetCamera);
  timeButton.addEventListener("click", () => {
    skyControls.autoTime = false;
    skyControls.timeOfDay = (skyControls.timeOfDay + 0.25) % 1;
    updateEnvironment();
    updateControlLabels();
  });
  weatherButton.addEventListener("click", () => {
    skyControls.weatherIndex = (skyControls.weatherIndex + 1) % weatherModes.length;
    updateEnvironment();
    updateControlLabels();
  });
  window.addEventListener("resize", resize);
  updateControlLabels();
  setTimeout(activateFocusOnly, 0);
  resize();
}

function activateControls() {
  activateFocusOnly();
  try {
    const lockRequest = renderer.domElement.requestPointerLock?.();
    if (lockRequest instanceof Promise) {
      lockRequest.catch((error) => console.warn("[terrain] pointer lock skipped", error));
    }
  } catch (error) {
    console.warn("[terrain] pointer lock skipped", error);
  }
}

function activateFocusOnly() {
  viewport.focus();
  renderer.domElement.focus();
}

function isPointerLocked() {
  return document.pointerLockElement === renderer.domElement || document.pointerLockElement === viewport;
}

function handleKeyDown(event: KeyboardEvent) {
  const code = normalizeMoveKey(event);
  if (!code) return;
  activateFocusOnly();
  event.preventDefault();
  event.stopPropagation();
  moveKeys.add(code);
  updateInputMetric();
}

function handleKeyUp(event: KeyboardEvent) {
  const code = normalizeMoveKey(event);
  if (!code) return;
  event.preventDefault();
  event.stopPropagation();
  moveKeys.delete(code);
  updateInputMetric();
}

function normalizeMoveKey(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  if (event.code === "KeyW" || key === "w" || key === "arrowup") return "forward";
  if (event.code === "KeyS" || key === "s" || key === "arrowdown") return "backward";
  if (event.code === "KeyA" || key === "a" || key === "arrowleft") return "left";
  if (event.code === "KeyD" || key === "d" || key === "arrowright") return "right";
  if (event.code === "Space" || key === " " || key === "e") return "up";
  if (event.code === "ControlLeft" || event.code === "ControlRight" || key === "control" || key === "c") return "down";
  if (event.code === "ShiftLeft" || event.code === "ShiftRight" || key === "shift") return "sprint";
  return "";
}

function updateInputMetric() {
  if (moveKeys.size === 0) {
    keysMetric.textContent = isPointerLocked() ? "ready" : "click scene";
    return;
  }

  keysMetric.textContent = [...moveKeys].join("+");
}

function updateControlLabels() {
  const hour = Math.round(((skyControls.timeOfDay + 0.25) % 1) * 24) % 24;
  timeButton.textContent = `${hour.toString().padStart(2, "0")}:00`;
  weatherButton.textContent = weatherModes[skyControls.weatherIndex];
}

async function loadMap(url: string, label: string) {
  sourceMetric.textContent = "loading";
  console.time("[terrain] load map");
  const image = await loadImage(url);
  console.log("[terrain] image loaded", { url, width: image.naturalWidth, height: image.naturalHeight });
  currentMap = extractMapData(image);
  console.timeEnd("[terrain] load map");
  buildTerrain(currentMap);
  sourceMetric.textContent = label.replace(/\.[^.]+$/, "");
}

function extractMapData(image: HTMLImageElement): MapData {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("Could not create image canvas.");
  }

  ctx.drawImage(image, 0, 0);

  const looksLikePanelSheet = image.naturalWidth > image.naturalHeight * 2.2;
  const sectionWidth = Math.floor(image.naturalWidth / 3);
  const yBand = looksLikePanelSheet ? findContentBand(ctx, sectionWidth, image.naturalHeight) : { y: 0, height: image.naturalHeight };
  const inset = looksLikePanelSheet ? 8 : 0;
  const panelWidth = (looksLikePanelSheet ? sectionWidth : image.naturalWidth) - inset * 2;
  const panelHeight = yBand.height - inset * 2;
  const heightmapX = looksLikePanelSheet ? sectionWidth * 2 + inset : 0;
  const heightmapY = yBand.y + inset;
  const heightmap = ctx.getImageData(heightmapX, heightmapY, panelWidth, panelHeight);

  return {
    width: panelWidth,
    height: panelHeight,
    layout: heightmap,
    heightmap,
  };
}

function buildTerrain(map: MapData) {
  console.time("[terrain] build total");
  console.log("[terrain] build start", { mapWidth: map.width, mapHeight: map.height, grid: GRID_RESOLUTION, worldSize: WORLD_SIZE });
  clearTerrain();

  const resolution = GRID_RESOLUTION;
  const verticesPerSide = resolution + 1;
  const vertexCount = verticesPerSide * verticesPerSide;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const biomeIdsAt = new Float32Array(vertexCount);
  const heights = new Float32Array(vertexCount);
  const biomeAt = new Array<Biome>(vertexCount);
  const indices = new Uint32Array(resolution * resolution * 6);
  const seaLevel = WATER_LEVEL;
  const half = WORLD_SIZE / 2;
  let vertex = 0;
  for (let z = 0; z < verticesPerSide; z += 1) {
    for (let x = 0; x < verticesPerSide; x += 1) {
      const u = x / resolution;
      const v = z / resolution;
      let height = heightForHeightmap(map.heightmap, seaLevel, u, v);
      if (!Number.isFinite(height)) height = seaLevel + 8;

      positions[vertex * 3] = u * WORLD_SIZE - half;
      positions[vertex * 3 + 1] = height;
      positions[vertex * 3 + 2] = v * WORLD_SIZE - half;
      uvs[vertex * 2] = u;
      uvs[vertex * 2 + 1] = 1 - v;
      heights[vertex] = height;
      vertex += 1;
    }
  }
  logHeightStats("raw", heights, seaLevel);

  console.time("[terrain] reshape");
  reshapeTerrainHeights(heights, verticesPerSide, seaLevel);
  clampHeights(heights, seaLevel - 18, seaLevel + 220);
  console.timeEnd("[terrain] reshape");
  logHeightStats("reshaped", heights, seaLevel);
  for (let i = 0; i < heights.length; i += 1) {
    positions[i * 3 + 1] = heights[i];
  }

  console.time("[terrain] flow");
  let terrainAnalysis = analyzeTerrain(heights, verticesPerSide, seaLevel);
  console.timeEnd("[terrain] flow");
  for (let i = 0; i < heights.length; i += 1) {
    const riverCut = smoothstep(0.60, 0.88, terrainAnalysis.flow[i]) * smoothstep(seaLevel + 10, seaLevel + 230, heights[i]) * 18;
    heights[i] = Math.max(seaLevel - 16, heights[i] - riverCut);
    positions[i * 3 + 1] = heights[i];
  }
  console.time("[terrain] final relax");
  relaxTerrainSlopes(heights, verticesPerSide, seaLevel, 3);
  clampHeights(heights, seaLevel - 18, seaLevel + 220);
  console.timeEnd("[terrain] final relax");
  logHeightStats("final", heights, seaLevel);
  for (let i = 0; i < heights.length; i += 1) {
    positions[i * 3 + 1] = heights[i];
  }
  console.time("[terrain] final flow");
  terrainAnalysis = analyzeTerrain(heights, verticesPerSide, seaLevel);
  console.timeEnd("[terrain] final flow");

  for (let z = 0; z < verticesPerSide; z += 1) {
    for (let x = 0; x < verticesPerSide; x += 1) {
      const index = z * verticesPerSide + x;
      const slope = terrainAnalysis.slope[index];
      const biome = biomeForTerrain(heights[index], slope, terrainAnalysis.moisture[index], terrainAnalysis.flow[index], seaLevel);
      const color = colorForSurface(
        biome,
        heights[index],
        slope,
        seaLevel,
        x / (verticesPerSide - 1),
        z / (verticesPerSide - 1),
      );

      biomeAt[index] = biome;
      biomeIdsAt[index] = biomeIds[biome];
      colors[index * 3] = color[0];
      colors[index * 3 + 1] = color[1];
      colors[index * 3 + 2] = color[2];
    }
  }
  const terrainNormals = buildTerrainNormals(heights, verticesPerSide);

  let cursor = 0;
  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const a = z * verticesPerSide + x;
      const b = a + 1;
      const c = a + verticesPerSide;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setAttribute("biome", new BufferAttribute(biomeIdsAt, 1));
  geometry.setAttribute("terrainHeight", new BufferAttribute(heights, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  terrainMeshes = [];
  const surfaceMesh = new Mesh(geometry, terrainShaderMaterial);
  surfaceMesh.receiveShadow = true;
  terrainMeshes.push(surfaceMesh);
  terrainGroup.add(surfaceMesh);

  waterMesh = new Mesh(buildWaterGeometry(biomeAt, verticesPerSide, seaLevel), waterMaterial);
  waterMesh.name = "diagnostic-deep-blue-water";
  waterMesh.frustumCulled = false;
  waterMesh.renderOrder = 40;
  terrainGroup.add(waterMesh);
  const shorelineMesh = new Mesh(buildShorelineGeometry(biomeAt, heights, verticesPerSide, seaLevel), shorelineMaterial);
  shorelineMesh.renderOrder = 42;
  terrainGroup.add(shorelineMesh);
  terrainGroup.add(new Mesh(buildMaskGeometry(biomeAt, heights, verticesPerSide, "road", 0.08), roadMaterial));
  terrainGroup.add(new Mesh(buildMaskGeometry(biomeAt, heights, verticesPerSide, "building", 0.1), cityPadMaterial));
  terrainSample.heights = heights;
  terrainSample.verticesPerSide = verticesPerSide;

  addDetails(map, heights, biomeAt, verticesPerSide);
  console.timeEnd("[terrain] build total");
}

function addDetails(map: MapData, heights: Float32Array, biomeAt: Biome[], verticesPerSide: number) {
  const pineTrunkGeometry = new CylinderGeometry(0.22, 0.42, 5.2, 7);
  const pineLowerGeometry = new ConeGeometry(2.9, 5.6, 9);
  const pineMidGeometry = new ConeGeometry(2.25, 4.9, 9);
  const pineTopGeometry = new ConeGeometry(1.45, 3.8, 9);
  const broadTrunkGeometry = new CylinderGeometry(0.32, 0.62, 5.6, 7);
  const broadCrownGeometry = new SphereGeometry(2.8, 10, 8);
  const bushGeometry = new SphereGeometry(1.8, 9, 7);
  const grassGeometry = new PlaneGeometry(0.45, 1.7, 1, 2);
  const rockGeometry = new ConeGeometry(4.5, 8, 6);
  const pebbleGeometry = new BoxGeometry(2.8, 1.2, 2.2);
  const pineMaterial = new MeshStandardMaterial({ color: "#153f20", roughness: 0.9, metalness: 0, envMapIntensity: 0.08, vertexColors: true });
  const pineDarkMaterial = new MeshStandardMaterial({ color: "#0f3018", roughness: 0.94, metalness: 0, envMapIntensity: 0.06, vertexColors: true });
  const broadleafMaterial = new MeshStandardMaterial({ color: "#2f5c24", roughness: 0.88, metalness: 0, envMapIntensity: 0.1, vertexColors: true });
  const treeTrunkMaterial = new MeshStandardMaterial({ color: "#4a2e1d", roughness: 0.96, metalness: 0, vertexColors: true });
  const bushMaterial = new MeshStandardMaterial({ color: "#1c5a27", roughness: 0.92, metalness: 0, envMapIntensity: 0.08, vertexColors: true });
  const grassMaterial = new MeshStandardMaterial({
    color: "#4c6b2b",
    roughness: 0.96,
    metalness: 0,
    side: DoubleSide,
    vertexColors: true,
  });
  const rockMaterial = new MeshStandardMaterial({ color: "#665f54", roughness: 0.88, metalness: 0, envMapIntensity: 0.16 });
  const pebbleMaterial = new MeshStandardMaterial({ color: "#777064", roughness: 0.9, metalness: 0 });
  const treeCandidates: number[] = [];
  const bushCandidates: number[] = [];
  const grassCandidates: number[] = [];
  const rockCandidates: number[] = [];
  const pebbleCandidates: number[] = [];
  const step = 3;

  for (let z = 0; z < verticesPerSide; z += step) {
    for (let x = 0; x < verticesPerSide; x += step) {
      const index = z * verticesPerSide + x;
      const biome = biomeAt[index];
      const u = x / (verticesPerSide - 1);
      const v = z / (verticesPerSide - 1);
      const jitter = hash01(x, z, 4);
      const slopeHint = Math.abs(sampleBlurredHeight(map.heightmap, u + 0.006, v) - sampleBlurredHeight(map.heightmap, u - 0.006, v));
      const forestMass = valueNoise01(u, v, 5.2, 140) * 0.72 + valueNoise01(u, v, 15.0, 141) * 0.28;
      const meadowBreak = valueNoise01(u, v, 10.0, 151);
      const valleyOpen = smoothstep(0.56, 0.86, sampleBlurredHeight(map.heightmap, u, v, 10));
      const woodlandDensity = Math.max(0, forestMass - valleyOpen * 0.22);
      const forestEdge = smoothstep(0.36, 0.62, woodlandDensity) * (1 - smoothstep(0.72, 0.92, meadowBreak));
      const grassDensity = smoothstep(0.24, 0.68, meadowBreak) * (1 - Math.min(0.82, slopeHint * 5.2));

      if (biome === "forest" && jitter < 0.34 + forestEdge * 0.58) treeCandidates.push(index);
      if (biome === "grass" && forestEdge > 0.46 && jitter < 0.10 + forestEdge * 0.30) treeCandidates.push(index);
      if ((biome === "forest" || biome === "grass") && jitter < 0.18 + Math.max(forestEdge, grassDensity) * 0.50) bushCandidates.push(index);
      if ((biome === "grass" || biome === "forest") && jitter < 0.24 + grassDensity * 0.66) grassCandidates.push(index);
      if ((biome === "rock" || biome === "snow" || slopeHint > 0.08) && jitter > 0.72) rockCandidates.push(index);
      if ((biome === "sand" || biome === "rock" || slopeHint > 0.045) && jitter > 0.62) pebbleCandidates.push(index);
    }
  }

  if (vegetationAssets.loaded) {
    addVegetationModelInstances(treeCandidates, bushCandidates, grassCandidates, heights, verticesPerSide);
    const groundCoverCount = Math.min(grassCandidates.length, 3600);
    const groundCover = new InstancedMesh(grassGeometry, grassMaterial, groundCoverCount);
    groundCover.castShadow = true;
    groundCover.receiveShadow = true;
    grassCandidates.slice(0, groundCoverCount).forEach((index, instance) => {
      const { x, z } = jitteredPositionFromIndex(index, instance, verticesPerSide, 0.52);
      const scale = 0.42 + hash01(index, instance, 133) * 0.82;
      scratchEuler.set((hash01(index, instance, 134) - 0.5) * 0.18, hash01(index, instance, 135) * Math.PI * 2, (hash01(index, instance, 136) - 0.5) * 0.18);
      scratchQuat.setFromEuler(scratchEuler);
      scratchMatrix.compose(
        new Vector3(x, heights[index] + 0.8 * scale, z),
        scratchQuat,
        new Vector3(scale, scale, scale),
      );
      groundCover.setMatrixAt(instance, scratchMatrix);
      groundCover.setColorAt(instance, new Color("#314f22").lerp(new Color("#6a7a32"), hash01(index, instance, 137)));
    });
    terrainGroup.add(groundCover);
  } else {
  const treeCount = Math.min(treeCandidates.length, 2800);
  const pineCandidates = treeCandidates.slice(0, treeCount).filter((index) => hash01(index, 2, 71) < 0.72);
  const broadleafCandidates = treeCandidates.slice(0, treeCount).filter((index) => hash01(index, 2, 71) >= 0.72);
  const pineCount = pineCandidates.length;
  const broadleafCount = broadleafCandidates.length;
  const pineTrunks = new InstancedMesh(pineTrunkGeometry, treeTrunkMaterial, pineCount);
  const pineLower = new InstancedMesh(pineLowerGeometry, pineDarkMaterial, pineCount);
  const pineMid = new InstancedMesh(pineMidGeometry, pineMaterial, pineCount);
  const pineTop = new InstancedMesh(pineTopGeometry, pineMaterial, pineCount);
  const broadTrunks = new InstancedMesh(broadTrunkGeometry, treeTrunkMaterial, broadleafCount);
  const broadCrownsA = new InstancedMesh(broadCrownGeometry, broadleafMaterial, broadleafCount);
  const broadCrownsB = new InstancedMesh(broadCrownGeometry, broadleafMaterial, broadleafCount);
  for (const mesh of [pineTrunks, pineLower, pineMid, pineTop, broadTrunks, broadCrownsA, broadCrownsB]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  pineCandidates.forEach((index, instance) => {
    const { x, z } = jitteredPositionFromIndex(index, instance, verticesPerSide, 0.46);
    const scale = 0.72 + hash01(index, instance, 7) * 0.58;
    const heightScale = 0.82 + hash01(index, instance, 8) * 0.46;
    const leanX = (hash01(index, instance, 9) - 0.5) * 0.11;
    const leanZ = (hash01(index, instance, 10) - 0.5) * 0.11;
    const yawAmount = hash01(index, instance, 11) * Math.PI * 2;
    const foliageColor = new Color("#123a1c").lerp(new Color("#2f5a28"), hash01(index, instance, 12));
    const trunkColor = new Color("#382516").lerp(new Color("#624025"), hash01(index, instance, 13));
    scratchEuler.set(leanX, yawAmount, leanZ);
    scratchQuat.setFromEuler(scratchEuler);

    scratchMatrix.compose(
      new Vector3(x, heights[index] + 2.5 * heightScale * scale, z),
      scratchQuat,
      new Vector3(scale * 0.9, heightScale * scale, scale * 0.9),
    );
    pineTrunks.setMatrixAt(instance, scratchMatrix);
    pineTrunks.setColorAt(instance, trunkColor);

    scratchMatrix.compose(
      new Vector3(x, heights[index] + 6.4 * heightScale * scale, z),
      scratchQuat,
      new Vector3(scale * 1.18, heightScale * scale, scale * 1.18),
    );
    pineLower.setMatrixAt(instance, scratchMatrix);
    pineLower.setColorAt(instance, foliageColor.clone().multiplyScalar(0.78));

    scratchMatrix.compose(
      new Vector3(x, heights[index] + 9.2 * heightScale * scale, z),
      scratchQuat,
      new Vector3(scale * 0.98, heightScale * scale, scale * 0.98),
    );
    pineMid.setMatrixAt(instance, scratchMatrix);
    pineMid.setColorAt(instance, foliageColor);

    scratchMatrix.compose(
      new Vector3(x, heights[index] + 11.8 * heightScale * scale, z),
      scratchQuat,
      new Vector3(scale * 0.78, heightScale * scale, scale * 0.78),
    );
    pineTop.setMatrixAt(instance, scratchMatrix);
    pineTop.setColorAt(instance, foliageColor.clone().multiplyScalar(1.08));
  });

  broadleafCandidates.forEach((index, instance) => {
    const { x, z } = jitteredPositionFromIndex(index, instance, verticesPerSide, 0.44);
    const scale = 0.72 + hash01(index, instance, 31) * 0.62;
    const canopyY = heights[index] + 5.6 * scale;
    const yawAmount = hash01(index, instance, 32) * Math.PI * 2;
    const foliageColor = new Color("#244a1e").lerp(new Color("#4f6f2c"), hash01(index, instance, 33));
    const trunkColor = new Color("#3c2718").lerp(new Color("#6b4628"), hash01(index, instance, 34));
    scratchEuler.set((hash01(index, instance, 35) - 0.5) * 0.12, yawAmount, (hash01(index, instance, 36) - 0.5) * 0.12);
    scratchQuat.setFromEuler(scratchEuler);

    scratchMatrix.compose(
      new Vector3(x, heights[index] + 2.8 * scale, z),
      scratchQuat,
      new Vector3(scale * 0.82, scale, scale * 0.82),
    );
    broadTrunks.setMatrixAt(instance, scratchMatrix);
    broadTrunks.setColorAt(instance, trunkColor);

    scratchMatrix.compose(
      new Vector3(x - 1.2 * scale, canopyY, z),
      scratchQuat,
      new Vector3(scale * 1.45, scale * 0.96, scale * 1.18),
    );
    broadCrownsA.setMatrixAt(instance, scratchMatrix);
    broadCrownsA.setColorAt(instance, foliageColor);

    scratchMatrix.compose(
      new Vector3(x + 0.9 * scale, canopyY + 0.65 * scale, z + 0.45 * scale),
      scratchQuat,
      new Vector3(scale * 1.1, scale * 0.82, scale * 1.32),
    );
    broadCrownsB.setMatrixAt(instance, scratchMatrix);
    broadCrownsB.setColorAt(instance, foliageColor.clone().multiplyScalar(0.88));
  });

  terrainGroup.add(pineTrunks, pineLower, pineMid, pineTop, broadTrunks, broadCrownsA, broadCrownsB);

  const bushCount = Math.min(bushCandidates.length, 1800);
  const bushes = new InstancedMesh(bushGeometry, bushMaterial, bushCount);
  bushes.castShadow = true;
  bushCandidates.slice(0, bushCount).forEach((index, instance) => {
    const { x, z } = jitteredPositionFromIndex(index, instance, verticesPerSide, 0.40);
    const scale = 0.5 + hash01(index, instance, 23) * 1.35;
    scratchEuler.set(0.08, hash01(index, instance, 24) * Math.PI * 2, -0.05);
    scratchQuat.setFromEuler(scratchEuler);
    scratchMatrix.compose(
      new Vector3(x, heights[index] + 2.1 * scale, z),
      scratchQuat,
      new Vector3(scale * 1.4, scale * 0.58, scale * 1.15),
    );
    bushes.setMatrixAt(instance, scratchMatrix);
  });
  terrainGroup.add(bushes);

  const grassCount = Math.min(grassCandidates.length, 5200);
  const grasses = new InstancedMesh(grassGeometry, grassMaterial, grassCount);
  grasses.castShadow = true;
  grassCandidates.slice(0, grassCount).forEach((index, instance) => {
    const { x, z } = jitteredPositionFromIndex(index, instance, verticesPerSide, 0.42);
    const scale = 0.55 + hash01(index, instance, 13) * 0.9;
    scratchEuler.set(0, hash01(index, instance, 17) * Math.PI * 2, 0);
    scratchQuat.setFromEuler(scratchEuler);
    scratchMatrix.compose(
      new Vector3(x, heights[index] + 2.6 * scale, z),
      scratchQuat,
      new Vector3(scale, scale, scale),
    );
    grasses.setMatrixAt(instance, scratchMatrix);
  });
  terrainGroup.add(grasses);
  }

  const rockCount = Math.min(rockCandidates.length, 650);
  const rocks = new InstancedMesh(rockGeometry, rockMaterial, rockCount);
  rocks.castShadow = true;
  rockCandidates.slice(0, rockCount).forEach((index, instance) => {
    const { x, z } = jitteredPositionFromIndex(index, instance, verticesPerSide, 0.36);
    const scale = 0.55 + hash01(index, instance, 9) * 1.15;
    scratchMatrix.makeScale(scale, 0.5 + scale * 0.45, scale);
    scratchMatrix.setPosition(x, heights[index] + scale * 2.1, z);
    rocks.setMatrixAt(instance, scratchMatrix);
  });
  terrainGroup.add(rocks);

  const pebbleCount = Math.min(pebbleCandidates.length, 1200);
  const pebbles = new InstancedMesh(pebbleGeometry, pebbleMaterial, pebbleCount);
  pebbles.castShadow = true;
  pebbles.receiveShadow = true;
  pebbleCandidates.slice(0, pebbleCount).forEach((index, instance) => {
    const { x, z } = positionsFromIndex(index, verticesPerSide);
    const scale = 0.38 + hash01(index, instance, 29) * 1.25;
    scratchEuler.set(
      hash01(index, instance, 30) * 0.28,
      hash01(index, instance, 31) * Math.PI * 2,
      hash01(index, instance, 32) * 0.22,
    );
    scratchQuat.setFromEuler(scratchEuler);
    scratchMatrix.compose(
      new Vector3(x, heights[index] + scale * 0.55, z),
      scratchQuat,
      new Vector3(scale * 1.4, scale * 0.42, scale),
    );
    pebbles.setMatrixAt(instance, scratchMatrix);
  });
  terrainGroup.add(pebbles);

}

function addVegetationModelInstances(
  treeCandidates: number[],
  bushCandidates: number[],
  grassCandidates: number[],
  heights: Float32Array,
  verticesPerSide: number,
) {
  const trees = treeCandidates.slice(0, 1500);
  const bushes = bushCandidates.slice(0, 900);
  const grasses = grassCandidates.slice(0, 700);

  trees.forEach((index, instance) => {
    const pine = hash01(index, instance, 81) < 0.68;
    const models = pine ? vegetationAssets.pines : vegetationAssets.broadleaf;
    const model = models[Math.floor(hash01(index, instance, 82) * models.length)];
    const targetHeight = pine
      ? 16 + hash01(index, instance, 83) * 16
      : 10 + hash01(index, instance, 84) * 12;
    placeVegetationModel(model, index, instance, heights, verticesPerSide, targetHeight, 0.06);
  });

  bushes.forEach((index, instance) => {
    const model = vegetationAssets.bushes[Math.floor(hash01(index, instance, 91) * vegetationAssets.bushes.length)];
    placeVegetationModel(model, index, instance, heights, verticesPerSide, 1.4 + hash01(index, instance, 92) * 2.0, 0.10);
  });

  grasses.forEach((index, instance) => {
    const model = vegetationAssets.grasses[Math.floor(hash01(index, instance, 101) * vegetationAssets.grasses.length)];
    placeVegetationModel(model, index, instance, heights, verticesPerSide, 0.55 + hash01(index, instance, 102) * 0.95, 0.16);
  });
}

function placeVegetationModel(
  source: Group | undefined,
  index: number,
  instance: number,
  heights: Float32Array,
  verticesPerSide: number,
  targetHeight: number,
  leanAmount: number,
) {
  if (!source) return;

  const clone = source.clone(true);
  const bounds = new Box3().setFromObject(source);
  const sourceHeight = Math.max(0.001, bounds.max.y - bounds.min.y);
  const scale = targetHeight / sourceHeight;
  const { x, z } = jitteredPositionFromIndex(index, instance, verticesPerSide, 0.48);
  const yawAmount = hash01(index, instance, 111) * Math.PI * 2;
  const leanX = (hash01(index, instance, 112) - 0.5) * leanAmount;
  const leanZ = (hash01(index, instance, 113) - 0.5) * leanAmount;

  clone.position.set(x, heights[index], z);
  clone.rotation.set(leanX, yawAmount, leanZ);
  clone.scale.setScalar(scale);
  clone.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material instanceof MeshStandardMaterial) {
        child.material = child.material.clone();
        child.material.roughness = Math.max(child.material.roughness, 0.82);
        child.material.metalness = 0;
        child.material.envMapIntensity = Math.min(child.material.envMapIntensity, 0.08);
        child.material.color.multiplyScalar(0.72 + hash01(index, instance, 119) * 0.22);
      }
    }
  });
  terrainGroup.add(clone);
}

function buildWaterGeometry(biomeAt: Biome[], verticesPerSide: number, seaLevel: number) {
  const resolution = verticesPerSide - 1;
  const half = WORLD_SIZE / 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const subdivisions = 3;

  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const a = z * verticesPerSide + x;
      const b = a + 1;
      const c = a + verticesPerSide;
      const d = c + 1;

      if (![biomeAt[a], biomeAt[b], biomeAt[c], biomeAt[d]].some((biome) => biome === "water")) {
        continue;
      }

      for (let sz = 0; sz < subdivisions; sz += 1) {
        for (let sx = 0; sx < subdivisions; sx += 1) {
          const u0 = (x + sx / subdivisions) / resolution;
          const u1 = (x + (sx + 1) / subdivisions) / resolution;
          const v0 = (z + sz / subdivisions) / resolution;
          const v1 = (z + (sz + 1) / subdivisions) / resolution;
          const x0 = u0 * WORLD_SIZE - half;
          const x1 = u1 * WORLD_SIZE - half;
          const z0 = v0 * WORLD_SIZE - half;
          const z1 = v1 * WORLD_SIZE - half;
          const base = positions.length / 3;
          const y = seaLevel + 0.35;

          positions.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
          uvs.push(x0 * 0.01, z0 * 0.01, x1 * 0.01, z0 * 0.01, x0 * 0.01, z1 * 0.01, x1 * 0.01, z1 * 0.01);
          indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        }
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildBiomeTerrainGeometry(
  biomeAt: Biome[],
  heights: Float32Array,
  colors: Float32Array,
  normals: Float32Array,
  verticesPerSide: number,
  target: Biome,
) {
  const resolution = verticesPerSide - 1;
  const half = WORLD_SIZE / 2;
  const positions: number[] = [];
  const vertexColors: number[] = [];
  const vertexNormals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const a = z * verticesPerSide + x;
      const b = a + 1;
      const c = a + verticesPerSide;
      const d = c + 1;
      const cellBiome = terrainBaseBiome(dominantCellBiome([biomeAt[a], biomeAt[b], biomeAt[c], biomeAt[d]]));

      if (cellBiome !== target) continue;

      const base = positions.length / 3;
      const x0 = (x / resolution) * WORLD_SIZE - half;
      const x1 = ((x + 1) / resolution) * WORLD_SIZE - half;
      const z0 = (z / resolution) * WORLD_SIZE - half;
      const z1 = ((z + 1) / resolution) * WORLD_SIZE - half;
      positions.push(x0, heights[a], z0, x1, heights[b], z0, x0, heights[c], z1, x1, heights[d], z1);
      pushTerrainColor(vertexColors, colors, biomeAt, a, target);
      pushTerrainColor(vertexColors, colors, biomeAt, b, target);
      pushTerrainColor(vertexColors, colors, biomeAt, c, target);
      pushTerrainColor(vertexColors, colors, biomeAt, d, target);
      pushColor(vertexNormals, normals, a);
      pushColor(vertexNormals, normals, b);
      pushColor(vertexNormals, normals, c);
      pushColor(vertexNormals, normals, d);
      uvs.push(x0 * 0.11, z0 * 0.11, x1 * 0.11, z0 * 0.11, x0 * 0.11, z1 * 0.11, x1 * 0.11, z1 * 0.11);
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(vertexColors), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(vertexNormals), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}

function buildTerrainNormals(heights: Float32Array, verticesPerSide: number) {
  const normals = new Float32Array(heights.length * 3);
  const spacing = WORLD_SIZE / (verticesPerSide - 1);

  for (let z = 0; z < verticesPerSide; z += 1) {
    for (let x = 0; x < verticesPerSide; x += 1) {
      const index = z * verticesPerSide + x;
      const left = heights[z * verticesPerSide + Math.max(0, x - 1)];
      const right = heights[z * verticesPerSide + Math.min(verticesPerSide - 1, x + 1)];
      const down = heights[Math.max(0, z - 1) * verticesPerSide + x];
      const up = heights[Math.min(verticesPerSide - 1, z + 1) * verticesPerSide + x];
      const normal = new Vector3(left - right, spacing * 2.0, down - up).normalize();
      normals[index * 3] = normal.x;
      normals[index * 3 + 1] = normal.y;
      normals[index * 3 + 2] = normal.z;
    }
  }

  return normals;
}

function dominantCellBiome(cell: Biome[]) {
  const counts = new Map<Biome, number>();
  for (const biome of cell) {
    counts.set(biome, (counts.get(biome) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function terrainBaseBiome(biome: Biome): Biome {
  if (biome === "road" || biome === "building") return "grass";
  return biome;
}

function pushColor(target: number[], colors: Float32Array, index: number) {
  target.push(colors[index * 3], colors[index * 3 + 1], colors[index * 3 + 2]);
}

function pushTerrainColor(target: number[], colors: Float32Array, biomeAt: Biome[], index: number, targetBiome: Biome) {
  if (targetBiome === "grass" && (biomeAt[index] === "road" || biomeAt[index] === "building")) {
    target.push(0.18, 0.34, 0.12);
    return;
  }
  pushColor(target, colors, index);
}

function buildShorelineGeometry(
  biomeAt: Biome[],
  heights: Float32Array,
  verticesPerSide: number,
  seaLevel: number,
) {
  const resolution = verticesPerSide - 1;
  const half = WORLD_SIZE / 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const a = z * verticesPerSide + x;
      const b = a + 1;
      const c = a + verticesPerSide;
      const d = c + 1;
      const cell = [biomeAt[a], biomeAt[b], biomeAt[c], biomeAt[d]];
      const hasWater = cell.some((biome) => biome === "water");
      const hasLand = cell.some((biome) => biome !== "water");

      if (!hasWater || !hasLand) continue;

      const base = positions.length / 3;
      const x0 = (x / resolution) * WORLD_SIZE - half;
      const x1 = ((x + 1) / resolution) * WORLD_SIZE - half;
      const z0 = (z / resolution) * WORLD_SIZE - half;
      const z1 = ((z + 1) / resolution) * WORLD_SIZE - half;
      const y0 = Math.max(heights[a] + 0.38, seaLevel + 0.55);
      const y1 = Math.max(heights[b] + 0.38, seaLevel + 0.55);
      const y2 = Math.max(heights[c] + 0.38, seaLevel + 0.55);
      const y3 = Math.max(heights[d] + 0.38, seaLevel + 0.55);
      positions.push(x0, y0, z0, x1, y1, z0, x0, y2, z1, x1, y3, z1);
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildMaskGeometry(
  biomeAt: Biome[],
  heights: Float32Array | undefined,
  verticesPerSide: number,
  target: Biome,
  yOrOffset: number,
) {
  const resolution = verticesPerSide - 1;
  const half = WORLD_SIZE / 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const a = z * verticesPerSide + x;
      const b = a + 1;
      const c = a + verticesPerSide;
      const d = c + 1;

      if (![biomeAt[a], biomeAt[b], biomeAt[c], biomeAt[d]].some((biome) => biome === target)) {
        continue;
      }

      const base = positions.length / 3;
      const x0 = (x / resolution) * WORLD_SIZE - half;
      const x1 = ((x + 1) / resolution) * WORLD_SIZE - half;
      const z0 = (z / resolution) * WORLD_SIZE - half;
      const z1 = ((z + 1) / resolution) * WORLD_SIZE - half;
      const y0 = heights ? heights[a] + yOrOffset : yOrOffset;
      const y1 = heights ? heights[b] + yOrOffset : yOrOffset;
      const y2 = heights ? heights[c] + yOrOffset : yOrOffset;
      const y3 = heights ? heights[d] + yOrOffset : yOrOffset;
      positions.push(x0, y0, z0, x1, y1, z0, x0, y2, z1, x1, y3, z1);
      uvs.push(x0 * 0.11, z0 * 0.11, x1 * 0.11, z0 * 0.11, x0 * 0.11, z1 * 0.11, x1 * 0.11, z1 * 0.11);
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function clearTerrain() {
  for (const child of [...terrainGroup.children]) {
    terrainGroup.remove(child);
    if (child instanceof Mesh || child instanceof InstancedMesh) {
      child.geometry.dispose();
    }
  }
  terrainMeshes = [];
  waterMesh = undefined;
}

function classifyBiome(pixel: number[]): Biome {
  const [r, g, b] = pixel;
  const gray = Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b);

  if (b > 130 && r < 85 && g < 125) return "water";
  if (r > 210 && g > 210 && b > 210) return "rock";
  if (r > 190 && g > 160 && b < 80) return "sand";
  if (r > 170 && g < 90 && b < 80) return "building";
  if (gray < 55 && r > 80 && r < 190) return "road";
  if (g > 70 && r < 60 && b < 75) return "forest";
  return "grass";
}

function colorForSurface(
  biome: Biome,
  height: number,
  slope: number,
  seaLevel: number,
  u: number,
  v: number,
): number[] {
  const broadVariation = valueNoise01(u, v, 18, 11);
  const fineVariation = valueNoise01(u, v, 74, 12);
  const variation = broadVariation * 0.72 + fineVariation * 0.28;
  const palette: Record<Biome, number[]> = {
    water: [0.01, 0.18, 0.34],
    sand: mixColor([0.42, 0.36, 0.22], [0.62, 0.52, 0.32], variation),
    grass: mixColor([0.08, 0.23, 0.07], [0.22, 0.42, 0.12], variation),
    forest: mixColor([0.018, 0.095, 0.036], [0.055, 0.20, 0.058], variation),
    rock: mixColor([0.26, 0.26, 0.24], [0.44, 0.42, 0.36], variation),
    road: [0.34, 0.29, 0.22],
    building: [0.58, 0.24, 0.14],
    snow: [0.62, 0.64, 0.6],
  };
  let color = palette[biome];

  if ((biome === "grass" || biome === "forest") && slope > 0.65) {
    color = mixColor(color, palette.rock, Math.min(0.62, (slope - 0.65) / 1.4));
  }

  if (biome !== "water" && height > seaLevel + 190) {
    color = mixColor(color, palette.snow, Math.min(0.08, (height - seaLevel - 190) / 120));
  }

  if (biome !== "water" && height < seaLevel + 10) {
    color = mixColor(color, palette.sand, 0.18);
  }

  return shadeColor(color, 0.66 + variation * 0.22);
}

function heightForHeightmap(heightmap: ImageData, seaLevel: number, u: number, v: number) {
  const broad = sampleBlurredHeight(heightmap, u, v, 10);
  const regional = sampleBlurredHeight(heightmap, u, v, 4);
  const low = smoothstep(0.08, 0.82, broad);
  const mountain = Math.pow(smoothstep(0.72, 0.995, broad), 2.1);
  const plains = seaLevel + 8 + low * 64;
  const hills = (regional - broad) * 8;
  const mountains = mountain * 118;
  const height = plains + hills + mountains;

  return height;
}

function reshapeTerrainHeights(heights: Float32Array, verticesPerSide: number, seaLevel: number) {
  const sorted = Array.from(heights).sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.02)];
  const high = sorted[Math.floor(sorted.length * 0.995)];
  const mountainStart = seaLevel + 112;

  for (let i = 0; i < heights.length; i += 1) {
    const normalized = Math.min(1, Math.max(0, (heights[i] - low) / Math.max(1, high - low)));
    const playable = Math.pow(normalized, 1.9);
    let remapped = seaLevel + 4 + playable * 205;
    if (remapped > mountainStart) {
      remapped = mountainStart + Math.pow((remapped - mountainStart) / 120, 0.62) * 82;
    }
    heights[i] = Math.max(seaLevel - 18, Math.min(seaLevel + 220, remapped));
  }

  relaxTerrainSlopes(heights, verticesPerSide, seaLevel, 4);
}

function relaxTerrainSlopes(heights: Float32Array, verticesPerSide: number, seaLevel: number, iterations: number) {
  const spacing = WORLD_SIZE / (verticesPerSide - 1);

  for (let pass = 0; pass < iterations; pass += 1) {
    const source = new Float32Array(heights);
    for (let z = 1; z < verticesPerSide - 1; z += 1) {
      for (let x = 1; x < verticesPerSide - 1; x += 1) {
        const index = z * verticesPerSide + x;
        const height = source[index];
        const mountain = smoothstep(seaLevel + 92, seaLevel + 220, height);
        const maxDelta = spacing * (0.065 + mountain * 0.095);
        let sum = height;
        let count = 1;

        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dz === 0) continue;
            const next = (z + dz) * verticesPerSide + x + dx;
            const neighbor = source[next];
            const delta = height - neighbor;
            if (delta > maxDelta) {
              sum += neighbor + maxDelta;
              count += 1;
            } else {
              sum += neighbor * 0.16;
              count += 0.16;
            }
          }
        }

        const thermal = sum / count;
        const broad = (
          source[index] * 0.44 +
          (source[index - 1] + source[index + 1] + source[index - verticesPerSide] + source[index + verticesPerSide]) * 0.11 +
          (source[index - verticesPerSide - 1] + source[index - verticesPerSide + 1] + source[index + verticesPerSide - 1] + source[index + verticesPerSide + 1]) * 0.03
        );
        const smoothing = 0.28 + mountain * 0.48;
        heights[index] = Math.min(seaLevel + 220, Math.max(seaLevel - 18, height * (1 - smoothing) + ((thermal + broad) * 0.5) * smoothing));
      }
    }
  }
}

function clampHeights(heights: Float32Array, minHeight: number, maxHeight: number) {
  for (let i = 0; i < heights.length; i += 1) {
    const height = heights[i];
    heights[i] = Number.isFinite(height) ? Math.min(maxHeight, Math.max(minHeight, height)) : minHeight;
  }
}

function logHeightStats(label: string, heights: Float32Array, seaLevel: number) {
  if (!DEBUG_TERRAIN) return;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let nonFinite = 0;
  let aboveWater = 0;

  for (const height of heights) {
    if (!Number.isFinite(height)) {
      nonFinite += 1;
      continue;
    }
    min = Math.min(min, height);
    max = Math.max(max, height);
    sum += height;
    if (height > seaLevel) aboveWater += 1;
  }

  console.log(`[terrain] heights ${label}`, {
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    avg: Number((sum / Math.max(1, heights.length - nonFinite)).toFixed(2)),
    nonFinite,
    aboveWater,
  });
}

function analyzeTerrain(heights: Float32Array, verticesPerSide: number, seaLevel: number) {
  const count = heights.length;
  const slope = new Float32Array(count);
  const flow = new Float32Array(count);
  const moisture = new Float32Array(count);
  const receiver = new Int32Array(count);
  const order = Array.from({ length: count }, (_, index) => index);
  const spacing = WORLD_SIZE / (verticesPerSide - 1);

  for (let z = 0; z < verticesPerSide; z += 1) {
    for (let x = 0; x < verticesPerSide; x += 1) {
      const index = z * verticesPerSide + x;
      const left = heights[z * verticesPerSide + Math.max(0, x - 1)];
      const right = heights[z * verticesPerSide + Math.min(verticesPerSide - 1, x + 1)];
      const down = heights[Math.max(0, z - 1) * verticesPerSide + x];
      const up = heights[Math.min(verticesPerSide - 1, z + 1) * verticesPerSide + x];
      slope[index] = Math.hypot(right - left, up - down) / (spacing * 2);
      receiver[index] = lowestNeighbor(index, x, z, heights, verticesPerSide);
      flow[index] = 1;
    }
  }

  order.sort((a, b) => heights[b] - heights[a]);
  for (const index of order) {
    const target = receiver[index];
    if (target !== index) flow[target] += flow[index];
  }

  let maxFlow = 1;
  for (let i = 0; i < count; i += 1) maxFlow = Math.max(maxFlow, flow[i]);

  for (let i = 0; i < count; i += 1) {
    const normalizedFlow = Math.log(flow[i]) / Math.log(maxFlow);
    flow[i] = normalizedFlow;
    const lowlandWetness = 1 - smoothstep(seaLevel + 35, seaLevel + 210, heights[i]);
    moisture[i] = Math.min(1, Math.max(0, normalizedFlow * 1.15 + lowlandWetness * 0.55 + (1 - Math.min(1, slope[i] * 2.4)) * 0.16));
  }

  return { flow, moisture, slope };
}

function lowestNeighbor(index: number, x: number, z: number, heights: Float32Array, verticesPerSide: number) {
  let best = index;
  let bestHeight = heights[index];

  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue;
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= verticesPerSide || nz >= verticesPerSide) continue;
      const next = nz * verticesPerSide + nx;
      if (heights[next] < bestHeight) {
        bestHeight = heights[next];
        best = next;
      }
    }
  }

  return best;
}

function biomeForTerrain(height: number, slope: number, moisture: number, flow: number, seaLevel: number): Biome {
  if (height <= seaLevel || (flow > 0.84 && height < seaLevel + 130 && slope < 0.16)) return "water";
  if (slope > 0.46 || height > seaLevel + 170) return "rock";
  if (height < seaLevel + 8 && flow > 0.22) return "sand";
  if (moisture > 0.50 && height < seaLevel + 155 && slope < 0.28) return "forest";
  return "grass";
}

function sampleBlurredHeight(image: ImageData, u: number, v: number, radius = 2): number {
  let total = 0;
  let weightTotal = 0;

  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const weight = 1 / (1 + Math.abs(x) + Math.abs(y));
      const pixel = samplePixel(image, u + x / image.width, v + y / image.height);
      total += ((pixel[0] + pixel[1] + pixel[2]) / (255 * 3)) * weight;
      weightTotal += weight;
    }
  }

  return total / weightTotal;
}

function hash01(x: number, y: number, seed: number) {
  let n = x * 374761393 + y * 668265263 + seed * 1442695041;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function valueNoise01(u: number, v: number, frequency: number, seed: number) {
  const x = u * frequency;
  const y = v * frequency;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(0, 1, x - ix);
  const fy = smoothstep(0, 1, y - iy);
  const a = hash01(ix, iy, seed);
  const b = hash01(ix + 1, iy, seed);
  const c = hash01(ix, iy + 1, seed);
  const d = hash01(ix + 1, iy + 1, seed);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fy;
}

function samplePixel(image: ImageData, u: number, v: number): number[] {
  const x = Math.min(image.width - 1, Math.max(0, Math.round(u * (image.width - 1))));
  const y = Math.min(image.height - 1, Math.max(0, Math.round(v * (image.height - 1))));
  const index = (y * image.width + x) * 4;
  return [image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]];
}

function findContentBand(ctx: CanvasRenderingContext2D, sectionWidth: number, imageHeight: number) {
  const x = sectionWidth;
  const width = sectionWidth * 2;
  let start = 0;
  let end = imageHeight - 1;

  for (let y = 0; y < imageHeight; y += 1) {
    if (rowHasContent(ctx, x, y, width)) {
      start = y;
      break;
    }
  }

  for (let y = imageHeight - 1; y >= 0; y -= 1) {
    if (rowHasContent(ctx, x, y, width)) {
      end = y;
      break;
    }
  }

  return { y: start, height: Math.max(1, end - start + 1) };
}

function rowHasContent(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  const row = ctx.getImageData(x, y, width, 1).data;
  let brightPixels = 0;

  for (let i = 0; i < row.length; i += 4) {
    if (row[i] + row[i + 1] + row[i + 2] > 34) brightPixels += 1;
  }

  return brightPixels > width * 0.2;
}

function positionsFromIndex(index: number, verticesPerSide: number) {
  const x = index % verticesPerSide;
  const z = Math.floor(index / verticesPerSide);
  return new Vector3(
    (x / (verticesPerSide - 1)) * WORLD_SIZE - WORLD_SIZE / 2,
    0,
    (z / (verticesPerSide - 1)) * WORLD_SIZE - WORLD_SIZE / 2,
  );
}

function jitteredPositionFromIndex(index: number, instance: number, verticesPerSide: number, amount: number) {
  const position = positionsFromIndex(index, verticesPerSide);
  const spacing = WORLD_SIZE / (verticesPerSide - 1);
  position.x += (hash01(index, instance, 211) - 0.5) * spacing * amount * 2;
  position.z += (hash01(index, instance, 212) - 0.5) * spacing * amount * 2;
  position.x = Math.max(-WORLD_SIZE / 2, Math.min(WORLD_SIZE / 2, position.x));
  position.z = Math.max(-WORLD_SIZE / 2, Math.min(WORLD_SIZE / 2, position.z));
  return position;
}

function mixColor(a: number[], b: number[], amount: number) {
  const t = Math.min(1, Math.max(0, amount));
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function shadeColor(color: number[], amount: number) {
  return color.map((component) => Math.min(1, Math.max(0, component * amount)));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function addSkyDome() {
  skyMaterial = new ShaderMaterial({
    side: DoubleSide,
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
      timeOfDay: { value: skyControls.timeOfDay },
      weather: { value: 0 },
      sunDirection: { value: sun.position.clone().normalize() },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float timeOfDay;
      uniform float weather;
      uniform vec3 sunDirection;
      varying vec3 vWorldPosition;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(41.23, 289.97))) * 45758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 6; i++) {
          v += noise(p) * a;
          p *= 2.0;
          a *= 0.52;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vWorldPosition);
        float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        float sunUp = sin(timeOfDay * 6.2831853);
        float day = smoothstep(-0.12, 0.35, sunUp);
        vec3 nightTop = vec3(0.015, 0.025, 0.055);
        vec3 nightBottom = vec3(0.035, 0.045, 0.075);
        vec3 dayTop = vec3(0.22, 0.50, 0.86);
        vec3 dayBottom = vec3(0.72, 0.88, 1.0);
        vec3 duskTop = vec3(0.24, 0.26, 0.46);
        vec3 duskBottom = vec3(0.95, 0.58, 0.36);
        float dusk = smoothstep(0.0, 0.22, abs(sunUp)) * (1.0 - smoothstep(0.22, 0.55, abs(sunUp)));
        vec3 sky = mix(mix(nightBottom, nightTop, h), mix(dayBottom, dayTop, h), day);
        sky = mix(sky, mix(duskBottom, duskTop, h), dusk * 0.72);

        vec2 cloudUv = dir.xz / max(dir.y + 0.32, 0.16) * 1.55 + vec2(time * 0.010, time * -0.005);
        float cloudShape = fbm(cloudUv * 2.1);
        float cloudWisps = fbm(cloudUv * 7.0 + vec2(time * -0.018, time * 0.011));
        cloudShape = cloudShape * 0.72 + cloudWisps * 0.28;
        float coverage = mix(0.56, 0.28, step(0.5, weather));
        coverage = mix(coverage, 0.16, step(1.5, weather));
        coverage = mix(coverage, 0.08, step(2.5, weather));
        coverage = mix(coverage, 0.38, step(3.5, weather));
        float clouds = smoothstep(coverage, coverage + 0.22, cloudShape) * smoothstep(0.02, 0.46, dir.y);
        vec3 warmCloud = mix(vec3(1.0, 0.82, 0.68), vec3(0.94, 0.97, 1.0), day);
        vec3 cloudColor = mix(warmCloud, vec3(0.23, 0.27, 0.29), smoothstep(1.1, 2.0, weather));
        cloudColor = mix(cloudColor, vec3(0.72, 0.76, 0.76), smoothstep(3.5, 4.0, weather));
        cloudColor *= mix(0.38, 1.18, day);
        sky = mix(sky, cloudColor, clouds * mix(0.36, 0.82, clamp(weather / 2.0, 0.0, 1.0)));

        float sunDisk = smoothstep(0.9991, 1.0, dot(dir, sunDirection)) * day;
        float sunGlow = pow(max(dot(dir, sunDirection), 0.0), 14.0) * day;
        sky += vec3(1.0, 0.72, 0.38) * sunGlow * 0.42;
        sky += vec3(1.0, 0.78, 0.42) * sunDisk * 2.6;
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  skyDome = new Mesh(new SphereGeometry(2500, 64, 32), skyMaterial);
  skyDome.renderOrder = -100;
  scene.add(skyDome);
  addCloudDeck();
  addRain();
  updateEnvironment();
}

function addCloudDeck() {
  cloudMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      time: { value: 0 },
      timeOfDay: { value: skyControls.timeOfDay },
      weather: { value: 0 },
      sunDirection: { value: sun.position.clone().normalize() },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float timeOfDay;
      uniform float weather;
      uniform vec3 sunDirection;
      varying vec3 vWorldPosition;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.7, 269.5))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 7; i++) {
          v += noise(p) * a;
          p *= 2.05;
          a *= 0.52;
        }
        return v;
      }

      void main() {
        float sunUp = sin(timeOfDay * 6.2831853);
        float day = smoothstep(-0.1, 0.42, sunUp);
        vec2 wind = vec2(time * 0.012, -time * 0.006);
        vec2 uv = vWorldPosition.xz * 0.0022 + wind;
        float base = fbm(uv);
        float detail = fbm(uv * 4.0 + vec2(time * -0.018, time * 0.01));
        float shape = base * 0.72 + detail * 0.28;
        float coverage = mix(0.78, 0.47, step(0.5, weather));
        coverage = mix(coverage, 0.39, step(1.5, weather));
        coverage = mix(coverage, 0.30, step(2.5, weather));
        coverage = mix(coverage, 0.58, step(3.5, weather));
        float density = smoothstep(coverage, coverage + 0.18, shape);
        float puff = smoothstep(0.36, 0.92, detail);
        float horizonFade = smoothstep(0.02, 0.18, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
        vec3 lit = mix(vec3(0.42, 0.46, 0.48), vec3(1.0, 0.98, 0.92), day);
        vec3 storm = vec3(0.18, 0.21, 0.23);
        vec3 fog = vec3(0.62, 0.68, 0.68);
        vec3 cloud = mix(lit, storm, smoothstep(2.4, 3.2, weather));
        cloud = mix(cloud, fog, smoothstep(3.5, 4.0, weather));
        float silver = pow(max(dot(normalize(sunDirection), normalize(cameraPosition - vWorldPosition)), 0.0), 4.0) * day;
        cloud += silver * 0.16;
        float alpha = density * mix(0.16, 0.62, clamp(weather / 3.0, 0.0, 1.0)) * horizonFade;
        alpha *= mix(0.74, 1.12, puff);
        gl_FragColor = vec4(cloud, alpha);
      }
    `,
  });
  cloudDeck = new Mesh(new PlaneGeometry(3200, 3200, 1, 1), cloudMaterial);
  cloudDeck.rotation.x = -Math.PI / 2;
  cloudDeck.position.y = 360;
  scene.add(cloudDeck);
}

function addRain() {
  const count = 1800;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (hash01(i, 1, 20) - 0.5) * 900;
    positions[i * 3 + 1] = hash01(i, 2, 21) * 300 + 60;
    positions[i * 3 + 2] = (hash01(i, 3, 22) - 0.5) * 900;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: "#b9d2dc",
    size: 1.7,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  rain = new Points(geometry, material);
  scene.add(rain);
}

function loadTerrainTexture(url: string) {
  const texture = textureLoader.load(url);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function loadLinearTexture(url: string) {
  const texture = textureLoader.load(url);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

async function loadVegetationAssets() {
  const base = "/assets/models/vendor/stylized_nature_megakitstandard/glTF";
  const [pines, broadleaf, bushes, grasses] = await Promise.all([
    Promise.all(["Pine_1.gltf", "Pine_2.gltf", "Pine_3.gltf", "Pine_4.gltf", "Pine_5.gltf"].map((name) => loadVegetationModel(`${base}/${name}`))),
    Promise.all(["CommonTree_1.gltf", "CommonTree_2.gltf", "CommonTree_3.gltf", "TwistedTree_1.gltf", "TwistedTree_2.gltf"].map((name) => loadVegetationModel(`${base}/${name}`))),
    Promise.all(["Bush_Common.gltf"].map((name) => loadVegetationModel(`${base}/${name}`))),
    Promise.all(["Grass_Common_Short.gltf", "Grass_Common_Tall.gltf", "Grass_Wispy_Short.gltf"].map((name) => loadVegetationModel(`${base}/${name}`))),
  ]);
  vegetationAssets.pines = pines;
  vegetationAssets.broadleaf = broadleaf;
  vegetationAssets.bushes = bushes;
  vegetationAssets.grasses = grasses;
  vegetationAssets.loaded = true;
}

function loadVegetationModel(url: string) {
  return new Promise<Group>((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => {
        const root = gltf.scene;
        root.traverse((child) => {
          if (child instanceof Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        resolve(root);
      },
      undefined,
      reject,
    );
  });
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image: ${url}`));
    image.src = url;
  });
}

function animate() {
  timer.update();
  const delta = Math.min(timer.getDelta(), 0.05);
  const elapsed = timer.getElapsed();
  waterMaterial.uniforms.time.value = elapsed;
  if (skyMaterial) skyMaterial.uniforms.time.value = elapsed;
  if (cloudMaterial) cloudMaterial.uniforms.time.value = elapsed;
  if (cloudDeck) {
    cloudDeck.position.x = camera.position.x;
    cloudDeck.position.z = camera.position.z;
  }
  if (skyDome) {
    skyDome.position.copy(camera.position);
  }
  if (skyControls.autoTime) {
    skyControls.timeOfDay = (skyControls.timeOfDay + delta * 0.006) % 1;
  }
  updateEnvironment();
  updateFirstPerson(delta, elapsed);
  updateInputMetric();
  composer.render();
  requestAnimationFrame(animate);
}

function resetCamera() {
  camera.position.set(90, 92, 360);
  yaw = -0.22;
  pitch = -0.18;
  updateCameraRotation();
}

function updateCameraRotation() {
  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

function updateFirstPerson(delta: number, elapsed: number) {
  walkDirection.set(0, 0, 0);
  camera.getWorldDirection(walkForward).normalize();
  walkRight.crossVectors(walkForward, camera.up).normalize();

  if (moveKeys.has("forward")) walkDirection.add(walkForward);
  if (moveKeys.has("backward")) walkDirection.sub(walkForward);
  if (moveKeys.has("right")) walkDirection.add(walkRight);
  if (moveKeys.has("left")) walkDirection.sub(walkRight);
  if (moveKeys.has("up")) walkDirection.y += 1;
  if (moveKeys.has("down")) walkDirection.y -= 1;

  if (walkDirection.lengthSq() > 0) {
    walkDirection.normalize();
    const speed = moveKeys.has("sprint") ? 185 : 86;
    camera.position.addScaledVector(walkDirection, speed * delta);
  }

  camera.position.x = Math.max(-WORLD_SIZE / 2 + 12, Math.min(WORLD_SIZE / 2 - 12, camera.position.x));
  camera.position.z = Math.max(-WORLD_SIZE / 2 + 12, Math.min(WORLD_SIZE / 2 - 12, camera.position.z));
  const ground = getTerrainHeightAt(camera.position.x, camera.position.z);
  const minFlyHeight = ground + 3.0;
  camera.position.y = Math.max(minFlyHeight, Math.min(620, camera.position.y));
}

function getTerrainHeightAt(x: number, z: number) {
  if (!terrainSample.heights || terrainSample.verticesPerSide < 2) return WATER_LEVEL + EYE_HEIGHT;

  const verticesPerSide = terrainSample.verticesPerSide;
  const u = (x + WORLD_SIZE / 2) / WORLD_SIZE;
  const v = (z + WORLD_SIZE / 2) / WORLD_SIZE;
  const gx = Math.max(0, Math.min(verticesPerSide - 1.001, u * (verticesPerSide - 1)));
  const gz = Math.max(0, Math.min(verticesPerSide - 1.001, v * (verticesPerSide - 1)));
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const x1 = Math.min(verticesPerSide - 1, x0 + 1);
  const z1 = Math.min(verticesPerSide - 1, z0 + 1);
  const tx = gx - x0;
  const tz = gz - z0;
  const h00 = terrainSample.heights[z0 * verticesPerSide + x0];
  const h10 = terrainSample.heights[z0 * verticesPerSide + x1];
  const h01 = terrainSample.heights[z1 * verticesPerSide + x0];
  const h11 = terrainSample.heights[z1 * verticesPerSide + x1];
  const h0 = h00 + (h10 - h00) * tx;
  const h1 = h01 + (h11 - h01) * tx;
  return h0 + (h1 - h0) * tz;
}

function updateEnvironment() {
  const weatherValue = skyControls.weatherIndex;
  const sunAngle = skyControls.timeOfDay * Math.PI * 2;
  const sunUp = Math.sin(sunAngle);
  const sunDir = new Vector3(Math.cos(sunAngle) * -0.72, Math.max(-0.15, sunUp), 0.48).normalize();
  const day = Math.max(0.08, Math.min(1, sunUp * 1.35));
  const rainWeather = weatherModes[weatherValue] === "rain";
  const storm = weatherModes[weatherValue] === "storm" ? 1 : 0;
  const foggy = weatherModes[weatherValue] === "fog" ? 1 : 0;
  const cloudy = weatherValue === 1 ? 1 : 0;
  const fogColor = new Color(storm ? "#657277" : foggy ? "#a7b2af" : cloudy || rainWeather ? "#9eaeb0" : "#b6c9cf");

  sun.position.copy(sunDir).multiplyScalar(900);
  sun.intensity = (3.8 * day) * (storm ? 0.25 : rainWeather ? 0.42 : cloudy ? 0.58 : foggy ? 0.5 : 1);
  renderer.toneMappingExposure = storm ? 0.82 : rainWeather || cloudy ? 0.9 : foggy ? 0.95 : 1.02;
  const fogNear = storm ? 620 : foggy ? 260 : rainWeather ? 900 : cloudy ? 1200 : 2200;
  const fogFar = storm ? 2200 : foggy ? 1200 : rainWeather ? 3000 : cloudy ? 3900 : 6200;
  scene.fog = new Fog(fogColor, fogNear, fogFar);
  renderer.setClearColor(fogColor);
  terrainShaderMaterial.uniforms.sunDirection.value.copy(sunDir);
  terrainShaderMaterial.uniforms.fogColor.value.copy(fogColor);
  terrainShaderMaterial.uniforms.fogNear.value = scene.fog.near;
  terrainShaderMaterial.uniforms.fogFar.value = scene.fog.far;
  waterMaterial.uniforms.sunDirection.value.copy(sunDir);
  waterMaterial.uniforms.skyColor.value.copy(new Color("#0b2638")).lerp(fogColor, storm ? 0.12 : rainWeather || cloudy ? 0.06 : 0.015);
  waterMaterial.uniforms.stormFactor.value = storm ? 1 : rainWeather ? 0.45 : 0;
  if (skyMaterial) {
    skyMaterial.uniforms.timeOfDay.value = skyControls.timeOfDay;
    skyMaterial.uniforms.weather.value = weatherValue;
    skyMaterial.uniforms.sunDirection.value.copy(sunDir);
  }
  if (cloudMaterial) {
    cloudMaterial.uniforms.timeOfDay.value = skyControls.timeOfDay;
    cloudMaterial.uniforms.weather.value = weatherValue;
    cloudMaterial.uniforms.sunDirection.value.copy(sunDir);
  }
  if (rain) {
    const wetWeather = rainWeather || storm === 1;
    rain.visible = wetWeather;
    rain.material.opacity = storm === 1 ? 0.62 : rainWeather ? 0.38 : 0;
    rain.position.x = camera.position.x;
    rain.position.z = camera.position.z;
    const positions = rain.geometry.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < positions.count; i += 1) {
      const y = positions.getY(i) - (storm === 1 ? 7.6 : 4.8);
      positions.setY(i, y < 0 ? 320 : y);
    }
    positions.needsUpdate = true;
  }
}

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
  ssaoPass.setSize(width, height);
}
