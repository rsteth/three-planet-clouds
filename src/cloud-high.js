import * as THREE from 'three';

// Small, single-shell implementation inspired by the envelope in
// github.com/FarazzShaikh/three-volumetric-clouds, pre-baked density/depth clipping
// in github.com/leoawen/volumetric-clouds, and the reduced-resolution principle in
// github.com/takram-design-engineering/three-geospatial/tree/main/packages/clouds.
// No code or complete renderer from those projects is imported.
export const HIGH_CLOUD_CONFIG = Object.freeze({
  wavelength: 18,
  erosion: 0.22,
  detailDistance: 160,
  extinction: 0.8,
  phaseG: 0.4,
  ambient: 0.62,
  sunlight: 2.7,
  shadowDistance: 12,
  depthTolerance: 0.24,
  depthRelativeTolerance: 0.006,
  ambientColor: [0.76, 0.84, 0.88],
  sunColor: [1, 0.98, 0.91],
});

export function cloudTargetSize(width, height) {
  const w = Math.max(1, Math.floor(width)),
    h = Math.max(1, Math.floor(height));
  const scale = Math.min(0.5, Math.sqrt(262144 / (w * h)));
  return {
    width: Math.max(1, Math.floor(w * scale)),
    height: Math.max(1, Math.floor(h * scale)),
    scale,
  };
}

// CPU reference used by tests. Distances use a normalized ray in planet space.
export function intersectCloudShellRay(origin, direction, inner, outer, sceneDistance = Infinity) {
  const sphere = (r) => {
    const b = origin[0] * direction[0] + origin[1] * direction[1] + origin[2] * direction[2];
    const c = origin[0] ** 2 + origin[1] ** 2 + origin[2] ** 2 - r * r;
    const d = b * b - c;
    return d < 0 ? null : [-b - Math.sqrt(d), -b + Math.sqrt(d)];
  };
  const outside = sphere(outer);
  if (!outside) return [];
  const a = Math.max(0, outside[0]),
    b = Math.min(sceneDistance, outside[1]);
  if (b <= a) return [];
  const inside = sphere(inner);
  if (!inside || inside[1] <= a || inside[0] >= b) return [[a, b]];
  const result = [];
  if (inside[0] > a) result.push([a, Math.min(b, inside[0])]);
  if (inside[1] < b) result.push([Math.max(a, inside[1]), b]);
  return result;
}

const FULLSCREEN_VERTEX = `precision highp float;
in vec3 position;
out vec2 vUv;
void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`;
const RAY_COMMON = `
uniform mat4 uInverseProjection;
uniform mat4 uCameraMatrix;
uniform vec3 uCameraPosition;
uniform vec3 uPlanetCenter;
uniform float uOrthographic;
uniform vec2 uShell;
uniform float uDistanceScale;
vec3 unprojectPoint(vec2 uv,float depth){
 vec4 p=uInverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);
 p/=p.w;return (uCameraMatrix*p).xyz;
}
void viewingRay(vec2 uv,out vec3 origin,out vec3 direction){
 vec3 nearPoint=unprojectPoint(uv,0.);
 origin=mix(uCameraPosition,nearPoint,uOrthographic);
 direction=normalize(unprojectPoint(uv,1.)-nearPoint);
}
float sceneRayDistance(vec2 uv,float depth,vec3 origin,vec3 direction){
 return max(0.,dot(unprojectPoint(uv,depth)-origin,direction));
}
vec2 sphereInterval(vec3 origin,vec3 direction,float radius){
 float b=dot(origin,direction),d=b*b-dot(origin,origin)+radius*radius;
 if(d<0.)return vec2(1.,-1.);
 float root=sqrt(max(0.,d));return vec2(-b-root,-b+root);
}
// Subtract the inner interval, then clip both remaining segments to opaque depth.
// A single cumulative-distance march below shares 48 samples across both.
vec4 shellIntervals(vec3 origin,vec3 direction,float sceneDistance){
 vec2 outer=sphereInterval(origin,direction,uShell.y);
 float a=max(0.,outer.x),b=min(sceneDistance,outer.y);
 if(b<=a)return vec4(0.);
 vec2 inner=sphereInterval(origin,direction,uShell.x);
 if(inner.y<=inner.x||inner.y<=a||inner.x>=b)return vec4(a,b,0.,0.);
 vec2 first=vec2(a,max(a,min(b,inner.x)));
 vec2 second=vec2(min(b,max(a,inner.y)),b);
 return vec4(first,second);
}
`;

