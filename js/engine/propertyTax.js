/* =========================================================
 * 재산세 ENGINE (주택분, 물건별 과세 → 소유자 지분 안분)
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.PropertyTax = (function () {
  const U = RETAX.Util;
  const Reg = RETAX.Registry;

  /**
   * 주택 1채의 재산세 계산 (지분 100% 기준 → share 안분은 호출부에서)
   * @param {object} opts
   *   year            귀속연도
   *   publicPrice     해당 연도 공시가격 (지분 100% 기준)
   *   isOneHomeHousehold  1세대 1주택 여부 (특례 공정시장가액비율/세율 판정용)
   *   prevTaxBase     직전연도 과세표준 (과표상한제 체인용, null 허용)
   *   lawMode
   * @returns 상세 breakdown
   */
  function compute(opts) {
    const { year, publicPrice, isOneHomeHousehold, prevTaxBase, lawMode } = opts;
    const date = U.assessmentDate(year);
    const rule = Reg.getRule("PROPERTY_TAX", date, lawMode || "CURRENT");
    const p = rule.params;
    const steps = [];

    // 1. 공정시장가액비율
    let fmv = p.fmvRatio;
    if (isOneHomeHousehold) {
      for (const b of p.fmvRatioOneHome) { if (publicPrice <= b.upTo) { fmv = b.ratio; break; } }
    }
    steps.push({ label: "공시가격", value: publicPrice });
    steps.push({ label: "공정시장가액비율", value: fmv, isRate: true });

    // 2. 과세표준 (+ 과표상한제: 전년 과표 × (1+5%) 상한)
    let taxBase = U.won(publicPrice * fmv);
    let capApplied = false;
    if (prevTaxBase != null && prevTaxBase > 0) {
      const cap = U.won(prevTaxBase * (1 + p.taxBaseCapGrowth));
      if (taxBase > cap) { taxBase = cap; capApplied = true; }
    }
    steps.push({ label: "과세표준" + (capApplied ? " (과표상한 5% 적용)" : ""), value: taxBase });

    // 3. 세율 (1주택 9억 이하 특례세율)
    const useSpecial = isOneHomeHousehold && publicPrice <= p.specialOneHomePriceCap;
    const brackets = useSpecial ? p.specialOneHomeBrackets : p.standardBrackets;
    const prog = U.progressiveTax(taxBase, brackets);
    const mainTax = prog.tax;
    steps.push({ label: "재산세 본세" + (useSpecial ? " (1주택 특례세율)" : " (표준세율)"), value: mainTax, detail: prog.steps });

    // 4. 부가세목
    const urbanTax = U.won(taxBase * p.urbanAreaRate);
    const eduTax = U.won(mainTax * p.localEducationRate);
    steps.push({ label: "도시지역분 (과표 × 0.14%)", value: urbanTax });
    steps.push({ label: "지방교육세 (본세 × 20%)", value: eduTax });

    const total = mainTax + urbanTax + eduTax;
    steps.push({ label: "재산세 합계", value: total });

    /** 표준세율 기준 재산세 상당액 (종부세 중복분 공제 계산용, 특례 미적용) */
    const standardEquivalent = U.progressiveTax(U.won(publicPrice * p.fmvRatio), p.standardBrackets).tax;

    return {
      ruleId: rule.ruleId, rule, year, taxBase, fmvRatio: fmv, useSpecialRate: useSpecial,
      mainTax, urbanTax, eduTax, total, standardEquivalent, steps,
      grade: "EXACT" // 공시가격이 확정값이면 EXACT, 예측이면 호출부에서 SCENARIO로 격하
    };
  }

  return { compute };
})();

if (typeof module !== "undefined") module.exports = RETAX.PropertyTax;
