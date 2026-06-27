"use client";

import { ComingSoon } from "../ui/coming-soon";

export default function VendorsPage() {
  return (
    <ComingSoon
      module="vendors"
      title="Vendor Management"
      subtitle="A roll-up per trade for additional scope, contacts, door codes, and the terms & conditions that govern each trade relationship."
      features={[
        "Per-trade roll-up for additional scope beyond the room matrix",
        "Phone & email per trade",
        "Trade contact list with owner-assigned door codes",
        "Terms & conditions: change-request policy, good-faith negotiation",
        "Explicit no-lien agreement per trade",
        "Links back to contracts in Building Costs",
      ]}
      note="Door codes are already assignable today in Administrative → Users. Your 'Rennovation Team' contacts (Oasis, Lakeside Plumbing, Diverse Windows, masons, designers) will seed this directory."
    />
  );
}
