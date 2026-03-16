"use client";
import dynamic from "next/dynamic";

const DashboardParticles = dynamic(() => import("./DashboardParticles"), { ssr: false });

export default function DashboardParticlesLoader() {
  return <DashboardParticles />;
}