export const CLOUD_RAYMARCH_FRAGMENT = `precision highp float;
precision highp sampler3D;
precision highp samplerCube;
in vec2 vUv;
layout(location=0) out vec4 outCloud;
layout(location=1) out vec4 outAux;
uniform sampler2D uSceneDepth;
uniform samplerCube uEnvelope;
uniform sampler3D uNoise;
uniform sampler3D uDetail;
uniform float uDensityModel;
uniform float uDetailDistance;
uniform sampler2D uBlueNoise;
uniform float uBlueNoiseSize;
uniform float uDiagnosticEmptyClouds;
uniform mat3 uWindInverse;
uniform vec3 uSunDirection;
uniform float uPlanetRadius;
uniform float uWavelength;
uniform float uErosion;
uniform float uExtinction;
uniform float uPhaseG;
uniform float uAmbient;
uniform float uSunlight;
uniform float uShadowDistance;
uniform vec3 uAmbientColor;
uniform vec3 uSunColor;
${RAY_COMMON}
float densityAt(vec3 worldPosition){
 if(uDiagnosticEmptyClouds>.5)return 0.;
 vec3 local=uWindInverse*(worldPosition-uPlanetCenter);
 float radius=length(local);
 if(radius<uShell.x||radius>uShell.y)return 0.;
 vec4 envelope=texture(uEnvelope,local/max(radius,.0001));
 if(uDensityModel>.5){
  // Weather is a continuous coverage/height/type map. The 3D shape signal,
  // not a min/max union of ellipsoids, decides occupancy along the ray.
  float coverage=envelope.r;
  if(coverage<.025)return 0.;
  vec2 heights=uShell.x+envelope.gb*(uShell.y-uShell.x);
  if(radius<=heights.x||radius>=heights.y)return 0.;
  float h=(radius-heights.x)/max(.0001,heights.y-heights.x);
  float type=envelope.a;
  float profile=smoothstep(0.,.07,h)*(1.-smoothstep(.78-.23*type,1.,h));
  if(profile<=.001)return 0.;
  vec3 shapePosition=local/uWavelength;
  float shape=clamp((texture(uNoise,shapePosition).r-.24)/.58,0.,1.);
  float threshold=.32+.5*(1.-coverage);
  float body=smoothstep(threshold,threshold+.18,shape*profile);
  if(body<=.0001)return 0.;
  float detailFade=1.-smoothstep(uDetailDistance*.5,uDetailDistance,length(worldPosition-uCameraPosition));
  if(detailFade>.01&&body<.999){
   float detail=texture(uDetail,local/(uWavelength*.13)).r;
   body=clamp(body-uErosion*detailFade*(1.-detail)*(1.-body),0.,1.);
  }
  return body*mix(.65,1.,type)*smoothstep(.025,.18,coverage);
 }
 if(envelope.a<.002)return 0.;
 vec3 decoded=envelope.rgb/max(envelope.a,.0001);
 vec2 heights=uShell.x+decoded.rg*(uShell.y-uShell.x);
 if(radius<=heights.x||radius>=heights.y)return 0.;
 float h=(radius-heights.x)/max(.0001,heights.y-heights.x);
 float profile=smoothstep(0.,.18,h)*(1.-smoothstep(.72,1.,h));
 if(profile*envelope.a<=.001)return 0.;
 // Empty envelope/altitude/profile samples never fetch the shared 3D noise.
 float noiseValue=texture(uNoise,local/uWavelength).r;
 return decoded.b*clamp((envelope.a*profile-uErosion*(1.-noiseValue))/max(.001,1.-uErosion),0.,1.);
}
float sunlightTransmittance(vec3 worldPosition){
 vec3 local=worldPosition-uPlanetCenter;
 vec2 planet=sphereInterval(local,uSunDirection,uPlanetRadius);
 if(planet.y>0.&&planet.x<planet.y)return 0.;
 vec2 outer=sphereInterval(local,uSunDirection,uShell.y);
 float segment=max(0.,min(uShadowDistance,outer.y))*.5;
 // Exactly two additional density calls, each representing one segment length.
 float shadowDensity=densityAt(worldPosition+uSunDirection*(segment*.5));
 shadowDensity+=densityAt(worldPosition+uSunDirection*(segment*1.5));
 return exp(-uExtinction*shadowDensity*segment);
}
float phaseHG(float cosine){
 float g=uPhaseG;
 return (1.-g*g)/(12.566370614359*pow(max(.001,1.+g*g-2.*g*cosine),1.5));
}
void main(){
 vec3 origin,ray;viewingRay(vUv,origin,ray);
 float sceneDistance=sceneRayDistance(vUv,texture(uSceneDepth,vUv).r,origin,ray);
 vec4 intervals=shellIntervals(origin-uPlanetCenter,ray,sceneDistance);
 float firstLength=intervals.y-intervals.x;
 float totalLength=firstLength+intervals.w-intervals.z;
 outCloud=vec4(0.);outAux=vec4(0.,sceneDistance/uDistanceScale,0.,0.);
 if(totalLength<=.0001)return;
 const int PRIMARY_SAMPLES=48;
 float ds=totalLength/float(PRIMARY_SAMPLES);
 // Fixed spatial blue noise: no frame/time term and no unsupported TAA history.
 float jitter=texture(uBlueNoise,gl_FragCoord.xy/uBlueNoiseSize).r;
 float transmittance=1.,weightedDistance=0.,firstCloud=-1.;vec3 radiance=vec3(0.);
 float phase=phaseHG(dot(ray,uSunDirection));
 for(int i=0;i<PRIMARY_SAMPLES;i++){
  float cumulative=(float(i)+jitter)*ds;
  float distanceAlongRay=cumulative<firstLength?intervals.x+cumulative:intervals.z+cumulative-firstLength;
  vec3 position=origin+ray*distanceAlongRay;
  float rho=densityAt(position);
  if(rho<=.0001)continue;
  if(firstCloud<0.)firstCloud=distanceAlongRay;
  float alpha=1.-exp(-uExtinction*rho*ds);
  float radialLight=.72+.28*max(0.,dot(normalize(position-uPlanetCenter),uSunDirection));
  vec3 sourceRadiance=uAmbientColor*uAmbient*radialLight;
  sourceRadiance+=uSunColor*(uSunlight*phase*sunlightTransmittance(position));
  float weight=transmittance*alpha;
  radiance+=weight*sourceRadiance;
  weightedDistance+=weight*distanceAlongRay;
  transmittance*=1.-alpha;
  if(transmittance<.02)break;
 }
 float opacity=1.-transmittance;
 outCloud=vec4(radiance,opacity);
 outAux=vec4(opacity>.0001?weightedDistance/(opacity*uDistanceScale):0.,sceneDistance/uDistanceScale,max(0.,firstCloud)/uDistanceScale,opacity);
}`;

