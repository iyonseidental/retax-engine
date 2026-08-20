/* =========================================================
 * HOLDING TAX ORCHESTRATOR
 * 한 해(과세기준일 6/1)의 세대 전체 보유세를 계산한다.
 *  - 재산세: 물건별 산출 → 소유자 지분 안분
 *  - 종부세: 납세의무자(인)별 합산
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.Holding = (function () {
  const U = RETAX.Util;
  const Reg = RETAX.Registry;

  /**
   * @param {object} opts
   *  year, lawMode
   *  household: { taxpayers: [{id, name, age}] }
   *  held: [{ property, publicPrice }]  — 해당 연도 6/1 현재 보유 중이며 납세의무가 있는 주택
   *  prevState: { propertyTaxBase: {propId: base}, taxpayerEquivalent: {tpId: amount} } | null
   */
  function computeYear(opts) {
    const { year, lawMode, household, held, prevState } = opts;
    const assessDate = U.assessmentDate(year);
    const isOneHomeHousehold = held.length === 1;

    // ---------- 재산세 (물건별) ----------
    const perProperty = [];
    const nextPropertyTaxBase = {};
    for (const h of held) {
      const prop = h.property;
      const prevBase = prevState && prevState.propertyTaxBase ? prevState.propertyTaxBase[prop.id] : null;
      const ptx = RETAX.PropertyTax.compute({
        year, publicPrice: h.publicPrice, isOneHomeHousehold,
        prevTaxBase: prevBase, lawMode
      });
      nextPropertyTaxBase[prop.id] = ptx.taxBase;
      perProperty.push({ propertyId: prop.id, name: prop.name, publicPrice: h.publicPrice, ptx });
    }

    // ---------- 종부세 (납세의무자별) ----------
    const perTaxpayer = [];
    const nextTaxpayerEquivalent = {};
    for (const tp of household.taxpayers) {
      const holdings = [];
      for (const h of held) {
        const prop = h.property;
        const owner = (prop.owners || []).find(o => o.taxpayerId === tp.id);
        if (!owner || owner.share <= 0) continue;
        const ptxRow = perProperty.find(pp => pp.propertyId === prop.id);
        holdings.push({
          propertyId: prop.id, name: prop.name,
          publicPrice: h.publicPrice, share: owner.share,
          isRegulated: Reg.isRegulatedAt(prop.district, assessDate),
          isResidence: !!(prop.residence && prop.residence.isCurrentResidence),
          excluded: !!prop.exemptFromAggregation,
          propertyTaxMain: ptxRow ? ptxRow.ptx.mainTax : null
        });
      }
      if (!holdings.length) continue;

      const houseCount = holdings.filter(h => !h.excluded).length;
      const soleOneHome = isOneHomeHousehold && holdings.length === 1 && holdings[0].share >= 1;
      const theHome = holdings[0];
      const holdingYears = soleOneHome
        ? U.fullYearsBetween((held.find(x => x.property.id === theHome.propertyId).property.acquisitionDate), assessDate)
        : 0;

      const jbs = RETAX.Jongbuse.computeForTaxpayer({
        year, lawMode, holdings, houseCount,
        isHouseholdOneHome: soleOneHome,
        residesInOneHome: soleOneHome && theHome.isResidence,
        age: tp.age, holdingYears,
        prevYearEquivalent: prevState && prevState.taxpayerEquivalent ? prevState.taxpayerEquivalent[tp.id] : null
      });
      nextTaxpayerEquivalent[tp.id] = jbs.equivalentForNextYearCap;
      perTaxpayer.push({ taxpayerId: tp.id, name: tp.name, jbs });
    }

    // ---------- 합계 ----------
    const propertyTaxTotal = perProperty.reduce((s, p) => s + p.ptx.total, 0);
    const jongbuseTotal = perTaxpayer.reduce((s, t) => s + t.jbs.tax, 0);
    const ruralTotal = perTaxpayer.reduce((s, t) => s + t.jbs.ruralTax, 0);

    return {
      year, lawMode, isOneHomeHousehold,
      perProperty, perTaxpayer,
      totals: {
        propertyTax: propertyTaxTotal,
        jongbuse: jongbuseTotal,
        ruralTax: ruralTotal,
        total: propertyTaxTotal + jongbuseTotal + ruralTotal
      },
      nextState: { propertyTaxBase: nextPropertyTaxBase, taxpayerEquivalent: nextTaxpayerEquivalent }
    };
  }

  return { computeYear };
})();

if (typeof module !== "undefined") module.exports = RETAX.Holding;
