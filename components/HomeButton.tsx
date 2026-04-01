// FILE: components/HomeButton.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function HomeButton() {
  const pathname = usePathname();
  if (pathname === "/home") return null;

  return (
    <>
      <style>{`
        .home-btn {
          position: fixed;
          bottom: 24px;
          left: 24px;
          z-index: 9999;
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 9px 14px 9px 10px;
          border-radius: 999px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 4px 16px rgba(15,23,42,0.12);
          font-family: system-ui, sans-serif;
          font-size: 0.8rem;
          font-weight: 600;
          color: #111827;
          text-decoration: none;
          transition: box-shadow 0.15s, transform 0.15s;
        }
        .home-btn:hover {
          box-shadow: 0 8px 24px rgba(15,23,42,0.18);
          transform: translateY(-1px);
        }
        .home-btn:active {
          transform: translateY(0);
        }
        .home-btn .material-symbols-outlined {
          font-size: 17px;
          color: #ff4b2b;
        }
      `}</style>
      <Link href="/home" className="home-btn">
        <span className="material-symbols-outlined">apps</span>
        Início
      </Link>
    </>
  );
}