export const CLOUD_COMPOSITE_FRAGMENT = `precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform sampler2D uSceneFlags;
uniform sampler2D uCloud;
uniform sampler2D uAux;
uniform vec2 uCloudSize;
uniform vec4 uProjectedBounds;
uniform float uDepthTolerance;
uniform float uDepthRelativeTolerance;
uniform int uOutputSpace;
uniform int uToneOperator;
uniform vec4 uHaze; // enabled, inner radius, outer radius, fade * authored opacity
uniform vec3 uHazeTint;
uniform int uFogType;
uniform vec3 uFogParameters; // density, near, far
uniform vec3 uFogColor;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
${RAY_COMMON}
vec3 outputColor(vec3 linearColor){
 vec4 color=vec4(max(vec3(0.),linearColor),1.);
 if(uOutputSpace>=2)color=LinearSRGBToLinearDisplayP3(color);
 if(uOutputSpace==1||uOutputSpace==3)color=sRGBTransferOETF(color);
 return color.rgb;
}
vec3 mapOutput(vec3 linearColor){
 return outputColor(uToneOperator==4?ACESFilmicToneMapping(linearColor):linearColor);
}
vec4 reconstructCloud(vec3 origin,vec3 ray,float fullDistance){
 if(any(lessThan(vUv,uProjectedBounds.xy))||any(greaterThan(vUv,uProjectedBounds.zw)))return vec4(0.);
 vec4 intervals=shellIntervals(origin-uPlanetCenter,ray,fullDistance);
 if(intervals.y<=intervals.x&&intervals.w<=intervals.z)return vec4(0.);
 float entry=intervals.y>intervals.x?intervals.x:intervals.z;
 // Recheck the entry against full-resolution depth, not a low-resolution tap.
 if(fullDistance<=entry+.0001)return vec4(0.);
 vec2 lowPosition=vUv*uCloudSize-.5,base=floor(lowPosition),fraction=fract(lowPosition);
 vec4 cloud=vec4(0.);float weightSum=0.,referenceDistance=-1.;
 float tolerance=uDepthTolerance+uDepthRelativeTolerance*max(1.,fullDistance);
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  vec2 uv=(base+vec2(float(x),float(y))+.5)/uCloudSize;
  vec4 aux=texture(uAux,uv);
  float representative=aux.x*uDistanceScale;
  if(aux.a>.0001&&aux.z*uDistanceScale<=fullDistance+tolerance&&representative<=fullDistance+tolerance&&abs(aux.y*uDistanceScale-fullDistance)<=tolerance*4.){
   if(referenceDistance<0.)referenceDistance=representative;
   else referenceDistance=min(referenceDistance,representative);
  }
 }
 if(referenceDistance<0.)return vec4(0.);
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  vec2 offset=vec2(float(x),float(y));vec2 uv=(base+offset+.5)/uCloudSize;
  vec4 aux=texture(uAux,uv);float representative=aux.x*uDistanceScale;
  if(aux.z*uDistanceScale>fullDistance+tolerance||representative>fullDistance+tolerance)continue;
  float depthDifference=abs(aux.y*uDistanceScale-fullDistance);
  if(depthDifference>tolerance*4.)continue;
  vec2 bilinear=mix(vec2(1.)-fraction,fraction,offset);
  float weight=bilinear.x*bilinear.y*exp(-depthDifference/max(.001,tolerance));
  if(aux.a>.0001)weight*=exp(-abs(representative-referenceDistance)/max(1.,referenceDistance*.025));
  cloud+=texture(uCloud,uv)*weight;weightSum+=weight;
 }
 if(weightSum<=.00001)return vec4(0.);
 return cloud/weightSum;
}
float artisticHazeAlpha(vec3 origin,vec3 ray,float sceneDistance){
 vec3 local=origin-uPlanetCenter;
 // Matches the original FrontSide mesh: an inside camera sees no haze surface.
 if(uHaze.x<.5||length(local)<=uHaze.z)return 0.;
 vec2 sphere=sphereInterval(local,ray,uHaze.z);
 float nearDistance=dot(unprojectPoint(vUv,0.)-origin,ray);
 if(sphere.x<nearDistance||sphere.y<=sphere.x||sphere.x>sceneDistance)return 0.;
 float impact=length(cross(local,ray));
 float altitude=clamp((impact-uHaze.y)/max(.001,uHaze.z-uHaze.y),0.,1.);
 float falloff=1.-altitude*altitude*(3.-2.*altitude);
 return uHaze.w*falloff*falloff;
}
void main(){
 vec4 sceneColor=texture(uSceneColor,vUv);
 float depth=texture(uSceneDepth,vUv).r;
 vec3 origin,ray;viewingRay(vUv,origin,ray);
 float fullDistance=sceneRayDistance(vUv,depth,origin,ray);
 vec4 cloud=reconstructCloud(origin,ray,fullDistance);
 float transmittance=1.-cloud.a;
 // The scene and volume combine in linear radiance before the sole output map.
 vec3 linearComposite=cloud.rgb+(1.-cloud.a)*sceneColor.rgb;
 vec3 display=mapOutput(linearComposite);
 vec3 flags=clamp(texture(uSceneFlags,vUv).rgb,0.,1.);
 // The Sun explicitly opts out of tone mapping. Correct only its background
 // contribution; the cloud radiance is never run through the output map twice.
 if(flags.g>.001)display+=transmittance*flags.g*(outputColor(sceneColor.rgb)-mapOutput(sceneColor.rgb));
 if(flags.b>.001)display+=transmittance*flags.b*(sceneColor.rgb-mapOutput(sceneColor.rgb));
 // Legacy Three fog is display-space, follows camera-space Z, and respects each
 // material's fog opt-out (celestial bodies do not receive the home-world fog).
 if(uFogType!=0&&flags.r>.001){
  vec4 viewPoint=uInverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);
  float viewDepth=max(0.,-viewPoint.z/viewPoint.w);
  float factor=uFogType==1?1.-exp(-uFogParameters.x*uFogParameters.x*viewDepth*viewDepth):smoothstep(uFogParameters.y,uFogParameters.z,viewDepth);
  display=mix(display,uFogColor,clamp(factor*flags.r*transmittance,0.,1.));
 }
 // One authored artistic haze treatment, in its original display blend space.
 // Cloud-transmittance weighting preserves clear cloud fronts. Intermediate
 // opacity is intentionally artistic, rather than a second physical atmosphere.
 float haze=artisticHazeAlpha(origin,ray,fullDistance)*transmittance;
 if(haze>.00001)display=mix(display,mapOutput(uHazeTint),clamp(haze,0.,1.));
 outColor=vec4(clamp(display,0.,1.),cloud.a+transmittance*sceneColor.a);
}`;

// Tone/output conversion has already happened once in reconstruction. FXAA is
// evaluated in display space and writes directly, with no second conversion.
const OUTPUT_VERTEX = `varying vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`;
// FXAA filter lineage: Timothy Lottes / NVIDIA; compact WebGL form by
// Armin Ronacher and Matt DesLauriers. See licenses/FXAA.txt.
export const CLOUD_OUTPUT_FRAGMENT = `uniform sampler2D uComposed;
uniform vec2 uInverseSize;
varying vec2 vUv;
float perceptualLuma(vec3 color){return dot(color,vec3(.299,.587,.114));}
void main(){
 vec4 middle=texture2D(uComposed,vUv);
 vec3 nw=texture2D(uComposed,vUv+vec2(-1.,-1.)*uInverseSize).rgb;
 vec3 ne=texture2D(uComposed,vUv+vec2(1.,-1.)*uInverseSize).rgb;
 vec3 sw=texture2D(uComposed,vUv+vec2(-1.,1.)*uInverseSize).rgb;
 vec3 se=texture2D(uComposed,vUv+vec2(1.,1.)*uInverseSize).rgb;
 float m=perceptualLuma(middle.rgb),a=perceptualLuma(nw),b=perceptualLuma(ne),c=perceptualLuma(sw),d=perceptualLuma(se);
 float low=min(m,min(min(a,b),min(c,d))),high=max(m,max(max(a,b),max(c,d)));
 vec3 color=middle.rgb;
 if(high-low>max(.0312,high*.125)){
  vec2 direction=vec2(-((a+b)-(c+d)),(a+c)-(b+d));
  float reduction=max((a+b+c+d)*(.25*.125),.0078125);
  float reciprocal=1./(min(abs(direction.x),abs(direction.y))+reduction);
  direction=clamp(direction*reciprocal,vec2(-8.),vec2(8.))*uInverseSize;
  vec3 narrow=.5*(texture2D(uComposed,vUv+direction*(-1./6.)).rgb+texture2D(uComposed,vUv+direction*(1./6.)).rgb);
  vec3 wide=narrow*.5+.25*(texture2D(uComposed,vUv+direction*(-.5)).rgb+texture2D(uComposed,vUv+direction*.5).rgb);
  float wideLuma=perceptualLuma(wide);color=wideLuma<low||wideLuma>high?narrow:wide;
 }
 gl_FragColor=vec4(color,middle.a);
}`;

// ACES fitted transform constants: Three.js / Stephen Hill.
// See licenses/THREE.txt and licenses/LTC.txt.
const ACES_INPUT = new THREE.Matrix3().set(
  0.59719,
  0.35458,
  0.04823,
  0.076,
  0.90834,
  0.01566,
  0.0284,
  0.13383,
  0.83777,
);
const ACES_OUTPUT = new THREE.Matrix3().set(
  1.60475,
  -0.53108,
  -0.07367,
  -0.10208,
  1.10813,
  -0.00605,
  -0.00327,
  -0.07276,
  1.07602,
);
const ACES_INPUT_INVERSE = ACES_INPUT.clone().invert(),
  ACES_OUTPUT_INVERSE = ACES_OUTPUT.clone().invert();
