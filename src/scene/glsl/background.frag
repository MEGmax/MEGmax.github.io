// Full-viewport flowing gradient: domain-warped fbm (q -> r -> f) blended
// through the palette ramp, plus soft iridescent metaballs.
// Rendered at reduced resolution into a float target, then upscaled + dithered.

#ifndef OCTAVES
#define OCTAVES 5
#endif
#ifndef BLOBS
#define BLOBS 4
#endif

varying vec2 vUv;

uniform float uTime;
uniform float uAspect;
uniform float uScroll;    // scroll offset in viewport heights
uniform float uShift;     // palette rotation (section mood)
uniform float uIntensity; // veil brightness (section mood)
uniform float uWarp;      // domain-warp strength (section mood)
uniform float uBlobs;     // metaball visibility (section mood)
uniform vec4 uScrim;     // dark halo behind the hero text: centre xy, radii zw (same space as p)
uniform vec3 uBase;
uniform vec3 uNight;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < OCTAVES; i++) {
    s += a * snoise(p);
    p = p * 2.03 + vec3(1.7, -1.3, 0.37);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 sp = p * 1.25 + vec2(0.0, uScroll * 0.32);
  float t = uTime * 0.045;
  float w = uWarp * 0.25;

  vec2 q = vec2(fbm(vec3(sp, t)), fbm(vec3(sp + vec2(5.2, 1.3), t + 3.1)));
  vec2 r = vec2(
    fbm(vec3(sp + w * q + vec2(1.7, 9.2), t * 1.4)),
    fbm(vec3(sp + w * q + vec2(8.3, 2.8), t * 1.4))
  );
  float f = fbm(vec3(sp + w * r, t * 0.8));

  // Deep-space base with a faint indigo haze.
  vec3 col = mix(uBase, uNight, smoothstep(-0.7, 0.9, q.y + 0.3 * f));

  // Luminous veils: mostly dark, with flowing ribbons of colour.
  float hue = uShift + 0.32 * f + 0.22 * r.x + 0.05 * p.x;
  vec3 tint = ramp(hue, uA, uB, uC);
  float veil = smoothstep(-0.1, 0.95, f + 0.5 * length(q) - 0.1);
  veil = veil * veil * (3.0 - 2.0 * veil);
  col += tint * veil * 0.36 * uIntensity;

  // Thin silk filaments where the warp folds over itself.
  float fold = 1.0 - smoothstep(0.0, 0.05, abs(r.y - q.x + 0.05));
  col += ramp(hue + 0.15, uA, uB, uC) * fold * veil * 0.10 * uIntensity;

  // Metaballs: an implicit field from a few drifting sources, shaded with an
  // iridescent rim whose hue follows the field gradient.
  float field = 0.0;
  vec2 grad = vec2(0.0);
  for (int i = 0; i < BLOBS; i++) {
    float fi = float(i);
    vec2 c = vec2(
      sin(uTime * 0.07 * (1.0 + fi * 0.21) + fi * 1.9) * uAspect * 0.55,
      cos(uTime * 0.055 * (1.0 + fi * 0.33) + fi * 2.7) * 0.42
    );
    c.y += uScroll * (0.08 + 0.05 * fi);
    c.y = mod(c.y + 0.9, 1.8) - 0.9;
    float rad = 0.15 + 0.045 * sin(uTime * 0.17 + fi * 1.3);
    vec2 d = p - c;
    float d2 = dot(d, d) + 1e-4;
    float k = rad * rad / d2;
    field += k;
    grad -= 2.0 * k * d / d2;
  }
  // Soft liquid fill with an iridescent edge (no dark centre).
  float body = smoothstep(0.75, 1.25, field);
  float edge = exp(-pow((field - 1.05) * 2.4, 2.0));
  float halo = smoothstep(0.25, 1.0, field) * (1.0 - body);
  float ang = atan(grad.y, grad.x) / 6.28318;
  vec3 rimCol = ramp(uShift + ang + field * 0.04 + t, uA, uB, uC);
  vec3 fillCol = ramp(uShift + 0.35 + p.y * 0.5 + p.x * 0.2 + t, uA, uB, uC);
  float sheen = smoothstep(0.0, 1.0, dot(normalize(grad + 1e-5), normalize(vec2(-0.6, 0.8))));
  col += fillCol * body * (0.11 + 0.08 * sheen) * uBlobs;
  col += rimCol * edge * 0.13 * uBlobs;
  col += rimCol * halo * 0.035 * uBlobs;

  // Darken behind the hero text so it stays AA-readable over bright veils.
  float scrim = 1.0 - smoothstep(0.15, 1.0, length((p - uScrim.xy) / uScrim.zw));
  col *= 1.0 - 0.6 * scrim;

  // Vignette.
  float vig = smoothstep(1.3, 0.3, length(p * vec2(0.85, 1.15)));
  col *= mix(0.5, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
