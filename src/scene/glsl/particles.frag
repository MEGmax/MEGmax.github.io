varying vec3 vColor;
varying float vAlpha;
varying float vSoft;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = pow(a, mix(1.7, 0.8, vSoft));
  if (a <= 0.002) discard;
  gl_FragColor = vec4(vColor, a * vAlpha);
}