const colorVector = new THREE.Vector3();
export function inverseACESClearColor(color, exposure, target = new THREE.Color()) {
  if (!(exposure > 0))
    throw new Error('High requires positive ACES exposure to preserve the authored clear color.');
  colorVector.set(color.r, color.g, color.b).applyMatrix3(ACES_OUTPUT_INVERSE);
  const inverse = (value) => {
    const a = 1 - 0.983729 * value,
      b = 0.0245786 - 0.432951 * value,
      c = -0.000090537 - 0.238081 * value;
    return Math.abs(a) < 1e-8 ? -c / b : (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
  };
  colorVector
    .set(inverse(colorVector.x), inverse(colorVector.y), inverse(colorVector.z))
    .applyMatrix3(ACES_INPUT_INVERSE)
    .multiplyScalar(0.6 / exposure);
  target.setRGB(colorVector.x, colorVector.y, colorVector.z, THREE.LinearSRGBColorSpace);
  return target;
}

// Pure shader patching is tested without a browser. Existing hooks are invoked
// first; the scoped renderer wrapper restores them when the High renderer dies.
export function addCloudSceneFlags(
  fragmentShader,
  { fog = true, toneMapped = true, literalOutput = false } = {},
) {
  const main = /void\s+main\s*\(\s*(?:void)?\s*\)\s*\{/.exec(fragmentShader);
  if (!main)
    throw new Error('Unsupported scene fragment shader: no main function for cloud metadata.');
  let balance = 1,
    end = main.index + main[0].length;
  for (; end < fragmentShader.length && balance; end++) {
    if (fragmentShader[end] === '{') balance++;
    else if (fragmentShader[end] === '}') balance--;
  }
  if (balance) throw new Error('Unsupported scene fragment shader: unbalanced main function.');
  const assignment = `\ncloudSceneFlags=vec4(${fog ? '1.' : '0.'},${toneMapped === false && !literalOutput ? '1.' : '0.'},${literalOutput ? '1.' : '0.'},gl_FragColor.a);\n`;
  const declaration = 'layout(location=1) out highp vec4 cloudSceneFlags;\n';
  return (
    declaration + fragmentShader.slice(0, end - 1) + assignment + fragmentShader.slice(end - 1)
  );
}

function configuredNumber(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function makeConfig(config) {
  const defaults = HIGH_CLOUD_CONFIG;
  return {
    wavelength: configuredNumber(config.wavelength, defaults.wavelength, 0.1, 100),
    erosion: configuredNumber(config.erosion, defaults.erosion, 0, 0.9),
    detailDistance: configuredNumber(config.detailDistance, defaults.detailDistance, 1, 10000),
    extinction: configuredNumber(config.extinction, defaults.extinction, 0.01, 8),
    phaseG: configuredNumber(config.phaseG, defaults.phaseG, -0.85, 0.85),
    ambient: configuredNumber(config.ambient, defaults.ambient, 0, 5),
    sunlight: configuredNumber(config.sunlight, defaults.sunlight, 0, 20),
    shadowDistance: configuredNumber(config.shadowDistance, defaults.shadowDistance, 0.1, 100),
    depthTolerance: configuredNumber(config.depthTolerance, defaults.depthTolerance, 0.001, 10),
    depthRelativeTolerance: configuredNumber(
      config.depthRelativeTolerance,
      defaults.depthRelativeTolerance,
      0,
      0.1,
    ),
    ambientColor: config.ambientColor ?? defaults.ambientColor,
    sunColor: config.sunColor ?? defaults.sunColor,
  };
}

export function createHighCloudRenderer({ renderer, bounds, planetRadius, config = {} }) {
  const settings = makeConfig(config),
    gl = renderer?.getContext?.();
  let supported = Boolean(
    gl &&
      renderer.capabilities?.isWebGL2 !== false &&
      gl.getExtension('EXT_color_buffer_float') &&
      gl.getParameter(gl.MAX_DRAW_BUFFERS) >= 2,
  );
  let failure = supported
    ? null
    : 'High requires renderable half-float color, two draw buffers, and sampleable WebGL2 depth.';
  let skipReason = null,
    diagnosticEmptyClouds = false;
  let resources = null,
    sceneTarget = null,
    cloudTarget = null,
    compositeTarget = null,
    disposed = false,
    validated = false;
  let fullWidth = 0,
    fullHeight = 0,
    cloudWidth = 0,
    cloudHeight = 0,
    rendered = false,
    culled = false,
    lastCalls = 0,
    sceneCalls = 0,
    lastCpuMs = null;
  const size = new THREE.Vector2(),
    shell = new THREE.Vector2(bounds.inner, bounds.outer),
    center = new THREE.Vector3(),
    cameraPosition = new THREE.Vector3();
  const frustum = new THREE.Frustum(),
    viewProjection = new THREE.Matrix4(),
    sphere = new THREE.Sphere(center, bounds.outer),
    corner = new THREE.Vector3(),
    viewCenter = new THREE.Vector3();
  const captureMaterials = new Map(),
    compensatedClear = new THREE.Color(),
    clearCache = new THREE.Color(-1, -1, -1);
  let clearExposure = NaN,
    clearToneOperator = -1,
    shadersValidated = false;
  const metadataClear = new Float32Array(4);
  const projected = new THREE.Vector4(0, 0, 1, 1),
    savedViewport = new THREE.Vector4(),
    savedScissor = new THREE.Vector4(),
    savedClearColor = new THREE.Color();
  const common = {
    uInverseProjection: { value: new THREE.Matrix4() },
    uCameraMatrix: { value: new THREE.Matrix4() },
    uCameraPosition: { value: cameraPosition },
    uPlanetCenter: { value: center },
    uOrthographic: { value: 0 },
    uShell: { value: shell },
    uDistanceScale: { value: 1 },
  };
  const marchUniforms = {
    ...common,
    uSceneDepth: { value: null },
    uEnvelope: { value: null },
    uNoise: { value: null },
    uDetail: { value: null },
    uDensityModel: { value: 0 },
    uDetailDistance: { value: settings.detailDistance },
    uBlueNoise: { value: null },
    uBlueNoiseSize: { value: 32 },
    uDiagnosticEmptyClouds: { value: 0 },
    uWindInverse: { value: new THREE.Matrix3() },
    uSunDirection: { value: new THREE.Vector3(-0.4, 0.8, 0.5).normalize() },
    uPlanetRadius: { value: planetRadius },
    uWavelength: { value: settings.wavelength },
    uErosion: { value: settings.erosion },
    uExtinction: { value: settings.extinction },
    uPhaseG: { value: settings.phaseG },
    uAmbient: { value: settings.ambient },
    uSunlight: { value: settings.sunlight },
    uShadowDistance: { value: settings.shadowDistance },
    uAmbientColor: { value: new THREE.Vector3(...settings.ambientColor) },
    uSunColor: { value: new THREE.Vector3(...settings.sunColor) },
  };
  const compositeUniforms = {
    ...common,
    uSceneColor: { value: null },
    uSceneDepth: { value: null },
    uSceneFlags: { value: null },
    toneMappingExposure: { value: 1 },
    uToneOperator: { value: 4 },
    uOutputSpace: { value: 1 },
    uHaze: { value: new THREE.Vector4() },
    uHazeTint: { value: new THREE.Vector3(0.58, 0.72, 0.76) },
    uFogType: { value: 0 },
    uFogParameters: { value: new THREE.Vector3() },
    uFogColor: { value: new THREE.Color() },
    uCloud: { value: null },
    uAux: { value: null },
    uCloudSize: { value: new THREE.Vector2() },
    uProjectedBounds: { value: projected },
    uDepthTolerance: { value: settings.depthTolerance },
    uDepthRelativeTolerance: { value: settings.depthRelativeTolerance },
  };
  const outputUniforms = {
    uComposed: { value: null },
    uInverseSize: { value: new THREE.Vector2() },
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const options = { depthTest: false, depthWrite: false, blending: THREE.NoBlending };
  const marchMaterial = new THREE.RawShaderMaterial({
    ...options,
    name: 'Cloud shell / 48 samples',
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: CLOUD_RAYMARCH_FRAGMENT,
    uniforms: marchUniforms,
  });
  const compositeMaterial = new THREE.RawShaderMaterial({
    ...options,
    name: 'Depth-aware cloud reconstruction',
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: CLOUD_COMPOSITE_FRAGMENT,
    uniforms: compositeUniforms,
  });
  const outputMaterial = new THREE.ShaderMaterial({
    ...options,
    name: 'Cloud composite / output FXAA',
    vertexShader: OUTPUT_VERTEX,
    fragmentShader: CLOUD_OUTPUT_FRAGMENT,
    uniforms: outputUniforms,
    toneMapped: false,
  });
  const passScene = new THREE.Scene(),
    passCamera = new THREE.Camera(),
    triangle = new THREE.Mesh(geometry, marchMaterial);
  triangle.frustumCulled = false;
  passScene.add(triangle);
  const timerExtension = supported ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
  const timerSlots = timerExtension
    ? Array.from({ length: 4 }, () => ({ query: gl.createQuery(), pending: false, invalid: false }))
    : [];
  const gpuSamples = new Float64Array(120);
  let gpuCount = 0,
    gpuCursor = 0,
    lastGpuMs = null,
    activeTimer = null;
  function pollTimers() {
    if (!timerExtension) return;
    const disjoint = gl.getParameter(timerExtension.GPU_DISJOINT_EXT);
    if (disjoint) for (const slot of timerSlots) if (slot.pending) slot.invalid = true;
    for (const slot of timerSlots)
      if (slot.pending && gl.getQueryParameter(slot.query, gl.QUERY_RESULT_AVAILABLE)) {
        slot.pending = false;
        if (disjoint || slot.invalid) continue;
        lastGpuMs = gl.getQueryParameter(slot.query, gl.QUERY_RESULT) / 1e6;
        if (Number.isFinite(lastGpuMs)) {
          gpuSamples[gpuCursor] = lastGpuMs;
          gpuCursor = (gpuCursor + 1) % gpuSamples.length;
          gpuCount = Math.min(gpuCount + 1, gpuSamples.length);
        }
      }
    if (disjoint) {
      gpuCount = 0;
      gpuCursor = 0;
      lastGpuMs = null;
    }
  }
  function startTimer() {
    if (
      !timerExtension ||
      gl.getParameter(timerExtension.GPU_DISJOINT_EXT) ||
      gl.getQuery(timerExtension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)
    )
      return;
    activeTimer = timerSlots.find((slot) => !slot.pending) ?? null;
    if (activeTimer) {
      activeTimer.invalid = false;
      gl.beginQuery(timerExtension.TIME_ELAPSED_EXT, activeTimer.query);
    }
  }
  function endTimer() {
    if (activeTimer) {
      gl.endQuery(timerExtension.TIME_ELAPSED_EXT);
      activeTimer.pending = true;
      activeTimer = null;
    }
  }
  function releaseTargets() {
    sceneTarget?.dispose();
    cloudTarget?.dispose();
    compositeTarget?.dispose();
    sceneTarget = cloudTarget = compositeTarget = null;
    fullWidth = fullHeight = cloudWidth = cloudHeight = 0;
    validated = false;
  }
  function releaseResources() {
    if (resources) {
      resources.envelope.dispose();
      for (const face of resources.faces) face.dispose();
      resources.noise.dispose();
      resources.detail?.dispose();
      resources.blueNoise.dispose();
      resources = null;
    }
    marchUniforms.uEnvelope.value =
      marchUniforms.uNoise.value =
      marchUniforms.uDetail.value =
      marchUniforms.uBlueNoise.value =
        null;
  }
  function setResources(data) {
    if (disposed) return false;
    if (
      !(data?.weather ?? data?.envelope)?.faces ||
      (data.weather ?? data.envelope).faces.length !== 6 ||
      !data.noise?.data ||
      !data.blueNoise?.data
    )
      return false;
    const weather = Boolean(data.weather);
    if (weather && (data.version !== 2 || data.model !== 'weather' || !data.detail)) return false;
    const e = data.weather ?? data.envelope,
      n = data.noise,
      b = data.blueNoise;
    const validSize = (value) => Number.isInteger(value) && value > 0 && value <= 256;
    if (
      !validSize(e.size) ||
      !validSize(n.size) ||
      !validSize(b.size) ||
      !(n.data instanceof Uint8Array) ||
      !(b.data instanceof Uint8Array) ||
      !e.faces.every((face) => face instanceof Uint8Array && face.length === e.size * e.size * 4) ||
      n.data.length !== n.size ** 3 ||
      b.data.length !== b.size ** 2 ||
      (weather &&
        (!validSize(data.detail.size) ||
          !(data.detail.data instanceof Uint8Array) ||
          data.detail.data.length !== data.detail.size ** 3)) ||
      (data.bounds &&
        (!Number.isFinite(data.bounds.inner) ||
          !Number.isFinite(data.bounds.outer) ||
          data.bounds.inner < 0 ||
          data.bounds.outer <= data.bounds.inner)) ||
      (weather && !data.bounds)
    )
      return false;
    releaseResources();
    const faces = e.faces.map(
      (face) =>
        new THREE.DataTexture(face, e.size, e.size, THREE.RGBAFormat, THREE.UnsignedByteType),
    );
    const envelope = new THREE.CubeTexture(faces);
    envelope.type = THREE.UnsignedByteType;
    envelope.format = THREE.RGBAFormat;
    envelope.colorSpace = THREE.NoColorSpace;
    envelope.minFilter = envelope.magFilter = THREE.LinearFilter;
    envelope.generateMipmaps = false;
    envelope.flipY = false;
    envelope.needsUpdate = true;
    const noise = new THREE.Data3DTexture(n.data, n.size, n.size, n.size);
    noise.format = THREE.RedFormat;
    noise.type = THREE.UnsignedByteType;
    noise.internalFormat = 'R8';
    noise.minFilter = noise.magFilter = THREE.LinearFilter;
    noise.wrapS = noise.wrapT = noise.wrapR = THREE.RepeatWrapping;
    noise.unpackAlignment = 1;
    noise.needsUpdate = true;
    let detail = null;
    if (weather) {
      const d = data.detail;
      detail = new THREE.Data3DTexture(d.data, d.size, d.size, d.size);
      detail.format = THREE.RedFormat;
      detail.type = THREE.UnsignedByteType;
      detail.internalFormat = 'R8';
      detail.minFilter = detail.magFilter = THREE.LinearFilter;
      detail.wrapS = detail.wrapT = detail.wrapR = THREE.RepeatWrapping;
      detail.unpackAlignment = 1;
      detail.needsUpdate = true;
    }
    const blueNoise = new THREE.DataTexture(
      b.data,
      b.size,
      b.size,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    blueNoise.minFilter = blueNoise.magFilter = THREE.NearestFilter;
    blueNoise.wrapS = blueNoise.wrapT = THREE.RepeatWrapping;
    blueNoise.needsUpdate = true;
    resources = {
      faces,
      envelope,
      noise,
      detail,
      blueNoise,
      model: weather ? 'weather' : 'legacy',
      bytes:
        e.faces.reduce((sum, f) => sum + f.byteLength, 0) +
        n.data.byteLength +
        b.data.byteLength +
        (weather ? data.detail.data.byteLength : 0),
    };
    marchUniforms.uEnvelope.value = envelope;
    marchUniforms.uNoise.value = noise;
    marchUniforms.uDetail.value = detail ?? noise;
    marchUniforms.uDensityModel.value = weather ? 1 : 0;
    marchUniforms.uBlueNoise.value = blueNoise;
    marchUniforms.uBlueNoiseSize.value = b.size;
    if (data.bounds) {
      shell.set(data.bounds.inner, data.bounds.outer);
      sphere.radius = data.bounds.outer;
    }
    return true;
  }
  function resize() {
    if (disposed) return;
    renderer.getDrawingBufferSize(size);
  }
  function ensureTargets() {
    resize();
    const width = Math.max(1, Math.floor(size.x)),
      height = Math.max(1, Math.floor(size.y));
    if (sceneTarget && fullWidth === width && fullHeight === height) return;
    releaseTargets();
    const reduced = cloudTargetSize(width, height);
    fullWidth = width;
    fullHeight = height;
    cloudWidth = reduced.width;
    cloudHeight = reduced.height;
    const targetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      internalFormat: 'RGBA16F',
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    sceneTarget = new THREE.WebGLRenderTarget(width, height, {
      ...targetOptions,
      count: 2,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(width, height, THREE.UnsignedIntType),
    });
    sceneTarget.texture.name = 'Cloud scene linear HDR';
    const flags = sceneTarget.textures[1];
    flags.name = 'Cloud scene material flags';
    flags.type = THREE.UnsignedByteType;
    flags.internalFormat = 'RGBA8';
    flags.colorSpace = THREE.NoColorSpace;
    flags.minFilter = flags.magFilter = THREE.NearestFilter;
    // Deliberately single-sample depth; output FXAA avoids an unverified depth resolve.
    sceneTarget.samples = 0;
    cloudTarget = new THREE.WebGLRenderTarget(cloudWidth, cloudHeight, {
      ...targetOptions,
      count: 2,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    cloudTarget.textures[0].name = 'Cloud premultiplied radiance';
    cloudTarget.textures[1].name = 'Cloud representative / scene / entry distances';
    compositeTarget = new THREE.WebGLRenderTarget(width, height, targetOptions);
    compositeTarget.texture.name = 'Cloud display composite';
    compositeTarget.texture.colorSpace = THREE.NoColorSpace;
    marchUniforms.uSceneDepth.value = sceneTarget.depthTexture;
    compositeUniforms.uSceneDepth.value = sceneTarget.depthTexture;
    compositeUniforms.uSceneColor.value = sceneTarget.texture;
    compositeUniforms.uSceneFlags.value = sceneTarget.textures[1];
    compositeUniforms.uCloud.value = cloudTarget.textures[0];
    compositeUniforms.uAux.value = cloudTarget.textures[1];
    compositeUniforms.uCloudSize.value.set(cloudWidth, cloudHeight);
    outputUniforms.uComposed.value = compositeTarget.texture;
    outputUniforms.uInverseSize.value.set(1 / width, 1 / height);
  }
  function validateTargets() {
    if (validated) return;
    for (const target of [sceneTarget, cloudTarget, compositeTarget]) {
      renderer.setRenderTarget(target);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Required HDR/depth framebuffer is incomplete.');
    }
    validated = true;
  }
  function updateBounds(camera) {
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    if (!frustum.intersectsSphere(sphere)) return false;
    projected.set(0, 0, 1, 1);
    if (cameraPosition.distanceToSquared(center) <= shell.y * shell.y) return true;
    viewCenter.copy(center).applyMatrix4(camera.matrixWorldInverse);
    // A near-plane-crossing bounding cube or nonperspective camera is ambiguous.
    if (!camera.isPerspectiveCamera || viewCenter.z + shell.y >= -camera.near) return true;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let x = -1; x <= 1; x += 2)
      for (let y = -1; y <= 1; y += 2)
        for (let z = -1; z <= 1; z += 2) {
          corner
            .set(viewCenter.x + x * shell.y, viewCenter.y + y * shell.y, viewCenter.z + z * shell.y)
            .applyMatrix4(camera.projectionMatrix);
          minX = Math.min(minX, corner.x);
          minY = Math.min(minY, corner.y);
          maxX = Math.max(maxX, corner.x);
          maxY = Math.max(maxY, corner.y);
        }
    // Pad by two reduced pixels so the 2x2 reconstruction footprint remains valid.
    const padX = 2 / Math.max(1, cloudWidth),
      padY = 2 / Math.max(1, cloudHeight);
    projected.set(
      Math.max(0, minX * 0.5 + 0.5 - padX),
      Math.max(0, minY * 0.5 + 0.5 - padY),
      Math.min(1, maxX * 0.5 + 0.5 + padX),
      Math.min(1, maxY * 0.5 + 0.5 + padY),
    );
    return projected.z > projected.x && projected.w > projected.y;
  }
  function render({ scene, camera, windInverse, sunDirection, planetCenter, artisticHaze }) {
    rendered = false;
    culled = false;
    lastCalls = 0;
    sceneCalls = 0;
    skipReason = null;
    if (disposed || !supported || !resources || gl.isContextLost()) return false;
    // This output pipeline owns the canvas. Leave a caller's arbitrary render target
    // entirely untouched rather than confusing target-pixel and canvas-DPR viewports.
    if (renderer.getRenderTarget() !== null) {
      skipReason = 'external-render-target';
      return false;
    }
    camera.updateMatrixWorld();
    cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    center.copy(planetCenter ?? ZERO);
    if (!updateBounds(camera)) {
      culled = true;
      return false;
    }
    if (
      (renderer.toneMapping !== THREE.ACESFilmicToneMapping &&
        renderer.toneMapping !== THREE.NoToneMapping) ||
      THREE.ColorManagement.workingColorSpace !== THREE.LinearSRGBColorSpace
    ) {
      failure = 'High preserves authored output for ACES or no tone mapping in linear sRGB only.';
      supported = false;
      return false;
    }
    if (
      ![
        THREE.SRGBColorSpace,
        THREE.LinearSRGBColorSpace,
        THREE.DisplayP3ColorSpace,
        THREE.LinearDisplayP3ColorSpace,
      ].includes(renderer.outputColorSpace)
    ) {
      failure = 'Unsupported High output color space.';
      supported = false;
      return false;
    }
    const started = performance.now();
    pollTimers();
    const oldTarget = renderer.getRenderTarget(),
      oldFace = renderer.getActiveCubeFace(),
      oldMip = renderer.getActiveMipmapLevel();
    renderer.getViewport(savedViewport);
    renderer.getScissor(savedScissor);
    renderer.getClearColor(savedClearColor);
    const oldScissorTest = renderer.getScissorTest(),
      oldClearAlpha = renderer.getClearAlpha(),
      oldAutoClear = renderer.autoClear,
      oldAutoClearColor = renderer.autoClearColor,
      oldAutoClearDepth = renderer.autoClearDepth,
      oldAutoClearStencil = renderer.autoClearStencil,
      oldToneMapping = renderer.toneMapping,
      oldOutput = renderer.outputColorSpace,
      oldXR = renderer.xr.enabled,
      oldInfoReset = renderer.info.autoReset;
    const oldFog = scene.fog,
      hazeMesh = artisticHaze?.mesh,
      oldHazeVisible = hazeMesh?.visible;
    const oldShaderError = renderer.debug?.onShaderError,
      oldShaderCheck = renderer.debug?.checkShaderErrors;
    let shaderError = null,
      success = false;
    try {
      if (renderer.debug) {
        renderer.debug.checkShaderErrors = true;
        renderer.debug.onShaderError = (context, program, vertex, fragment) => {
          shaderError =
            context.getProgramInfoLog(program) ||
            context.getShaderInfoLog(fragment) ||
            'Cloud capture shader compilation failed';
          oldShaderError?.(context, program, vertex, fragment);
        };
      }
      scene.traverse(registerMaterial);
      compositeUniforms.uToneOperator.value = oldToneMapping;
      compositeUniforms.toneMappingExposure.value = renderer.toneMappingExposure;
      compositeUniforms.uOutputSpace.value =
        oldOutput === THREE.SRGBColorSpace
          ? 1
          : oldOutput === THREE.LinearDisplayP3ColorSpace
            ? 2
            : oldOutput === THREE.DisplayP3ColorSpace
              ? 3
              : 0;
      if (
        !clearCache.equals(savedClearColor) ||
        clearExposure !== renderer.toneMappingExposure ||
        clearToneOperator !== oldToneMapping
      ) {
        if (oldToneMapping === THREE.ACESFilmicToneMapping)
          inverseACESClearColor(savedClearColor, renderer.toneMappingExposure, compensatedClear);
        else compensatedClear.copy(savedClearColor);
        if (
          ![compensatedClear.r, compensatedClear.g, compensatedClear.b].every(
            (v) => Number.isFinite(v) && v >= 0 && v <= 1,
          )
        )
          throw new Error(
            'The authored clear color is outside the supported inverse-tone clear range.',
          );
        clearCache.copy(savedClearColor);
        clearExposure = renderer.toneMappingExposure;
        clearToneOperator = oldToneMapping;
      }
      compositeUniforms.uFogType.value = oldFog?.isFogExp2 ? 1 : oldFog?.isFog ? 2 : 0;
      if (oldFog) {
        compositeUniforms.uFogParameters.value.set(
          oldFog.density ?? 0,
          oldFog.near ?? 0,
          oldFog.far ?? 1,
        );
        oldFog.color.getRGB(compositeUniforms.uFogColor.value, oldOutput);
      }
      if (artisticHaze && oldHazeVisible) {
        compositeUniforms.uHaze.value.set(
          1,
          artisticHaze.innerRadius,
          artisticHaze.outerRadius,
          (artisticHaze.maxOpacity ?? 0.32) * Math.max(0, Math.min(1, artisticHaze.fade)),
        );
        compositeUniforms.uHazeTint.value.fromArray(artisticHaze.tint ?? [0.58, 0.72, 0.76]);
      } else compositeUniforms.uHaze.value.set(0, 0, 1, 0);
      if (hazeMesh) hazeMesh.visible = false;
      scene.fog = null;
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      if (oldInfoReset) renderer.info.reset();
      ensureTargets();
      updateBounds(camera);
      validateTargets();
      common.uInverseProjection.value.copy(camera.projectionMatrixInverse);
      common.uCameraMatrix.value.copy(camera.matrixWorld);
      common.uOrthographic.value = camera.isOrthographicCamera ? 1 : 0;
      common.uDistanceScale.value = Math.max(1, camera.far * 4, shell.y * 4);
      if (windInverse?.isMatrix4) marchUniforms.uWindInverse.value.setFromMatrix4(windInverse);
      else if (windInverse) marchUniforms.uWindInverse.value.copy(windInverse);
      else marchUniforms.uWindInverse.value.identity();
      if (sunDirection) marchUniforms.uSunDirection.value.copy(sunDirection).normalize();
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      sceneTarget.scissorTest = false;
      renderer.setRenderTarget(sceneTarget);
      // The compensated clear radiance maps back to the unchanged authored canvas
      // clear. Set it AFTER binding the linear target, restore the color write mask,
      // and independently zero the RGBA8 metadata (MRT clear otherwise broadcasts
      // the HDR color into the flags). Let Three's normal auto-clear reset depth.
      renderer.setClearColor(compensatedClear, oldClearAlpha);
      renderer.state.buffers.color.setMask(true);
      renderer.clear(true, false, false);
      gl.clearBufferfv(gl.COLOR, 1, metadataClear);
      renderer.autoClear = true;
      renderer.autoClearColor = false;
      renderer.autoClearDepth = true;
      renderer.autoClearStencil = true;
      const initialCalls = renderer.info.render.calls;
      renderer.render(scene, camera);
      sceneCalls = renderer.info.render.calls - initialCalls;
      scene.fog = oldFog;
      if (hazeMesh) hazeMesh.visible = oldHazeVisible;
      renderer.autoClear = false;
      if (shaderError) throw new Error(shaderError);
      startTimer();
      cloudTarget.scissorTest = false;
      renderer.setRenderTarget(cloudTarget);
      renderer.setClearColor(0, 0);
      renderer.clear(true, false, false);
      const x = Math.floor(projected.x * cloudWidth),
        y = Math.floor(projected.y * cloudHeight),
        right = Math.ceil(projected.z * cloudWidth),
        top = Math.ceil(projected.w * cloudHeight);
      cloudTarget.scissor.set(x, y, Math.max(1, right - x), Math.max(1, top - y));
      cloudTarget.scissorTest = true;
      renderer.setRenderTarget(cloudTarget);
      triangle.material = marchMaterial;
      renderer.render(passScene, passCamera);
      renderer.setRenderTarget(compositeTarget);
      triangle.material = compositeMaterial;
      renderer.render(passScene, passCamera);
      renderer.toneMapping = oldToneMapping;
      renderer.outputColorSpace = oldOutput;
      renderer.setRenderTarget(oldTarget, oldFace, oldMip);
      renderer.setViewport(savedViewport);
      renderer.setScissor(savedScissor);
      renderer.setScissorTest(oldScissorTest);
      triangle.material = outputMaterial;
      renderer.render(passScene, passCamera);
      endTimer();
      if (
        shaderError ||
        (!shadersValidated &&
          renderer.info.programs?.some((program) => program.diagnostics?.runnable === false))
      )
        throw new Error(shaderError ?? 'High shader program failed to link.');
      shadersValidated = true;
      lastCalls = renderer.info.render.calls - initialCalls - sceneCalls;
      rendered = true;
      success = true;
    } catch (error) {
      failure = String(error?.message ?? error);
      supported = false;
      endTimer();
      releaseTargets();
      restoreCaptureMaterials();
    } finally {
      scene.fog = oldFog;
      if (hazeMesh) hazeMesh.visible = oldHazeVisible;
      if (renderer.debug) {
        renderer.debug.onShaderError = oldShaderError;
        renderer.debug.checkShaderErrors = oldShaderCheck;
      }
      renderer.setRenderTarget(oldTarget, oldFace, oldMip);
      renderer.setViewport(savedViewport);
      renderer.setScissor(savedScissor);
      renderer.setScissorTest(oldScissorTest);
      renderer.setClearColor(savedClearColor, oldClearAlpha);
      renderer.toneMapping = oldToneMapping;
      renderer.outputColorSpace = oldOutput;
      renderer.autoClear = oldAutoClear;
      renderer.autoClearColor = oldAutoClearColor;
      renderer.autoClearDepth = oldAutoClearDepth;
      renderer.autoClearStencil = oldAutoClearStencil;
      renderer.xr.enabled = oldXR;
      renderer.info.autoReset = oldInfoReset;
      lastCpuMs = performance.now() - started;
    }
    return success;
  }
  function registerMaterial(object) {
    const value = object.material;
    if (!value) return;
    if (Array.isArray(value)) {
      for (const material of value) registerOne(material);
    } else registerOne(value);
  }
  function registerOne(material) {
    if (captureMaterials.has(material)) return;
    if (material.isRawShaderMaterial || material.glslVersion === THREE.GLSL3)
      throw new Error(
        'High scene metadata does not support external RawShaderMaterial or explicit GLSL3 output layouts.',
      );
    const oldCompile = material.onBeforeCompile,
      oldKey = material.customProgramCacheKey,
      baseKey = material.customProgramCacheKey();
    const literalOutput =
      !!material.isShaderMaterial && !material.fragmentShader.includes('colorspace_fragment');
    const toneMapped =
      material.toneMapped !== false &&
      (!material.isShaderMaterial || material.fragmentShader.includes('tonemapping_fragment'));
    const flags = { fog: material.fog === true, toneMapped, literalOutput };
    const compile = function (shader, activeRenderer) {
      oldCompile.call(this, shader, activeRenderer);
      shader.fragmentShader = addCloudSceneFlags(shader.fragmentShader, flags);
    };
    const key = function () {
      return (
        baseKey +
        '|cloud-metadata-v1:' +
        Number(flags.fog) +
        Number(flags.toneMapped) +
        Number(flags.literalOutput)
      );
    };
    material.onBeforeCompile = compile;
    material.customProgramCacheKey = key;
    material.needsUpdate = true;
    shadersValidated = false;
    captureMaterials.set(material, { oldCompile, oldKey, compile, key, flags });
  }
  function restoreCaptureMaterials() {
    for (const [material, hooks] of captureMaterials) {
      if (material.onBeforeCompile === hooks.compile) material.onBeforeCompile = hooks.oldCompile;
      if (material.customProgramCacheKey === hooks.key)
        material.customProgramCacheKey = hooks.oldKey;
      material.needsUpdate = true;
    }
    captureMaterials.clear();
  }
  function setDiagnosticEmptyClouds(value) {
    diagnosticEmptyClouds = !!value;
    marchUniforms.uDiagnosticEmptyClouds.value = diagnosticEmptyClouds ? 1 : 0;
  }
  function resetGpuTimings() {
    gpuCount = 0;
    gpuCursor = 0;
    lastGpuMs = null;
    // A capture starts a new measurement generation. Keep query objects alive,
    // but discard every in-flight result from before this reset when it resolves.
    for (const slot of timerSlots) if (slot.pending || slot === activeTimer) slot.invalid = true;
  }
  function stats() {
    const sorted = Array.from(gpuSamples.subarray(0, gpuCount)).sort((a, b) => a - b);
    return {
      supported,
      diagnosticEmptyClouds,
      ready: Boolean(resources),
      rendered,
      culled,
      failure,
      skipReason,
      dimensions: {
        width: cloudWidth,
        height: cloudHeight,
        sceneWidth: fullWidth,
        sceneHeight: fullHeight,
      },
      targetPixels: cloudWidth * cloudHeight,
      drawCalls: lastCalls,
      sceneDrawCalls: sceneCalls,
      antialiasing: 'display-space FXAA',
      primarySamples: 48,
      shadowSamples: 2,
      resourceBytes: resources?.bytes ?? 0,
      densityModel: resources?.model ?? null,
      detailDistance: settings.detailDistance,
      gpuTimerSupported: Boolean(timerExtension),
      gpuMs: lastGpuMs,
      gpuP95Ms: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] : null,
      gpuSamples: gpuCount,
      gpuTimeScope:
        'raymarch, reconstruction with authored fog/haze and output transform, display-space FXAA; excludes scene capture/metadata',
      cpuMs: lastCpuMs,
      projectedBounds: projected.toArray(),
      renderTargets: sceneTarget ? 3 : 0,
      sceneMetadataBytes: fullWidth * fullHeight * 4,
      materialFlagCount: captureMaterials.size,
      colorCompositing:
        'linear cloud radiance; one ACES/output transform; display-space authored fog/haze weighted by cloud transmittance',
      transparentOutputParity:
        'approximate for overlapping normal-alpha/additive materials with different output flags',
    };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    endTimer();
    releaseResources();
    releaseTargets();
    restoreCaptureMaterials();
    for (const slot of timerSlots) gl.deleteQuery(slot.query);
    geometry.dispose();
    marchMaterial.dispose();
    compositeMaterial.dispose();
    outputMaterial.dispose();
  }
  return {
    setResources,
    render,
    resize,
    stats,
    resetGpuTimings,
    setDiagnosticEmptyClouds,
    dispose,
  };
}
const ZERO = new THREE.Vector3();
