/* =========================================================
 * SVG CHART RENDERER (외부 라이브러리 없음 — local-first, PART 66)
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.Charts = (function () {
  const U = RETAX.Util;
  const W = 760, H = 340, PAD = { l: 78, r: 16, t: 18, b: 34 };

  const COLORS = ["#0e9d6e", "#e0762f", "#2c6fb5", "#6b51c0", "#d2445d", "#8a8f2e", "#1f9aa8", "#b8862a"];

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p;
    return 10 * p;
  }

  function frame(inner, opts) {
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts && opts.title || "chart")}">${inner}</svg>`;
  }

  function yAxis(maxV, minV, fmt) {
    minV = minV || 0;
    let out = "";
    const n = 4;
    for (let i = 0; i <= n; i++) {
      const v = minV + (maxV - minV) * i / n;
      const y = PAD.t + (H - PAD.t - PAD.b) * (1 - i / n);
      out += `<line x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" class="grid"/>`;
      out += `<text x="${PAD.l - 6}" y="${y + 4}" class="ylab" text-anchor="end">${esc(fmt(v))}</text>`;
    }
    return out;
  }

  /** 스택 막대: categories(연도) × stacks[{name,color?,values[]}] */
  function stackedBar(categories, stacks, opts) {
    opts = opts || {};
    const totals = categories.map((_, i) => stacks.reduce((s, st) => s + (st.values[i] || 0), 0));
    const maxV = niceMax(Math.max(...totals, 1));
    const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
    const bw = Math.min(46, plotW / categories.length * 0.62);
    let out = yAxis(maxV, 0, opts.yFmt || U.fmtEok);
    categories.forEach((c, i) => {
      const cx = PAD.l + plotW * (i + 0.5) / categories.length;
      let acc = 0;
      stacks.forEach((st, si) => {
        const v = st.values[i] || 0;
        const h = plotH * v / maxV;
        const y = PAD.t + plotH - plotH * acc / maxV - h;
        out += `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${Math.max(0, h)}" fill="${st.color || COLORS[si % COLORS.length]}"><title>${esc(c)} ${esc(st.name)}: ${U.fmtEok(v)}</title></rect>`;
        acc += v;
      });
      out += `<text x="${cx}" y="${H - PAD.b + 16}" class="xlab" text-anchor="middle">${esc(c)}</text>`;
      out += `<text x="${cx}" y="${PAD.t + plotH - plotH * acc / maxV - 5}" class="vlab" text-anchor="middle">${U.fmtEok(acc)}</text>`;
    });
    out += legend(stacks.map((s, i) => ({ name: s.name, color: s.color || COLORS[i % COLORS.length] })));
    return frame(out, opts);
  }

  /** 선 그래프: series[{name,color?,values[]}] over categories; opts.markers=[{ci,si,label}] */
  function line(categories, series, opts) {
    opts = opts || {};
    const all = series.flatMap(s => s.values).filter(v => v != null);
    const maxV = niceMax(Math.max(...all, 1));
    const minV = opts.zeroBase === false ? Math.min(...all, 0) : 0;
    const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
    const X = i => PAD.l + plotW * (categories.length === 1 ? 0.5 : i / (categories.length - 1));
    const Y = v => PAD.t + plotH * (1 - (v - minV) / (maxV - minV || 1));
    let out = yAxis(maxV, minV, opts.yFmt || U.fmtEok);
    categories.forEach((c, i) => {
      if (categories.length <= 12 || i % 2 === 0)
        out += `<text x="${X(i)}" y="${H - PAD.b + 16}" class="xlab" text-anchor="middle">${esc(c)}</text>`;
    });
    series.forEach((s, si) => {
      const color = s.color || COLORS[si % COLORS.length];
      const pts = s.values.map((v, i) => v == null ? null : `${X(i)},${Y(v)}`).filter(Boolean).join(" ");
      out += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${s.bold ? 3 : 2}" ${s.dashed ? 'stroke-dasharray="6 4"' : ""}/>`;
      s.values.forEach((v, i) => {
        if (v == null) return;
        out += `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="${color}"><title>${esc(categories[i])} ${esc(s.name)}: ${(opts.yFmt || U.fmtEok)(v)}</title></circle>`;
      });
    });
    (opts.markers || []).forEach(m => {
      const x = X(m.ci), y = Y(m.value);
      out += `<circle cx="${x}" cy="${y}" r="7" fill="none" stroke="#d6405a" stroke-width="2.5"/>`;
      out += `<text x="${x}" y="${y - 12}" class="marker" text-anchor="middle">${esc(m.label)}</text>`;
    });
    out += legend(series.map((s, i) => ({ name: s.name, color: s.color || COLORS[i % COLORS.length] })));
    return frame(out, opts);
  }

  /** 가로 막대 (전략 비교) */
  function hbar(items, opts) {
    opts = opts || {};
    const maxV = niceMax(Math.max(...items.map(i => i.value), 1));
    const rowH = Math.min(40, (H - PAD.t - 10) / items.length);
    const lw = 250;
    let out = "";
    items.forEach((it, i) => {
      const y = PAD.t + i * rowH;
      const w = (W - lw - 90) * it.value / maxV;
      out += `<text x="${lw - 8}" y="${y + rowH * 0.62}" class="ylab" text-anchor="end">${esc(it.label)}</text>`;
      out += `<rect x="${lw}" y="${y + rowH * 0.15}" width="${Math.max(0, w)}" height="${rowH * 0.66}" fill="${it.color || (it.highlight ? "#e0762f" : "#0e9d6e")}" rx="3"><title>${(opts.yFmt || U.fmtEok)(it.value)}</title></rect>`;
      out += `<text x="${lw + w + 6}" y="${y + rowH * 0.62}" class="vlab">${(opts.yFmt || U.fmtEok)(it.value)}</text>`;
    });
    return frame(out, opts);
  }

  /** 히트맵: rows(상승률) × cols(연도) */
  function heatmap(rowLabels, colLabels, cells, opts) {
    opts = opts || {};
    const flat = cells.flat();
    const mn = Math.min(...flat), mx = Math.max(...flat);
    const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
    const cw = plotW / colLabels.length, ch = plotH / rowLabels.length;
    let out = "";
    let bestR = 0, bestC = 0, bestV = -Infinity;
    cells.forEach((row, r) => row.forEach((v, c) => { if (v > bestV) { bestV = v; bestR = r; bestC = c; } }));
    cells.forEach((row, r) => {
      out += `<text x="${PAD.l - 6}" y="${PAD.t + r * ch + ch * 0.6}" class="ylab" text-anchor="end">${esc(rowLabels[r])}</text>`;
      row.forEach((v, c) => {
        const t = mx > mn ? (v - mn) / (mx - mn) : 0.5;
        const hue = 8 + t * 130; // 붉음(낮음) → 초록(높음)
        out += `<rect x="${PAD.l + c * cw}" y="${PAD.t + r * ch}" width="${cw - 2}" height="${ch - 2}" fill="hsl(${hue} 45% ${62 - t * 12}%)"><title>${esc(rowLabels[r])} / ${esc(colLabels[c])}: ${U.fmtEok(v)}</title></rect>`;
        if (cw > 55) out += `<text x="${PAD.l + c * cw + cw / 2}" y="${PAD.t + r * ch + ch * 0.6}" class="cell" text-anchor="middle">${U.fmtEok(v)}</text>`;
      });
    });
    colLabels.forEach((c, i) => {
      out += `<text x="${PAD.l + i * cw + cw / 2}" y="${H - PAD.b + 16}" class="xlab" text-anchor="middle">${esc(c)}</text>`;
    });
    out += `<rect x="${PAD.l + bestC * cw}" y="${PAD.t + bestR * ch}" width="${cw - 2}" height="${ch - 2}" fill="none" stroke="#1a1a1a" stroke-width="2.5"/>`;
    return frame(out, opts);
  }

  function legend(items) {
    let x = PAD.l, out = "";
    items.forEach(it => {
      out += `<rect x="${x}" y="${H - 12}" width="11" height="11" fill="${it.color}"/>`;
      out += `<text x="${x + 15}" y="${H - 2}" class="leg">${esc(it.name)}</text>`;
      x += 15 + it.name.length * 12 + 22;
    });
    return out;
  }

  return { stackedBar, line, hbar, heatmap, COLORS };
})();

if (typeof module !== "undefined") module.exports = RETAX.Charts;
