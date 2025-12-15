async function buildComprovantePNG(args: {
  dateLabel: string;
  solicitante: string;
  equipamento: string;
  horimetroLabel: string;
  odometroLabel: string;
  litrosLabel: string;
  fotos: Array<{ label: string; file: File }>;
}): Promise<Blob> {
  const W = 1400;
  const H = 1050;

  const generatedAt = new Date();
  const generatedAtLabel = generatedAt.toLocaleString("pt-BR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");

  // Helpers
  function roundRectPath(x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawCard(x: number, y: number, w: number, h: number) {
    ctx.save();
    ctx.shadowColor = "rgba(15, 23, 42, 0.08)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;

    ctx.fillStyle = "#ffffff";
    roundRectPath(x, y, w, h, 18);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    roundRectPath(x, y, w, h, 18);
    ctx.stroke();
  }

  function drawPill(text: string, x: number, y: number) {
    ctx.save();
    ctx.font =
      "700 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const m = ctx.measureText(text);
    const padX = 12;
    const w = Math.ceil(m.width + padX * 2);
    const h = 34;

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    roundRectPath(x, y, w, h, 999);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.fillText(text, x + padX, y + 24);
    ctx.restore();
  }

  function drawTextFit(text: string, x: number, y: number, maxW: number, fontSizes: number[], weight = 800) {
    for (const size of fontSizes) {
      ctx.font = `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      if (ctx.measureText(text).width <= maxW) {
        ctx.fillText(text, x, y);
        return;
      }
    }
    // último recurso: desenha mesmo assim
    ctx.font = `${weight} ${fontSizes[fontSizes.length - 1]}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillText(text, x, y);
  }

  // Fundo página
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(0, 0, W, H);

  const pad = 44;

  // Card principal
  const mainX = pad;
  const mainY = pad;
  const mainW = W - pad * 2;
  const mainH = H - pad * 2;
  drawCard(mainX, mainY, mainW, mainH);

  // ===== Header (espaçamento melhor) =====
  const leftX = mainX + 36;

  const titleY = mainY + 78;
  const dateY = titleY + 46;
  const equipY = dateY + 60;
  const solicitY = equipY + 44;

  ctx.fillStyle = "#0b1220";
  ctx.font =
    "800 44px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("ABASTECIMENTO • DIESEL", leftX, titleY);

  ctx.fillStyle = "#334155";
  ctx.font =
    "600 26px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Data: ${args.dateLabel}`, leftX, dateY);

  ctx.fillStyle = "#0f172a";
  // ajusta tamanho se nome do equipamento for grande
  drawTextFit(
    `Equipamento: ${args.equipamento}`,
    leftX,
    equipY,
    mainW - 36 - 560, // espaço reservado pro box à direita
    [34, 32, 30, 28],
    800
  );

  ctx.fillStyle = "#334155";
  ctx.font =
    "700 26px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  drawTextFit(
    `Solicitante: ${args.solicitante}`,
    leftX,
    solicitY,
    mainW - 36 - 560,
    [26, 24, 22],
    700
  );

  // Box KPI à direita (alinhado e com mais respiro)
  const kpiW = 520;
  const kpiH = 178;
  const kpiX = mainX + mainW - 36 - kpiW;
  const kpiY = mainY + 104;

  ctx.fillStyle = "#eef2f7";
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 2;
  roundRectPath(kpiX, kpiY, kpiW, kpiH, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.font =
    "800 34px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Litros: ${args.litrosLabel}`, kpiX + 28, kpiY + 66);

  ctx.fillStyle = "#334155";
  ctx.font =
    "700 24px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Horímetro: ${args.horimetroLabel}`, kpiX + 28, kpiY + 114);
  ctx.fillText(`Odômetro: ${args.odometroLabel}`, kpiX + 28, kpiY + 148);

  // divisor sutil (separa header das fotos)
  const headerBottom = mainY + 300;
  ctx.strokeStyle = "#eef2f7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mainX + 24, headerBottom);
  ctx.lineTo(mainX + mainW - 24, headerBottom);
  ctx.stroke();

  // ===== Fotos =====
  const photosTop = headerBottom + 22;
  const photosX = mainX + 26;
  const photosW = mainW - 52;
  const footerH = 64;
  const photosH = mainY + mainH - footerH - photosTop;
  const gap = 18;

  const cellW = Math.floor((photosW - gap) / 2);
  const cellH = Math.floor((photosH - gap) / 2);

  const slots = [
    { x: photosX, y: photosTop, label: args.fotos[0].label, file: args.fotos[0].file },
    { x: photosX + cellW + gap, y: photosTop, label: args.fotos[1].label, file: args.fotos[1].file },
    { x: photosX, y: photosTop + cellH + gap, label: args.fotos[2].label, file: args.fotos[2].file },
    { x: photosX + cellW + gap, y: photosTop + cellH + gap, label: args.fotos[3].label, file: args.fotos[3].file },
  ];

  const urlsToRevoke: string[] = [];

  for (const s of slots) {
    // card da foto
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    roundRectPath(s.x, s.y, cellW, cellH, 18);
    ctx.fill();
    ctx.stroke();

    // fundo interno suave
    ctx.fillStyle = "#f8fafc";
    roundRectPath(s.x + 10, s.y + 10, cellW - 20, cellH - 20, 14);
    ctx.fill();

    // label pill dentro
    drawPill(s.label, s.x + 18, s.y + 18);

    // imagem contain (sem cortar)
    const objectUrl = URL.createObjectURL(s.file);
    urlsToRevoke.push(objectUrl);

    const img = new Image();
    img.decoding = "async";
    img.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Falha ao carregar uma das fotos"));
    });

    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;

    const innerPad = 18;
    const usableX = s.x + innerPad;
    const usableY = s.y + 58;
    const usableW = cellW - innerPad * 2;
    const usableH = cellH - 58 - innerPad;

    const scale = Math.min(usableW / iw, usableH / ih);
    const dw = Math.max(1, Math.floor(iw * scale));
    const dh = Math.max(1, Math.floor(ih * scale));
    const dx = Math.floor(usableX + (usableW - dw) / 2);
    const dy = Math.floor(usableY + (usableH - dh) / 2);

    ctx.drawImage(img, dx, dy, dw, dh);
  }

  // ===== Rodapé com data/hora =====
  const footerY = mainY + mainH - 26;

  ctx.fillStyle = "#94a3b8";
  ctx.font =
    "700 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("GP Asfalto • Registro interno", leftX, footerY);

  const rightText = `Gerado em: ${generatedAtLabel}`;
  const rightW = ctx.measureText(rightText).width;
  ctx.fillText(rightText, mainX + mainW - 36 - rightW, footerY);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Falha ao gerar PNG"))),
      "image/png",
      0.92
    );
  });

  for (const u of urlsToRevoke) URL.revokeObjectURL(u);

  return blob;
}
