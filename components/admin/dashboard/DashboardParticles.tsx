"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function DashboardParticles() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // Scene + Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    camera.position.z = 4;

    // Meshes data
    const meshes: { mesh: THREE.Mesh; rx: number; ry: number; driftX: number; driftY: number; driftSpeed: number; initX: number; initY: number }[] = [];

    // ~40 Torus (anneaux)
    for (let i = 0; i < 40; i++) {
      const radius = 0.2 + Math.random() * 0.6;
      const tube = 0.03 + Math.random() * 0.06;
      const geo = new THREE.TorusGeometry(radius, tube, 8, 24);
      const opacity = 0.15 + Math.random() * 0.25;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity,
      });
      const mesh = new THREE.Mesh(geo, mat);

      const x = (Math.random() - 0.5) * 10;
      const y = (Math.random() - 0.5) * 5;
      const z = -3 + Math.random() * 3;
      mesh.position.set(x, y, z);
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      scene.add(mesh);
      meshes.push({
        mesh,
        rx: 0.001 + Math.random() * 0.004,
        ry: 0.001 + Math.random() * 0.004,
        driftX: Math.random() * Math.PI * 2,
        driftY: Math.random() * Math.PI * 2,
        driftSpeed: 0.002 + Math.random() * 0.003,
        initX: x,
        initY: y,
      });
    }

    // ~20 Octahedron (diamants)
    for (let i = 0; i < 20; i++) {
      const size = 0.08 + Math.random() * 0.18;
      const geo = new THREE.OctahedronGeometry(size);
      const opacity = 0.2 + Math.random() * 0.2;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity,
      });
      const mesh = new THREE.Mesh(geo, mat);

      const x = (Math.random() - 0.5) * 10;
      const y = (Math.random() - 0.5) * 5;
      const z = -3 + Math.random() * 3;
      mesh.position.set(x, y, z);
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      scene.add(mesh);
      meshes.push({
        mesh,
        rx: 0.002 + Math.random() * 0.003,
        ry: 0.001 + Math.random() * 0.004,
        driftX: Math.random() * Math.PI * 2,
        driftY: Math.random() * Math.PI * 2,
        driftSpeed: 0.002 + Math.random() * 0.003,
        initX: x,
        initY: y,
      });
    }

    // Animation loop
    let animId: number;
    let t = 0;

    function animate() {
      animId = requestAnimationFrame(animate);
      t += 1;

      for (const item of meshes) {
        item.mesh.rotation.x += item.rx;
        item.mesh.rotation.y += item.ry;
        item.mesh.position.x = item.initX + Math.sin(t * item.driftSpeed + item.driftX) * 0.3;
        item.mesh.position.y = item.initY + Math.cos(t * item.driftSpeed + item.driftY) * 0.2;
      }

      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    function onResize() {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0 pointer-events-none" />;
}
