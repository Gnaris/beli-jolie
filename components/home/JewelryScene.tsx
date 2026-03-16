"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

interface JewelryPiece {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  rotSpeed: THREE.Vector3;
  floatSpeed: number;
  floatAmp: number;
  basePos: THREE.Vector3;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  hovered: boolean;
}

export default function JewelryScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Scene ──
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 8);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    container.appendChild(renderer.domElement);

    // ── Lighting — rich, multi-point for reflections ──
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 2.2);
    keyLight.position.set(5, 6, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe0d8ff, 0.8);
    fillLight.position.set(-5, 3, -4);
    scene.add(fillLight);

    const warmRim = new THREE.PointLight(0xffd700, 1.8, 30);
    warmRim.position.set(0, -5, 5);
    scene.add(warmRim);

    const topSpot = new THREE.PointLight(0xffffff, 1.2, 25);
    topSpot.position.set(3, 7, 0);
    scene.add(topSpot);

    const backGold = new THREE.PointLight(0xd4af37, 0.8, 20);
    backGold.position.set(-4, -3, -6);
    scene.add(backGold);

    const sideBlue = new THREE.PointLight(0x8888ff, 0.4, 15);
    sideBlue.position.set(6, 0, -2);
    scene.add(sideBlue);

    // ── Materials ──
    const gold = new THREE.MeshPhysicalMaterial({
      color: 0xd4af37, metalness: 1, roughness: 0.1,
      reflectivity: 1, clearcoat: 0.5, clearcoatRoughness: 0.06,
    });
    const polishedGold = new THREE.MeshPhysicalMaterial({
      color: 0xe6c33a, metalness: 1, roughness: 0.05,
      reflectivity: 1, clearcoat: 0.8, clearcoatRoughness: 0.02,
    });
    const silver = new THREE.MeshPhysicalMaterial({
      color: 0xc8c8c8, metalness: 1, roughness: 0.08,
      reflectivity: 1, clearcoat: 0.6, clearcoatRoughness: 0.03,
    });
    const platinum = new THREE.MeshPhysicalMaterial({
      color: 0xe5e4e2, metalness: 1, roughness: 0.06,
      reflectivity: 1, clearcoat: 0.7, clearcoatRoughness: 0.02,
    });
    const roseGold = new THREE.MeshPhysicalMaterial({
      color: 0xb76e79, metalness: 1, roughness: 0.12,
      reflectivity: 0.95, clearcoat: 0.4, clearcoatRoughness: 0.08,
    });
    const diamond = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0,
      transmission: 0.92, thickness: 0.6, ior: 2.42,
      clearcoat: 1, clearcoatRoughness: 0, transparent: true, opacity: 0.93,
    });
    const sapphire = new THREE.MeshPhysicalMaterial({
      color: 0x0f52ba, metalness: 0, roughness: 0.05,
      transmission: 0.7, thickness: 0.4, ior: 1.77,
      clearcoat: 1, clearcoatRoughness: 0, transparent: true, opacity: 0.9,
    });
    const ruby = new THREE.MeshPhysicalMaterial({
      color: 0xe0115f, metalness: 0, roughness: 0.05,
      transmission: 0.65, thickness: 0.4, ior: 1.76,
      clearcoat: 1, clearcoatRoughness: 0, transparent: true, opacity: 0.9,
    });
    const emerald = new THREE.MeshPhysicalMaterial({
      color: 0x046307, metalness: 0, roughness: 0.08,
      transmission: 0.6, thickness: 0.4, ior: 1.58,
      clearcoat: 1, clearcoatRoughness: 0, transparent: true, opacity: 0.88,
    });
    const pearl = new THREE.MeshPhysicalMaterial({
      color: 0xfff5ee, metalness: 0.1, roughness: 0.25,
      sheen: 1, sheenColor: new THREE.Color(0xffe4e1), sheenRoughness: 0.15,
      clearcoat: 0.9, clearcoatRoughness: 0.08,
    });

    const allMaterials = [gold, polishedGold, silver, platinum, roseGold, diamond, sapphire, ruby, emerald, pearl];

    // ── Helpers ──
    const pieces: JewelryPiece[] = [];
    const allInteractMeshes: THREE.Mesh[] = [];

    function createPiece(
      group: THREE.Group,
      pos: [number, number, number],
      rot: [number, number, number],
      rotSpeed: [number, number, number],
      floatSpeed: number,
      floatAmp: number,
    ) {
      group.position.set(...pos);
      group.rotation.set(...rot);
      scene.add(group);
      const meshes: THREE.Mesh[] = [];
      group.traverse((c) => { if (c instanceof THREE.Mesh) meshes.push(c); });
      allInteractMeshes.push(...meshes);
      pieces.push({
        group, meshes,
        rotSpeed: new THREE.Vector3(...rotSpeed),
        floatSpeed, floatAmp,
        basePos: new THREE.Vector3(...pos),
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        hovered: false,
      });
    }

    // ═══════════════════════════════════════
    // 1. HALO ENGAGEMENT RING — gold band + diamond halo
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      // Band with profile detail
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.065, 48, 80), gold);
      g.add(band);
      // Inner comfort band
      const inner = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 32, 80), polishedGold);
      inner.position.y = 0.002;
      g.add(inner);
      // Cathedral prongs (6)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.2, 8), gold);
        prong.position.set(Math.cos(a) * 0.07, 0.5 + 0.08, Math.sin(a) * 0.07);
        prong.rotation.x = Math.sin(a) * 0.18;
        prong.rotation.z = -Math.cos(a) * 0.18;
        g.add(prong);
      }
      // Center diamond
      const centerStone = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 2), diamond);
      centerStone.position.set(0, 0.5 + 0.14, 0);
      centerStone.scale.set(1, 1.35, 1);
      g.add(centerStone);
      // Halo — ring of tiny diamonds around center
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const haloDiamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.025, 1), diamond);
        haloDiamond.position.set(Math.cos(a) * 0.12, 0.5 + 0.1, Math.sin(a) * 0.12);
        haloDiamond.scale.set(1, 1.2, 1);
        g.add(haloDiamond);
      }
      // Pavé on band sides (tiny diamonds embedded)
      for (let i = 0; i < 8; i++) {
        const bandA = (i / 8) * Math.PI - Math.PI / 2;
        const pave = new THREE.Mesh(new THREE.OctahedronGeometry(0.015, 0), diamond);
        pave.position.set(Math.cos(bandA) * 0.5, Math.sin(bandA) * 0.5, 0.065);
        g.add(pave);
        const pave2 = new THREE.Mesh(new THREE.OctahedronGeometry(0.015, 0), diamond);
        pave2.position.set(Math.cos(bandA) * 0.5, Math.sin(bandA) * 0.5, -0.065);
        g.add(pave2);
      }
      createPiece(g, [-1.8, 0.5, 0.8], [0.5, 0.3, 0.2], [0.003, 0.005, 0.001], 0.65, 0.2);
    }

    // ═══════════════════════════════════════
    // 2. CHANDELIER EARRING — silver cascade drops
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      // Top decorative plate
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.02, 24), silver);
      g.add(plate);
      // Filigree detail — tiny torus around plate
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), silver);
        dot.position.set(Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11);
        g.add(dot);
      }
      // Post
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 8), silver);
      post.position.set(0, 0.16, 0);
      g.add(post);
      // Three cascading tiers
      const tiers = [
        { y: -0.1, count: 3, radius: 0.08, gemSize: 0.035, mat: sapphire },
        { y: -0.25, count: 5, radius: 0.12, gemSize: 0.03, mat: diamond },
        { y: -0.42, count: 7, radius: 0.16, gemSize: 0.025, mat: sapphire },
      ];
      for (const tier of tiers) {
        // Thin connecting chains
        const connector = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 6), silver);
        connector.position.set(0, tier.y + 0.06, 0);
        g.add(connector);
        // Bar
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, tier.radius * 2.2, 8), silver);
        bar.position.set(0, tier.y, 0);
        bar.rotation.z = Math.PI / 2;
        g.add(bar);
        // Gems
        for (let i = 0; i < tier.count; i++) {
          const x = (i - (tier.count - 1) / 2) * (tier.radius * 2.2 / tier.count);
          const gem = new THREE.Mesh(new THREE.OctahedronGeometry(tier.gemSize, 1), tier.mat);
          gem.position.set(x, tier.y - 0.04, 0);
          gem.scale.set(0.8, 1.3, 0.8);
          g.add(gem);
        }
      }
      // Bottom teardrop pearl
      const tearPearl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 24), pearl);
      tearPearl.position.set(0, -0.52, 0);
      tearPearl.scale.set(0.8, 1.2, 0.8);
      g.add(tearPearl);

      createPiece(g, [2.2, 0.6, 0], [-0.2, 0.4, 0.1], [-0.003, 0.004, 0.002], 1.0, 0.15);
    }

    // ═══════════════════════════════════════
    // 3. PEARL STRAND NECKLACE — curved chain with pearls
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      const numPearls = 20;
      for (let i = 0; i < numPearls; i++) {
        const t = (i / (numPearls - 1)) * Math.PI;
        const x = Math.cos(t) * 0.8;
        const y = -Math.sin(t) * 0.4;
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 24), pearl);
        p.position.set(x, y, 0);
        g.add(p);
        // Tiny gold spacer between pearls
        if (i < numPearls - 1) {
          const nx = Math.cos((i + 0.5) / (numPearls - 1) * Math.PI) * 0.8;
          const ny = -Math.sin((i + 0.5) / (numPearls - 1) * Math.PI) * 0.4;
          const spacer = new THREE.Mesh(new THREE.SphereGeometry(0.015, 12, 12), gold);
          spacer.position.set(nx, ny, 0);
          g.add(spacer);
        }
      }
      // Gold clasp
      const clasp = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 12, 16), gold);
      clasp.position.set(0.82, 0, 0);
      g.add(clasp);
      const claspBar = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 8), gold);
      claspBar.position.set(0.82, 0, 0);
      claspBar.rotation.z = Math.PI / 2;
      g.add(claspBar);
      // Center pendant — gold with emerald
      const pendant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.08, 16), gold);
      pendant.position.set(0, -0.46, 0);
      g.add(pendant);
      const pendantGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 1), emerald);
      pendantGem.position.set(0, -0.5, 0);
      g.add(pendantGem);

      createPiece(g, [0.0, -0.6, 0.6], [0.15, 0.1, 0.1], [0.002, 0.003, -0.001], 0.8, 0.16);
    }

    // ═══════════════════════════════════════
    // 4. TENNIS BRACELET — row of diamonds in gold
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      const numStones = 24;
      for (let i = 0; i < numStones; i++) {
        const a = (i / numStones) * Math.PI * 2;
        // Gold setting cup
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.02, 8), gold);
        cup.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0);
        cup.lookAt(0, 0, 0);
        g.add(cup);
        // Diamond
        const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.025, 1), diamond);
        stone.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.02);
        stone.scale.set(1, 1, 1.3);
        g.add(stone);
        // Link between settings
        if (i < numStones - 1) {
          const na = ((i + 0.5) / numStones) * Math.PI * 2;
          const link = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6), gold);
          link.position.set(Math.cos(na) * 0.5, Math.sin(na) * 0.5, 0);
          const dir = new THREE.Vector3(Math.cos(na + 0.1) - Math.cos(na - 0.1), Math.sin(na + 0.1) - Math.sin(na - 0.1), 0);
          link.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
          g.add(link);
        }
      }
      // Clasp
      const tClasp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.025, 2, 2, 2), gold);
      tClasp.position.set(0.53, 0, 0);
      g.add(tClasp);

      createPiece(g, [1.5, -0.7, -0.3], [1.0, 0.4, 0.2], [-0.003, 0.004, 0.002], 0.85, 0.13);
    }

    // ═══════════════════════════════════════
    // 5. ROSE GOLD BANGLE with engravings & gems
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      const bangle = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.055, 48, 80), roseGold);
      g.add(bangle);
      // Outer decorative edge ridges
      const edgeTop = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.008, 16, 80), polishedGold);
      edgeTop.position.z = 0.05;
      g.add(edgeTop);
      const edgeBot = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.008, 16, 80), polishedGold);
      edgeBot.position.z = -0.05;
      g.add(edgeBot);
      // Center line ridge
      const centerRidge = new THREE.Mesh(new THREE.TorusGeometry(0.555, 0.005, 12, 80), gold);
      g.add(centerRidge);
      // Gemstone stations every 60 degrees
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 1), i % 2 === 0 ? ruby : diamond);
        gem.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.06);
        gem.scale.set(0.8, 1.1, 0.7);
        g.add(gem);
        // Micro prongs around each gem
        for (let j = 0; j < 4; j++) {
          const pa = (j / 4) * Math.PI * 2;
          const mp = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), gold);
          mp.position.set(
            Math.cos(a) * 0.55 + Math.cos(pa) * 0.025,
            Math.sin(a) * 0.55 + Math.sin(pa) * 0.025,
            0.06,
          );
          g.add(mp);
        }
      }
      createPiece(g, [-0.8, 1.4, -0.3], [1.3, -0.2, 0.5], [0.002, -0.003, 0.003], 1.1, 0.11);
    }

    // ═══════════════════════════════════════
    // 6. SIGNET RING — platinum with engraved face
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      // Band
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.07, 48, 64), platinum);
      g.add(band);
      // Flat face plate (wider section)
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 8), platinum);
      face.position.set(0, 0.45, 0);
      face.rotation.x = Math.PI / 2;
      g.add(face);
      // Engraving detail — recessed lines (subtle ridges on face)
      const line1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.005, 0.003, 1, 1, 1), silver);
      line1.position.set(0, 0.48, 0);
      g.add(line1);
      const line2 = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.005, 0.14, 1, 1, 1), silver);
      line2.position.set(0, 0.48, 0);
      g.add(line2);
      // Decorative diamond center of face
      const faceGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 1), diamond);
      faceGem.position.set(0, 0.49, 0);
      g.add(faceGem);
      // Shoulder details
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < 3; i++) {
          const a = (side * (0.3 + i * 0.15));
          const detail = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), gold);
          detail.position.set(Math.sin(a) * 0.45, Math.cos(a) * 0.45, 0.07);
          g.add(detail);
        }
      }
      createPiece(g, [2.3, -0.2, 0.3], [0.7, 0.6, 0], [0.004, 0.002, -0.002], 1.2, 0.1);
    }

    // ═══════════════════════════════════════
    // 7. GOLD CHAIN BRACELET with heart charm
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      const links = 22;
      for (let i = 0; i < links; i++) {
        const a = (i / links) * Math.PI * 1.7 - Math.PI * 0.85;
        // Alternating link orientation for realism
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.009, 12, 16), gold);
        link.position.set(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0);
        link.rotation.y = i % 2 === 0 ? 0 : Math.PI / 2;
        g.add(link);
      }
      // Heart charm
      const heartShape = new THREE.Shape();
      heartShape.moveTo(0, 0);
      heartShape.bezierCurveTo(0, -0.07, -0.12, -0.12, -0.12, -0.04);
      heartShape.bezierCurveTo(-0.12, 0.03, 0, 0.08, 0, 0.12);
      heartShape.bezierCurveTo(0, 0.08, 0.12, 0.03, 0.12, -0.04);
      heartShape.bezierCurveTo(0.12, -0.12, 0, -0.07, 0, 0);
      const heartGeo = new THREE.ExtrudeGeometry(heartShape, {
        depth: 0.025, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.006, bevelSegments: 4,
      });
      const charm = new THREE.Mesh(heartGeo, roseGold);
      charm.position.set(0, -0.48, -0.012);
      charm.scale.set(0.9, 0.9, 0.9);
      g.add(charm);
      // Tiny diamond on heart
      const heartGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.018, 1), diamond);
      heartGem.position.set(0, -0.44, 0.02);
      g.add(heartGem);
      // Bail connecting charm to chain
      const bail = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 10, 12), gold);
      bail.position.set(0, -0.38, 0);
      bail.rotation.x = Math.PI / 2;
      g.add(bail);

      createPiece(g, [-1.0, -1.0, 0.2], [0.4, -0.4, 0.3], [0.002, -0.004, 0.002], 1.15, 0.12);
    }

    // ═══════════════════════════════════════
    // 8. DROP EARRING — cascading rubies
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      // Top stud — circular
      const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 24), gold);
      g.add(stud);
      const studGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 1), ruby);
      studGem.position.set(0, 0.015, 0);
      studGem.scale.set(1, 1.2, 1);
      g.add(studGem);
      // Earring post
      const earPost = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 8), gold);
      earPost.position.set(0, 0.18, 0);
      g.add(earPost);
      // Three drops with decreasing size
      const drops = [
        { y: -0.12, size: 0.05 },
        { y: -0.28, size: 0.06 },
        { y: -0.46, size: 0.07 },
      ];
      for (const drop of drops) {
        // Chain link
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.1, 6), gold);
        chain.position.set(0, drop.y + 0.06, 0);
        g.add(chain);
        // Gold cap
        const dropCap = new THREE.Mesh(new THREE.ConeGeometry(drop.size * 0.5, drop.size * 0.4, 12), gold);
        dropCap.position.set(0, drop.y + 0.01, 0);
        dropCap.rotation.x = Math.PI;
        g.add(dropCap);
        // Ruby teardrop (scaled sphere)
        const rubyDrop = new THREE.Mesh(new THREE.SphereGeometry(drop.size, 24, 24), ruby);
        rubyDrop.position.set(0, drop.y - drop.size * 0.3, 0);
        rubyDrop.scale.set(0.7, 1.2, 0.7);
        g.add(rubyDrop);
      }

      createPiece(g, [0.8, 1.2, 0.4], [-0.1, 0.7, 0.15], [-0.002, 0.005, 0.001], 0.95, 0.14);
    }

    // ═══════════════════════════════════════
    // 9. TWISTED DOUBLE RING — two intertwined bands
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 32, 64), gold);
      ring1.rotation.x = 0.3;
      g.add(ring1);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 32, 64), roseGold);
      ring2.rotation.x = -0.3;
      g.add(ring2);
      // Diamond at intersection point
      const meetGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 1), diamond);
      meetGem.position.set(0, 0.4, 0);
      meetGem.scale.set(1, 1.3, 1);
      g.add(meetGem);
      // Small accent gems along each band
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 0.6 - Math.PI * 0.15;
        const accent = new THREE.Mesh(new THREE.OctahedronGeometry(0.015, 0), diamond);
        accent.position.set(Math.sin(a + 0.3) * 0.4, Math.cos(a + 0.3) * 0.4, 0.04);
        g.add(accent);
      }

      createPiece(g, [-2.2, -0.5, -0.2], [0.5, 0.8, 0.1], [0.003, 0.003, -0.001], 0.78, 0.15);
    }

    // ═══════════════════════════════════════
    // 10. LAYERED PENDANT NECKLACE — three chains + charms
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      // Three chain arcs at different lengths
      const chains = [
        { radius: 0.5, numLinks: 12, y: 0, gemMat: diamond, gemSize: 0.04 },
        { radius: 0.65, numLinks: 16, y: -0.1, gemMat: sapphire, gemSize: 0.035 },
        { radius: 0.8, numLinks: 20, y: -0.2, gemMat: emerald, gemSize: 0.04 },
      ];
      for (const chain of chains) {
        for (let i = 0; i < chain.numLinks; i++) {
          const t = (i / (chain.numLinks - 1)) * Math.PI;
          const x = Math.cos(t) * chain.radius;
          const y = chain.y + Math.sin(t) * 0.15;
          const link = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 8, 12), silver);
          link.position.set(x, y, 0);
          link.rotation.y = i % 2 === 0 ? 0 : Math.PI / 2;
          g.add(link);
        }
        // Pendant at center bottom
        const pendantMount = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.04, 8), silver);
        pendantMount.position.set(0, chain.y - Math.abs(chain.radius) * 0.02 - 0.02, 0);
        pendantMount.rotation.x = Math.PI;
        g.add(pendantMount);
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(chain.gemSize, 1), chain.gemMat);
        gem.position.set(0, chain.y - Math.abs(chain.radius) * 0.02 - 0.07, 0);
        gem.scale.set(0.8, 1.3, 0.8);
        g.add(gem);
      }

      createPiece(g, [-0.3, 0.0, 1.0], [0.2, 0, 0.1], [0.001, 0.004, -0.001], 0.7, 0.18);
    }

    // ═══════════════════════════════════════
    // 11. TORUS KNOT — polished gold decorative piece
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.3, 0.045, 200, 24, 2, 3), polishedGold);
      g.add(knot);
      // Tiny gems at knot crossover points
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const gem = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 16), diamond);
        gem.position.set(Math.cos(a) * 0.25, Math.sin(a) * 0.25, 0.05);
        g.add(gem);
      }

      createPiece(g, [2.5, 1.2, -0.5], [0.6, 1.0, 0], [0.002, 0.003, -0.001], 0.72, 0.11);
    }

    // ═══════════════════════════════════════
    // 12. STUD EARRING — halo sapphire
    // ═══════════════════════════════════════
    {
      const g = new THREE.Group();
      // Base
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.02, 32), platinum);
      g.add(base);
      // Center sapphire
      const saphCenter = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 2), sapphire);
      saphCenter.position.set(0, 0.06, 0);
      saphCenter.scale.set(1, 1.4, 1);
      g.add(saphCenter);
      // Diamond halo
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const hd = new THREE.Mesh(new THREE.OctahedronGeometry(0.02, 1), diamond);
        hd.position.set(Math.cos(a) * 0.08, 0.03, Math.sin(a) * 0.08);
        g.add(hd);
      }
      // 8 prongs
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.08, 6), platinum);
        p.position.set(Math.cos(a) * 0.06, 0.04, Math.sin(a) * 0.06);
        p.rotation.x = Math.sin(a) * 0.15;
        p.rotation.z = -Math.cos(a) * 0.15;
        g.add(p);
      }
      // Post
      const sPost = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 8), platinum);
      sPost.position.set(0, -0.16, 0);
      g.add(sPost);

      createPiece(g, [-1.5, -1.3, 0.5], [0.9, 0.3, -0.2], [0.003, -0.002, 0.004], 1.25, 0.09);
    }

    // ═══════════════════════════════════════
    // 13. FLOATING LOOSE DIAMONDS (3 scattered)
    // ═══════════════════════════════════════
    {
      const positions3: [number, number, number][] = [
        [1.0, 0.2, 1.2],
        [-0.5, -0.3, 1.5],
        [0.3, 1.8, 0.2],
      ];
      const sizes = [0.12, 0.08, 0.1];
      for (let i = 0; i < 3; i++) {
        const g = new THREE.Group();
        const d = new THREE.Mesh(new THREE.OctahedronGeometry(sizes[i], 2), diamond);
        d.scale.set(1, 1.4, 1);
        g.add(d);
        createPiece(g, positions3[i],
          [Math.random() * 2, Math.random() * 2, Math.random()],
          [0.005 + Math.random() * 0.003, 0.008, 0.002],
          1.0 + Math.random() * 0.5, 0.08 + Math.random() * 0.1,
        );
      }
    }

    // ── Sparkle particles ──
    const particleCount = 150;
    const particleGeometry = new THREE.BufferGeometry();
    const pPositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      pPositions[i * 3]     = (Math.random() - 0.5) * 12;
      pPositions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      pPositions[i * 3 + 2] = (Math.random() - 0.5) * 6;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xffd700, size: 0.02, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // ── Raycaster ──
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(9999, 9999);

    function onPointerMove(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }
    function onPointerLeave() { mouse.set(9999, 9999); }

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    // ── Animation ──
    const clock = new THREE.Clock();
    let prevHovered: JewelryPiece | null = null;

    function animate() {
      animRef.current = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const dt = Math.min(clock.getDelta(), 0.05);

      // Raycast
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(allInteractMeshes, false);
      let hoveredPiece: JewelryPiece | null = null;
      if (intersects.length > 0) {
        const hitMesh = intersects[0].object as THREE.Mesh;
        hoveredPiece = pieces.find((p) => p.meshes.includes(hitMesh)) ?? null;
      }

      if (prevHovered && prevHovered !== hoveredPiece) prevHovered.hovered = false;
      if (hoveredPiece && !hoveredPiece.hovered) {
        hoveredPiece.hovered = true;
        hoveredPiece.velocity.add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 2.5,
            (Math.random() - 0.5) * 2.5,
            (Math.random() - 0.3) * 1.5,
          ).normalize().multiplyScalar(2.0),
        );
        hoveredPiece.angularVelocity.set(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
        );
      }
      prevHovered = hoveredPiece;

      // Physics
      for (const p of pieces) {
        const spring = new THREE.Vector3().copy(p.basePos).sub(p.group.position).multiplyScalar(2.0);
        p.velocity.add(spring.multiplyScalar(dt));
        p.velocity.multiplyScalar(0.95);
        p.angularVelocity.multiplyScalar(0.96);
        p.group.position.add(p.velocity.clone().multiplyScalar(dt));
        p.group.position.y += Math.sin(t * p.floatSpeed) * p.floatAmp * 0.03;
        p.group.rotation.x += p.rotSpeed.x + p.angularVelocity.x * dt;
        p.group.rotation.y += p.rotSpeed.y + p.angularVelocity.y * dt;
        p.group.rotation.z += p.rotSpeed.z + p.angularVelocity.z * dt;
      }

      // Particles
      const pos = particles.geometry.attributes.position;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        arr[i * 3 + 1] += Math.sin(t * 0.35 + i) * 0.0006;
        arr[i * 3]     += Math.cos(t * 0.2 + i * 0.5) * 0.0003;
      }
      pos.needsUpdate = true;
      particleMaterial.opacity = 0.3 + Math.sin(t * 0.5) * 0.15;

      // Camera
      camera.position.x = Math.sin(t * 0.1) * 0.2;
      camera.position.y = Math.cos(t * 0.07) * 0.12;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    }

    animate();

    function handleResize() {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    }
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      cancelAnimationFrame(animRef.current);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      scene.traverse((obj) => { if (obj instanceof THREE.Mesh) obj.geometry.dispose(); });
      particleGeometry.dispose();
      particleMaterial.dispose();
      for (const m of allMaterials) m.dispose();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
}
