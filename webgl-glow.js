/**
 * Soft GPU points + trail feedback + half-res bloom. No CDN.
 */
export function createGlowRenderer(canvas) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("WebGL2 not available");

  const MAX = 3000;
  let dpr = 1;
  let bloomStrength = 0.6;
  let trailDamp = 0.08;
  let count = 0;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
    }
    return sh;
  }

  function makeProgram(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || "program link failed");
    }
    return p;
  }

  const particleProg = makeProgram(
    `#version 300 es
    precision highp float;
    layout(location=0) in vec2 aPos;
    layout(location=1) in vec3 aColor;
    layout(location=2) in float aSize;
    layout(location=3) in float aAlpha;
    uniform vec2 uRes;
    out vec3 vColor;
    out float vAlpha;
    void main() {
      vec2 ndc = (aPos / uRes) * 2.0 - 1.0;
      ndc.y *= -1.0;
      gl_Position = vec4(ndc, 0.0, 1.0);
      gl_PointSize = max(1.5, aSize);
      vColor = aColor;
      vAlpha = aAlpha;
    }`,
    `#version 300 es
    precision mediump float;
    in vec3 vColor;
    in float vAlpha;
    out vec4 outColor;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float d = dot(p, p);
      float soft = exp(-d * 2.6) * (1.0 - smoothstep(0.72, 1.0, d));
      float core = exp(-d * 8.5);
      vec3 col = vColor * (0.5 + 1.05 * core);
      float a = soft * vAlpha;
      outColor = vec4(col * a, a);
    }`
  );

  const blitProg = makeProgram(
    `#version 300 es
    precision highp float;
    const vec2 V[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
    out vec2 vUv;
    void main() {
      vec2 p = V[gl_VertexID];
      gl_Position = vec4(p, 0.0, 1.0);
      vUv = p * 0.5 + 0.5;
    }`,
    `#version 300 es
    precision mediump float;
    in vec2 vUv;
    uniform sampler2D uTex;
    uniform sampler2D uBloomTex;
    uniform float uFade;
    uniform float uBloom;
    uniform int uMode;
    uniform vec2 uTexel;
    out vec4 outColor;
    void main() {
      if (uMode == 0) {
        vec3 c = texture(uTex, vUv).rgb * (1.0 - uFade);
        outColor = vec4(c, 1.0);
        return;
      }
      if (uMode == 4) {
        outColor = vec4(texture(uTex, vUv).rgb, 1.0);
        return;
      }
      if (uMode == 1 || uMode == 2) {
        vec2 dir = (uMode == 1) ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
        vec3 c = texture(uTex, vUv).rgb * 0.227027027;
        c += texture(uTex, vUv + dir).rgb * 0.1945945946;
        c += texture(uTex, vUv - dir).rgb * 0.1945945946;
        c += texture(uTex, vUv + dir * 2.0).rgb * 0.1216216216;
        c += texture(uTex, vUv - dir * 2.0).rgb * 0.1216216216;
        c += texture(uTex, vUv + dir * 3.0).rgb * 0.054054054;
        c += texture(uTex, vUv - dir * 3.0).rgb * 0.054054054;
        outColor = vec4(c, 1.0);
        return;
      }
      vec3 base = texture(uTex, vUv).rgb;
      vec3 bloom = texture(uBloomTex, vUv).rgb;
      vec3 col = base + bloom * uBloom;
      float vig = smoothstep(1.4, 0.2, length(vUv - 0.5));
      col *= 0.9 + 0.1 * vig;
      outColor = vec4(col, 1.0);
    }`
  );

  const pos = new Float32Array(MAX * 2);
  const col = new Float32Array(MAX * 3);
  const sizes = new Float32Array(MAX);
  const alphas = new Float32Array(MAX);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  function attrBuf(data, loc, n) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
    return b;
  }
  const bufPos = attrBuf(pos, 0, 2);
  const bufCol = attrBuf(col, 1, 3);
  const bufSize = attrBuf(sizes, 2, 1);
  const bufAlpha = attrBuf(alphas, 3, 1);
  gl.bindVertexArray(null);
  const emptyVao = gl.createVertexArray();

  function makeTarget(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  let scene = null;
  let history = null;
  let bloomA = null;
  let bloomB = null;

  function clearTarget(t, r = 0.027, g = 0.047, b = 0.086) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function resizeTargets(w, h) {
    const kill = (t) => {
      if (!t) return;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    };
    kill(scene); kill(history); kill(bloomA); kill(bloomB);
    scene = makeTarget(w, h);
    history = makeTarget(w, h);
    bloomA = makeTarget(Math.max(1, w >> 1), Math.max(1, h >> 1));
    bloomB = makeTarget(Math.max(1, w >> 1), Math.max(1, h >> 1));
    clearTarget(scene);
    clearTarget(history);
  }

  const uRes = gl.getUniformLocation(particleProg, "uRes");
  const uTex = gl.getUniformLocation(blitProg, "uTex");
  const uBloomTex = gl.getUniformLocation(blitProg, "uBloomTex");
  const uFade = gl.getUniformLocation(blitProg, "uFade");
  const uBloom = gl.getUniformLocation(blitProg, "uBloom");
  const uMode = gl.getUniformLocation(blitProg, "uMode");
  const uTexel = gl.getUniformLocation(blitProg, "uTexel");

  function blit(mode, dest, src, bloomSrc, fade) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest ? dest.fbo : null);
    const w = dest ? dest.w : canvas.width;
    const h = dest ? dest.h : canvas.height;
    gl.viewport(0, 0, w, h);
    gl.useProgram(blitProg);
    gl.bindVertexArray(emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (bloomSrc || src).tex);
    gl.uniform1i(uBloomTex, 1);
    gl.uniform1i(uMode, mode);
    gl.uniform1f(uFade, fade);
    gl.uniform1f(uBloom, bloomStrength);
    gl.uniform2f(uTexel, 1 / src.w, 1 / src.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    maxParticles: MAX,
    resize(cssW, cssH, nextDpr) {
      dpr = nextDpr;
      const pw = Math.max(1, Math.floor(cssW * dpr));
      const ph = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
        resizeTargets(pw, ph);
      }
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
    },
    setBloom(v) { bloomStrength = Math.max(0, v); },
    setTrailDamp(v) { trailDamp = Math.max(0.012, Math.min(0.35, v)); },
    clearTrail() {
      if (!scene) return;
      clearTarget(scene);
      clearTarget(history);
    },
    writeParticles(list) {
      count = Math.min(MAX, list.length);
      for (let i = 0; i < count; i++) {
        const p = list[i];
        pos[i * 2] = p.x * dpr;
        pos[i * 2 + 1] = p.y * dpr;
        col[i * 3] = p.r / 255;
        col[i * 3 + 1] = p.g / 255;
        col[i * 3 + 2] = p.b / 255;
        sizes[i] = Math.max(1.6, p.size * dpr * 2.4);
        alphas[i] = p.alpha;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos.subarray(0, count * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, bufCol);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, col.subarray(0, count * 3));
      gl.bindBuffer(gl.ARRAY_BUFFER, bufSize);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sizes.subarray(0, count));
      gl.bindBuffer(gl.ARRAY_BUFFER, bufAlpha);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, alphas.subarray(0, count));
    },
    render() {
      if (!scene) return;

      // history * (1-fade) -> scene
      blit(0, scene, history, history, trailDamp);

      // additive points into scene
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
      gl.viewport(0, 0, scene.w, scene.h);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(particleProg);
      gl.uniform2f(uRes, scene.w, scene.h);
      gl.bindVertexArray(vao);
      if (count > 0) gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      // store for next trail
      blit(4, history, scene, scene, 0);

      // bloom half-res
      if (bloomStrength > 0.02) {
        blit(4, bloomA, scene, scene, 0);
        blit(1, bloomB, bloomA, bloomA, 0);
        blit(2, bloomA, bloomB, bloomB, 0);
        blit(3, null, scene, bloomA, 0);
      } else {
        blit(4, null, scene, scene, 0);
      }
    },
  };
}
