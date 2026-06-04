import * as XLSX from "xlsx";
import type {
  ComputedStep,
  DashboardType,
  CampaignCostSummary,
} from "./types";
import { compactStepLabel } from "./types";

// jsPDF + helvetica encode en WinAnsi → U+2192 "→" devient garbage ("!'").
// On remplace par "–" (en-dash, U+2013) qui est dans cp1252.
const DASH = "–";

function fileSafeName(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tableau"
  );
}

function pct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

/**
 * Exporte le tableau d'un dashboard en .xlsx. Format adapté au type :
 *
 *   - funnel : colonnes [Étape, Volume, Conv. vs précédent, Conv. vs étape 1]
 *              + sources indentées sous chaque étape qui cumule plusieurs refs.
 *   - pie    : colonnes [Part, Volume, % du total] + sources indentées de la
 *              même façon, et ligne « Total » en pied de tableau.
 */
export function exportFunnelToExcel(args: {
  dashboardName: string;
  fromDate: string;
  toDate: string;
  steps: ComputedStep[];
  type?: DashboardType;
  campaignSummary?: CampaignCostSummary | null;
}) {
  const {
    dashboardName,
    fromDate,
    toDate,
    steps,
    type = "funnel",
    campaignSummary = null,
  } = args;
  const rows: Array<Array<string | number>> = [];

  rows.push(["Tableau", dashboardName]);
  rows.push(["Période", `${fromDate} → ${toDate}`]);
  rows.push(["Exporté le", new Date().toLocaleString("fr-FR")]);
  rows.push([]);

  if (type === "pie") {
    const total = steps.reduce(
      (acc, s) => (s.available ? acc + s.count : acc),
      0
    );
    rows.push(["Part", "Volume", "% du total"]);
    steps.forEach((s, i) => {
      const label = `${i + 1}. ${compactStepLabel(s)}${
        !s.available ? " (indisponible)" : ""
      }`;
      const share = s.available && total > 0 ? pct(s.count, total) : "—";
      rows.push([label, s.count, share]);
      if (s.refs.length > 1) {
        s.refs.forEach((r) => {
          rows.push([
            `    · ${r.label}${!r.available ? " (indisponible)" : ""}`,
            r.count,
            "",
          ]);
        });
      }
    });
    rows.push(["Total", total, "100,0%"]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 50 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pie chart");
    XLSX.writeFile(wb, `${fileSafeName(dashboardName)}.xlsx`);
    return;
  }

  // Funnel (défaut). Le step "Échec" synthétique est sorti du flux principal :
  // son volume est ajouté en sous-ligne du Lancement (cohérent avec l'UI table).
  const failedStep = steps.find((s) => s.synth_role === "failed") ?? null;
  const visibleSteps = steps.filter((s) => s.synth_role !== "failed");
  const first = visibleSteps[0]?.count ?? 0;
  // Substitue le coût NET (lancement − failed) au brut pour le step Lancement
  // quand la campagne a un failed configuré. Aligne le tableau avec la
  // synthèse "COÛT NET META" en haut du builder.
  const useNetForLaunch =
    campaignSummary !== null && campaignSummary.failed !== null;
  const stepCost = (s: ComputedStep): number | null => {
    if (useNetForLaunch && s.synth_role === "launch") {
      return campaignSummary?.net_cost_eur ?? null;
    }
    return s.meta_cost_eur ?? null;
  };
  const hasMetaCost = visibleSteps.some((s) => {
    const c = stepCost(s);
    return c != null && c > 0;
  });
  const totalMetaCost = hasMetaCost
    ? visibleSteps.reduce((acc, s) => acc + (stepCost(s) ?? 0), 0)
    : 0;

  const header: Array<string | number> = [
    "Étape",
    "Volume",
    "Conv. vs précédent",
    "Conv. vs étape 1",
  ];
  if (hasMetaCost) header.push("Coût Meta (EUR)");
  rows.push(header);

  visibleSteps.forEach((s, i) => {
    const prev = i === 0 ? null : visibleSteps[i - 1].count;
    const convPrev =
      prev !== null && prev > 0 ? pct(s.count, prev) : i === 0 ? "—" : "—";
    const convFirst =
      i === 0 ? "—" : first > 0 ? pct(s.count, first) : "—";
    const label = `${i + 1}. ${compactStepLabel(s)}${
      !s.available ? " (indisponible)" : ""
    }`;
    const row: Array<string | number> = [label, s.count, convPrev, convFirst];
    if (hasMetaCost) {
      const c = stepCost(s);
      row.push(c != null ? Number(c.toFixed(4)) : "");
    }
    rows.push(row);

    // Sous-lignes "failed" + "envois réussis" sous le step Lancement.
    if (s.synth_role === "launch" && failedStep && failedStep.available) {
      const failedLabel = failedStep.label.replace(/^Échec\s*:\s*/, "");
      const failedRow: Array<string | number> = [
        `    − ${failedLabel} (failed WhatsApp)`,
        failedStep.count,
        s.count > 0
          ? `${((failedStep.count / s.count) * 100).toFixed(1)}%`
          : "",
        "",
      ];
      if (hasMetaCost) failedRow.push("");
      rows.push(failedRow);
      const netRow: Array<string | number> = [
        `    = Envois réussis (net)`,
        s.count - failedStep.count,
        "",
        "",
      ];
      if (hasMetaCost) netRow.push("");
      rows.push(netRow);
    }

    if (s.refs.length > 1) {
      s.refs.forEach((r) => {
        const subRow: Array<string | number> = [
          `    · ${r.label}${!r.available ? " (indisponible)" : ""}`,
          r.count,
          "",
          "",
        ];
        if (hasMetaCost) {
          subRow.push(r.meta_cost_eur != null ? Number(r.meta_cost_eur.toFixed(4)) : "");
        }
        rows.push(subRow);
      });
    }
  });

  if (hasMetaCost) {
    rows.push(["Total coût Meta", "", "", "", Number(totalMetaCost.toFixed(2))]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Largeurs de colonne raisonnables
  ws["!cols"] = hasMetaCost
    ? [{ wch: 50 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 16 }]
    : [{ wch: 50 }, { wch: 12 }, { wch: 18 }, { wch: 18 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Funnel");
  XLSX.writeFile(wb, `${fileSafeName(dashboardName)}.xlsx`);
}

/**
 * Capture le DOM de l'élément (chart + tableau) en image puis l'incorpore
 * dans un PDF A4 paysage avec un titre. Utilise `html-to-image` qui gère
 * les couleurs Tailwind v4 en `oklch()` (`html2canvas` ne sait pas les
 * parser). Libs chargées à la demande (`import()`).
 */
export async function exportFunnelToPDF(args: {
  element: HTMLElement;
  dashboardName: string;
  fromDate: string;
  toDate: string;
}) {
  const { element, dashboardName, fromDate, toDate } = args;

  const [{ toPng }, { default: jsPDF }] = await Promise.all([
    import("html-to-image"),
    import("jspdf"),
  ]);

  // L'overflow horizontal dans la sous-arbre (notamment le wrapper
  // `<div class="overflow-x-auto">` autour du tableau funnel) tronque
  // la capture html-to-image à la zone visible. Avant la capture, on
  // neutralise tous les overflow + on note les scrollWidth max pour
  // dimensionner la capture, puis on restore l'état DOM.
  const restoreFns: Array<() => void> = [];
  const setStyle = (
    el: HTMLElement,
    prop: keyof CSSStyleDeclaration,
    value: string
  ) => {
    const prev = (el.style[prop] as string | undefined) ?? "";
    (el.style[prop] as string) = value;
    restoreFns.push(() => {
      (el.style[prop] as string) = prev;
    });
  };

  // 1. Neutralise tous les overflow descendants (table wrapper inclus).
  const allEls = Array.from(
    element.querySelectorAll<HTMLElement>("*")
  );
  for (const el of allEls) {
    const cs = window.getComputedStyle(el);
    if (
      cs.overflow !== "visible" ||
      cs.overflowX !== "visible" ||
      cs.overflowY !== "visible"
    ) {
      setStyle(el, "overflow", "visible");
      setStyle(el, "overflowX", "visible");
      setStyle(el, "overflowY", "visible");
    }
  }

  // 2. Mesure la largeur "réelle" maintenant que les scroll containers
  //    sont libérés : le scrollWidth max de tout descendant donne la
  //    largeur de contenu finale qu'on veut capturer.
  let widestContent = element.scrollWidth;
  for (const el of allEls) {
    if (el.scrollWidth > widestContent) widestContent = el.scrollWidth;
  }
  const fullWidth = Math.max(widestContent, element.clientWidth);

  // 3. Force la root à occuper toute la largeur de contenu pour que le
  //    clone ne se reflow pas plus étroitement.
  setStyle(element, "width", `${fullWidth}px`);
  setStyle(element, "maxWidth", "none");
  // Laisse le navigateur recalculer le layout avec les overrides ci-dessus.
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  const fullHeight = Math.max(element.scrollHeight, element.clientHeight);

  let dataUrl: string;
  try {
    dataUrl = await toPng(element, {
      backgroundColor: "#ffffff",
      pixelRatio: 2,
      cacheBust: true,
      width: fullWidth,
      height: fullHeight,
      canvasWidth: fullWidth,
      canvasHeight: fullHeight,
      style: {
        overflow: "visible",
        width: `${fullWidth}px`,
        maxWidth: "none",
      },
    });
  } finally {
    // Restore le DOM dans son état initial (ordre inverse important).
    for (let i = restoreFns.length - 1; i >= 0; i--) restoreFns[i]();
  }

  // Récupère les dimensions natives de l'image pour calculer le ratio.
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 32;

  pdf.setFontSize(18);
  pdf.setFont("helvetica", "bold");
  pdf.text(dashboardName, margin, margin + 8);

  pdf.setFontSize(10);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(120);
  pdf.text(
    `Période : ${fromDate} ${DASH} ${toDate}   ·   Exporté le ${new Date().toLocaleString("fr-FR")}`,
    margin,
    margin + 26
  );
  pdf.setTextColor(0);

  const availWidth = pageWidth - margin * 2;
  const availHeight = pageHeight - margin * 2 - 48;
  const ratio = img.height / img.width;
  let drawWidth = availWidth;
  let drawHeight = drawWidth * ratio;
  if (drawHeight > availHeight) {
    drawHeight = availHeight;
    drawWidth = drawHeight / ratio;
  }
  pdf.addImage(dataUrl, "PNG", margin, margin + 48, drawWidth, drawHeight);

  pdf.save(`${fileSafeName(dashboardName)}.pdf`);
}
