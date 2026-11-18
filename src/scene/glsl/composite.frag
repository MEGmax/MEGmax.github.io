// Upscales the low-res background and adds dither + fine grain, which hides
// 8-bit banding in the dark gradients.
varying vec2 vUv;
uniform sampler2D tBg;
uniform float uTime;
uniform float uGrain;

// Integer PCG hash (Jarzynski & Olano 2020): true white noise per pixel, no
// lattice structure (float hashes show faint grids at this amplitude).
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float rand(vec2 fragCoord, float frame) {
  uvec2 q = uvec2(fragCoord);
  return float(pcg(q.x + pcg(q.y + pcg(uint(frame))))) * (1.0 / 4294967295.0);
}

void main() {
  vec3 col = texture2D(tBg, vUv).rgb;
  float n = rand(gl_FragCoord.xy, floor(fract(uTime * 0.37) * 64.0));
  col += (n - 0.5) * (1.5 / 255.0 + uGrain);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
