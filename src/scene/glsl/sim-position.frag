// GPGPU position pass: integrate velocity, add scroll parallax, wrap at the edges.
uniform float uDt;
uniform float uAspect;
uniform float uScrollVel;
uniform float uGather;
uniform sampler2D tTarget;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(tPos, uv);
  vec4 V = texture2D(tVel, uv);
  float hold = uGather * texture2D(tTarget, uv).w;
  vec3 p = P.xyz;
  float depth = p.z * 0.5 + 0.5;

  p += V.xyz * uDt;
  // Parallax: near particles travel further with the page than far ones.
  p.y += uScrollVel * uDt * (0.08 + 0.45 * depth) * (1.0 - hold);

  if (hold < 0.05) {
    float bx = uAspect + 0.12;
    float by = 1.12;
    if (p.x > bx) p.x -= 2.0 * bx;
    else if (p.x < -bx) p.x += 2.0 * bx;
    if (p.y > by) p.y -= 2.0 * by;
    else if (p.y < -by) p.y += 2.0 * by;
  }
  p.z = clamp(p.z, -1.0, 1.0);

  gl_FragColor = vec4(p, P.w);
}
