"use client";

import { useRef, useState, useEffect, type ReactNode } from "react";

const TAB_ORDER = ["produits", "categories", "couleurs", "compositions", "pays", "saisons", "tailles", "mots-cles"];

interface TabDef {
  key: string;
  content: ReactNode;
}

interface Props {
  activeTab: string;
  tabs: TabDef[];
}

export default function TabSlideWrapper({ activeTab, tabs }: Props) {
  const prevTabRef = useRef(activeTab);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [animCounter, setAnimCounter] = useState(0);

  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      const prevIdx = TAB_ORDER.indexOf(prevTabRef.current);
      const nextIdx = TAB_ORDER.indexOf(activeTab);
      setDirection(nextIdx > prevIdx ? "left" : "right");
      setAnimCounter((c) => c + 1);
      prevTabRef.current = activeTab;
    }
  }, [activeTab]);

  const animClass =
    direction === "left"
      ? "animate-[slide-in-right_0.3s_ease-out]"
      : direction === "right"
        ? "animate-[slide-in-left_0.3s_ease-out]"
        : "";

  return (
    <div className="overflow-hidden">
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        if (!isActive) {
          return <div key={tab.key} className="hidden">{tab.content}</div>;
        }
        return (
          <div key={`${tab.key}-${animCounter}`} className={animClass}>
            {tab.content}
          </div>
        );
      })}
    </div>
  );
}
