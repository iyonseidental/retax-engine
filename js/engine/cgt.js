/* =========================================================
 * 양도소득세 ENGINE (CAPITAL GAINS TAX)
 * - 양도일 기준 유효 법령(중과 이력 포함)으로 계산한다.
 * - 1세대1주택 비과세(12억 초과 고가주택 안분), 장기보유특별공제,
 *   다주택 중과(조정대상지역), 단기양도, 지방소득세 포함.
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.CGT = (function () {
  const U = RETAX.Util;
  const Reg = RETAX.Registry;

  /**
   * @param {object} opts
   *  saleDate, salePrice          양도일, 양도가액 (지분 100% 기준)
   *  acquisitionDate, acquisitionPrice
   *  necessaryExpenses            취득세·법무사·중개·자본적지출 등 (취득측)
   *  sellingCosts                 양도 시 중개수수료 등 (양도비)
   *  share                        양도자 지분 (기본 1)
   *  residenceYears               실거주 연수
   *  householdCountAtSale         양도일 현재 1세대 보유주택 수 (양도주택 포함)
   *  isRegulatedAtSale            양도일 현재 조정대상지역 여부
   *  acquiredWhileRegulated       취득 당시 조정대상지역 여부 (비과세 거주요건 판정)
   *  lawMode
   * @returns 상세 breakdown
   */
  function compute(opts) {
    const {
      saleDate, salePrice, acquisitionDate, acquisitionPrice,
      necessaryExpenses = 0, sellingCosts = 0, share = 1,
      residenceYears = 0, householdCountAtSale, isRegulatedAtSale,
      acquiredWhileRegulated = false, lawMode
    } = opts;

    const basic = Reg.getRule("CGT_BASIC", saleDate, lawMode || "CURRENT").params;
    const surRule = Reg.getRule("CGT_SURCHARGE", saleDate, lawMode || "CURRENT");
    const sur = surRule ? surRule.params : { active: false };
    const steps = [];
    const flags = [];

    const holdingYears = U.fullYearsBetween(acquisitionDate, saleDate);

    // ---------- 양도차익 (지분 반영) ----------
    const gSale = U.won(salePrice * share);
    const gAcq = U.won(acquisitionPrice * share);
    const gExp = U.won((necessaryExpenses + sellingCosts) * share);
    let gain = gSale - gAcq - gExp;
    steps.push({ label: "양도가액 (지분 " + U.pct(share, 0) + ")", value: gSale });
    steps.push({ label: "취득가액", value: -gAcq });
    steps.push({ label: "필요경비 + 양도비", value: -gExp });
    steps.push({ label: "양도차익", value: gain });

    if (gain <= 0) {
      return finish(0, 0, { steps, flags, holdingYears, gain, taxableGain: 0, taxBase: 0,
        exempt: false, surcharged: false, ltsd: 0, rateInfo: null, basic });
    }

    // ---------- 1세대1주택 비과세 판정 ----------
    // 요건: 1주택 + 보유 2년 이상 (+ 조정대상지역에서 취득한 경우 거주 2년 이상)
    const isOneHome = householdCountAtSale === 1;
    const meetsHold = holdingYears >= 2;
    const meetsReside = !acquiredWhileRegulated || residenceYears >= 2;
    const exempt = isOneHome && meetsHold && meetsReside;
    let taxableGain = gain;

    if (exempt) {
      if (gSale <= basic.highPriceExemptionThreshold) {
        steps.push({ label: "1세대1주택 비과세 (양도가액 12억 이하)", value: -gain });
        return finish(0, 0, { steps, flags, holdingYears, gain, taxableGain: 0, taxBase: 0,
          exempt: true, surcharged: false, ltsd: 0, rateInfo: null, basic });
      }
      // 고가주택: 12억 초과분 안분
      taxableGain = U.won(gain * (gSale - basic.highPriceExemptionThreshold) / gSale);
      steps.push({ label: "1세대1주택 고가주택 과세대상 차익 (12억 초과분 안분)", value: taxableGain });
    } else if (isOneHome && !meetsReside) {
      flags.push("조정대상지역 취득 1주택: 거주 2년 미충족으로 비과세 배제");
    }

    // ---------- 중과 여부 (양도일 시점 규칙) ----------
    const surcharged = !!(sur.active && isRegulatedAtSale && householdCountAtSale >= 2 && !exempt);
    let surchargeRate = 0;
    if (surcharged) {
      surchargeRate = householdCountAtSale >= 3 ? sur.threeHome : sur.twoHome;
      flags.push("다주택 중과 적용 (" + surRule.ruleId + ", +" + U.pct(surchargeRate, 0) + "p)");
      if (surRule.status === "PROPOSED") flags.push("PROPOSED_LAW");
    }

    // ---------- 장기보유특별공제 ----------
    let ltsdRatio = 0, ltsdLabel = "";
    const ltsdExcluded = surcharged && sur.ltsdExcluded;
    if (!ltsdExcluded && holdingYears >= basic.ltsdGeneralMinYears) {
      if (exempt && residenceYears >= basic.ltsdOneHomeMinResideYears) {
        // 1세대1주택 표2: 보유 연4% + 거주 연4%, 최대 80%
        ltsdRatio = Math.min(basic.ltsdOneHomeMax,
          Math.min(10, holdingYears) * basic.ltsdOneHomeHoldPerYear +
          Math.min(10, residenceYears) * basic.ltsdOneHomeResidePerYear);
        ltsdLabel = "장기보유특별공제 표2 (보유 " + holdingYears + "년 + 거주 " + residenceYears + "년)";
      } else {
        ltsdRatio = Math.min(basic.ltsdGeneralMax, holdingYears * basic.ltsdGeneralPerYear);
        ltsdLabel = "장기보유특별공제 일반 (" + holdingYears + "년 × 2%)";
      }
    } else if (ltsdExcluded) {
      ltsdLabel = "장기보유특별공제 배제 (중과대상)";
    }
    const ltsd = U.won(taxableGain * ltsdRatio);
    if (ltsdLabel) steps.push({ label: ltsdLabel + (ltsd ? " " + U.pct(ltsdRatio, 0) : ""), value: -ltsd });

    // ---------- 과세표준 ----------
    const taxBase = Math.max(0, taxableGain - ltsd - basic.annualBasicDeduction);
    steps.push({ label: "기본공제", value: -Math.min(basic.annualBasicDeduction, taxableGain - ltsd) });
    steps.push({ label: "과세표준", value: taxBase });

    // ---------- 세율 ----------
    let nationalTax, rateInfo;
    if (holdingYears < 1) {
      nationalTax = U.won(taxBase * basic.shortTermUnder1yr);
      rateInfo = { type: "단기(1년 미만)", rate: basic.shortTermUnder1yr };
    } else if (holdingYears < 2) {
      nationalTax = U.won(taxBase * basic.shortTermUnder2yr);
      rateInfo = { type: "단기(2년 미만)", rate: basic.shortTermUnder2yr };
    } else {
      const br = U.bracketRateOf(taxBase, basic.basicBrackets);
      const rate = br.rate + surchargeRate;
      nationalTax = Math.max(0, U.won(taxBase * rate - br.deduction));
      rateInfo = { type: surcharged ? "기본세율 + 중과" : "기본세율",
                   rate, baseRate: br.rate, surchargeRate, deduction: br.deduction };
    }
    steps.push({
      label: "산출세액 (" + rateInfo.type + " " + U.pct(rateInfo.rate, 0) +
             (rateInfo.deduction ? ", 누진공제 " + U.fmt(rateInfo.deduction) : "") + ")",
      value: nationalTax
    });

    const localTax = U.won(nationalTax * basic.localIncomeTaxRate);
    steps.push({ label: "지방소득세 (10%)", value: localTax });
    steps.push({ label: "양도 관련 총 세금", value: nationalTax + localTax });

    return finish(nationalTax, localTax, {
      steps, flags, holdingYears, gain, taxableGain, taxBase,
      exempt, surcharged, ltsd, rateInfo, basic, surRuleId: surRule ? surRule.ruleId : null
    });
  }

  function finish(nationalTax, localTax, ctx) {
    return {
      nationalTax, localTax, total: nationalTax + localTax,
      gain: ctx.gain, taxableGain: ctx.taxableGain, taxBase: ctx.taxBase,
      holdingYears: ctx.holdingYears, exempt: ctx.exempt, surcharged: ctx.surcharged,
      ltsd: ctx.ltsd, rateInfo: ctx.rateInfo, steps: ctx.steps, flags: ctx.flags,
      surRuleId: ctx.surRuleId || null,
      grade: ctx.flags.includes("PROPOSED_LAW") ? "PROPOSED_LAW" : "EXACT"
    };
  }

  return { compute };
})();

if (typeof module !== "undefined") module.exports = RETAX.CGT;
