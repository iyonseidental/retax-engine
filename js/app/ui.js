/* =========================================================
 * UI LAYER — 렌더링 전용.
 * 모든 숫자는 deterministic engine이 계산하고, 이 파일은 표시/설명만 한다. (PART 78~79)
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.UI = (function () {
  const U = RETAX.Util;
  const C = RETAX.Charts;
  const S = RETAX.Strategy;
  const Reg = RETAX.Registry;

  const APP = { pf: null, results: null, tab: "dashboard" };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function el(id) { return document.getElementById(id); }

  const MODE_BADGE = {
    CURRENT: '<span class="badge badge-current">현행법 기준</span>',
    PROPOSED: '<span class="badge badge-proposed">2026 개편안 기준 (국회 미확정)</span>',
    CUSTOM: '<span class="badge badge-custom">사용자 설정</span>'
  };
  const GRADE_BADGE = {
    EXACT: '<span class="badge badge-exact">확정 계산</span>',
    ESTIMATED: '<span class="badge badge-est">추정치</span>',
    SCENARIO: '<span class="badge badge-scn">가정에 따른 예상</span>',
    PROPOSED_LAW: '<span class="badge badge-proposed">개편안 기준(미확정)</span>',
    ASSUMPTION: '<span class="badge badge-asm">가정값 — 수정 필요</span>',
    USER_INPUT: '<span class="badge badge-asm">직접 입력값</span>'
  };

  /* =========================================================
   * 전체 재계산
   * ========================================================= */
  function assumptionsOf(pf, lawModeOverride) {
    const a = pf.assumptions;
    const A = {
      startYear: a.startYear, endYear: a.endYear,
      lawMode: lawModeOverride || a.lawMode,
      scenarioKey: a.scenarioKey,
      cashReturn: a.cashReturn, discountRate: a.discountRate,
      liquidateAtEnd: a.liquidateAtEnd !== false
    };
    if (a.scenarioKey === "CUSTOM") {
      A.scenario = { key: "CUSTOM", label: "사용자", marketGrowth: a.customScenario.marketGrowth, publicGrowth: a.customScenario.publicGrowth };
      A.lawMode = A.lawMode === "CUSTOM" ? "CURRENT" : A.lawMode;
    }
    if (A.lawMode === "CUSTOM") A.lawMode = "CURRENT"; // CUSTOM 법모드는 시나리오 파라미터로만 반영(v1)
    return A;
  }

  function recompute() {
    const pf = APP.pf;
    const A = assumptionsOf(pf);
    const otherMode = A.lawMode === "PROPOSED" ? "CURRENT" : "PROPOSED";
    const AOther = assumptionsOf(pf, otherMode);

    const holdPlan = { name: "모두 계속 보유", sales: [] };
    const t0 = Date.now();
    const holdSim = S.simulate(pf, holdPlan, A);
    const holdSimOther = S.simulate(pf, holdPlan, AOther);
    const evalAll = S.evaluateAll(pf, A);
    const evalAllOther = S.evaluateAll(pf, AOther);

    const exitCurves = {}, sensitivity = {}, reversalVsHold = {};
    for (const p of pf.properties) {
      exitCurves[p.id] = S.exitYearCurve(pf, p.id, A);
      sensitivity[p.id] = S.sensitivityMatrix(pf, p.id, A);
      reversalVsHold[p.id] = S.findReversalPoint(pf, holdPlan,
        { name: "sell", sales: [{ propertyId: p.id, date: (A.startYear + 1) + "-09-30" }] }, A);
    }
    let reversalAB = null;
    if (pf.properties.length === 2) {
      const [pa, pb] = pf.properties;
      reversalAB = S.findReversalPoint(pf,
        { name: "sellA", sales: [{ propertyId: pa.id, date: (A.startYear + 1) + "-09-30" }] },
        { name: "sellB", sales: [{ propertyId: pb.id, date: (A.startYear + 1) + "-09-30" }] }, A);
    }

    // 핵심 매트릭스 (PART 30, 111)
    const keyPlans = [{ label: "두 채 계속 보유", plan: holdPlan }];
    for (const p of pf.properties) {
      for (const y of [2027, 2028]) {
        if (y >= A.startYear && y <= A.endYear)
          keyPlans.push({ label: p.name + " " + y + " 매도", plan: { name: p.name + " " + y, sales: [{ propertyId: p.id, date: y + "-09-30" }] } });
      }
    }
    const best = evalAll[0];
    keyPlans.push({ label: "시스템 최적: " + best.strategy.name, plan: best.strategy, isBest: true });
    const keyMatrix = keyPlans.map(k => ({ label: k.label, isBest: k.isBest, sim: S.simulate(pf, k.plan, A) }));

    const bestSellByYear = {};
    for (const p of pf.properties)
      for (const c of exitCurves[p.id])
        bestSellByYear[c.year] = Math.max(bestSellByYear[c.year] || -Infinity, c.terminalWealth);
    const signals = S.sellReviewSignals(holdSim, bestSellByYear);

    APP.results = {
      A, AOther, holdSim, holdSimOther, evalAll, evalAllOther,
      exitCurves, sensitivity, reversalVsHold, reversalAB,
      keyMatrix, signals, computeMs: Date.now() - t0
    };
  }

  /* =========================================================
   * 공통 조각
   * ========================================================= */
  function stepsTable(steps) {
    return '<table class="steps"><tbody>' + steps.map(s =>
      `<tr><td>${esc(s.label)}</td><td class="num">${s.isRate ? U.pct(s.value) : U.fmt(s.value) + "원"}</td></tr>`
    ).join("") + "</tbody></table>";
  }
  function auditDetails(title, steps, extra) {
    return `<details class="audit"><summary>${esc(title)} <span class="hint">계산과정 펼치기</span></summary>${stepsTable(steps)}${extra || ""}</details>`;
  }
  function assumptionList(items) {
    if (!items || !items.length) return "";
    return `<div class="asm-box">${GRADE_BADGE.ASSUMPTION} ` + items.map(esc).join(" · ") + "</div>";
  }

  /* =========================================================
   * TAB: 대시보드
   * ========================================================= */
  function renderDashboard() {
    const pf = APP.pf, R = APP.results;
    const A = R.A;
    const y0 = A.startYear;
    const rows = R.holdSim.years;
    const r0 = rows[0], r1 = rows[1];
    const cum5 = rows.filter(r => r.year < y0 + 5).reduce((s, r) => s + r.holdingTax, 0);
    const cum10 = rows.filter(r => r.year < y0 + 10).reduce((s, r) => s + r.holdingTax, 0);
    const totalMarket = pf.properties.reduce((s, p) => s + p.marketValue, 0);
    const totalPublic = pf.properties.reduce((s, p) => s + (p.publicPriceByYear[y0] || 0), 0);
    const best = R.evalAll[0];
    const bestSaleYears = best.strategy.sales.map(s => {
      const p = pf.properties.find(x => x.id === s.propertyId);
      return (p ? p.name : s.propertyId) + " " + s.date;
    }).join(", ") || "매도 없음";

    const cards = [
      ["현재 총 시장가치", U.fmtEok(totalMarket), "ASSUMPTION"],
      ["현재 총 공시가격 (" + y0 + ")", U.fmtEok(totalPublic), "USER_INPUT"],
      [y0 + " 예상 보유세", U.fmtEok(r0.holdingTax), "EXACT"],
      [(y0 + 1) + " 예상 보유세", r1 ? U.fmtEok(r1.holdingTax) : "-", A.lawMode === "PROPOSED" ? "PROPOSED_LAW" : "SCENARIO"],
      ["5년 누적 보유세", U.fmtEok(cum5), "SCENARIO"],
      ["10년 누적 보유세", A.endYear >= y0 + 9 ? U.fmtEok(cum10) : "기간 부족", "SCENARIO"],
      ["손익분기 집값 상승률 (" + (y0 + 1) + ")", r1 && r1.breakEvenRate != null ? U.pct(r1.breakEvenRate, 2) : "-", "SCENARIO"],
      ["전략 1위", best.strategy.name, "SCENARIO"],
      ["추천 검토 매도시점", bestSaleYears, "SCENARIO"]
    ];

    // 핵심 5질문 (PART 116~117)
    const heuk = pf.properties[0], gaepo = pf.properties[1];
    const revA = heuk ? R.reversalVsHold[heuk.id] : null;
    const revB = gaepo ? R.reversalVsHold[gaepo.id] : null;
    const q5 = [];
    if (revA != null) q5.push(`시장 연평균 상승률이 <b>${(revA * 100).toFixed(2)}%</b>를 넘으면 「계속 보유」가 「${esc(heuk.name)} 조기 매도」보다 유리해집니다(그 이하면 매도 우위).`);
    if (revB != null) q5.push(`상승률 <b>${(revB * 100).toFixed(2)}%</b>가 「계속 보유」 vs 「${esc(gaepo.name)} 조기 매도」의 경계입니다.`);
    if (R.reversalAB != null && gaepo) q5.push(`상승률 <b>${(R.reversalAB * 100).toFixed(2)}%</b>를 경계로 어느 집을 먼저 팔지가 뒤집힙니다.`);
    if (!q5.length) q5.push("분석 구간(-5%~+12%) 안에서 전략 순위가 뒤집히는 상승률이 발견되지 않았습니다 — 현재 가정에서 결론이 비교적 견고합니다.");

    const matrix = R.keyMatrix.map(k => `
      <tr class="${k.isBest ? "hl" : ""}">
        <td>${esc(k.label)}</td>
        <td class="num">${U.fmtEok(k.sim.totalCGT)}</td>
        <td class="num">${U.fmtEok(k.sim.totalHoldingTax)}</td>
        <td class="num">${U.fmtEok(k.sim.totalSellingCosts)}</td>
        <td class="num"><b>${U.fmtEok(k.sim.terminalWealth)}</b></td>
        <td class="num">${U.fmtEok(k.sim.npv)}</td>
      </tr>`).join("");
    // (NPV = 미래 돈을 현재 가치로 환산한 값)

    const sigHtml = R.signals.length
      ? `<div class="signal">⚠ 매도 재검토 신호: ${R.signals.map(s => s.year + "년").join(", ")} — 이 해에는 집값 상승 기대이익보다 세금·이자 등 보유 비용이 더 크고, 파는 쪽의 최종 자산이 더 높게 계산됩니다. (무조건 팔라는 뜻이 아니라, 이 시점에 다시 판단해 보라는 신호입니다)`
        + "</div>"
      : `<div class="signal ok">현재 가정에서는 「보유 비용이 기대이익보다 크면서, 파는 쪽이 더 유리한」 연도가 없습니다.</div>`;

    // ANALYSIS (PART 105) — 엔진 숫자를 규칙 기반 템플릿으로 설명 (AI가 세금을 계산하지 않음)
    const holdRank = R.evalAll.findIndex(r => r.strategy.key === "HOLD_ALL") + 1;
    const analysis = `
      <p>${esc(R.holdSim.scenario.label)}(${A.scenarioKey}) 시나리오 · ${MODE_BADGE[APP.pf.assumptions.lawMode] || ""} 기준,
      ${A.endYear}년까지 분석(마지막 해에 모두 매도한다고 가정) 결과 <b>「${esc(best.strategy.name)}」</b> 전략의
      세후 최종자산이 <b>${U.fmtEok(best.terminalWealth)}</b>으로 가장 높습니다.
      「모두 계속 보유」는 ${holdRank}위(${U.fmtEok(R.holdSim.terminalWealth)})입니다.</p>
      <p>주요 요인: ① 보유세 차이 — 계속 보유 시 누적 ${U.fmtEok(R.holdSim.totalHoldingTax)} vs 1위 전략 ${U.fmtEok(best.sim.totalHoldingTax)},
      ② 양도세 차이 — ${U.fmtEok(R.holdSim.totalCGT)} vs ${U.fmtEok(best.sim.totalCGT)}
      (매도시점의 중과세율·주택수에 따라 달라짐), ③ 매도대금 재투자수익(연 ${U.pct(A.cashReturn)}) 대 주택가격 상승률의 경쟁입니다.</p>
      <p class="conf">얼마나 믿을 수 있나요? — 세금 계산은 법령 산식 그대로라 정확하지만(입력값이 실제와 맞는지 확인 필요),
      미래 집값은 어디까지나 가정입니다. 위의 「어떤 가정이 바뀌면 결론이 뒤집히는가」를 반드시 함께 보세요.</p>`;

    return `
      <div class="cards">${cards.map(c => `
        <div class="card"><div class="card-t">${esc(c[0])}</div><div class="card-v">${c[1]}</div>${GRADE_BADGE[c[2]] || ""}</div>`).join("")}
      </div>
      ${APP.pf.assumptions.lawMode === "PROPOSED" ? '<div class="warn-box">정부 세제개편안 기준 시뮬레이션 — 현재 시행법이 아니며, 국회 심의 및 법률 공포 과정에서 변경될 수 있습니다.</div>' : ""}
      <h3>핵심 질문에 대한 답</h3>
      <ol class="qa">
        <li><b>지금 주택을 계속 보유하면 매년 보유세가 얼마인가?</b><br>
          ${rows.slice(0, 5).map(r => r.year + "년 " + U.fmtEok(r.holdingTax)).join(" → ")} …</li>
        <li><b>${A.endYear}년까지 누적 보유세는?</b><br> ${U.fmtEok(R.holdSim.totalHoldingTax)}
          (개편안 시행 가정 시 ${U.fmtEok(R.holdSimOther.totalHoldingTax)})</li>
        <li><b>어느 집을 먼저 매도하는 것이 세후 자산 기준으로 유리한가?</b><br> ${renderWhichHouseShort()}</li>
        <li><b>몇 년에 매도해야 세후 최종자산이 가장 높은가?</b><br>
          ${pf.properties.map(p => {
            const c = R.exitCurves[p.id]; if (!c.length) return "";
            const b = c.reduce((m, x) => x.terminalWealth > m.terminalWealth ? x : m, c[0]);
            return esc(p.name) + ": <b>" + b.year + "년</b> (세후 최종자산 " + U.fmtEok(b.terminalWealth) + ")";
          }).join(" / ")}</li>
        <li><b>어떤 가정이 바뀌면 결론이 뒤집히는가?</b><br> ${q5.join("<br>")}</li>
      </ol>
      ${sigHtml}
      <h3>핵심 전략 비교표 ${MODE_BADGE[APP.pf.assumptions.lawMode]}</h3>
      <div class="tbl-wrap"><table class="data">
        <thead><tr><th>전략</th><th>양도세(지방세 포함)</th><th>누적 보유세</th><th>매도비용</th><th>세후 최종자산</th><th>현재가치(NPV)</th></tr></thead>
        <tbody>${matrix}</tbody></table></div>
      <h3>종합 해설 <span class="hint">계산 결과를 알기 쉽게 정리한 글 — 세금 숫자는 모두 법령 산식으로 계산됩니다</span></h3>
      <div class="analysis">${analysis}</div>`;
  }

  function renderWhichHouseShort() {
    const pf = APP.pf, R = APP.results;
    if (pf.properties.length < 2) return "주택이 2채 이상일 때 비교합니다.";
    const [a, b] = pf.properties;
    const bestA = R.exitCurves[a.id].reduce((m, x) => x.terminalWealth > m.terminalWealth ? x : m);
    const bestB = R.exitCurves[b.id].reduce((m, x) => x.terminalWealth > m.terminalWealth ? x : m);
    const winner = bestA.terminalWealth >= bestB.terminalWealth ? a : b;
    const wBest = winner === a ? bestA : bestB;
    return `단일 매도 기준 <b>${esc(winner.name)}</b>을(를) 먼저 매도(${wBest.year}년)하는 쪽이 우위입니다
      (${esc(a.name)} 최적 ${U.fmtEok(bestA.terminalWealth)} vs ${esc(b.name)} 최적 ${U.fmtEok(bestB.terminalWealth)}).
      단, 이는 세금 절감이 아니라 <b>세후 최종자산 최대화</b> 기준입니다.`;
  }

  /* =========================================================
   * TAB: 보유주택 입력
   * ========================================================= */
  function cachedPriceHint(p, year) {
    const hit = RETAX.Address.getCachedPrice(p.address, p.dong, p.ho, year);
    return hit
      ? "💾 이전에 입력해 둔 값: " + U.fmt(hit.price) + "원 (" + new Date(hit.savedAt).toLocaleDateString("ko-KR") + " 저장)"
      : "「공시가격 조회」로 정부 사이트에서 확인한 값을 입력하세요. 한 번 입력하면 저장되어 다음부터 자동으로 채워집니다.";
  }

  function renderProperties() {
    const pf = APP.pf;
    const tps = pf.household.taxpayers;
    const tpHtml = `
      <h3>세대 구성원 <span class="hint">종부세·양도세는 사람별로 계산되므로 소유자 정보가 필요합니다</span></h3>
      <div class="prop-grid">${tps.map((t, i) => `
        <div class="prop-card">
          <label>납세의무자 ${i + 1} 이름 <input data-tp="${i}" data-k="name" value="${esc(t.name)}"></label>
          <label>연령 (종부세 고령자공제 판정) <input type="number" data-tp="${i}" data-k="age" value="${t.age || ""}"></label>
        </div>`).join("")}
        <button class="btn" id="btn-add-tp">+ 납세의무자 추가 (배우자 등)</button>
      </div>`;

    const propsHtml = pf.properties.map((p, pi) => {
      const ownerRows = pf.household.taxpayers.map(t => {
        const o = (p.owners || []).find(x => x.taxpayerId === t.id);
        return `<label>${esc(t.name)} 지분(%) <input type="number" data-p="${pi}" data-owner="${t.id}" value="${o ? Math.round(o.share * 100) : 0}" min="0" max="100"></label>`;
      }).join("");
      return `
      <div class="prop-card wide">
        <h4>${esc(p.name)} <span class="hint">${esc(p.address || "")}</span></h4>
        <div class="grid3">
          <label>주택명 <input data-p="${pi}" data-k="name" value="${esc(p.name)}"></label>
          <label>자치구 (조정대상지역 판정)
            <select data-p="${pi}" data-k="district">
              ${["강남구", "서초구", "송파구", "용산구", "동작구", "기타 서울", "비규제지역"].map(d =>
                `<option ${p.district === d ? "selected" : ""}>${d}</option>`).join("")}
            </select></label>
          <label>주소
            <span style="display:flex; gap:6px;">
              <input data-p="${pi}" data-k="address" value="${esc(p.address || "")}" style="flex:1" placeholder="주소검색 버튼을 누르거나 직접 입력">
              <button class="btn" data-addr-search="${pi}" type="button">🔍 주소검색</button>
            </span></label>
          <label>동 <input data-p="${pi}" data-k="dong" value="${esc(p.dong || "")}" placeholder="예: 101"></label>
          <label>호 <input data-p="${pi}" data-k="ho" value="${esc(p.ho || "")}" placeholder="예: 1204"></label>
          <label>${pf.assumptions.startYear} 공시가격(원)
            <span style="display:flex; gap:6px;">
              <input type="number" data-p="${pi}" data-k="publicPrice0" value="${p.publicPriceByYear[pf.assumptions.startYear] || ""}" style="flex:1">
              <button class="btn" data-pubprice-open="${pi}" type="button" title="정부 공시가격 사이트를 열어 확인한 값을 입력하세요">공시가격 조회</button>
            </span>
            <span class="hint" id="pubprice-hint-${pi}">${cachedPriceHint(p, pf.assumptions.startYear)}</span></label>
          <label>현재 시장가치(원) ${GRADE_BADGE.ASSUMPTION} <input type="number" data-p="${pi}" data-k="marketValue" value="${p.marketValue}"></label>
          <label>취득일 <input type="date" data-p="${pi}" data-k="acquisitionDate" value="${esc(p.acquisitionDate)}"></label>
          <label>실제 취득가격(원) <input type="number" data-p="${pi}" data-k="acquisitionPrice" value="${p.acquisitionPrice}"></label>
          <label>필요경비(취득세·중개·자본적지출, 원) <input type="number" data-p="${pi}" data-k="necessaryExpenses" value="${p.necessaryExpenses || 0}"></label>
          <label>현재 실거주 여부 <select data-p="${pi}" data-k="isCurrentResidence"><option value="true" ${p.residence.isCurrentResidence ? "selected" : ""}>실거주</option><option value="false" ${!p.residence.isCurrentResidence ? "selected" : ""}>비거주</option></select></label>
          <label>누적 실거주 연수 <input type="number" data-p="${pi}" data-k="residenceYears" value="${p.residence.residenceYears || 0}"></label>
          <label>대출잔액(원) <input type="number" data-p="${pi}" data-k="loanBalance" value="${p.loan ? p.loan.balance : 0}"></label>
          <label>대출금리(%) <input type="number" step="0.1" data-p="${pi}" data-k="loanRate" value="${p.loan ? (p.loan.rate * 100).toFixed(1) : 4}"></label>
          <label>연간 순임대수익(세후, 원) <input type="number" data-p="${pi}" data-k="netRental" value="${p.rental ? p.rental.netAnnualIncome : 0}"></label>
          <label>연간 유지비(원) <input type="number" data-p="${pi}" data-k="maintenance" value="${p.maintenanceAnnual || 0}"></label>
          <label>매도비용률(%) <input type="number" step="0.1" data-p="${pi}" data-k="sellingCostRate" value="${((p.sellingCostRate || 0.007) * 100).toFixed(1)}"></label>
          <label>재건축 분담금(원, 없으면 0) <input type="number" data-p="${pi}" data-k="reconCharge" value="${p.reconstruction ? p.reconstruction.charge || 0 : 0}"></label>
          <label>분담금 납부연도 <input type="number" data-p="${pi}" data-k="reconYear" value="${p.reconstruction && p.reconstruction.chargeYear || ""}"></label>
        </div>
        <div class="grid3">${ownerRows}</div>
        ${assumptionList(p.assumptions)}
        <button class="btn danger" data-del-prop="${pi}">이 주택 삭제</button>
      </div>`;
    }).join("");

    return `
      <div class="note"><b>🔍 주소검색</b>: 버튼을 누르면 주소 검색창이 열립니다. 아파트를 선택하면
      주소·아파트명·자치구(조정대상지역 판정용)가 자동으로 채워집니다.
      <b>공시가격 조회</b>: 버튼을 누르면 정부 공시가격 사이트가 새 창으로 열립니다.
      거기서 확인한 공시가격을 입력하면 <b>저장되어, 다음에 같은 주소를 쓸 때 자동으로 채워집니다</b>.
      입력하신 재산 정보는 이 브라우저 안에만 저장되고 밖으로 나가지 않습니다 (주소 검색어만 검색할 때 카카오로 전송).</div>
      ${tpHtml}
      <h3>보유 주택 (${pf.properties.length}채)</h3>
      ${propsHtml}
      <div class="toolbar">
        <button class="btn" id="btn-add-prop">+ 주택 추가</button>
        <button class="btn" id="btn-sample2">2주택 예시 불러오기</button>
        <button class="btn primary" id="btn-apply">적용 및 전체 재계산</button>
        <button class="btn danger" id="btn-reset">전체 초기화</button>
      </div>`;
  }

  function readPropertyInputs() {
    const pf = APP.pf;
    document.querySelectorAll("[data-tp]").forEach(inp => {
      const t = pf.household.taxpayers[+inp.dataset.tp];
      if (!t) return;
      if (inp.dataset.k === "age") t.age = +inp.value || null; else t[inp.dataset.k] = inp.value;
    });
    document.querySelectorAll("[data-p][data-k]").forEach(inp => {
      const p = pf.properties[+inp.dataset.p];
      if (!p) return;
      const k = inp.dataset.k, v = inp.value;
      switch (k) {
        case "name": p.name = v; break;
        case "district": p.district = v; break;
        case "address": p.address = v; break;
        case "dong": p.dong = v; break;
        case "ho": p.ho = v; break;
        case "publicPrice0": {
          const price = +v || 0;
          p.publicPriceByYear[pf.assumptions.startYear] = price;
          if (price > 0 && p.address) // 주소·동·호 기준 공시가격 캐시 (PART 65)
            RETAX.Address.saveCachedPrice(p.address, p.dong, p.ho, pf.assumptions.startYear, price);
          break;
        }
        case "marketValue": p.marketValue = +v || 0; p.marketValueYear = pf.assumptions.startYear; break;
        case "acquisitionDate": p.acquisitionDate = v; break;
        case "acquisitionPrice": p.acquisitionPrice = +v || 0; break;
        case "necessaryExpenses": p.necessaryExpenses = +v || 0; break;
        case "isCurrentResidence": p.residence.isCurrentResidence = v === "true"; break;
        case "residenceYears": p.residence.residenceYears = +v || 0; break;
        case "loanBalance": p.loan = p.loan || {}; p.loan.balance = +v || 0; break;
        case "loanRate": p.loan = p.loan || {}; p.loan.rate = (+v || 0) / 100; break;
        case "netRental": p.rental = p.rental || {}; p.rental.netAnnualIncome = +v || 0; break;
        case "maintenance": p.maintenanceAnnual = +v || 0; break;
        case "sellingCostRate": p.sellingCostRate = (+v || 0) / 100; break;
        case "reconCharge": p.reconstruction = p.reconstruction || {}; p.reconstruction.charge = +v || 0; break;
        case "reconYear": p.reconstruction = p.reconstruction || {}; p.reconstruction.chargeYear = +v || null; break;
      }
    });
    document.querySelectorAll("[data-owner]").forEach(inp => {
      const p = pf.properties[+inp.dataset.p];
      if (!p) return;
      const share = (+inp.value || 0) / 100;
      p.owners = p.owners.filter(o => o.taxpayerId !== inp.dataset.owner);
      if (share > 0) p.owners.push({ taxpayerId: inp.dataset.owner, share });
    });
  }

  /* =========================================================
   * TAB: 보유세 상세
   * ========================================================= */
  function renderHolding() {
    const R = APP.results, A = R.A;
    const rows = R.holdSim.years;
    const cats = rows.map(r => String(r.year));

    const table = rows.map(r => `
      <tr>
        <td>${r.year}</td>
        <td class="num">${U.fmtEok(r.marketValueHeld)}</td>
        <td class="num">${U.fmtEok(r.publicPriceHeld)}</td>
        <td class="num">${U.fmt(r.propertyTax)}</td>
        <td class="num">${U.fmt(r.jongbuse)}</td>
        <td class="num">${U.fmt(r.ruralTax)}</td>
        <td class="num"><b>${U.fmt(r.holdingTax)}</b></td>
        <td class="num">${U.fmtEok(r.cumHoldingTax)}</td>
        <td class="num">${r.breakEvenRate != null ? U.pct(r.breakEvenRate, 2) : "-"}</td>
      </tr>`).join("");

    // 감사(audit) — 첫 3개 연도 상세
    const audits = rows.slice(0, 3).map(r => {
      const h = r.holding;
      const ptx = h.perProperty.map(pp =>
        auditDetails(`${r.year} 재산세 — ${pp.name} (공시 ${U.fmtEok(pp.publicPrice)})`, pp.ptx.steps)).join("");
      const jbs = h.perTaxpayer.map(t =>
        auditDetails(`${r.year} 종부세 — ${t.name} (${t.jbs.ruleId})`, t.jbs.steps,
          t.jbs.flags.length ? `<div class="hint">flags: ${t.jbs.flags.join(", ")}</div>` : "")).join("");
      return ptx + jbs;
    }).join("");

    const lawCompare = rows.map((r, i) => {
      const o = R.holdSimOther.years[i];
      return { y: r.year, cur: A.lawMode === "CURRENT" ? r.holdingTax : o.holdingTax, pro: A.lawMode === "CURRENT" ? o.holdingTax : r.holdingTax };
    });
    const impact5 = lawCompare.slice(0, 5).reduce((s, x) => s + (x.pro - x.cur), 0);

    return `
      <h3>연도별 보유세 ${MODE_BADGE[APP.pf.assumptions.lawMode]} <span class="hint">매년 6월 1일에 소유한 사람에게 그 해 보유세가 부과됩니다 · 계속 보유 기준</span></h3>
      ${C.stackedBar(cats, [
        { name: "재산세", values: rows.map(r => r.propertyTax) },
        { name: "종부세", values: rows.map(r => r.jongbuse) },
        { name: "농특세", values: rows.map(r => r.ruralTax) }
      ], { title: "연도별 보유세" })}
      ${C.line(cats, [
        { name: "누적 보유세", values: rows.map(r => r.cumHoldingTax), bold: true }
      ], { title: "누적 보유세" })}
      <div class="tbl-wrap"><table class="data">
        <thead><tr><th>연도</th><th>시장가치</th><th>공시가격</th><th>재산세</th><th>종부세</th><th>농특세</th><th>총보유세</th><th>누적</th><th>손익분기 상승률</th></tr></thead>
        <tbody>${table}</tbody></table></div>
      <div class="hint">「손익분기 상승률」= 그 해 세금·이자·유지비를 집값 상승이 만회하려면 최소 몇 % 올라야 하는지</div>
      <h3>계산 과정 펼쳐보기 <span class="hint">세금이 어떻게 산출되었는지 단계별로 확인할 수 있습니다</span></h3>
      ${audits}
      <h3>현행법 vs 2026 개편안 — 세금이 얼마나 달라지나</h3>
      ${C.line(cats, [
        { name: "현행법", values: lawCompare.map(x => x.cur), bold: true },
        { name: "2026 개편안(미확정)", values: lawCompare.map(x => x.pro), dashed: true }
      ], { title: "세법 비교" })}
      <div class="tbl-wrap"><table class="data"><thead><tr><th>연도</th><th>현행법</th><th>개편안</th><th>영향</th></tr></thead>
      <tbody>${lawCompare.map(x => `<tr><td>${x.y}</td><td class="num">${U.fmt(x.cur)}</td><td class="num">${U.fmt(x.pro)}</td>
        <td class="num ${x.pro - x.cur >= 0 ? "up" : "down"}">${(x.pro - x.cur >= 0 ? "+" : "") + U.fmt(x.pro - x.cur)}</td></tr>`).join("")}
      <tr class="hl"><td colspan="3">개편안 시행 시 5년 누적 영향</td><td class="num">${(impact5 >= 0 ? "+" : "") + U.fmt(impact5)}원</td></tr>
      </tbody></table></div>`;
  }

  /* =========================================================
   * TAB: 양도세
   * ========================================================= */
  function renderCGT() {
    const pf = APP.pf, R = APP.results, A = R.A;
    const out = [];
    for (const p of pf.properties) {
      const series = R.holdSim.series[p.id];
      const rows = [];
      for (let y = A.startYear; y <= A.endYear; y++) {
        const date = y + "-09-30";
        const mk = mode => RETAX.CGT.compute({
          saleDate: date, salePrice: series.market[y],
          acquisitionDate: p.acquisitionDate, acquisitionPrice: p.acquisitionPrice,
          necessaryExpenses: p.necessaryExpenses || 0, share: 1,
          residenceYears: (p.residence.residenceYears || 0) + (p.residence.isCurrentResidence ? y - A.startYear : 0),
          householdCountAtSale: pf.properties.length,
          isRegulatedAtSale: Reg.isRegulatedAt(p.district, date),
          acquiredWhileRegulated: Reg.isRegulatedAt(p.district, p.acquisitionDate),
          lawMode: mode
        });
        rows.push({ y, cur: mk("CURRENT"), pro: mk("PROPOSED"), price: series.market[y] });
      }
      const detail = rows[Math.min(1, rows.length - 1)];
      out.push(`
        <h3>${esc(p.name)} — 매도연도별 양도세 <span class="hint">단독매도(다른 주택 보유 유지, ${pf.properties.length}주택자) 가정, 9/30 양도</span></h3>
        <div class="tbl-wrap"><table class="data">
          <thead><tr><th>매도연도</th><th>예상 양도가액</th><th>현행: 중과</th><th>현행 총세액</th><th>개편안: 중과</th><th>개편안 총세액</th><th>차이</th></tr></thead>
          <tbody>${rows.map(r => `
            <tr><td>${r.y}</td><td class="num">${U.fmtEok(r.price)}</td>
            <td>${r.cur.surcharged ? "+" + U.pct(r.cur.rateInfo.surchargeRate, 0) + "p" : (r.cur.exempt ? "비과세" : "일반")}</td>
            <td class="num">${U.fmt(r.cur.total)}</td>
            <td>${r.pro.surcharged ? "+" + U.pct(r.pro.rateInfo.surchargeRate, 0) + "p" : (r.pro.exempt ? "비과세" : "일반")}</td>
            <td class="num">${U.fmt(r.pro.total)}</td>
            <td class="num ${r.pro.total - r.cur.total >= 0 ? "up" : "down"}">${U.fmt(r.pro.total - r.cur.total)}</td></tr>`).join("")}
          </tbody></table></div>
        ${auditDetails(`${p.name} ${detail.y}년 매도 상세 (현행법)`, detail.cur.steps,
          detail.cur.flags.length ? `<div class="hint">${detail.cur.flags.map(esc).join(" · ")}</div>` : "")}
        ${auditDetails(`${p.name} ${detail.y}년 매도 상세 (2026 개편안)`, detail.pro.steps,
          `<div class="hint">${MODE_BADGE.PROPOSED} 국회 확정 전 정부안</div>`)}`);
    }
    return `<div class="note">양도세는 <b>양도일 당시 유효한 법령</b>(중과 이력 포함)으로 계산합니다.
      2026-05-10부터 조정대상지역 다주택 중과가 재개되었고(유예 종료), 개편안은 2027년(+5/+10%p)·2028년(+10/+15%p) 한시 완화 후 2029년 원상복귀입니다.</div>` + out.join("");
  }

  /* =========================================================
   * TAB: 전략
   * ========================================================= */
  function renderStrategy() {
    const pf = APP.pf, R = APP.results, A = R.A;
    const top = R.evalAll.slice(0, 12);
    const bars = C.hbar(top.slice(0, 8).map((r, i) => ({
      label: (i + 1) + "위 " + r.strategy.name, value: r.terminalWealth, highlight: i === 0
    })), { title: "전략별 세후 최종자산" });

    const curves = pf.properties.map((p, i) => {
      const c = R.exitCurves[p.id];
      return { name: p.name + " 매도 시 최종자산", values: c.map(x => x.terminalWealth), color: C.COLORS[i] };
    });
    const years = R.exitCurves[pf.properties[0].id].map(x => String(x.year));
    const holdLine = { name: "계속 보유", values: years.map(() => R.holdSim.terminalWealth), dashed: true, color: "#888" };
    const markers = pf.properties.map((p, i) => {
      const c = R.exitCurves[p.id];
      let bi = 0; c.forEach((x, j) => { if (x.terminalWealth > c[bi].terminalWealth) bi = j; });
      return { ci: bi, value: c[bi].terminalWealth, label: "BEST " + c[bi].year };
    });

    const rankTable = top.map((r, i) => `
      <tr class="${i === 0 ? "hl" : ""}"><td>${i + 1}</td><td>${esc(r.strategy.name)}</td>
      <td class="num">${U.fmtEok(r.totalCGT)}</td><td class="num">${U.fmtEok(r.totalHoldingTax)}</td>
      <td class="num"><b>${U.fmtEok(r.terminalWealth)}</b></td><td class="num">${U.fmtEok(r.sim.npv)}</td></tr>`).join("");

    // 법 개정 시 전략 변화 (PART 59, 97)
    const bestCur = (A.lawMode === "CURRENT" ? R.evalAll : R.evalAllOther)[0];
    const bestPro = (A.lawMode === "CURRENT" ? R.evalAllOther : R.evalAll)[0];
    const changed = bestCur.strategy.key !== bestPro.strategy.key;

    const revs = [];
    for (const p of pf.properties) {
      const r = R.reversalVsHold[p.id];
      if (r != null) revs.push(`시장 상승률 <b>${(r * 100).toFixed(2)}%</b> ${r >= (R.holdSim.scenario.marketGrowth) ? "이상이면" : "이하이면"} — 「계속 보유」 vs 「${esc(p.name)} ${A.startYear + 1} 매도」의 우위가 바뀝니다.`);
    }
    if (R.reversalAB != null) revs.push(`상승률 <b>${(R.reversalAB * 100).toFixed(2)}%</b>가 「${esc(pf.properties[0].name)} 먼저」 vs 「${esc(pf.properties[1].name)} 먼저」의 경계입니다.`);

    return `
      <h3>전략별 세후 최종자산 (${A.endYear}년에 모두 매도한다고 가정) ${MODE_BADGE[APP.pf.assumptions.lawMode]}</h3>
      ${bars}
      <h3>몇 년에 팔면 가장 유리한가 — 매도연도별 최종자산</h3>
      ${C.line(years, curves.concat([holdLine]), { title: "매도연도 최적화", markers })}
      <h3>전략 순위 (상위 12개 / 전체 ${R.evalAll.length}개 전수평가)</h3>
      <div class="tbl-wrap"><table class="data">
        <thead><tr><th>#</th><th>전략</th><th>양도세</th><th>보유세</th><th>최종자산</th><th>현재가치(NPV)</th></tr></thead>
        <tbody>${rankTable}</tbody></table></div>
      <h3>무엇이 바뀌면 결론이 뒤집히는가</h3>
      <div class="analysis">${revs.length ? revs.map(r => "<p>" + r + "</p>").join("") : "<p>집값 상승률을 -5%~+12% 사이에서 바꿔 봐도 전략 순위가 뒤집히지 않습니다.</p>"}
      <p class="conf">"앞으로 집값이 이렇게 된다"는 전망이 아니라, "상승률이 이 값을 넘느냐 아니냐에 따라 유리한 전략이 달라진다"는 경계값입니다.</p></div>
      <h3>세법이 바뀌면 최적 전략도 바뀌는가</h3>
      <div class="${changed ? "warn-box" : "note"}">
        현행법 1위: <b>${esc(bestCur.strategy.name)}</b> (${U.fmtEok(bestCur.terminalWealth)})<br>
        개편안 시행 가정 1위: <b>${esc(bestPro.strategy.name)}</b> (${U.fmtEok(bestPro.terminalWealth)})<br>
        ${changed ? "⚠ STRATEGY CHANGE — 세법 개정이 확정되면 최적 전략이 달라집니다." : "최적 전략 동일 — 세법 개정이 순위를 바꾸지 않습니다."}
      </div>`;
  }

  /* =========================================================
   * TAB: 민감도
   * ========================================================= */
  function renderSensitivity() {
    const pf = APP.pf, R = APP.results;
    return pf.properties.map(p => {
      const sm = R.sensitivity[p.id];
      const rows = sm.rates.map(r => (r * 100).toFixed(0) + "%");
      const cols = sm.years.map(String).concat(["보유"]);
      const cells = sm.cells.map((row, i) => row.concat([sm.holdCol[i]]));
      return `<h3>${esc(p.name)} — 집값 상승률에 따라 최적 매도시점이 어떻게 달라지나</h3>
        <div class="hint">세로축 = 연평균 집값 상승률 가정, 가로축 = 매도연도. 색이 진한 초록일수록 최종 자산이 큽니다.
        검은 테두리 = 가장 유리한 조합. 마지막 열 「보유」 = 팔지 않고 끝까지 보유.</div>
        ${C.heatmap(rows, cols, cells, { title: p.name + " 민감도" })}`;
    }).join("") + `
      <h3>극단 상황 실험 — 버튼 한 번으로 나쁜 상황을 가정해 보기</h3>
      <div class="toolbar">
        <button class="btn" data-stress="crash">집값 -20% 후 횡보</button>
        <button class="btn" data-stress="flat">집값 5년 횡보</button>
        <button class="btn" data-stress="pubUp">공시가격 +15%/년</button>
        <button class="btn" data-stress="reset">기준 시나리오 복귀</button>
      </div>
      <div class="note">버튼을 누르면 집값 전망을 해당 상황으로 바꿔 모든 결과를 다시 계산합니다. 「기준 시나리오 복귀」로 되돌릴 수 있습니다.</div>`;
  }

  /* =========================================================
   * TAB: 세법 (TAX LAW WATCH / Registry)
   * ========================================================= */
  const TAXTYPE_KO = {
    PROPERTY_TAX: "재산세", COMPREHENSIVE_TAX: "종합부동산세",
    CGT_BASIC: "양도세 (기본)", CGT_SURCHARGE: "양도세 (다주택 중과)"
  };
  const STATUS_KO = {
    CURRENT: "시행 중", PROPOSED: "정부안 (미확정)", PASSED: "국회 통과",
    PROMULGATED: "공포됨", FUTURE_EFFECTIVE: "시행 예정", EXPIRED: "지난 규정", SUPERSEDED: "대체됨"
  };

  function renderLaw() {
    const rows = Reg.RULES.map(r => `
      <tr ${r.updatedAt ? 'class="hl"' : ""}><td><code>${esc(r.ruleId)}</code>${r.updatedAt ? "<br><span class='hint'>🔔 " + esc(RETAX.LawMonitor.fmtTime(r.updatedAt)) + " 갱신</span>" : ""}</td><td>${esc(TAXTYPE_KO[r.taxType] || r.taxType)}</td>
      <td><span class="badge badge-${r.status === "CURRENT" ? "current" : r.status === "PROPOSED" ? "proposed" : "est"}">${esc(STATUS_KO[r.status] || r.status)}</span></td>
      <td>${esc(r.effectiveFrom)} ~ ${esc(r.effectiveTo || "")}</td>
      <td>${esc(r.sourceAuthority)}<br><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.sourceTitle)}</a></td>
      <td>${esc(r.verifiedAt)}</td>
      <td class="small">${esc(r.notes || "")}</td></tr>`).join("");
    const areas = Reg.REGULATED_AREAS.map(a => `
      <tr><td>${esc(a.region)}</td><td>${esc(a.effectiveFrom)} ~ ${esc(a.effectiveTo || "현재")}</td>
      <td>${esc(STATUS_KO[a.status] || a.status)}</td><td class="small">${esc(a.officialSource)}</td></tr>`).join("");
    const M = RETAX.LawMonitor;
    const changelog = (M.state.changelog.length ? M.state.changelog : []).map(c => `
      <tr><td>${esc(M.fmtTime(c.date))}</td><td>v${esc(c.version || "-")}</td><td class="small">${esc(c.summary || "")}</td></tr>`).join("");
    return `
      <div class="note"><b>세법 데이터 v${esc(M.state.appliedVersion)}</b>
      · 마지막 세법 데이터 갱신: <b>${esc(M.fmtTime(M.state.appliedAt))}</b>
      · 이 브라우저에서 마지막으로 확인한 시각: ${esc(M.fmtTime(M.state.lastCheckedAt))}
      · 상태: ${M.state.lastResult === "UPDATED" ? "🔔 새 세법이 적용됨" : M.state.lastResult === "UP_TO_DATE" ? "✅ 최신" : M.state.lastResult === "OFFLINE" ? "⚠ 인터넷 확인 실패 — 프로그램에 내장된 세법 사용 중" : "확인 전"}
      <br>이 프로그램의 세법은 ${Reg.META_VERIFIED_AT}에 공식 자료로 검증되었습니다. 실제 세금은 항상 그 시점의 공식 법령이 우선합니다.
      2026 세제개편안은 아직 <b>국회를 통과하지 않은 정부안</b>이며, 확정되면 세법 데이터가 자동으로 갱신됩니다.</div>
      <div class="toolbar"><button class="btn primary" id="btn-law-check">세법 최신 확인 (지금 확인)</button></div>
      ${changelog ? `<h3>세법 데이터 변경 이력</h3><div class="tbl-wrap"><table class="data small">
        <thead><tr><th>갱신 시각</th><th>버전</th><th>내용</th></tr></thead><tbody>${changelog}</tbody></table></div>` : ""}
      <h3>정부 공식 사이트 바로가기</h3>
      <div class="toolbar">
        <a class="btn" href="https://www.law.go.kr" target="_blank" rel="noopener">국가법령정보센터</a>
        <a class="btn" href="https://www.moef.go.kr" target="_blank" rel="noopener">기획재정부 (세제개편안)</a>
        <a class="btn" href="https://www.nts.go.kr" target="_blank" rel="noopener">국세청</a>
        <a class="btn" href="https://likms.assembly.go.kr/bill/main.do" target="_blank" rel="noopener">국회 의안정보시스템</a>
        <a class="btn" href="https://www.realtyprice.kr" target="_blank" rel="noopener">부동산공시가격알리미</a>
        <a class="btn" href="https://rt.molit.go.kr" target="_blank" rel="noopener">국토부 실거래가</a>
      </div>
      <h3>적용 중인 세법 규칙 목록 (${Reg.RULES.length}개)</h3>
      <div class="tbl-wrap"><table class="data small">
        <thead><tr><th>ruleId</th><th>세목</th><th>상태</th><th>유효기간</th><th>출처</th><th>검증일</th><th>비고</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <h3>조정대상지역 지정·해제 이력</h3>
      <div class="tbl-wrap"><table class="data small">
        <thead><tr><th>지역</th><th>기간</th><th>상태</th><th>근거</th></tr></thead>
        <tbody>${areas}</tbody></table></div>`;
  }

  /* =========================================================
   * TAB: 스냅샷
   * ========================================================= */
  function renderSnapshots() {
    const snaps = RETAX.State.listSnapshots();
    const rows = snaps.map((s, i) => `
      <tr><td>${new Date(s.savedAt).toLocaleString("ko-KR")}</td>
      <td>검증일 ${esc(s.lawRegistryVerifiedAt)}</td>
      <td class="num">${s.summary ? U.fmtEok(s.summary.terminalWealthBest) : "-"}</td>
      <td>${s.summary ? esc(s.summary.bestStrategy) : "-"}</td>
      <td><button class="btn danger" data-del-snap="${i}">삭제</button></td></tr>`).join("");
    return `
      <div class="note">지금의 입력값과 분석 결과를 날짜와 함께 저장해 두고, 나중에 다시 분석했을 때 비교할 수 있습니다. 저장은 이 브라우저 안에만 됩니다.</div>
      <div class="toolbar"><button class="btn primary" id="btn-snap">현재 분석 결과 저장</button>
      <button class="btn" id="btn-export">입력 데이터 복사 (다른 기기로 옮길 때)</button></div>
      <div class="tbl-wrap"><table class="data">
        <thead><tr><th>저장 시각</th><th>세법 데이터 기준</th><th>1위 전략의 최종자산</th><th>1위 전략</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">저장된 스냅샷 없음</td></tr>'}</tbody></table></div>`;
  }

  /* =========================================================
   * 셸 렌더 + 이벤트
   * ========================================================= */
  const TABS = [
    ["dashboard", "대시보드", renderDashboard],
    ["props", "보유주택 입력", renderProperties],
    ["holding", "보유세 상세", renderHolding],
    ["cgt", "양도세", renderCGT],
    ["strategy", "전략 비교", renderStrategy],
    ["sens", "조건 실험", renderSensitivity],
    ["law", "세법 정보", renderLaw],
    ["snap", "분석 저장", renderSnapshots]
  ];

  function renderShell() {
    const a = APP.pf.assumptions;
    el("controls").innerHTML = `
      <label>세법 기준
        <select id="ctl-law">
          <option value="CURRENT" ${a.lawMode === "CURRENT" ? "selected" : ""}>지금 시행 중인 법</option>
          <option value="PROPOSED" ${a.lawMode === "PROPOSED" ? "selected" : ""}>2026 개편안이 통과된다면</option>
        </select></label>
      <label>집값 전망
        <select id="ctl-scn">
          ${[["BEAR", "하락 전망"], ["BASE", "보통 전망"], ["BULL", "상승 전망"], ["CUSTOM", "직접 입력"]]
            .map(k => `<option value="${k[0]}" ${a.scenarioKey === k[0] ? "selected" : ""}>${k[1]}</option>`).join("")}
        </select></label>
      <label class="custom-only" style="${a.scenarioKey === "CUSTOM" ? "" : "display:none"}">집값 상승률(연 %)
        <input id="ctl-mg" type="number" step="0.5" value="${typeof a.customScenario.marketGrowth === "number" ? (a.customScenario.marketGrowth * 100).toFixed(1) : ""}" placeholder="실험 설정 사용 중"></label>
      <label class="custom-only" style="${a.scenarioKey === "CUSTOM" ? "" : "display:none"}">공시가격 상승률(연 %)
        <input id="ctl-pg" type="number" step="0.5" value="${typeof a.customScenario.publicGrowth === "number" ? (a.customScenario.publicGrowth * 100).toFixed(1) : ""}" placeholder="실험 설정 사용 중"></label>
      <label>분석 종료연도
        <select id="ctl-end">${(() => {
          const opts = [];
          for (let y = a.startYear + 1; y <= 2050; y++)
            opts.push(`<option ${a.endYear === y ? "selected" : ""}>${y}</option>`);
          return opts.join("");
        })()}</select></label>
      <label>매도 후 현금 수익률(연 %) <input id="ctl-cash" type="number" step="0.5" value="${(a.cashReturn * 100).toFixed(1)}" title="집을 판 돈을 예금·투자로 굴릴 때의 연 수익률"></label>
      <label>할인율(연 %) <input id="ctl-dr" type="number" step="0.5" value="${(a.discountRate * 100).toFixed(1)}" title="미래 돈을 현재 가치로 환산할 때 쓰는 비율"></label>
      <button class="btn primary" id="ctl-recalc">전체 다시 계산</button>`;
    el("tabs").innerHTML = TABS.map(t =>
      `<button class="tab ${APP.tab === t[0] ? "active" : ""}" data-tab="${t[0]}">${t[1]}</button>`).join("");
  }

  function renderTab() {
    const t = TABS.find(x => x[0] === APP.tab);
    el("content").innerHTML = t[2]();
    el("content").querySelectorAll(".card-v").forEach(v => { if (v.textContent.trim().length > 9) v.classList.add("long"); });
    bindContentEvents();
  }

  function readControls() {
    const a = APP.pf.assumptions;
    a.lawMode = el("ctl-law").value;
    a.scenarioKey = el("ctl-scn").value;
    a.endYear = +el("ctl-end").value;
    a.cashReturn = (+el("ctl-cash").value || 0) / 100;
    a.discountRate = (+el("ctl-dr").value || 0) / 100;
    if (el("ctl-mg") && el("ctl-mg").value !== "") a.customScenario.marketGrowth = (+el("ctl-mg").value || 0) / 100;
    if (el("ctl-pg") && el("ctl-pg").value !== "") a.customScenario.publicGrowth = (+el("ctl-pg").value || 0) / 100;
  }

  function fullRefresh() {
    RETAX.State.save(APP.pf);
    recompute();
    renderShell();
    bindShellEvents();
    renderTab();
  }

  function bindShellEvents() {
    el("ctl-recalc").onclick = () => { readControls(); fullRefresh(); };
    el("ctl-scn").onchange = () => { readControls(); fullRefresh(); };
    el("ctl-law").onchange = () => { readControls(); fullRefresh(); };
    el("ctl-end").onchange = () => { readControls(); fullRefresh(); };
    el("tabs").querySelectorAll("[data-tab]").forEach(b =>
      b.onclick = () => { APP.tab = b.dataset.tab; renderShell(); bindShellEvents(); renderTab(); });
  }

  function bindContentEvents() {
    const addProp = el("btn-add-prop");
    if (addProp) addProp.onclick = () => {
      readPropertyInputs();
      const p = RETAX.State.blankProperty(APP.pf.properties.length + 1);
      p.owners = [{ taxpayerId: APP.pf.household.taxpayers[0].id, share: 1.0 }];
      APP.pf.properties.push(p);
      fullRefresh(); APP.tab = "props"; renderTab();
    };
    document.querySelectorAll("[data-addr-search]").forEach(b => b.onclick = async () => {
      const pi = +b.dataset.addrSearch;
      await RETAX.Address.openSearch(sel => {
        readPropertyInputs();
        const p = APP.pf.properties[pi];
        if (!p) return;
        p.address = sel.roadAddress + (sel.buildingName ? " (" + sel.buildingName + ")" : "");
        p.district = sel.district;
        if (sel.buildingName && (!p.name || /^주택\s/.test(p.name))) p.name = sel.buildingName;
        if (sel.district === "비규제지역")
          alert("서울 외 지역입니다. v1 조정대상지역 이력은 서울 기준이므로, 해당 지역의 조정대상지역 여부를 직접 확인해 주세요 (성남 분당·과천 등 2025-10-16 지정 지역 주의).");
        // 캐시된 공시가격이 있으면 자동 채움
        const hit = RETAX.Address.getCachedPrice(p.address, p.dong, p.ho, APP.pf.assumptions.startYear);
        if (hit) p.publicPriceByYear[APP.pf.assumptions.startYear] = hit.price;
        RETAX.State.save(APP.pf);
        renderTab();
      });
    });
    document.querySelectorAll("[data-pubprice-open]").forEach(b => b.onclick = () => {
      RETAX.Address.openRealtyPrice();
    });
    const sample2 = el("btn-sample2");
    if (sample2) sample2.onclick = () => {
      if (confirm("현재 입력을 가상의 2주택 예시 데이터로 바꿉니다. 계속할까요?")) {
        APP.pf = RETAX.State.sampleTwoHomePortfolio(); fullRefresh(); APP.tab = "props"; renderTab();
      }
    };
    const addTp = el("btn-add-tp");
    if (addTp) addTp.onclick = () => {
      readPropertyInputs();
      APP.pf.household.taxpayers.push({ id: "tp" + Date.now(), name: "배우자", age: null });
      RETAX.State.save(APP.pf); renderTab();
    };
    const apply = el("btn-apply");
    if (apply) apply.onclick = () => { readPropertyInputs(); fullRefresh(); };
    const reset = el("btn-reset");
    if (reset) reset.onclick = () => {
      if (confirm("모든 입력을 지우고 예시 1주택 상태로 되돌립니다. 계속할까요?")) {
        APP.pf = RETAX.State.reset(); fullRefresh();
      }
    };
    document.querySelectorAll("[data-del-prop]").forEach(b => b.onclick = () => {
      readPropertyInputs();
      APP.pf.properties.splice(+b.dataset.delProp, 1);
      fullRefresh(); APP.tab = "props"; renderTab();
    });
    document.querySelectorAll("[data-del-snap]").forEach(b => b.onclick = () => {
      RETAX.State.deleteSnapshot(+b.dataset.delSnap); renderTab();
    });
    const snap = el("btn-snap");
    if (snap) snap.onclick = () => {
      const best = APP.results.evalAll[0];
      RETAX.State.saveSnapshot(APP.pf, {
        bestStrategy: best.strategy.name, terminalWealthBest: best.terminalWealth,
        holdingTaxY0: APP.results.holdSim.years[0].holdingTax
      });
      renderTab();
    };
    const exp = el("btn-export");
    if (exp) exp.onclick = () => {
      navigator.clipboard.writeText(JSON.stringify(APP.pf, null, 2));
      exp.textContent = "복사됨 ✓";
    };
    const lawCheck = el("btn-law-check");
    if (lawCheck) lawCheck.onclick = async () => {
      lawCheck.textContent = "확인 중…"; lawCheck.disabled = true;
      await runLawCheck(true);
      lawCheck.disabled = false;
      if (APP.tab === "law") renderTab();
    };
    document.querySelectorAll("[data-stress]").forEach(b => b.onclick = () => {
      const a = APP.pf.assumptions;
      const map = {
        crash: { mg: { [a.startYear + 1]: -0.20, [a.startYear + 2]: 0 }, pg: { [a.startYear + 1]: -0.10, [a.startYear + 2]: 0 } },
        flat: { mg: 0, pg: 0 },
        pubUp: { mg: 0.03, pg: 0.15 },
        reset: null
      };
      if (b.dataset.stress === "reset") { a.scenarioKey = "BASE"; }
      else {
        const m = map[b.dataset.stress];
        a.scenarioKey = "CUSTOM";
        a.customScenario.marketGrowth = m.mg;
        a.customScenario.publicGrowth = m.pg;
      }
      fullRefresh();
    });
  }

  function renderLawStatus() {
    const M = RETAX.LawMonitor;
    const st = el("law-status");
    if (st) st.innerHTML =
      `세법 데이터 v${esc(M.state.appliedVersion)} · 갱신 ${esc(M.fmtTime(M.state.appliedAt))} · ` +
      (M.state.lastResult === "UPDATED" ? "🔔 새 세법 적용됨"
        : M.state.lastResult === "UP_TO_DATE" ? "✅ 최신 (확인 " + esc(M.fmtTime(M.state.lastCheckedAt)) + ")"
        : M.state.lastResult === "OFFLINE" ? "⚠ 인터넷 확인 실패 — 내장 세법(검증일 " + Reg.META_VERIFIED_AT + ") 사용"
        : "확인 중…");
    const banner = el("law-banner");
    if (banner) {
      banner.innerHTML = (M.state.lastResult === "UPDATED" && M.state.changedRuleIds.length)
        ? `<div class="law-update">🔔 <b>세법 변경 알림</b> —
           세법 데이터가 v${esc(M.state.appliedVersion)}(으)로 갱신되었습니다
           (갱신 시각: <b>${esc(M.fmtTime(M.state.appliedAt))}</b>,
           바뀐 규칙: ${M.state.changedRuleIds.map(esc).join(", ")}).
           모든 계산이 새 세법으로 자동으로 다시 이루어졌습니다 — 자세한 내용은 「세법 정보」 탭에서 확인하세요.</div>`
        : "";
    }
  }

  /** 법령 DB 자동 확인 → 변경 시 전체 재계산 (PART 96~97) */
  async function runLawCheck() {
    const M = RETAX.LawMonitor;
    await M.check();
    if (M.state.lastResult === "UPDATED" && M.state.changedRuleIds.length) {
      recompute();                 // 새 규칙으로 자동 재계산
      renderTab();
    }
    renderLawStatus();
    renderFooter();
  }

  function renderFooter() {
    el("footer-meta").textContent =
      `Ver. ${Reg.APP_VERSION} · 제작 Dr. Min & Dr. Lee · 세법 데이터 v${RETAX.LawMonitor.state.appliedVersion}` +
      ` (검증일 ${Reg.META_VERIFIED_AT}) · 세법 규칙 ${Reg.RULES.length}개 · 전략 ${APP.results.evalAll.length}개 비교 계산 (${APP.results.computeMs}ms)`;
  }

  function init() {
    APP.pf = RETAX.State.load();
    recompute();
    renderShell();
    bindShellEvents();
    renderTab();
    renderFooter();
    renderLawStatus();
    runLawCheck();   // 접속할 때마다 법령 DB 자동 확인 (비동기)
  }

  return { init, APP, runLawCheck };
})();

if (typeof module !== "undefined") module.exports = RETAX.UI;
