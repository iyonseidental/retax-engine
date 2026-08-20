/* =========================================================
 * HOLD / SELL STRATEGY ENGINE
 * - 전략(매도 계획)별로 연도별 시뮬레이션을 돌려
 *   AFTER-TAX TERMINAL WEALTH, NPV, 누적보유세, CGT를 계산한다.
 * - 6/1 과세기준일 귀속, 매도 후 잔여 주택 세제 재계산,
 *   매도대금 기회수익(cashReturn), Break-even, Reversal Point 포함.
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.Strategy = (function () {
  const U = RETAX.Util;
  const Reg = RETAX.Registry;
  const Market = RETAX.Market;

  const DEFAULT_ASSUMPTIONS = {
    startYear: 2026,
    endYear: 2035,
    lawMode: "CURRENT",
    scenarioKey: "BASE",
    cashReturn: 0.03,        // 매도대금 운용수익률 (세후 가정)
    discountRate: 0.03,      // NPV 할인율
    liquidateAtEnd: true,    // 종료연도에 잔여 주택 전량 매도 가정(양도세 반영, 공정 비교)
    sellingCostRate: 0.007   // 중개수수료 등 매도비용률
  };

  /* =========================================================
   * 핵심 시뮬레이터
   * plan = { name, sales: [{propertyId, date}] }
   * ========================================================= */
  function simulate(portfolio, plan, assumptionsIn) {
    const A = Object.assign({}, DEFAULT_ASSUMPTIONS, assumptionsIn || {});
    const scenario = A.scenario ||
      Object.assign({}, Market.DEFAULT_SCENARIOS[A.scenarioKey] || Market.DEFAULT_SCENARIOS.BASE);
    if (A.marketGrowthOverride != null) scenario.marketGrowth = A.marketGrowthOverride;
    if (A.publicGrowthOverride != null) scenario.publicGrowth = A.publicGrowthOverride;

    const props = portfolio.properties;
    const series = {};
    for (const p of props) series[p.id] = Market.projectProperty(p, scenario, A.startYear, A.endYear);

    // 매도 계획 정리 (종료연도 청산 포함)
    const sales = (plan.sales || []).slice().sort((a, b) => U.cmpDate(a.date, b.date));
    const plannedIds = new Set(sales.map(s => s.propertyId));
    const liquidations = [];
    if (A.liquidateAtEnd) {
      for (const p of props) if (!plannedIds.has(p.id))
        liquidations.push({ propertyId: p.id, date: U.dstr(A.endYear, 12, 15), isLiquidation: true });
    }
    const allSales = sales.concat(liquidations).sort((a, b) => U.cmpDate(a.date, b.date));

    let held = new Set(props.map(p => p.id));
    let cash = 0;
    let holdState = null;
    let cumHoldingTax = 0, totalCGT = 0, totalSellingCosts = 0;
    const years = [], saleRecords = [];
    const rawFlows = {};

    for (let y = A.startYear; y <= A.endYear; y++) {
      const yearSales = allSales.filter(s => U.yearOf(s.date) === y && held.has(s.propertyId));
      let saleProceeds = 0, yearCGT = 0, yearSellCost = 0;

      // ---------- 매도 처리 (양도일 순서대로, 주택수는 양도일 현재 기준) ----------
      for (const s of yearSales) {
        const prop = props.find(p => p.id === s.propertyId);
        const salePrice = series[prop.id].market[y];
        const countAtSale = held.size; // 양도주택 포함
        const resideYears = residenceYearsAt(prop, y, A.startYear);
        // 양도세는 소유자별(지분별)로 각각 계산한다 — 누진세율·기본공제가 인별 적용되므로
        const owners = (prop.owners && prop.owners.length) ? prop.owners : [{ taxpayerId: null, share: 1 }];
        const perOwnerCGT = owners.map(o => RETAX.CGT.compute({
          saleDate: s.date, salePrice,
          acquisitionDate: prop.acquisitionDate, acquisitionPrice: prop.acquisitionPrice,
          necessaryExpenses: prop.necessaryExpenses || 0,
          sellingCosts: 0, // 매도비용은 아래 별도 현금흐름 (필요경비 이중반영 방지)
          share: o.share,
          residenceYears: resideYears,
          householdCountAtSale: countAtSale,
          isRegulatedAtSale: Reg.isRegulatedAt(prop.district, s.date),
          acquiredWhileRegulated: Reg.isRegulatedAt(prop.district, prop.acquisitionDate),
          lawMode: A.lawMode
        }));
        const cgt = {
          nationalTax: perOwnerCGT.reduce((t, c) => t + c.nationalTax, 0),
          localTax: perOwnerCGT.reduce((t, c) => t + c.localTax, 0),
          total: perOwnerCGT.reduce((t, c) => t + c.total, 0),
          exempt: perOwnerCGT.every(c => c.exempt),
          surcharged: perOwnerCGT.some(c => c.surcharged),
          perOwner: perOwnerCGT, steps: perOwnerCGT[0].steps, flags: perOwnerCGT[0].flags
        };
        const sellCost = U.won(salePrice * (prop.sellingCostRate != null ? prop.sellingCostRate : A.sellingCostRate));
        const loanBal = prop.loan ? (prop.loan.balance || 0) : 0;
        const netProceeds = salePrice - cgt.total - sellCost - loanBal;
        saleProceeds += netProceeds;
        yearCGT += cgt.total; yearSellCost += sellCost;
        totalCGT += cgt.total; totalSellingCosts += sellCost;
        saleRecords.push({
          propertyId: prop.id, name: prop.name, date: s.date, year: y,
          salePrice, cgt, sellCost, loanRepaid: loanBal, netProceeds,
          countAtSale, isLiquidation: !!s.isLiquidation
        });
        held.delete(prop.id);
      }

      // ---------- 보유세 (6/1 기준: 그 해 6/1 초과 매도자는 그 해 보유세 부담) ----------
      const taxableHeld = props.filter(p => {
        const soldThisYear = yearSales.find(s => s.propertyId === p.id);
        if (soldThisYear) return U.sellerOwesHoldingTax(soldThisYear.date, y);
        if (!held.has(p.id)) {
          // 이전 연도에 매도됨 — 해당 매도가 올해 이후인지 확인 불필요 (연 순회)
          return false;
        }
        return true;
      });
      const holdRes = RETAX.Holding.computeYear({
        year: y, lawMode: A.lawMode,
        household: portfolio.household,
        held: taxableHeld.map(p => ({ property: p, publicPrice: series[p.id].public[y] })),
        prevState: holdState
      });
      holdState = holdRes.nextState;
      cumHoldingTax += holdRes.totals.total;

      // ---------- 임대·이자·유지비 (매도연도는 월할 근사) ----------
      let rental = 0, interest = 0, maintenance = 0, extraCharge = 0;
      for (const p of props) {
        const soldRec = saleRecords.find(r => r.propertyId === p.id && r.year === y);
        const wasHeldBefore = held.has(p.id) || soldRec;
        if (!wasHeldBefore) continue;
        const frac = soldRec ? Math.max(0, (parseInt(soldRec.date.slice(5, 7), 10) - 1) / 12) : 1;
        rental += U.won((p.rental && p.rental.netAnnualIncome || 0) * frac);
        interest += U.won((p.loan ? (p.loan.balance || 0) * (p.loan.rate || 0) : 0) * frac);
        maintenance += U.won((p.maintenanceAnnual || 0) * frac);
        if (p.reconstruction && p.reconstruction.chargeYear === y && !soldRec)
          extraCharge += p.reconstruction.charge || 0;
      }

      // ---------- 현금흐름 ----------
      const netFlow = saleProceeds + rental - interest - maintenance - holdRes.totals.total - extraCharge;
      cash = U.won(cash * (1 + A.cashReturn)) + netFlow;
      rawFlows[y] = netFlow;

      const marketValueHeld = props.filter(p => held.has(p.id))
        .reduce((s, p) => s + series[p.id].market[y], 0);
      const loanHeld = props.filter(p => held.has(p.id))
        .reduce((s, p) => s + (p.loan ? p.loan.balance || 0 : 0), 0);
      const carrying = holdRes.totals.total + interest + maintenance;

      years.push({
        year: y,
        marketValueHeld, publicPriceHeld: taxableHeld.reduce((s, p) => s + series[p.id].public[y], 0),
        holding: holdRes, holdingTax: holdRes.totals.total,
        propertyTax: holdRes.totals.propertyTax,
        jongbuse: holdRes.totals.jongbuse, ruralTax: holdRes.totals.ruralTax,
        cumHoldingTax, rental, interest, maintenance, extraCharge,
        carryingCost: carrying,
        yearCGT, yearSellCost, saleProceeds, netFlow, cash,
        loanHeld, heldCount: held.size,
        breakEvenRate: Market.breakEvenRate(carrying, rental, marketValueHeld || null)
      });
    }

    // ---------- 최종 자산 ----------
    const last = years[years.length - 1];
    const terminalWealth = A.liquidateAtEnd
      ? cash
      : cash + last.marketValueHeld - last.loanHeld;

    let npv = 0;
    for (let y = A.startYear; y <= A.endYear; y++)
      npv += (rawFlows[y] || 0) / Math.pow(1 + A.discountRate, y - A.startYear + 1);
    if (!A.liquidateAtEnd)
      npv += (last.marketValueHeld - last.loanHeld) / Math.pow(1 + A.discountRate, A.endYear - A.startYear + 1);
    npv = U.won(npv);

    return {
      plan, assumptions: A, scenario, years, saleRecords, series,
      totalCGT, totalHoldingTax: cumHoldingTax, totalSellingCosts,
      terminalWealth: U.won(terminalWealth), npv,
      grade: A.lawMode === "PROPOSED" ? "PROPOSED_LAW" : "SCENARIO"
    };
  }

  function ownedShareTotal(prop) {
    return (prop.owners || [{ share: 1 }]).reduce((s, o) => s + o.share, 0);
  }
  function residenceYearsAt(prop, saleYear, startYear) {
    const r = prop.residence || {};
    const base = r.residenceYears || 0;
    return r.isCurrentResidence ? base + Math.max(0, saleYear - startYear) : base;
  }

  /* =========================================================
   * 전략 자동 생성 + 전수 평가 (PART 28~30, 45)
   * ========================================================= */
  function generateStrategies(portfolio, A) {
    const props = portfolio.properties;
    const start = Math.max(A.startYear, U.yearOf(todayStr()) );
    const strategies = [{ name: "모두 계속 보유", key: "HOLD_ALL", sales: [] }];
    const dateKeys = ["05-15", "09-30"]; // 과세기준일(6/1) 전·후 비교

    for (const p of props) {
      for (let y = start; y <= A.endYear; y++) {
        for (const dk of dateKeys) {
          strategies.push({
            name: p.name + " " + y + "-" + dk + " 매도, 나머지 보유",
            key: "SELL_" + p.id + "_" + y + "_" + dk,
            sales: [{ propertyId: p.id, date: y + "-" + dk }]
          });
        }
      }
    }
    if (props.length === 2) {
      const [a, b] = props;
      for (let y1 = start; y1 <= A.endYear; y1++) {
        for (let y2 = start; y2 <= A.endYear; y2++) {
          if (y1 === y2) continue;
          strategies.push({
            name: a.name + " " + y1 + " 매도 → " + b.name + " " + y2 + " 매도",
            key: "SELL_BOTH_" + y1 + "_" + y2,
            sales: [
              { propertyId: a.id, date: y1 + "-09-30" },
              { propertyId: b.id, date: y2 + "-09-30" }
            ]
          });
        }
      }
    }
    return strategies;
  }

  function evaluateAll(portfolio, assumptionsIn) {
    const A = Object.assign({}, DEFAULT_ASSUMPTIONS, assumptionsIn || {});
    const strategies = generateStrategies(portfolio, A);
    const results = strategies.map(st => {
      const sim = simulate(portfolio, st, A);
      return { strategy: st, sim,
        terminalWealth: sim.terminalWealth, npv: sim.npv,
        totalCGT: sim.totalCGT, totalHoldingTax: sim.totalHoldingTax };
    });
    results.sort((x, y) => y.terminalWealth - x.terminalWealth);
    return results;
  }

  /* ----- 매도연도 최적화 곡선: 특정 주택을 y년에 매도할 때의 TW (PART 45) ----- */
  function exitYearCurve(portfolio, propertyId, assumptionsIn) {
    const A = Object.assign({}, DEFAULT_ASSUMPTIONS, assumptionsIn || {});
    const start = Math.max(A.startYear, U.yearOf(todayStr()));
    const out = [];
    for (let y = start; y <= A.endYear; y++) {
      const sim = simulate(portfolio, {
        name: "exit " + y, sales: [{ propertyId, date: y + "-09-30" }]
      }, A);
      out.push({ year: y, terminalWealth: sim.terminalWealth, npv: sim.npv });
    }
    return out;
  }

  /* ----- STRATEGY REVERSAL POINT: 시장상승률에 따라 두 전략 우위가 뒤집히는 지점 (PART 54, 95) ----- */
  function findReversalPoint(portfolio, planA, planB, assumptionsIn, lo, hi) {
    const A = Object.assign({}, DEFAULT_ASSUMPTIONS, assumptionsIn || {});
    lo = lo == null ? -0.05 : lo; hi = hi == null ? 0.12 : hi;
    const diff = g => {
      const opts = Object.assign({}, A, { marketGrowthOverride: g });
      return simulate(portfolio, planA, opts).terminalWealth -
             simulate(portfolio, planB, opts).terminalWealth;
    };
    let fLo = diff(lo), fHi = diff(hi);
    if (fLo * fHi > 0) return null; // 구간 내 역전 없음
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2, fm = diff(mid);
      if (Math.abs(fm) < 1e4 || hi - lo < 1e-4) return mid;
      if (fLo * fm <= 0) { hi = mid; fHi = fm; } else { lo = mid; fLo = fm; }
    }
    return (lo + hi) / 2;
  }

  /* ----- SENSITIVITY HEATMAP: 매도연도 × 시장상승률 → TW (PART 46) ----- */
  function sensitivityMatrix(portfolio, propertyId, assumptionsIn, growthRates) {
    const A = Object.assign({}, DEFAULT_ASSUMPTIONS, assumptionsIn || {});
    const rates = growthRates || [0, 0.02, 0.04, 0.06, 0.08, 0.10];
    const start = Math.max(A.startYear, U.yearOf(todayStr()));
    const yearsArr = [];
    for (let y = start; y <= Math.min(A.endYear, start + 8); y++) yearsArr.push(y);
    const cells = rates.map(g => yearsArr.map(y => {
      const opts = Object.assign({}, A, { marketGrowthOverride: g });
      return simulate(portfolio, { name: "s", sales: [{ propertyId, date: y + "-09-30" }] }, opts).terminalWealth;
    }));
    // HOLD 열 추가
    const holdCol = rates.map(g =>
      simulate(portfolio, { name: "hold", sales: [] },
        Object.assign({}, A, { marketGrowthOverride: g })).terminalWealth);
    return { rates, years: yearsArr, cells, holdCol };
  }

  /* ----- SELL REVIEW POINT (PART 37~38) ----- */
  function sellReviewSignals(holdSim, bestSellByYear) {
    const signals = [];
    for (let i = 1; i < holdSim.years.length; i++) {
      const row = holdSim.years[i], prev = holdSim.years[i - 1];
      const expectedReturn = (row.marketValueHeld - prev.marketValueHeld) + row.rental;
      const carrying = row.carryingCost;
      const sellBetter = bestSellByYear && bestSellByYear[row.year] != null
        ? bestSellByYear[row.year] > holdSim.terminalWealth : false;
      if (expectedReturn < carrying && sellBetter) {
        signals.push({ year: row.year, expectedReturn, carrying, signal: "SELL_REVIEW" });
      }
    }
    return signals;
  }

  function todayStr() {
    const d = new Date();
    return U.dstr(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  return {
    DEFAULT_ASSUMPTIONS, simulate, generateStrategies, evaluateAll,
    exitYearCurve, findReversalPoint, sensitivityMatrix, sellReviewSignals, todayStr
  };
})();

if (typeof module !== "undefined") module.exports = RETAX.Strategy;
