/* =========================================================
 * 종합부동산세 ENGINE (납세의무자별 인별 합산)
 *
 * 계산 순서 (PART 14):
 *  1 taxpayer별 대상주택 파악 → 2 주택수 판정 → 3 합산배제 → 4 공시가격 합산
 *  → 5 기본공제 → 6 공정시장가액비율 → 7 과세표준 → 8 누진세율
 *  → 9 재산세 중복분 공제 → 10 세액공제 → 11 세부담상한 → 12 종부세 → 13 농특세
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.Jongbuse = (function () {
  const U = RETAX.Util;
  const Reg = RETAX.Registry;

  /**
   * @param {object} opts
   *  year, lawMode
   *  holdings: [{ propertyId, name, publicPrice(지분반영 전 100%), share,
   *               isRegulated(과세기준일 시점), isResidence(실거주 주택 여부), excluded(합산배제) }]
   *  houseCount        납세의무자 주택수 (지분 보유 포함)
   *  isHouseholdOneHome  1세대 1주택(단독명의) 여부 → 12억/14억 공제 + 세액공제
   *  residesInOneHome  1세대1주택자가 그 주택에 실거주하는지 (개편안 공제 판정)
   *  age, holdingYears  1세대1주택 세액공제용
   *  prevYearEquivalent 전년 (재산세+종부세) 상당액 — 세부담상한용, null 허용
   * @returns 상세 breakdown
   */
  function computeForTaxpayer(opts) {
    const { year, lawMode, holdings, houseCount, isHouseholdOneHome,
            residesInOneHome, age, holdingYears, prevYearEquivalent } = opts;
    const date = U.assessmentDate(year);
    const rule = Reg.getRule("COMPREHENSIVE_TAX", date, lawMode || "CURRENT");
    const p = rule.params;
    const isReform = rule.ruleId === "CRT-2026REFORM";
    const steps = [];
    const flags = [];

    // 1~4. 합산 (합산배제 제외, 지분 반영)
    const taxable = holdings.filter(h => !h.excluded);
    const sumPublic = U.won(taxable.reduce((s, h) => s + h.publicPrice * (h.share == null ? 1 : h.share), 0));
    steps.push({ label: "공시가격 합산 (지분 반영, " + taxable.length + "건)", value: sumPublic });

    // 5. 기본공제
    let deduction;
    if (isReform) {
      if (isHouseholdOneHome) {
        deduction = residesInOneHome ? p.oneHomeResidingDeduction : p.oneHomeNonResidingDeduction;
        steps.push({ label: "기본공제 (개편안 1세대1주택 " + (residesInOneHome ? "실거주 14억" : "비거주 9억") + ")", value: deduction });
      } else {
        const residencePublic = U.won(taxable.filter(h => h.isResidence)
          .reduce((s, h) => s + h.publicPrice * (h.share == null ? 1 : h.share), 0));
        const bonus = sumPublic > 0 ? U.won(p.multiResidenceBonusMax * Math.min(1, residencePublic / sumPublic)) : 0;
        deduction = p.multiBaseDeduction + bonus;
        steps.push({ label: "기본공제 (개편안 다주택: 4억 + 5억 × 거주주택비중 " +
          U.pct(sumPublic ? residencePublic / sumPublic : 0) + ")", value: deduction });
      }
      flags.push("PROPOSED_LAW");
    } else {
      deduction = isHouseholdOneHome ? p.oneHomeDeduction : p.basicDeduction;
      steps.push({ label: "기본공제 (" + (isHouseholdOneHome ? "1세대1주택 12억" : "9억") + ")", value: deduction });
    }

    const afterDeduction = Math.max(0, sumPublic - deduction);

    // 6. 공정시장가액비율
    const hasRegulated = taxable.some(h => h.isRegulated);
    const isHighGroup = houseCount >= 3 || hasRegulated;
    const fmv = isReform ? p.fmvRatioByYear(year, isHighGroup) : p.fmvRatio;
    steps.push({ label: "공정시장가액비율", value: fmv, isRate: true });

    // 7. 과세표준
    const taxBase = U.won(afterDeduction * fmv);
    steps.push({ label: "과세표준", value: taxBase });

    // 8. 누진세율
    let rateResult, rateLabel;
    if (isReform && year >= p.unifiedFromYear) {
      // 가액 기준 일원화: 과표 12억 이하 일반세율, 초과분 중과세율 수준 (주택수 무관)
      const cur = Reg.getRule("COMPREHENSIVE_TAX", date, "CURRENT").params;
      const unified = cur.generalBrackets.map((b, i) =>
        b.upTo <= p.unifiedThreshold ? b : cur.multiBrackets[i]);
      rateResult = U.progressiveTax(taxBase, unified);
      rateLabel = "산출세액 (개편안 가액기준 일원화 세율)";
      flags.push("UNVERIFIED_RATE_TABLE");
    } else {
      const cur = isReform ? Reg.getRule("COMPREHENSIVE_TAX", date, "CURRENT").params : p;
      const useMulti = houseCount >= 3;
      rateResult = U.progressiveTax(taxBase, useMulti ? cur.multiBrackets : cur.generalBrackets);
      rateLabel = "산출세액 (" + (useMulti ? "3주택 이상 중과세율" : "일반세율") + ")";
    }
    const grossTax = rateResult.tax;
    steps.push({ label: rateLabel, value: grossTax, detail: rateResult.steps });

    // 9. 재산세 중복분 공제
    //  공제액 = 실제 부과 재산세(본세) 합계 × [종부세 과표 × 재산세FMV에 표준세율 적용액] ÷ [주택별 표준세율 재산세 상당액 합]
    const ptxRule = Reg.getRule("PROPERTY_TAX", date, "CURRENT").params;
    let propertyTaxPaid = 0, standardSum = 0;
    for (const h of taxable) {
      const share = h.share == null ? 1 : h.share;
      const std = U.progressiveTax(U.won(h.publicPrice * ptxRule.fmvRatio), ptxRule.standardBrackets).tax;
      standardSum += U.won(std * share);
      propertyTaxPaid += U.won((h.propertyTaxMain != null ? h.propertyTaxMain : std) * share);
    }
    const numerator = U.progressiveTax(U.won(taxBase * ptxRule.fmvRatio), ptxRule.standardBrackets).tax;
    let propertyTaxCredit = standardSum > 0
      ? Math.min(propertyTaxPaid, U.won(propertyTaxPaid * numerator / standardSum))
      : 0;
    propertyTaxCredit = Math.min(propertyTaxCredit, grossTax);
    steps.push({ label: "재산세 중복분 공제", value: -propertyTaxCredit });

    let tax = grossTax - propertyTaxCredit;

    // 10. 1세대1주택 세액공제 (고령자 + 장기보유, 합산 80% 한도)
    let creditRatio = 0, creditDetail = [];
    if (isHouseholdOneHome) {
      const ac = (p.ageCredits || []).find(c => (age || 0) >= c.minAge);
      const hc = (p.holdCredits || []).find(c => (holdingYears || 0) >= c.minYears);
      if (ac) { creditRatio += ac.credit; creditDetail.push("고령자 " + U.pct(ac.credit, 0)); }
      if (hc) { creditRatio += hc.credit; creditDetail.push("장기보유 " + U.pct(hc.credit, 0)); }
      creditRatio = Math.min(creditRatio, p.creditCap);
    }
    const credit = U.won(tax * creditRatio);
    if (credit > 0) steps.push({ label: "세액공제 (" + creditDetail.join(" + ") + ")", value: -credit });
    tax -= credit;

    // 11. 세부담상한 (전년 재산세+종부세 상당액 × 150%)
    let capApplied = false;
    if (prevYearEquivalent != null && prevYearEquivalent > 0) {
      const thisYearEquivalent = propertyTaxPaid + tax;
      const cap = U.won(prevYearEquivalent * p.burdenCapRatio);
      if (thisYearEquivalent > cap) {
        const capped = Math.max(0, cap - propertyTaxPaid);
        steps.push({ label: "세부담상한 (전년 상당액 × 150%)", value: capped - tax });
        tax = capped;
        capApplied = true;
      }
    }

    // 12~13. 종부세 + 농특세
    tax = Math.max(0, U.won(tax));
    const ruralTax = U.won(tax * p.ruralSurtaxRate);
    steps.push({ label: "종합부동산세 결정세액", value: tax });
    steps.push({ label: "농어촌특별세 (20%)", value: ruralTax });
    steps.push({ label: "총 납부액", value: tax + ruralTax });

    return {
      ruleId: rule.ruleId, rule, year, lawMode: lawMode || "CURRENT",
      sumPublic, deduction, fmvRatio: fmv, taxBase, houseCount,
      grossTax, propertyTaxCredit, credit, capApplied,
      tax, ruralTax, total: tax + ruralTax,
      equivalentForNextYearCap: propertyTaxPaid + tax,
      steps, flags,
      grade: isReform ? "PROPOSED_LAW" : "EXACT"
    };
  }

  return { computeForTaxpayer };
})();

if (typeof module !== "undefined") module.exports = RETAX.Jongbuse;
