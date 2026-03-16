"use client";

import dynamic from "next/dynamic";

const JewelryScene = dynamic(() => import("./JewelryScene"), { ssr: false });

export default function JewelrySceneLoader() {
  return <JewelryScene />;
}
