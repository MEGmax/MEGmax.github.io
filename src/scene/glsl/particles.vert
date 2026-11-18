uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D tTarget;
uniform float uSize;
uniform float uDpr;
uniform float uShift;
uniform float uAlpha;
uniform float uGather;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;

attribute vec2 ref; // this particle's texel in the simulation textures
attribute float rnd;

varying vec3 vColor;
varying float vAlpha;
varying float vSoft;

void main() {
  vec4 P = texture2D(tPos, ref);
  vec4 V = texture2D(tVel, ref);
  float g = uGather * texture2D(tTarget, ref).w;
  vec3 p = P.xyz;
  float depth = p.z * 0.5 + 0.5;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p.xy, 0.0, 1.0);

  // ~2.5% of particles are large, faint, out-of-focus discs for depth.
  float bokeh = step(0.975, rnd) * (1.0 - g);
  float size = uSize * (0.55 + 1.25 * depth) * (0.7 + 0.6 * fract(rnd * 7.13));
  size = mix(size, uSize * (5.0 + 7.0 * depth), bokeh);
  size = mix(size, uSize * (1.5 + 1.1 * fract(rnd * 3.7)), g);
  gl_PointSize = size * uDpr;

  float speed = length(V.xy);
  vec3 flowCol = ramp(uShift + rnd * 0.55 + p.y * 0.06 + p.x * 0.04, uA, uB, uC);
  // While gathered, colour sweeps cyan -> violet -> magenta across the name.
  vec3 haloCol = ramp(uShift + p.x * 0.22 + 0.02 * rnd, uA, uB, uC);
  vColor = mix(mix(flowCol, vec3(1.0), 0.12), mix(haloCol, vec3(1.0), 0.18), g);

  float a = uAlpha * (0.28 + 0.62 * depth) * (0.75 + min(speed * 2.5, 0.75));
  a = mix(a, uAlpha * 0.85, g);
  vAlpha = a * mix(1.0, 0.16, bokeh);
  vSoft = bokeh;
}
