/* =========================================================
 * MARKET VALUE ENGINE
 * - 시장가격 상승률(marketGrowth)과 공시가격 상승률(publicGrowth)은
 *   절대로 같은 변수로 취급하지 않는다. (PART 23)
 * - 시나리오: BEAR / BASE / BULL / CUSTOM, 연도별 개별 입력 지원 (PART 24~25)
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.Market = (function () {
  const U = RETAX.Util;

  const DEFAULT_SCENARIOS = {
    BEAR: { key: "BEAR", label: "보수적", marketGrowth: -0.01, publicGrowth: 0.00 },
    BASE: { key: "BASE", label: "기준",   marketGrowth: 0.03,  publicGrowth: 0.025 },
    BULL: { key: "BULL", label: "강세",   marketGrowth: 0.06,  publicGrowth: 0.05 }
  };

  /** growth: number(고정) 또는 {2027:0.07, 2028:0.05,...}(연도별) */
  function growthFor(growth, year) {
    if (growth == null) return 0;
    if (typeof growth === "number") return growth;
    if (growth[year] != null) return growth[year];
    // 연도별 입력이 끊기면 마지막 입력값 유지
    const years = Object.keys(growth).map(Number).sort((a, b) => a - b);
    let last = 0;
    for (const y of years) if (y <= year) last = growth[y];
    return last;
  }

  /**
   * 기준연도 값에서 연도별 시계열을 만든다.
   * @returns {baseYear: v, baseYear+1: v*(1+g), ...}
   */
  function projectSeries(baseValue, baseYear, endYear, growth) {
    const out = {};
    let v = baseValue;
    out[baseYear] = U.won(v);
    for (let y = baseYear + 1; y <= endYear; y++) {
      v = v * (1 + growthFor(growth, y));
      out[y] = U.won(v);
    }
    return out;
  }

  /**
   * 부동산 1건의 시장가치/공시가격 시계열.
   * property.publicPriceByYear의 실제값(확정 공시가격)이 있으면 우선 사용하고,
   * 없는 미래 연도는 성장률로 추정한다(SCENARIO 등급).
   */
  function projectProperty(property, scenario, startYear, endYear) {
    const perPropGrowth = property.marketGrowthOverride;
    const mg = perPropGrowth != null ? perPropGrowth : scenario.marketGrowth;
    const market = projectSeries(property.marketValue, property.marketValueYear || startYear, endYear, mg);

    const known = property.publicPriceByYear || {};
    const knownYears = Object.keys(known).map(Number).sort((a, b) => a - b);
    const lastKnownYear = knownYears.length ? knownYears[knownYears.length - 1] : null;
    const pub = {};
    if (lastKnownYear != null) {
      for (const y of knownYears) pub[y] = known[y];
      let v = known[lastKnownYear];
      for (let y = lastKnownYear + 1; y <= endYear; y++) {
        v = v * (1 + growthFor(scenario.publicGrowth, y));
        pub[y] = U.won(v);
      }
      // 기준연도 이전 공백은 첫 확정값으로 채움 (근사)
      for (let y = startYear; y < knownYears[0]; y++) pub[y] = known[knownYears[0]];
    } else {
      // 공시가격 자료가 전혀 없으면 시장가치 × 공시가율 가정 (ASSUMPTION)
      const ratio = property.publicRatioAssumption || 0.65;
      for (let y = startYear; y <= endYear; y++) pub[y] = U.won(market[y] * ratio);
    }
    return {
      market, public: pub,
      publicGradeByYear: y => (known[y] != null ? "EXACT" : "SCENARIO"),
      marketGradeByYear: y => (y <= (property.marketValueYear || startYear) ? "ESTIMATED" : "SCENARIO")
    };
  }

  /** Break-even appreciation rate = (연간 순보유비용 − 순임대수익) / 시장가치 */
  function breakEvenRate(carryingCost, netRental, marketValue) {
    if (!marketValue) return null;
    return (carryingCost - netRental) / marketValue;
  }

  return { DEFAULT_SCENARIOS, growthFor, projectSeries, projectProperty, breakEvenRate };
})();

if (typeof module !== "undefined") module.exports = RETAX.Market;
