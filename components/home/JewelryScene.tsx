"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export default function JewelryScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isMobile = container.clientWidth < 768;

    let seed = 77;
    function rand() {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    // ── Scene ──
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      50, container.clientWidth / container.clientHeight, 0.1, 150,
    );
    camera.position.set(0, 0, 20);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !isMobile,
      powerPreference: "high-performance",
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    container.appendChild(renderer.domElement);

    // ── Bloom ──
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      isMobile ? 0.8 : 1.2,
      0.6,
      0.1,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    // ── Dimensions ──
    const SPREAD_X = isMobile ? 22 : 35;
    const SPREAD_Y = isMobile ? 14 : 22;

    // ── Gold stars — main layer ──
    const GOLD_COUNT = isMobile ? 200 : 500;
    const goldGeo = new THREE.BufferGeometry();
    const goldPos = new Float32Array(GOLD_COUNT * 3);
    const goldPhases = new Float32Array(GOLD_COUNT);
    const goldSpeeds = new Float32Array(GOLD_COUNT);
    for (let i = 0; i < GOLD_COUNT; i++) {
      goldPos[i * 3]     = (rand() - 0.5) * SPREAD_X * 1.3;
      goldPos[i * 3 + 1] = (rand() - 0.5) * SPREAD_Y * 1.3;
      goldPos[i * 3 + 2] = (rand() - 0.5) * 14;
      goldPhases[i] = rand() * Math.PI * 2;
      goldSpeeds[i] = 0.5 + rand() * 2.0;
    }
    goldGeo.setAttribute("position", new THREE.BufferAttribute(goldPos, 3));
    const goldMat = new THREE.PointsMaterial({
      color: 0xd4af37,
      size: isMobile ? 0.12 : 0.09,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      depthWrite: false,
    });
    scene.add(new THREE.Points(goldGeo, goldMat));

    // ── White sparkles — bright twinkle layer ──
    const WHITE_COUNT = isMobile ? 80 : 200;
    const whiteGeo = new THREE.BufferGeometry();
    const whitePos = new Float32Array(WHITE_COUNT * 3);
    const whitePhases = new Float32Array(WHITE_COUNT);
    const whiteSpeeds = new Float32Array(WHITE_COUNT);
    for (let i = 0; i < WHITE_COUNT; i++) {
      whitePos[i * 3]     = (rand() - 0.5) * SPREAD_X * 1.2;
      whitePos[i * 3 + 1] = (rand() - 0.5) * SPREAD_Y * 1.2;
      whitePos[i * 3 + 2] = (rand() - 0.5) * 12;
      whitePhases[i] = rand() * Math.PI * 2;
      whiteSpeeds[i] = 1.0 + rand() * 3.0;
    }
    whiteGeo.setAttribute("position", new THREE.BufferAttribute(whitePos, 3));
    const whiteMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: isMobile ? 0.14 : 0.11,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      depthWrite: false,
    });
    scene.add(new THREE.Points(whiteGeo, whiteMat));

    // ── Warm rose gold motes — depth ──
    const ROSE_COUNT = isMobile ? 60 : 150;
    const roseGeo = new THREE.BufferGeometry();
    const rosePos = new Float32Array(ROSE_COUNT * 3);
    const rosePhases = new Float32Array(ROSE_COUNT);
    for (let i = 0; i < ROSE_COUNT; i++) {
      rosePos[i * 3]     = (rand() - 0.5) * SPREAD_X * 1.5;
      rosePos[i * 3 + 1] = (rand() - 0.5) * SPREAD_Y * 1.5;
      rosePos[i * 3 + 2] = (rand() - 0.5) * 8 - 5;
      rosePhases[i] = rand() * Math.PI * 2;
    }
    roseGeo.setAttribute("position", new THREE.BufferAttribute(rosePos, 3));
    const roseMat = new THREE.PointsMaterial({
      color: 0xb76e79,
      size: isMobile ? 0.08 : 0.06,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      depthWrite: false,
    });
    scene.add(new THREE.Points(roseGeo, roseMat));

    // ── Animation ──
    const clock = new THREE.Clock();

    function animate() {
      animRef.current = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // Gold — gentle drift + individual twinkle via position micro-movement
      {
        const arr = goldPos;
        for (let i = 0; i < GOLD_COUNT; i++) {
          const p = goldPhases[i];
          const s = goldSpeeds[i];
          arr[i * 3]     += Math.sin(t * 0.08 + p) * 0.001;
          arr[i * 3 + 1] += Math.cos(t * 0.06 + p * 1.3) * 0.001;
          arr[i * 3 + 2] += Math.sin(t * 0.04 + p * 0.7) * 0.0005;
          // Subtle z-oscillation creates size twinkle via sizeAttenuation
          arr[i * 3 + 2] += Math.sin(t * s + p) * 0.003;
        }
        goldGeo.attributes.position.needsUpdate = true;
        goldMat.opacity = 0.5 + Math.sin(t * 0.3) * 0.15;
      }

      // White — rapid twinkle
      {
        const arr = whitePos;
        for (let i = 0; i < WHITE_COUNT; i++) {
          const p = whitePhases[i];
          arr[i * 3]     += Math.cos(t * 0.1 + p) * 0.0008;
          arr[i * 3 + 1] += Math.sin(t * 0.12 + p * 1.5) * 0.001;
          // Z-oscillation for twinkle
          arr[i * 3 + 2] += Math.sin(t * whiteSpeeds[i] * 1.5 + p) * 0.005;
        }
        whiteGeo.attributes.position.needsUpdate = true;
        whiteMat.opacity = 0.35 + Math.sin(t * 2.5) * 0.2 + Math.sin(t * 5.5 + 1) * 0.05;
        whiteMat.size = (isMobile ? 0.14 : 0.11) + Math.sin(t * 1.8) * 0.03;
      }

      // Rose — slow background
      {
        const arr = rosePos;
        for (let i = 0; i < ROSE_COUNT; i++) {
          arr[i * 3]     += Math.cos(t * 0.05 + rosePhases[i]) * 0.001;
          arr[i * 3 + 1] += Math.sin(t * 0.07 + rosePhases[i]) * 0.001;
        }
        roseGeo.attributes.position.needsUpdate = true;
        roseMat.opacity = 0.2 + Math.sin(t * 0.4 + 1) * 0.08;
      }

      // Camera drift
      camera.position.x = Math.sin(t * 0.04) * 0.8;
      camera.position.y = Math.cos(t * 0.03) * 0.5;
      camera.lookAt(0, 0, 0);

      bloomPass.strength = (isMobile ? 0.8 : 1.2) + Math.sin(t * 0.2) * 0.1;

      composer.render();
    }

    animate();

    function handleResize() {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bloomPass.resolution.set(w, h);
    }
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animRef.current);
      composer.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      goldGeo.dispose(); goldMat.dispose();
      whiteGeo.dispose(); whiteMat.dispose();
      roseGeo.dispose(); roseMat.dispose();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
}
