(() => {
  const vertexSource = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision mediump float;

    uniform vec2 u_resolution;
    uniform vec4 u_board;
    uniform float u_time;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.52;
      mat2 turn = mat2(0.84, -0.54, 0.54, 0.84);
      for (int i = 0; i < 4; i++) {
        value += amplitude * noise(p);
        p = turn * p * 2.01 + vec2(2.9, 4.1);
        amplitude *= 0.5;
      }
      return value;
    }

    float distanceOutsideBoard(vec2 p) {
      float dx = max(max(u_board.x - p.x, 0.0), p.x - u_board.z);
      float dy = max(max(u_board.y - p.y, 0.0), p.y - u_board.w);
      return length(vec2(dx, dy));
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
      vec2 topUv = vec2(uv.x, 1.0 - uv.y);
      float edgeDistance = distanceOutsideBoard(topUv);

      // The authoritative board stays clear. Fog only fades in outside it.
      float edgeMask = smoothstep(0.006, 0.055, edgeDistance);
      if (edgeMask <= 0.001) {
        gl_FragColor = vec4(0.0);
        return;
      }

      vec2 p = uv * 2.0 - 1.0;
      p.x *= u_resolution.x / max(u_resolution.y, 1.0);

      float t = u_time * 0.032;
      float broad = fbm(p * 1.55 + vec2(t * 0.55, -t * 0.22));
      float curled = fbm(
        (p + vec2(broad * 0.19, -broad * 0.11)) * 3.05 +
        vec2(-t * 0.21, t * 0.17)
      );
      float cloud = smoothstep(0.34, 0.82, broad * 0.69 + curled * 0.31);
      float outer = smoothstep(0.016, 0.09, edgeDistance);
      float density = (0.065 + 0.18 * outer) * (0.52 + 0.48 * cloud);

      vec3 cool = vec3(0.68, 0.77, 0.78);
      vec3 pale = vec3(0.86, 0.90, 0.88);
      vec3 color = mix(cool, pale, cloud * 0.72);

      gl_FragColor = vec4(color, edgeMask * density);
    }
  `;

  const FRAME_INTERVAL = 1000 / 24;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    console.warn('Fog shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  function init(canvas, board, fallback) {
    if (!canvas || !board) return null;

    const activateFallback = () => {
      canvas.classList.add('fog-webgl-unavailable');
      fallback?.classList.add('fog-fallback-active');
    };

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    });

    if (!gl) {
      activateFallback();
      return { resize() {}, destroy() {} };
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      activateFallback();
      return { resize() {}, destroy() {} };
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Fog shader link failed:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      activateFallback();
      return { resize() {}, destroy() {} };
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const boardLocation = gl.getUniformLocation(program, 'u_board');
    const timeLocation = gl.getUniformLocation(program, 'u_time');

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let resizeFrame = 0;
    let lastFrameAt = 0;
    let startedAt = performance.now();
    let disposed = false;
    let visible = !document.hidden;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function normalizedBoardRect() {
      const surfaceRect = canvas.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      if (surfaceRect.width <= 0 || surfaceRect.height <= 0) {
        return [0.1, 0.1, 0.9, 0.9];
      }

      const clamp = value => Math.max(0, Math.min(1, value));
      return [
        clamp((boardRect.left - surfaceRect.left) / surfaceRect.width),
        clamp((boardRect.top - surfaceRect.top) / surfaceRect.height),
        clamp((boardRect.right - surfaceRect.left) / surfaceRect.width),
        clamp((boardRect.bottom - surfaceRect.top) / surfaceRect.height),
      ];
    }

    function draw(now) {
      if (disposed) return;
      resize();

      const [left, top, right, bottom] = normalizedBoardRect();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform4f(boardLocation, left, top, right, bottom);
      gl.uniform1f(timeLocation, reducedMotion.matches ? 0 : (now - startedAt) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function tick(now) {
      frame = 0;
      if (disposed || !visible || reducedMotion.matches) return;
      if (!lastFrameAt || now - lastFrameAt >= FRAME_INTERVAL) {
        lastFrameAt = now;
        draw(now);
      }
      frame = requestAnimationFrame(tick);
    }

    function restart() {
      cancelAnimationFrame(frame);
      frame = 0;
      lastFrameAt = 0;
      startedAt = performance.now();
      if (disposed || !visible) return;
      if (reducedMotion.matches) draw(startedAt);
      else frame = requestAnimationFrame(tick);
    }

    const scheduleResizeDraw = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        draw(reducedMotion.matches ? startedAt : performance.now());
      });
    };

    const observer = new ResizeObserver(scheduleResizeDraw);
    observer.observe(canvas);
    observer.observe(board);

    const onVisibility = () => {
      visible = !document.hidden;
      if (!visible) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        restart();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onMotionChange = () => restart();
    reducedMotion.addEventListener?.('change', onMotionChange);

    const onContextLost = event => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      frame = 0;
      activateFallback();
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    draw(startedAt);
    if (!reducedMotion.matches && visible) frame = requestAnimationFrame(tick);

    return {
      resize: scheduleResizeDraw,
      destroy() {
        disposed = true;
        cancelAnimationFrame(frame);
        cancelAnimationFrame(resizeFrame);
        observer.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        reducedMotion.removeEventListener?.('change', onMotionChange);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      },
    };
  }

  function boot() {
    const canvas = document.getElementById('mapFogCanvas');
    const board = document.getElementById('mapBoard');
    const fallback = document.getElementById('mapFogFallback');
    if (!canvas || !board) return;
    window.__pervoFogController = init(canvas, board, fallback);
  }

  window.PervoFog = { init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
