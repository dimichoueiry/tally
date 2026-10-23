// WebGL2 compositor for the camera background (from the LC-6 spike, spike/blur/compositor.js).
// Every texture is in image space (row 0 = top). Mirroring is done by the caller (2D canvas).
// Passes: mask EMA (mask res) → feather H/V (mask res) → [blur] mask-aware downsample +
// blur H/V (¼ res) → final (output res): joint-bilateral edge refine, smoothstep, mix fg/bg.

const VS = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float; out vec4 o;`;

const FS = {
  // Adaptive EMA: big changes follow fast (no ghost trails on motion), small ones are damped (no edge shimmer).
  ema: `${HEAD}
uniform sampler2D uNew, uPrev; uniform int uFirst; uniform float uAlpha, uGain;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float n = texelFetch(uNew, p, 0).r;
  float prev = texelFetch(uPrev, p, 0).r;
  float a = uFirst == 1 ? 1.0 : mix(uAlpha, 1.0, clamp(abs(n - prev) * uGain, 0.0, 1.0));
  o = vec4(mix(prev, n, a), 0, 0, 1);
}`,
  // 9-tap gaussian, separable. uDir in texels.
  gauss: `${HEAD}
uniform sampler2D uSrc; uniform vec2 uDir;
void main() {
  vec2 ts = vec2(textureSize(uSrc, 0)); vec2 uv = gl_FragCoord.xy / ts;
  const float w[5] = float[](0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);
  vec4 c = texture(uSrc, uv) * w[0];
  for (int i = 1; i < 5; i++) { vec2 d = uDir * float(i) / ts; c += (texture(uSrc, uv + d) + texture(uSrc, uv - d)) * w[i]; }
  o = c;
}`,
  // Downsample the camera, premultiplied by "background-ness" so the person's colours don't bleed into the blur (halo).
  bgDown: `${HEAD}
uniform sampler2D uVideo, uMask; uniform vec2 uOut;
void main() {
  vec2 uv = gl_FragCoord.xy / uOut; vec2 h = 0.5 / uOut;
  vec3 c = (texture(uVideo, uv + vec2(-h.x, -h.y)).rgb + texture(uVideo, uv + vec2(h.x, -h.y)).rgb +
            texture(uVideo, uv + vec2(-h.x, h.y)).rgb + texture(uVideo, uv + vec2(h.x, h.y)).rgb) * 0.25;
  float w = (1.0 - texture(uMask, uv).r) * 0.98 + 0.02;
  o = vec4(c * w, w);
}`,
  final: `${HEAD}
