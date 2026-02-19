// FILE: components/MiniCampoInline.tsx
"use client";

import React, { type CSSProperties } from "react";

export const miniInlineInputStyle: CSSProperties = {
  width: "100%",
  border: "none",
  outline: "none",
  background: "transparent",
  color: "var(--gp-text)",
  fontSize: 14,
  fontWeight: 800,
};

export const miniInlineSelectStyle: CSSProperties = {
  ...miniInlineInputStyle,
  appearance: "none",
};

type MiniCampoInlineProps = {
  label: string;
  children: React.ReactNode;
  style?: CSSProperties;
};

export function MiniCampoInline({ label, children, style }: MiniCampoInlineProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px solid #e5e7eb",
        background: "#ffffff",
        boxShadow: "0 10px 28px rgba(2, 6, 23, 0.06)",
        minWidth: 0,
        ...style,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 900,
          color: "var(--gp-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.10em",
          whiteSpace: "nowrap",
          opacity: 0.9,
        }}
      >
        {label}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
