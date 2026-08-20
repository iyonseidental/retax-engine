/* 단일 HTML 파일 빌드 — 서버 없이 더블클릭으로 실행 가능한 배포본 생성.
 * 실행: node build.js  →  dist/부동산_보유매도_전략엔진.html
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;

const JS_FILES = [
  "js/core/util.js",
  "js/rules/registry.js",
  "js/engine/propertyTax.js",
  "js/engine/jongbuse.js",
  "js/engine/cgt.js",
  "js/engine/holding.js",
  "js/engine/market.js",
  "js/engine/strategy.js",
  "js/app/state.js",
  "js/app/lawmonitor.js",
  "js/app/charts.js",
  "js/app/ui.js"
];

const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const css = read("css/style.css");
const js = JS_FILES.map(f => `/* ===== ${f} ===== */\n` + read(f)).join("\n\n");

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>부동산 보유·매도 전략 엔진</title>
<style>
${css}
</style>
</head>
<body>
<header>
  <div class="brand">
    <h1>🏠 부동산 보유·매도 전략 엔진 <span class="ver">Ver. 1.0</span></h1>
    <p class="sub">제작자 <b>Dr. Min &amp; Dr. Lee</b> · 보유세 · 양도세 · HOLD/SELL DECISION — deterministic tax engine (단일파일 배포본)</p>
    <p class="sub" id="law-status">법령 DB 확인 중…</p>
  </div>
  <div id="controls" class="controls"></div>
</header>

<div id="law-banner"></div>
<nav id="tabs" class="tabs"></nav>

<main id="content">로딩 중…</main>

<footer>
  <div class="disclaimer">
    본 프로그램은 부동산 보유 및 매도 의사결정을 위한 <b>세금 시뮬레이션 도구</b>입니다.
    실제 신고세액은 개별 사실관계, 세법 개정, 과세관청의 판단 등에 따라 달라질 수 있습니다.
    중요한 매매 또는 세금 신고 전에는 <b>세무전문가 확인</b>이 필요합니다.
    미래 가격 관련 수치는 예측이 아니라 <b>가정에 따른 시나리오</b>입니다.
    입력 데이터는 이 브라우저에만 저장되며 외부로 전송되지 않습니다.
  </div>
  <div id="footer-meta" class="meta"></div>
</footer>

<script>
${js}
RETAX.UI.init();
</script>
</body>
</html>
`;

const distDir = path.join(ROOT, "dist");
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);
const out = path.join(distDir, "부동산_보유매도_전략엔진.html");
fs.writeFileSync(out, html, "utf8");
console.log("built:", out, Math.round(html.length / 1024) + "KB");

/* 웹 게시(Artifact)용: 문서 스켈레톤(doctype/html/head/body) 없이 본문만 */
const bodyInner = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const artifact = `<title>부동산 보유·매도 전략 엔진</title>\n<style>\n${css}\n</style>\n${bodyInner}`;
const outA = path.join(distDir, "artifact.html");
fs.writeFileSync(outA, artifact, "utf8");
console.log("built:", outA, Math.round(artifact.length / 1024) + "KB");