uniform sampler2D uVideo, uMask, uBg, uImg; uniform vec2 uOut; uniform int uMode;
uniform float uLo, uHi, uSigma; uniform vec4 uImgXf;
void main() {
  vec2 uv = gl_FragCoord.xy / uOut; uv.y = 1.0 - uv.y;
  vec3 fg = texture(uVideo, uv).rgb;
  if (uMode == 0) { o = vec4(fg, 1); return; }
  // Joint bilateral upsampling: low-res mask, weighted by colour similarity in the full-res frame.
  vec2 mt = 1.0 / vec2(textureSize(uMask, 0)); float ws = 0.0, acc = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 d = vec2(x, y) * mt * 0.75; vec3 c = texture(uVideo, uv + d).rgb - fg;
    float w = exp(-dot(c, c) / uSigma - float(x * x + y * y) * 0.18);
    acc += texture(uMask, uv + d).r * w; ws += w;
  }
  float a = smoothstep(uLo, uHi, acc / ws);
  vec3 bg;
  if (uMode == 1) { vec4 b = texture(uBg, uv); bg = b.rgb / b.a; }
  else bg = texture(uImg, uv * uImgXf.xy + uImgXf.zw).rgb;
  o = vec4(mix(bg, fg, a), 1);
}`,
};

const INTS = new Set(['uFirst', 'uMode']);

export class Compositor {
  constructor(gl, outW, outH) {
    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.vao = gl.createVertexArray();
    this.p = {};
    for (const [k, src] of Object.entries(FS)) this.p[k] = this.#program(src);
    this.video = this.#tex();
    this.img = this.#tex();
    this.upload = this.#tex(gl.NEAREST);
    this.maskW = 0;
    this.imgAspect = 0;
    this.imgXf = [1, 1, 0, 0];
    this.resize(outW, outH);
  }

  // Output size (the bubble crop in pixels). Background targets are ¼ of it.
  resize(w, h) {
    if (w === this.W && h === this.H) return;
    this.W = w;
    this.H = h;
    this.#free(this.bgA, this.bgB);
    this.bw = Math.max(1, Math.round(w / 4));
    this.bh = Math.max(1, Math.round(h / 4));
    this.bgA = this.#target(this.bw, this.bh, this.gl.RGBA16F);
    this.bgB = this.#target(this.bw, this.bh, this.gl.RGBA16F);
    this.#fitImage();
  }

  #program(fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    const u = {};
    const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(pr, i).name;
      u[name] = gl.getUniformLocation(pr, name);
    }
    return { pr, u };
  }

  #tex(filter = this.gl.LINEAR) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  #target(w, h, fmt) {
    const gl = this.gl;
    const tex = this.#tex();
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }

  #free(...targets) {
    for (const t of targets) {
      if (!t) continue;
      this.gl.deleteTexture(t.tex);
      this.gl.deleteFramebuffer(t.fb);
    }
  }

  #ensureMask(w, h) {
    if (this.maskW === w && this.maskH === h) return;
    this.#free(this.emaA, this.emaB, this.fA, this.fB);
    this.maskW = w;
    this.maskH = h;
    this.first = true;
    const f = this.gl.R16F;
    this.emaA = this.#target(w, h, f);
    this.emaB = this.#target(w, h, f);
    this.fA = this.#target(w, h, f);
    this.fB = this.#target(w, h, f);
  }

  #draw(prog, target, texs, uni) {
    const gl = this.gl;
    const { pr, u } = this.p[prog];
    gl.useProgram(pr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.W, target ? target.h : this.H);
    let unit = 0;
    for (const [name, t] of Object.entries(texs)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(u[name], unit++);
    }
    for (const [name, v] of Object.entries(uni)) {
      if (!(name in u)) continue;
      if (typeof v === 'number') INTS.has(name) ? gl.uniform1i(u[name], v) : gl.uniform1f(u[name], v);
      else if (v.length === 2) gl.uniform2fv(u[name], v);
      else gl.uniform4fv(u[name], v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // MediaPipe shares this context: set every piece of state we rely on, and unbind after.
  #begin() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  #end() {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
  }

  #fitImage() {
    // Cover-fit the background image to the output aspect.
    if (!this.imgAspect) return;
    const ia = this.imgAspect;
    const oa = this.W / this.H;
    const sx = ia > oa ? oa / ia : 1;
    const sy = ia > oa ? 1 : ia / oa;
    this.imgXf = [sx, sy, (1 - sx) / 2, (1 - sy) / 2];
  }

  setImage(source) {
    const gl = this.gl;
    this.#begin();
    gl.bindTexture(gl.TEXTURE_2D, this.img);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.#end();
    this.imgAspect = (source.naturalWidth || source.width) / (source.naturalHeight || source.height);
    this.#fitImage();
  }

  // A new confidence mask: a GPU texture from MediaPipe, or a Float32Array (CPU delegate).
  pushMask({ texture, data, width, height }, s) {
    const gl = this.gl;
    this.#begin();
    this.#ensureMask(width, height);
    let src = texture;
    if (!src) {
      gl.bindTexture(gl.TEXTURE_2D, this.upload);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data);
      src = this.upload;
    }
    this.#draw('ema', this.emaB, { uNew: src, uPrev: this.emaA.tex }, { uFirst: this.first ? 1 : 0, uAlpha: s.alpha, uGain: s.gain });
    [this.emaA, this.emaB] = [this.emaB, this.emaA];
    this.first = false;
    this.#draw('gauss', this.fB, { uSrc: this.emaA.tex }, { uDir: [s.feather, 0] });
    this.#draw('gauss', this.fA, { uSrc: this.fB.tex }, { uDir: [0, s.feather] });
    this.#end();
  }

  // Composite the current frame into the canvas (default framebuffer). mode: 'blur' | 'image'.
  render(frame, mode, s) {
    const gl = this.gl;
    this.#begin();
    gl.bindTexture(gl.TEXTURE_2D, this.video);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    const m = this.maskW ? { blur: 1, image: 2 }[mode] || 0 : 0;
    const maskTex = this.maskW ? this.fA.tex : this.video;
    if (m === 1) {
      this.#draw('bgDown', this.bgA, { uVideo: this.video, uMask: maskTex }, { uOut: [this.bw, this.bh] });
      for (let i = 0; i < s.blurPasses; i++) {
        this.#draw('gauss', this.bgB, { uSrc: this.bgA.tex }, { uDir: [s.blurStep, 0] });
        this.#draw('gauss', this.bgA, { uSrc: this.bgB.tex }, { uDir: [0, s.blurStep] });
      }
    }
    this.#draw('final', null, { uVideo: this.video, uMask: maskTex, uBg: this.bgA.tex, uImg: this.img }, { uOut: [this.W, this.H], uMode: m, uLo: s.lo, uHi: s.hi, uSigma: s.sigma, uImgXf: this.imgXf });
    this.#end();
  }

  // Forces the GPU to finish (1-px readback). Used only for measurements.
  sync() {
    const px = new Uint8Array(4);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
  }

  resetMask() {
    this.first = true;
  }
}
