// WebGL2 batcher: one shader draws everything — colored shapes sample a 1×1
// white texture, textured surfaces sample tiling canvas-generated textures
// with world-anchored UVs. Vertex = pos(2) uv(2) rgba(4).

const VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
in vec4 a_col;
uniform vec2 u_center;
uniform vec2 u_invHalf;
out vec2 v_uv;
out vec4 v_col;
void main() {
  vec2 clip = (a_pos - u_center) * u_invHalf;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
  v_col = a_col;
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_col;
uniform sampler2D u_tex;
out vec4 outColor;
void main() { outColor = texture(u_tex, v_uv) * v_col; }`;

export type RGB = [number, number, number];
export type Texture = WebGLTexture;

// render resolution scale — lower-spec machines can trade sharpness for
// fill rate from the settings menu; the canvas CSS size never changes
let renderScale = Math.min(1, Math.max(0.5,
  parseFloat(localStorage.getItem('render-scale') ?? '1') || 1));

export function setRenderScale(v: number): void {
  renderScale = Math.min(1, Math.max(0.5, v));
  localStorage.setItem('render-scale', String(renderScale));
}

export function getRenderScale(): number {
  return renderScale;
}

const FLOATS_PER_VERT = 8;
const CAPACITY = 10000 * FLOATS_PER_VERT * 3;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private data = new Float32Array(CAPACITY);
  private n = 0;
  private uCenter: WebGLUniformLocation;
  private uInvHalf: WebGLUniformLocation;
  private white: WebGLTexture;
  private boundTex: WebGLTexture;

  width = 0;
  height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, stencil: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('shader: ' + gl.getShaderInfoLog(sh));
      }
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_VERT * 4;
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    const aUv = gl.getAttribLocation(prog, 'a_uv');
    const aCol = gl.getAttribLocation(prog, 'a_col');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(aCol);
    gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, stride, 16);

    this.uCenter = gl.getUniformLocation(prog, 'u_center')!;
    this.uInvHalf = gl.getUniformLocation(prog, 'u_invHalf')!;
    gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);

    // 1×1 white — colored geometry samples this
    this.white = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]));
    this.boundTex = this.white;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);
  }

  createTexture(source: HTMLCanvasElement, repeatT = true): Texture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeatT ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, max));
    }
    gl.bindTexture(gl.TEXTURE_2D, this.boundTex);
    return tex;
  }

  // null → white (plain colored drawing)
  setTexture(tex: Texture | null): void {
    const target = tex ?? this.white;
    if (target === this.boundTex) return;
    this.flush();
    this.boundTex = target;
    this.gl.bindTexture(this.gl.TEXTURE_2D, target);
  }

  // clip subsequent draws to a screen-space rectangle (device pixels, y-down)
  setScissor(x: number, y: number, w: number, h: number): void {
    this.flush();
    const gl = this.gl;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.round(x), Math.round(this.height - y - h), Math.round(w), Math.round(h));
  }

  // constrain subsequent draws to a circle (screen px): used by the zoom lens
  stencilCircle(cx: number, cy: number, radius: number): void {
    const gl = this.gl;
    this.flush();
    gl.enable(gl.STENCIL_TEST);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.colorMask(false, false, false, false);
    this.beginScreen();
    const segs = 48;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      this.tri(cx, cy,
        cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius,
        cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius,
        [1, 1, 1], 1);
    }
    this.flush();
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  }

  // begin writing shapes into the stencil (nothing hits the color buffer)
  stencilWriteBegin(): void {
    const gl = this.gl;
    this.flush();
    gl.enable(gl.STENCIL_TEST);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.colorMask(false, false, false, false);
  }

  // subsequent draws land only where the stencil was (not) written
  stencilWriteEnd(mode: 'inside' | 'outside'): void {
    const gl = this.gl;
    this.flush();
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.EQUAL, mode === 'inside' ? 1 : 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  }

  clearStencil(): void {
    this.flush();
    this.gl.disable(this.gl.STENCIL_TEST);
  }

  clearScissor(): void {
    this.flush();
    this.gl.disable(this.gl.SCISSOR_TEST);
  }

  private additive = false;

  setAdditive(on: boolean): void {
    if (on === this.additive) return;
    this.flush();
    this.additive = on;
    const gl = this.gl;
    if (on) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * renderScale;
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (w !== this.width || h !== this.height) {
      this.width = this.canvas.width = w;
      this.height = this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  clear(): void {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  beginWorld(camX: number, camY: number, viewW: number, viewH: number): void {
    this.flush();
    this.gl.uniform2f(this.uCenter, camX, camY);
    this.gl.uniform2f(this.uInvHalf, 2 / viewW, 2 / viewH);
  }

  beginScreen(): void {
    this.flush();
    this.gl.uniform2f(this.uCenter, this.width / 2, this.height / 2);
    this.gl.uniform2f(this.uInvHalf, 2 / this.width, 2 / this.height);
  }

  private vert(
    x: number, y: number, u: number, v: number,
    r: number, g: number, b: number, a: number,
  ): void {
    if (this.n + FLOATS_PER_VERT > CAPACITY) this.flush();
    const d = this.data;
    let i = this.n;
    d[i++] = x; d[i++] = y; d[i++] = u; d[i++] = v;
    d[i++] = r; d[i++] = g; d[i++] = b; d[i++] = a;
    this.n = i;
  }

  quad(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    this.gradQuad(x, y, w, h, c, c, a, a);
  }

  gradQuad(
    x: number, y: number, w: number, h: number,
    top: RGB, bot: RGB, aTop = 1, aBot = 1,
  ): void {
    const x2 = x + w, y2 = y + h;
    this.vert(x, y, 0, 0, top[0], top[1], top[2], aTop);
    this.vert(x2, y, 0, 0, top[0], top[1], top[2], aTop);
    this.vert(x, y2, 0, 0, bot[0], bot[1], bot[2], aBot);
    this.vert(x2, y, 0, 0, top[0], top[1], top[2], aTop);
    this.vert(x2, y2, 0, 0, bot[0], bot[1], bot[2], aBot);
    this.vert(x, y2, 0, 0, bot[0], bot[1], bot[2], aBot);
  }

  // Textured quad with world-anchored UVs (uScale = world units per tile
  // repeat) and a vertical tint gradient for lighting.
  texQuad(
    x: number, y: number, w: number, h: number, uScale: number,
    top: RGB, bot: RGB, aTop = 1, aBot = 1,
  ): void {
    const x2 = x + w, y2 = y + h;
    const u1 = x / uScale, u2 = x2 / uScale;
    const v1 = y / uScale, v2 = y2 / uScale;
    this.vert(x, y, u1, v1, top[0], top[1], top[2], aTop);
    this.vert(x2, y, u2, v1, top[0], top[1], top[2], aTop);
    this.vert(x, y2, u1, v2, bot[0], bot[1], bot[2], aBot);
    this.vert(x2, y, u2, v1, top[0], top[1], top[2], aTop);
    this.vert(x2, y2, u2, v2, bot[0], bot[1], bot[2], aBot);
    this.vert(x, y2, u1, v2, bot[0], bot[1], bot[2], aBot);
  }

  // Textured quad with explicit UV rectangle (for the sky backdrop).
  texQuadUV(
    x: number, y: number, w: number, h: number,
    u1: number, v1: number, u2: number, v2: number,
    top: RGB, bot: RGB, aTop = 1, aBot = 1,
  ): void {
    const x2 = x + w, y2 = y + h;
    this.vert(x, y, u1, v1, top[0], top[1], top[2], aTop);
    this.vert(x2, y, u2, v1, top[0], top[1], top[2], aTop);
    this.vert(x, y2, u1, v2, bot[0], bot[1], bot[2], aBot);
    this.vert(x2, y, u2, v1, top[0], top[1], top[2], aTop);
    this.vert(x2, y2, u2, v2, bot[0], bot[1], bot[2], aBot);
    this.vert(x, y2, u1, v2, bot[0], bot[1], bot[2], aBot);
  }

  // Textured quad given in local coordinates around a pivot, rotated by
  // angle. UVs map (u0,v0)→(lx0,ly0) and (u1,v1)→(lx1,ly1); callers flip
  // sprites by swapping u or v (and mirroring the local extents).
  texRotQuadLocal(
    px: number, py: number, angle: number,
    lx0: number, ly0: number, lx1: number, ly1: number,
    u0: number, v0: number, u1: number, v1: number,
    tint: RGB = [1, 1, 1], a = 1,
  ): void {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const wx = (lx: number, ly: number) => px + lx * cos - ly * sin;
    const wy = (lx: number, ly: number) => py + lx * sin + ly * cos;
    const [r, g, b] = tint;
    this.vert(wx(lx0, ly0), wy(lx0, ly0), u0, v0, r, g, b, a);
    this.vert(wx(lx1, ly0), wy(lx1, ly0), u1, v0, r, g, b, a);
    this.vert(wx(lx0, ly1), wy(lx0, ly1), u0, v1, r, g, b, a);
    this.vert(wx(lx1, ly0), wy(lx1, ly0), u1, v0, r, g, b, a);
    this.vert(wx(lx1, ly1), wy(lx1, ly1), u1, v1, r, g, b, a);
    this.vert(wx(lx0, ly1), wy(lx0, ly1), u0, v1, r, g, b, a);
  }

  tri(
    x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
    c: RGB, a = 1,
  ): void {
    this.vert(x1, y1, 0, 0, c[0], c[1], c[2], a);
    this.vert(x2, y2, 0, 0, c[0], c[1], c[2], a);
    this.vert(x3, y3, 0, 0, c[0], c[1], c[2], a);
  }

  // flat-colored polygon, fan-triangulated from the centroid (star-convex)
  poly(pts: Float32Array, c: RGB, a = 1): void {
    const n = pts.length / 2;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
    cx /= n; cy /= n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.vert(cx, cy, 0, 0, c[0], c[1], c[2], a);
      this.vert(pts[i * 2], pts[i * 2 + 1], 0, 0, c[0], c[1], c[2], a);
      this.vert(pts[j * 2], pts[j * 2 + 1], 0, 0, c[0], c[1], c[2], a);
    }
  }

  // textured polygon with world-anchored UVs and a vertical tint gradient
  texPoly(
    pts: Float32Array, uScale: number,
    top: RGB, bot: RGB, minY: number, maxY: number, a = 1,
  ): void {
    const n = pts.length / 2;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
    cx /= n; cy /= n;
    const span = Math.max(1, maxY - minY);
    const col = (y: number): RGB => {
      const t = Math.max(0, Math.min(1, (y - minY) / span));
      return [top[0] + (bot[0] - top[0]) * t, top[1] + (bot[1] - top[1]) * t, top[2] + (bot[2] - top[2]) * t];
    };
    const cc = col(cy);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = pts[i * 2], y1 = pts[i * 2 + 1];
      const x2 = pts[j * 2], y2 = pts[j * 2 + 1];
      const c1 = col(y1), c2 = col(y2);
      this.vert(cx, cy, cx / uScale, cy / uScale, cc[0], cc[1], cc[2], a);
      this.vert(x1, y1, x1 / uScale, y1 / uScale, c1[0], c1[1], c1[2], a);
      this.vert(x2, y2, x2 / uScale, y2 / uScale, c2[0], c2[1], c2[2], a);
    }
  }

  rotQuad(
    cx: number, cy: number, w: number, h: number, angle: number, c: RGB, a = 1,
  ): void {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const hw = w / 2, hh = h / 2;
    const px = [-hw, hw, hw, -hw];
    const py = [-hh, -hh, hh, hh];
    const vx: number[] = [], vy: number[] = [];
    for (let i = 0; i < 4; i++) {
      vx.push(cx + px[i] * cos - py[i] * sin);
      vy.push(cy + px[i] * sin + py[i] * cos);
    }
    this.vert(vx[0], vy[0], 0, 0, c[0], c[1], c[2], a);
    this.vert(vx[1], vy[1], 0, 0, c[0], c[1], c[2], a);
    this.vert(vx[2], vy[2], 0, 0, c[0], c[1], c[2], a);
    this.vert(vx[0], vy[0], 0, 0, c[0], c[1], c[2], a);
    this.vert(vx[2], vy[2], 0, 0, c[0], c[1], c[2], a);
    this.vert(vx[3], vy[3], 0, 0, c[0], c[1], c[2], a);
  }

  line(x1: number, y1: number, x2: number, y2: number, thick: number, c: RGB, a = 1): void {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return;
    this.rotQuad((x1 + x2) / 2, (y1 + y2) / 2, len, thick, Math.atan2(dy, dx), c, a);
  }

  glowDisc(cx: number, cy: number, rad: number, c: RGB, a: number, segs = 18): void {
    for (let i = 0; i < segs; i++) {
      const a1 = (i / segs) * Math.PI * 2;
      const a2 = ((i + 1) / segs) * Math.PI * 2;
      this.vert(cx, cy, 0, 0, c[0], c[1], c[2], a);
      this.vert(cx + Math.cos(a1) * rad, cy + Math.sin(a1) * rad, 0, 0, c[0], c[1], c[2], 0);
      this.vert(cx + Math.cos(a2) * rad, cy + Math.sin(a2) * rad, 0, 0, c[0], c[1], c[2], 0);
    }
  }

  circle(cx: number, cy: number, rad: number, top: RGB, bot: RGB, a = 1, segs = 28): void {
    const mid: RGB = [(top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2, (top[2] + bot[2]) / 2];
    const colAt = (y: number): RGB => {
      const t = (y - (cy - rad)) / (rad * 2);
      return [top[0] + (bot[0] - top[0]) * t, top[1] + (bot[1] - top[1]) * t, top[2] + (bot[2] - top[2]) * t];
    };
    for (let i = 0; i < segs; i++) {
      const a1 = (i / segs) * Math.PI * 2;
      const a2 = ((i + 1) / segs) * Math.PI * 2;
      const p1y = cy + Math.sin(a1) * rad;
      const p2y = cy + Math.sin(a2) * rad;
      const c1 = colAt(p1y), c2 = colAt(p2y);
      this.vert(cx, cy, 0, 0, mid[0], mid[1], mid[2], a);
      this.vert(cx + Math.cos(a1) * rad, p1y, 0, 0, c1[0], c1[1], c1[2], a);
      this.vert(cx + Math.cos(a2) * rad, p2y, 0, 0, c2[0], c2[1], c2[2], a);
    }
  }

  flushes = 0;   // draw calls this frame; reset by the frame loop

  flush(): void {
    if (this.n === 0) return;
    const gl = this.gl;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.n));
    gl.drawArrays(gl.TRIANGLES, 0, this.n / FLOATS_PER_VERT);
    this.n = 0;
    this.flushes++;
  }
}
