# Realistic Heightmap Generation Prompt

Use this prompt to generate the only image input for the terrain pipeline.
The output must behave like a real-world digital elevation model, not like a fantasy map or a decorative texture.

## Prompt

Generate one square grayscale heightmap that looks like authentic real-world DEM elevation data for a small playable open-world terrain.

The image must be a pure top-down elevation raster.
Black means the lowest elevation.
White means the highest elevation.
Every pixel value must represent terrain height only.

Map scale:
- 4 km to 6 km wide.
- Realistic small region with hills, low mountains, valleys, lake basins, and broad traversable land.
- Suitable for a Three.js or Unreal Engine terrain mesh.

Real-world terrain structure:
- Most of the map should be lowland, broad valley floor, gentle plains, or rolling hills.
- Only 10% to 20% of the map should be high mountain terrain.
- Highest mountains should sit near one edge or one corner, not everywhere.
- Central and town-suitable areas should be mostly low-slope terrain.
- Use one coherent watershed: high ground drains into branching valleys and lower basins.
- Include several long connected valley corridors where rivers could naturally form later.
- Include one or two natural lake basins, but do not draw water. Represent them only as lower dark terrain.
- Mountains should be broad ridges and massifs with eroded side valleys, not isolated cones.
- Foothills must gradually transition into plains.
- Terrain should have believable erosion: dendritic tributary valleys, soft ridgelines, alluvial fans, and smoothed lowlands.

Elevation distribution:
- 45% to 60% of pixels should be dark-to-mid gray lowland and gentle plains.
- 25% to 35% should be mid-gray rolling hills and foothills.
- 10% to 20% should be light-gray mountains.
- Less than 3% should be near-white peaks.
- Avoid using full black or full white except in very small controlled areas.
- No large white plateaus.
- No large black holes.
- No high-frequency random speckle.

Visual encoding:
- Pure grayscale only.
- Smooth continuous gradients.
- Soft DEM-like relief shapes without lighting or shadows.
- The image should look like raw elevation data, not a rendered landscape.
- If texture detail is added, it must be subtle erosion detail that changes height logically.
- Do not add fake highlights, ambient occlusion, cast shadows, cloud shadows, or material texture.

Composition:
- Single image only.
- Orthographic top-down view.
- Square image.
- No perspective.
- No horizon.
- No sky.
- No UI.
- No panel layout.
- No labels.
- No icons.
- No roads.
- No buildings.
- No trees.
- No biome colors.
- No painted rivers.
- No blue water.
- No snow texture.
- No contour lines.

Important realism constraints:
- This must resemble a real DEM heightmap from terrain data.
- Do not generate a random Perlin-noise blob map.
- Do not generate circular islands of brightness.
- Do not generate repeated noise cells.
- Do not generate vertical walls, mesa columns, needle towers, fantasy cliffs, or crater-like bowls.
- Do not create mountains across the whole map.
- Do not create roads or rivers in the image. The program will calculate rivers and roads later from height, slope, and flow.

Target result:
- A natural grayscale elevation map with large readable landforms.
- Broad playable lowlands.
- Edge or corner mountain range.
- Continuous valleys suitable for flow accumulation.
- Realistic height transitions that will produce believable 3D terrain when displaced.

## Negative Prompt

colored map, satellite image, painted map, fantasy map, strategy map, terrain render, 3D render, perspective, shadows, lighting, clouds, sky, roads, paths, rivers, blue water, forests, grass, snow, buildings, towns, labels, text, UI, grid, compass, legend, contour lines, multiple panels, icons, decorative texture, random noise, Perlin blobs, cellular noise, repeated patterns, isolated cones, needle peaks, vertical cliffs, mesa walls, canyon columns, crater field, flat white plateau, pure black holes, artificial shapes

## Recommended Output

- 1024 x 1024 or 2048 x 2048 PNG.
- 16-bit grayscale PNG if available.
- 8-bit grayscale PNG is acceptable for MVP.
- No alpha channel needed.

## Validation Checklist

Before using the generated image, check:

- Does it look like real DEM elevation data?
- Are most areas traversable lowland or rolling terrain?
- Are mountains limited to one edge/corner or a small region?
- Are valleys continuous enough for flow accumulation?
- Are there no painted rivers, roads, buildings, trees, colors, shadows, or labels?
- Are there no random noise blobs, spikes, walls, or white plateaus?

Reject the image if it looks like a texture, painting, fantasy map, terrain screenshot, or random noise field.

## Program Pipeline

The generated image should be loaded directly by the terrain program:

```text
AI HeightMap
  -> program height remap
  -> flow accumulation
  -> river carving
  -> slope / moisture analysis
  -> biome generation
  -> roads / settlements later
  -> Three.js preview render
```
