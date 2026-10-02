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
      float amplitude = 0.5;
      mat2 turn = mat2(0.82, -0.57, 0.57, 0.82);
      for (int i = 0; i < 4; i++) {
        value += amplitude * noise(p);
        p = turn * p * 2.03 + vec2(3.7, 1.9);
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
      vec2 p = uv * 2.0 - 1.0;
      p.x *= u_resolution.x / max(u_resolution.y, 1.0);

      float t = u_time * 0.18;
      float swell = fbm(p * 1.55 + vec2(t * 0.72, -t * 0.33));
      float crossWave = fbm(p * 4.2 + vec2(-t * 0.26, t * 0.48));
      float ripple = 0.5 + 0.5 * sin(
        p.x * 8.5 +
        p.y * 3.1 +
        t * 3.0 +
        swell * 3.2
      );

      float surface = clamp(swell * 0.58 + crossWave * 0.29 + ripple * 0.13, 0.0, 1.0);

      vec3 deep = vec3(0.018, 0.255, 0.325);
      vec3 mid = vec3(0.025, 0.475, 0.565);
      vec3 crest = vec3(0.33, 0.77, 0.81);

      vec3 color = mix(deep, mid, smoothstep(0.18, 0.82, surface));
      float foamLight = smoothstep(0.70, 0.96, surface + ripple * 0.08);
      color = mix(color, crest, foamLight * 0.28);

      float glintBand = sin((p.x - p.y * 0.55) * 13.0 + t * 4.0 + crossWave * 5.0);
      float glint = pow(max(glintBand, 0.0), 10.0) * (0.025 + 0.035 * swell);
      color += vec3(0.45, 0.82, 0.86) * glint;

      float edgeShade = 1.0 - smoothstep(0.72, 1.55, length(p)) * 0.07;
      color *= edgeShade;

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    console.warn('Ocean shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  function init(canvas) {
    if (!canvas) return null;

    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    });
    if (!gl) {
      canvas.classList.add('ocean-fallback');
      return { resize() {} };
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) {
      canvas.classList.add('ocean-fallback');
      return { resize() {} };
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Ocean shader link failed:', gl.getProgramInfoLog(program));
      canvas.classList.add('ocean-fallback');
      return { resize() {} };
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
    const timeLocation = gl.getUniformLocation(program, 'u_time');

    let frame = 0;
    let startedAt = performance.now();
    let disposed = false;
    let visible = !document.hidden;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function draw(now) {
      if (disposed) return;
      resize();

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, reducedMotion.matches ? 0 : (now - startedAt) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!reducedMotion.matches && visible) frame = requestAnimationFrame(draw);
    }

    function restart() {
      cancelAnimationFrame(frame);
      frame = 0;
      if (disposed) return;
      startedAt = performance.now();
      draw(startedAt);
    }

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion.matches || !frame) draw(performance.now());
    });
    observer.observe(canvas);

    const onVisibility = () => {
      visible = !document.hidden;
      if (!visible) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!reducedMotion.matches && !frame) {
        startedAt = performance.now();
        frame = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onMotionChange = () => restart();
    reducedMotion.addEventListener?.('change', onMotionChange);

    draw(startedAt);

    return {
      resize,
      destroy() {
        disposed = true;
        cancelAnimationFrame(frame);
        observer.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        reducedMotion.removeEventListener?.('change', onMotionChange);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      },
    };
  }

  window.PervoOcean = { init };
})();
