"use client";

import { ComingSoon } from "../ui/coming-soon";

export default function MaterialsPage() {
  return (
    <ComingSoon
      module="materials"
      title="Materials"
      subtitle="Every material, sortable by room, trade, or category — with critical-path selection due dates, spec links, purchase status, and storage location."
      features={[
        "Sort/filter by room, trade, or category",
        "Critical-path selection due date per material",
        "Spec / product link, purchased status, storage location",
        "Required volume (e.g. 36 receptacles) with bulk assignment",
        "Assign who purchases: owner vs trade vs builder",
        "✨ AI: find the exact product for the cheapest price",
        "Review local & federal rebates / tax incentives for products",
      ]}
      note="Your spreadsheet's Materials tab (Primary Bath, Kids Bath, Kitchen, Basement breakers, smoke detectors, windows, spec links, 'InGarage' storage) is captured and ready to import here."
    />
  );
}
