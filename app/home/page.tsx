// FILE: app/home/page.tsx
"use client";

import Link from "next/link";

type PageCard = {
  href: string;
  icon: string;
  title: string;
  description: string;
};

type Group = {
  label: string;
  icon: string;
  accent: string;
  pages: PageCard[];
};

const GROUPS: Group[] = [
  {
    label: "Operacional",
    icon: "engineering",
    accent: "#ff4b2b",
    pages: [
      {
        href: "/horimetros",
        icon: "timer",
        title: "Horímetros",
        description: "Lançar horas trabalhadas por equipamento no dia",
      },
      {
        href: "/sigasul",
        icon: "location_on",
        title: "GPS — Frota",
        description: "Monitorar posição e status da frota em tempo real",
      },
      {
        href: "/diesel/novo",
        icon: "local_gas_station",
        title: "Abastecimento Diesel",
        description: "Registrar novo abastecimento com comprovante",
      },
    ],
  },
  {
    label: "Refeições",
    icon: "restaurant",
    accent: "#0ea5e9",
    pages: [
      {
        href: "/refeicoes",
        icon: "restaurant_menu",
        title: "Pedidos — Encarregado",
        description: "Solicitar refeições da obra por turno",
      },
      {
        href: "/refeicoes/restaurante",
        icon: "storefront",
        title: "Portal Restaurante",
        description: "Confirmar e gerenciar pedidos recebidos",
      },
      {
        href: "/refeicoes/historico",
        icon: "history",
        title: "Histórico",
        description: "Consultar e exportar histórico de refeições",
      },
    ],
  },
  {
    label: "Materiais",
    icon: "inventory_2",
    accent: "#16a34a",
    pages: [
      {
        href: "/material/dashboard",
        icon: "bar_chart",
        title: "Dashboard Materiais",
        description: "Consumo e saldo de agregados — GPA Engenharia",
      },
      {
        href: "/material/novo",
        icon: "document_scanner",
        title: "Lançar Ticket",
        description: "Registrar entrada ou saída de material via OCR",
      },
    ],
  },
  {
    label: "Compras",
    icon: "shopping_cart",
    accent: "#7c3aed",
    pages: [
      {
        href: "/oc",
        icon: "receipt_long",
        title: "Registrar OC",
        description: "Criar Ordem de Compra padronizada para WhatsApp",
      },
      {
        href: "/equipamentos",
        icon: "construction",
        title: "Compras — Equipamentos",
        description: "Histórico de manutenção e compras por equipamento",
      },
    ],
  },
  {
    label: "Financeiro",
    icon: "account_balance",
    accent: "#b45309",
    pages: [
      {
        href: "/financeiro/pdf-nf",
        icon: "picture_as_pdf",
        title: "OCR NF-e",
        description: "Ler DANFE via Gemini e lançar título no Sienge",
      },
      {
        href: "/financeiro/credores",
        icon: "contacts",
        title: "Credores",
        description: "Gerenciar e pesquisar cadastro de credores",
      },
    ],
  },
  {
    label: "Análise",
    icon: "analytics",
    accent: "#475569",
    pages: [
      {
        href: "/",
        icon: "price_change",
        title: "Custos de Equipamentos",
        description: "Comparativo GP vs GOINFRA por equipamento e período",
      },
      {
        href: "/horimetros/relatorios",
        icon: "monitoring",
        title: "Relatórios — Horímetros",
        description: "Analytics de horas: tendências, ranking e evolução",
      },
      {
        href: "/horimetros/relatorio-diario",
        icon: "today",
        title: "Relatório Diário",
        description: "Visão consolidada da operação do dia corrente",
      },
    ],
  },
];

export default function HomeDashboard() {
  return (
    <>
      <style>{`
        .hub-root {
          min-height: 100vh;
          background: var(--gp-bg);
          padding: 32px 20px 80px;
        }
        .hub-inner {
          max-width: 1100px;
          margin: 0 auto;
        }
        .hub-header {
          display: flex;
          align-items: center;
          gap: 14px;
          padding-bottom: 28px;
          border-bottom: 1px solid #e5e7eb;
          margin-bottom: 36px;
        }
        .hub-logo {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          background: #fff;
          object-fit: contain;
          padding: 4px;
        }
        .hub-title {
          font-size: 1.15rem;
          font-weight: 600;
          color: var(--gp-text);
          letter-spacing: -0.02em;
          line-height: 1.2;
        }
        .hub-subtitle {
          font-size: 0.75rem;
          color: var(--gp-muted-soft);
          margin-top: 2px;
        }
        .hub-groups {
          display: flex;
          flex-direction: column;
          gap: 36px;
        }
        .hub-group-label {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 14px;
        }
        .hub-group-icon {
          font-size: 18px;
          line-height: 1;
        }
        .hub-group-name {
          font-size: 0.72rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--gp-muted);
        }
        .hub-group-divider {
          flex: 1;
          height: 1px;
          background: #e5e7eb;
        }
        .hub-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 12px;
        }
        .hub-card {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 16px;
          border-radius: 14px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 1px 4px rgba(15,23,42,0.05);
          text-decoration: none;
          color: inherit;
          transition: box-shadow 0.15s, transform 0.15s, border-color 0.15s;
        }
        .hub-card:hover {
          box-shadow: 0 6px 20px rgba(15,23,42,0.1);
          transform: translateY(-2px);
          border-color: #d1d5db;
        }
        .hub-card:active {
          transform: translateY(0);
        }
        .hub-card-icon-wrap {
          flex-shrink: 0;
          width: 38px;
          height: 38px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .hub-card-icon-wrap .material-symbols-outlined {
          font-size: 20px;
        }
        .hub-card-body {
          flex: 1;
          min-width: 0;
        }
        .hub-card-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--gp-text);
          margin-bottom: 3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .hub-card-desc {
          font-size: 0.75rem;
          color: var(--gp-muted);
          line-height: 1.4;
        }
        @media (max-width: 480px) {
          .hub-cards {
            grid-template-columns: 1fr;
          }
          .hub-root {
            padding: 20px 14px 80px;
          }
        }
      `}</style>

      <div className="hub-root">
        <div className="hub-inner">

          <div className="hub-header">
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" className="hub-logo" />
            <div>
              <div className="hub-title">GP Asfalto</div>
              <div className="hub-subtitle">Painel de aplicações internas</div>
            </div>
          </div>

          <div className="hub-groups">
            {GROUPS.map((group) => (
              <div key={group.label}>
                <div className="hub-group-label">
                  <span
                    className="material-symbols-outlined hub-group-icon"
                    style={{ color: group.accent }}
                  >
                    {group.icon}
                  </span>
                  <span className="hub-group-name">{group.label}</span>
                  <div className="hub-group-divider" />
                </div>

                <div className="hub-cards">
                  {group.pages.map((page) => (
                    <Link key={page.href} href={page.href} className="hub-card">
                      <div
                        className="hub-card-icon-wrap"
                        style={{ background: group.accent + "18" }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ color: group.accent }}
                        >
                          {page.icon}
                        </span>
                      </div>
                      <div className="hub-card-body">
                        <div className="hub-card-title">{page.title}</div>
                        <div className="hub-card-desc">{page.description}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </>
  );
}
