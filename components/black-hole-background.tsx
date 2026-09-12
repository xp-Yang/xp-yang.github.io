'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

import { Button } from '@/components/ui/button';
import {
  DEFAULT_BLACK_HOLE_CONTROLS,
  type BlackHoleControls,
} from '@/lib/black-hole/controls';
import {
  createBlackbodyLut,
  findThinDiskPeak,
  thinDiskPeakTemperatureKelvin,
} from '@/lib/black-hole/physics';
import {
  bloomFragmentShader,
  compositeFragmentShader,
  fullscreenVertexShader,
  schwarzschildFragmentShader,
} from '@/lib/black-hole/shaders';
import { cn } from '@/lib/utils';

const MOTION_KEY = 'event-horizon-motion';

const QUALITY_LEVELS = [
  { name: 'High', scale: 0.7, bloomDivisor: 2, bloomStrength: 0.34 },
  { name: 'Balanced', scale: 0.52, bloomDivisor: 4, bloomStrength: 0.28 },
  { name: 'Safe', scale: 0.36, bloomDivisor: 0, bloomStrength: 0 },
  { name: 'Emergency', scale: 0.25, bloomDivisor: 0, bloomStrength: 0 },
] as const;

interface DebugStats {
  fps: number;
  gpuMs: number | null;
  quality: string;
  width: number;
  height: number;
}

interface TimerQueryExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

function validateProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
) {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('WebGL2 shader allocation failed');
    gl.shaderSource(shader, `#version 300 es\n${source}`);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message =
        gl.getShaderInfoLog(shader) ?? 'Unknown shader compilation error';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  };

  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL2 program allocation failed');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  const message = gl.getProgramInfoLog(program);
  gl.deleteProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!linked) throw new Error(message ?? 'WebGL2 shader link failed');
}

function createFullscreenScene(
  material: THREE.Material,
  geometry: THREE.PlaneGeometry,
) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  return scene;
}

