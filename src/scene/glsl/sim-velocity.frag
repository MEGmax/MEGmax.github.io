// GPGPU velocity pass. Injected by GPUComputationRenderer:
//   uniform sampler2D tPos; uniform sampler2D tVel; #define resolution vec2(...)
// World space: x in [-aspect, aspect], y in [-1, 1] (the viewport), z in [-1, 1] (depth).

uniform float uTime;
uniform float uDt;
uniform float uFlow;
uniform float uScrollWorld;  // scroll offset in world units (2 = one viewport)
uniform float uScrollVel;    // world units / s
uniform float uGather;       // 0..1 envelope for the "gather around my name" moment
uniform float uPointerActive;
uniform vec2 uPointer;
uniform vec2 uPointerVel;
uniform sampler2D tTarget;   // xy: halo point (world, at scroll 0), z: depth, w: 1 if this particle gathers

// 2D curl of a scalar noise potential: divergence-free, so particles swirl
// instead of clumping.
vec2 curl2(vec2 p, float t) {
  const float e = 0.07;
  float a = snoise(vec3(p.x, p.y + e, t));
  float b = snoise(vec3(p.x, p.y - e, t));
  float c = snoise(vec3(p.x + e, p.y, t));
  float d = snoise(vec3(p.x - e, p.y, t));
  return vec2(a - b, -(c - d)) / (2.0 * e);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(tPos, uv);
  vec4 V = texture2D(tVel, uv);
  vec4 T = texture2D(tTarget, uv);
  vec3 p = P.xyz;
  vec3 v = V.xyz;
  float depth = p.z * 0.5 + 0.5;

  // Flow field.
  vec2 fp = p.xy * 0.8 + vec2(0.0, uScrollWorld * 0.22);
  vec2 flow = curl2(fp, uTime * 0.05) * 0.05 + curl2(fp * 2.7 + 7.0, uTime * 0.09) * 0.016;
  vec3 desired = vec3(flow * uFlow * (0.55 + 0.9 * depth), 0.04 * sin(uTime * 0.4 + P.w * 40.0));
  v += (desired - v) * (1.0 - exp(-uDt * 1.5));

  // Cursor: push away and swirl around it, and drag along with its motion.
  vec2 d = p.xy - uPointer;
  float r2 = dot(d, d);
  float fall = exp(-r2 / 0.045) * uPointerActive;
  vec2 dir = d * inversesqrt(r2 + 1e-4);
  v.xy += (dir * 1.4 + vec2(-dir.y, dir.x) * 2.2) * fall * uDt;
  v.xy += uPointerVel * fall * 2.0 * uDt;

  // Scroll: a kick that keeps swirling after scrolling stops.
  v.y += uScrollVel * 0.6 * uDt * (0.3 + depth);

  // Gather: spring towards this particle's point in the halo around the name.
  float g = uGather * T.w;
  if (g > 0.001) {
    vec3 tgt = vec3(T.xy + vec2(0.0, uScrollWorld), T.z);
    tgt.xy += curl2(T.xy * 7.0, uTime * 0.35) * 0.0022;
    vec3 seek = (tgt - p) * 3.4;
    v = mix(v, seek, clamp(g * g * uDt * 7.5, 0.0, 1.0));
  }

  float sp = length(v);
  if (sp > 1.6) v *= 1.6 / sp;

  gl_FragColor = vec4(v, V.w);
}