export function BlackHoleBackground({
  controls = DEFAULT_BLACK_HOLE_CONTROLS,
  playbackClassName,
  debugClassName,
}: {
  controls?: BlackHoleControls;
  playbackClassName?: string;
  debugClassName?: string;
} = {}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef(controls);
  const renderWithControlsRef = useRef<(() => void) | null>(null);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [contextRevision, setContextRevision] = useState(0);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugStats, setDebugStats] = useState<DebugStats>({
    fps: 0,
    gpuMs: null,
    quality: QUALITY_LEVELS[0].name,
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const saved = window.localStorage.getItem(MOTION_KEY);
    setMotionEnabled(saved === null ? !media.matches : saved === 'true');
    setDebugEnabled(
      new URLSearchParams(window.location.search).get('bhDebug') === '1',
    );
  }, []);

  useEffect(() => {
    controlsRef.current = controls;
    renderWithControlsRef.current?.();
  }, [controls]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      setWebglAvailable(false);
      return;
    }

    let renderer: THREE.WebGLRenderer | null = null;
    let animationFrame = 0;
    let contextLost = false;
    let pageVisible = !document.hidden;
    let heroVisible = true;
    let qualityIndex = 0;
    let badWindows = 0;
    let goodWindows = 0;
    let sampleStart = performance.now();
    let sampleFrames = 0;
    let lastFrame = sampleStart;
    let elapsedSeconds = 0;
    let gpuMs: number | null = null;
    let pendingQuery: WebGLQuery | null = null;
    let lastDebugUpdate = 0;
    let renderWidth = 1;
    let renderHeight = 1;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const camera = new THREE.Camera();
    const blackbodyTexture = new THREE.DataTexture(
      createBlackbodyLut(),
      256,
      1,
      THREE.RGBAFormat,
    );
    blackbodyTexture.colorSpace = THREE.NoColorSpace;
    blackbodyTexture.minFilter = THREE.LinearFilter;
    blackbodyTexture.magFilter = THREE.LinearFilter;
    blackbodyTexture.wrapS = THREE.ClampToEdgeWrapping;
    blackbodyTexture.wrapT = THREE.ClampToEdgeWrapping;
    blackbodyTexture.needsUpdate = true;

    const diskPeak = findThinDiskPeak();
    let lastTemperatureMass = controlsRef.current.blackHoleMassSolar;
    let lastTemperatureAccretion = controlsRef.current.eddingtonRatio;
    const physicsUniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uPrincipalOffset: { value: 0.6 },
      uFluxPeak: { value: diskPeak.flux },
      uDiskPeakTemperature: {
        value: thinDiskPeakTemperatureKelvin(
          lastTemperatureMass,
          lastTemperatureAccretion,
        ),
      },
      uObserverRadius: { value: controlsRef.current.observerRadius },
      uOrbitTilt: {
        value: THREE.MathUtils.degToRad(controlsRef.current.inclination),
      },
      uViewAzimuth: { value: controlsRef.current.azimuth },
      uZoom: { value: controlsRef.current.zoom },
      uDiskOuterRadius: { value: controlsRef.current.diskOuterRadius },
      uObserverMotion: { value: controlsRef.current.observerMotion ? 1 : 0 },
      uCameraMode: {
        value:
          controlsRef.current.cameraMode === 'orbit'
            ? 1
            : controlsRef.current.cameraMode === 'fixed'
              ? 2
              : 0,
      },
      uStarsEnabled: { value: controlsRef.current.starsEnabled ? 1 : 0 },
      uBlackbodyLut: { value: blackbodyTexture },
    };
    const physicsMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVertexShader,
      fragmentShader: schwarzschildFragmentShader,
      uniforms: physicsUniforms,
      depthTest: false,
      depthWrite: false,
    });
    const blurUniforms = {
      uInput: { value: null as THREE.Texture | null },
      uDirection: { value: new THREE.Vector2(1, 0) },
      uExtract: { value: 1 },
    };
    const blurMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVertexShader,
      fragmentShader: bloomFragmentShader,
      uniforms: blurUniforms,
      depthTest: false,
      depthWrite: false,
    });
    const compositeUniforms = {
      uScene: { value: null as THREE.Texture | null },
      uBloom: { value: null as THREE.Texture | null },
      uBloomStrength: { value: QUALITY_LEVELS[0].bloomStrength as number },
      uExposure: { value: 0.75 },
    };
    const compositeMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVertexShader,
      fragmentShader: compositeFragmentShader,
      uniforms: compositeUniforms,
      depthTest: false,
      depthWrite: false,
    });
    const physicsScene = createFullscreenScene(physicsMaterial, geometry);
    const blurScene = createFullscreenScene(blurMaterial, geometry);
    const compositeScene = createFullscreenScene(compositeMaterial, geometry);

    const floatTargetsAvailable = Boolean(
      gl.getExtension('EXT_color_buffer_float'),
    );
    const renderTargetOptions: THREE.RenderTargetOptions = {
      type: floatTargetsAvailable
        ? THREE.HalfFloatType
        : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
    const physicsTarget = new THREE.WebGLRenderTarget(
      1,
      1,
      renderTargetOptions,
    );
    const bloomTargetA = new THREE.WebGLRenderTarget(1, 1, renderTargetOptions);
    const bloomTargetB = new THREE.WebGLRenderTarget(1, 1, renderTargetOptions);

    try {
      validateProgram(gl, fullscreenVertexShader, schwarzschildFragmentShader);
      validateProgram(gl, fullscreenVertexShader, bloomFragmentShader);
      validateProgram(gl, fullscreenVertexShader, compositeFragmentShader);
      renderer = new THREE.WebGLRenderer({
        canvas,
        context: gl,
        antialias: false,
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.domElement.setAttribute('aria-hidden', 'true');
      renderer.domElement.className = 'h-full w-full';
      mount.appendChild(renderer.domElement);
      setWebglAvailable(true);
    } catch (error) {
      console.error('Schwarzschild renderer initialization failed', error);
      setWebglAvailable(false);
    }

    if (!renderer) {
      geometry.dispose();
      blackbodyTexture.dispose();
      physicsMaterial.dispose();
      blurMaterial.dispose();
      compositeMaterial.dispose();
      physicsTarget.dispose();
      bloomTargetA.dispose();
      bloomTargetB.dispose();
      return;
    }

    const timerExtension = gl.getExtension(
      'EXT_disjoint_timer_query_webgl2',
    ) as TimerQueryExtension | null;

    const requestedQualityIndex = () => {
      const quality = controlsRef.current.quality;
      if (quality === 'high') return 0;
      if (quality === 'balanced') return 1;
      if (quality === 'safe') return 2;
      return null;
    };

    const syncControlUniforms = () => {
      const next = controlsRef.current;
      physicsUniforms.uObserverRadius.value = next.observerRadius;
      physicsUniforms.uOrbitTilt.value = THREE.MathUtils.degToRad(
        next.inclination,
      );
      physicsUniforms.uViewAzimuth.value = next.azimuth;
      physicsUniforms.uZoom.value = next.zoom;
      physicsUniforms.uDiskOuterRadius.value = next.diskOuterRadius;
      physicsUniforms.uObserverMotion.value = next.observerMotion ? 1 : 0;
      physicsUniforms.uCameraMode.value =
        next.cameraMode === 'orbit' ? 1 : next.cameraMode === 'fixed' ? 2 : 0;
      physicsUniforms.uStarsEnabled.value = next.starsEnabled ? 1 : 0;
      if (
        next.blackHoleMassSolar !== lastTemperatureMass ||
        next.eddingtonRatio !== lastTemperatureAccretion
      ) {
        physicsUniforms.uDiskPeakTemperature.value =
          thinDiskPeakTemperatureKelvin(
            next.blackHoleMassSolar,
            next.eddingtonRatio,
          );
        lastTemperatureMass = next.blackHoleMassSolar;
        lastTemperatureAccretion = next.eddingtonRatio;
      }
      compositeUniforms.uExposure.value = next.exposure;
    };

    const resize = () => {
      if (!renderer) return;
      const quality = QUALITY_LEVELS[qualityIndex];
      const deviceScale = Math.min(window.devicePixelRatio || 1, 1.5);
      renderWidth = Math.max(
        2,
        Math.floor(window.innerWidth * deviceScale * quality.scale),
      );
      renderHeight = Math.max(
        2,
        Math.floor(window.innerHeight * deviceScale * quality.scale),
      );
      const bloomWidth = Math.max(
        2,
        Math.floor(renderWidth / Math.max(quality.bloomDivisor, 1)),
      );
      const bloomHeight = Math.max(
        2,
        Math.floor(renderHeight / Math.max(quality.bloomDivisor, 1)),
      );

      renderer.setSize(renderWidth, renderHeight, false);
      physicsTarget.setSize(renderWidth, renderHeight);
      bloomTargetA.setSize(bloomWidth, bloomHeight);
      bloomTargetB.setSize(bloomWidth, bloomHeight);
      physicsUniforms.uResolution.value.set(renderWidth, renderHeight);
      physicsUniforms.uPrincipalOffset.value =
        window.innerWidth >= 820 ? 0.6 : 0;
      compositeUniforms.uBloomStrength.value =
        quality.bloomStrength *
        (controlsRef.current.bloom / DEFAULT_BLACK_HOLE_CONTROLS.bloom);
    };

    const renderPipeline = () => {
      if (!renderer || contextLost) return;
      syncControlUniforms();
      const quality = QUALITY_LEVELS[qualityIndex];
      renderer.setRenderTarget(physicsTarget);
      renderer.render(physicsScene, camera);

      if (quality.bloomDivisor > 0) {
        blurUniforms.uInput.value = physicsTarget.texture;
        blurUniforms.uDirection.value.set(1 / bloomTargetA.width, 0);
        blurUniforms.uExtract.value = 1;
        renderer.setRenderTarget(bloomTargetA);
        renderer.render(blurScene, camera);

        blurUniforms.uInput.value = bloomTargetA.texture;
        blurUniforms.uDirection.value.set(0, 1 / bloomTargetB.height);
        blurUniforms.uExtract.value = 0;
        renderer.setRenderTarget(bloomTargetB);
        renderer.render(blurScene, camera);
      }

      compositeUniforms.uScene.value = physicsTarget.texture;
      compositeUniforms.uBloom.value =
        quality.bloomDivisor > 0 ? bloomTargetB.texture : physicsTarget.texture;
      renderer.setRenderTarget(null);
      renderer.render(compositeScene, camera);
    };

    const applyQuality = (nextIndex: number) => {
      qualityIndex = Math.max(
        0,
        Math.min(QUALITY_LEVELS.length - 1, nextIndex),
      );
      resize();
      renderPipeline();
    };

    renderWithControlsRef.current = () => {
      const forcedQuality = requestedQualityIndex();
      if (forcedQuality !== null && forcedQuality !== qualityIndex) {
        qualityIndex = forcedQuality;
        resize();
      } else {
        compositeUniforms.uBloomStrength.value =
          QUALITY_LEVELS[qualityIndex].bloomStrength *
          (controlsRef.current.bloom / DEFAULT_BLACK_HOLE_CONTROLS.bloom);
      }
      renderPipeline();
    };

    const updateGpuTimer = () => {
      if (!timerExtension || !pendingQuery) return;
      const available = gl.getQueryParameter(
        pendingQuery,
        gl.QUERY_RESULT_AVAILABLE,
      ) as boolean;
      const disjoint = gl.getParameter(
        timerExtension.GPU_DISJOINT_EXT,
      ) as boolean;
      if (!available) return;
      if (!disjoint) {
        const nanoseconds = gl.getQueryParameter(
          pendingQuery,
          gl.QUERY_RESULT,
        ) as number;
        gpuMs = nanoseconds / 1_000_000;
      }
      gl.deleteQuery(pendingQuery);
      pendingQuery = null;
    };

    const render = (now: number) => {
      if (!pageVisible || !heroVisible || !motionEnabled || contextLost) return;
      const frameDelta = Math.min((now - lastFrame) / 1_000, 0.1);
      lastFrame = now;
      elapsedSeconds += frameDelta;
      physicsUniforms.uTime.value = elapsedSeconds;

      updateGpuTimer();
      let activeQuery: WebGLQuery | null = null;
      if (timerExtension && !pendingQuery) {
        activeQuery = gl.createQuery();
        if (activeQuery)
          gl.beginQuery(timerExtension.TIME_ELAPSED_EXT, activeQuery);
      }

      try {
        renderPipeline();
      } catch (error) {
        console.error('Schwarzschild renderer failed', error);
        contextLost = true;
        renderer.domElement.style.display = 'none';
        setWebglAvailable(false);
        return;
      }

      if (timerExtension && activeQuery) {
        gl.endQuery(timerExtension.TIME_ELAPSED_EXT);
        pendingQuery = activeQuery;
      }

      sampleFrames += 1;
      const sampleDuration = now - sampleStart;
      if (sampleDuration >= 2_000) {
        const fps = (sampleFrames * 1_000) / sampleDuration;
        if (fps < 20) {
          badWindows += 1;
          goodWindows = 0;
        } else if (fps > 30) {
          goodWindows += 1;
          badWindows = 0;
        } else {
          badWindows = 0;
          goodWindows = 0;
        }

        if (
          controlsRef.current.quality === 'auto' &&
          badWindows >= 2 &&
          qualityIndex < QUALITY_LEVELS.length - 1
        ) {
          applyQuality(qualityIndex + 1);
          badWindows = 0;
        } else if (
          controlsRef.current.quality === 'auto' &&
          goodWindows >= 3 &&
          qualityIndex > 0
        ) {
          applyQuality(qualityIndex - 1);
          goodWindows = 0;
        }

        if (
          (debugEnabled || controlsRef.current.performanceInfo) &&
          now - lastDebugUpdate > 450
        ) {
          setDebugStats({
            fps,
            gpuMs,
            quality: QUALITY_LEVELS[qualityIndex].name,
            width: renderWidth,
            height: renderHeight,
          });
          lastDebugUpdate = now;
        }
        sampleStart = now;
        sampleFrames = 0;
      }

      animationFrame = requestAnimationFrame(render);
    };

    const resume = () => {
      if (!motionEnabled || !pageVisible || !heroVisible || contextLost) return;
      cancelAnimationFrame(animationFrame);
      lastFrame = performance.now();
      sampleStart = lastFrame;
      sampleFrames = 0;
      animationFrame = requestAnimationFrame(render);
    };

    const onVisibility = () => {
      pageVisible = !document.hidden;
      if (pageVisible) resume();
      else cancelAnimationFrame(animationFrame);
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      cancelAnimationFrame(animationFrame);
      setWebglAvailable(false);
    };
    const onContextRestored = () => setContextRevision((value) => value + 1);

    const hero = mount.closest('main')?.querySelector('section');
    const heroObserver = hero
      ? new IntersectionObserver(([entry]) => {
          heroVisible = entry.isIntersecting;
          if (heroVisible) resume();
          else cancelAnimationFrame(animationFrame);
        })
      : null;
    if (hero && heroObserver) heroObserver.observe(hero);

    resize();
    renderPipeline();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    if (motionEnabled) resume();

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      heroObserver?.disconnect();
      renderWithControlsRef.current = null;
      if (pendingQuery) gl.deleteQuery(pendingQuery);
      geometry.dispose();
      blackbodyTexture.dispose();
      physicsMaterial.dispose();
      blurMaterial.dispose();
      compositeMaterial.dispose();
      physicsTarget.dispose();
      bloomTargetA.dispose();
      bloomTargetB.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [contextRevision, debugEnabled, motionEnabled]);

  const toggleMotion = () => {
    setMotionEnabled((current) => {
      const next = !current;
      window.localStorage.setItem(MOTION_KEY, String(next));
      return next;
    });
  };

  return (
    <>
      <div
        ref={mountRef}
        className="pointer-events-none fixed inset-0 z-0 bg-[#020305]"
        data-webgl={webglAvailable ? 'available' : 'unavailable'}
      />
      <div className="pointer-events-none fixed inset-0 z-[1] bg-[linear-gradient(90deg,rgba(3,4,6,.91)_0%,rgba(3,4,6,.57)_42%,rgba(3,4,6,.08)_76%),linear-gradient(0deg,rgba(3,4,6,.93)_0%,transparent_44%)]" />

      {(debugEnabled || controls.performanceInfo) && webglAvailable && (
        <output
          className={cn(
            'fixed right-4 top-20 z-30 rounded-lg border border-white/12 bg-black/70 px-3 py-2 font-mono text-[10px] leading-5 text-stone-300 backdrop-blur-md',
            debugClassName,
          )}
          aria-live="polite"
        >
          <span className="block text-[#ffad61]">
            SCHWARZSCHILD / RK4 × 224
          </span>
          <span className="block">
            {debugStats.fps.toFixed(1)} FPS ·{' '}
            {debugStats.gpuMs === null
              ? 'GPU —'
              : `GPU ${debugStats.gpuMs.toFixed(1)} ms`}
          </span>
          <span className="block">
            {debugStats.quality} · {debugStats.width}×{debugStats.height}
          </span>
        </output>
      )}

      {webglAvailable && (
        <Button
          aria-label={motionEnabled ? '暂停黑洞动画' : '播放黑洞动画'}
          title={motionEnabled ? '暂停动态背景' : '播放动态背景'}
          variant="outline"
          size="icon"
          onClick={toggleMotion}
          className={cn(
            'fixed bottom-4 right-4 z-30 border-white/15 bg-black/55 text-stone-200 backdrop-blur-md hover:bg-white/10',
            playbackClassName,
          )}
        >
          {motionEnabled ? <Pause /> : <Play />}
        </Button>
      )}
    </>
  );
}
