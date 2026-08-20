/* =========================================================
 * RETAX ENGINE TEST SUITE (Node)
 * 실행: node tests/run-tests.js
 * PART 80~84 요구 케이스 포함
 * ========================================================= */
"use strict";
const path = require("path");
const base = path.join(__dirname, "..");
require(path.join(base, "js/core/util.js"));
require(path.join(base, "js/rules/registry.js"));
require(path.join(base, "js/engine/propertyTax.js"));
require(path.join(base, "js/engine/jongbuse.js"));
require(path.join(base, "js/engine/cgt.js"));
require(path.join(base, "js/engine/holding.js"));
require(path.join(base, "js/engine/market.js"));
require(path.join(base, "js/engine/strategy.js"));
require(path.join(base, "js/app/state.js"));

const R = globalThis.RETAX;
const U = R.Util;

let pass = 0, fail = 0;
const failures = [];
function eq(name, actual, expected) {
  if (actual === expected) { pass++; }
  else { fail++; failures.push(`${name}\n  expected: ${expected}\n  actual:   ${actual}`); }
}
function near(name, actual, expected, tol) {
  tol = tol == null ? 1 : tol;
  if (Math.abs(actual - expected) <= tol) { pass++; }
  else { fail++; failures.push(`${name}\n  expected: ${expected} (±${tol})\n  actual:   ${actual}`); }
}
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; failures.push(name); }
}

/* =========================================================
 * 1. 누진세 계산기
 * ========================================================= */
{
  const b = [{ upTo: 100, rate: 0.1 }, { upTo: 200, rate: 0.2 }, { upTo: Infinity, rate: 0.3 }];
  eq("progressive: 150 → 10+10=20", U.progressiveTax(150, b).tax, 20);
  eq("progressive: 250 → 10+20+15=45", U.progressiveTax(250, b).tax, 45);
  eq("progressive: 0 → 0", U.progressiveTax(0, b).tax, 0);
}

/* =========================================================
 * 2. 날짜 / 6월 1일 기준일 (PART 15)
 * ========================================================= */
{
  eq("보유연수: 2013-05-01→2027-09-30 = 14년", U.fullYearsBetween("2013-05-01", "2027-09-30"), 14);
  eq("보유연수: 2016-05-01→2018-04-30 = 1년", U.fullYearsBetween("2016-05-01", "2018-04-30"), 1);
  eq("5/31 매도 → 매도인 보유세 없음", U.sellerOwesHoldingTax("2027-05-31", 2027), false);
  eq("6/1 매도(잔금) → 취득자 납세의무 → 매도인 없음", U.sellerOwesHoldingTax("2027-06-01", 2027), false);
  eq("6/2 매도 → 매도인이 그 해 보유세 부담", U.sellerOwesHoldingTax("2027-06-02", 2027), true);
}

/* =========================================================
 * 3. 조정대상지역 이력 (PART 17)
 * ========================================================= */
{
  const reg = R.Registry;
  eq("강남구 2020 조정지역", reg.isRegulatedAt("강남구", "2020-06-01"), true);
  eq("강남구 2024 조정지역 (해제 제외)", reg.isRegulatedAt("강남구", "2024-06-01"), true);
  eq("동작구 2022 조정지역", reg.isRegulatedAt("동작구", "2022-06-01"), true);
  eq("동작구 2024 해제 상태", reg.isRegulatedAt("동작구", "2024-06-01"), false);
  eq("동작구 2026 재지정 (10·15 대책)", reg.isRegulatedAt("동작구", "2026-06-01"), true);
  eq("동작구 취득 2013 비조정", reg.isRegulatedAt("동작구", "2013-05-01"), false);
}

/* =========================================================
 * 4. 재산세 엔진 (PART 13)
 * ========================================================= */
{
  // 1주택 공시 9억: 특례 FMV 45%... 아니고 6억초과 45%? 9억은 6억 초과 → 45%
  const r = R.PropertyTax.compute({ year: 2026, publicPrice: 9e8, isOneHomeHousehold: true, lawMode: "CURRENT" });
  // 과표 = 9e8×0.45 = 4.05e8; 특례세율(공시 9억 이하): 3e8까지 12만+... 누진: 6천만×0.05%=3만, 9천만×0.1%=9만, 1.5억×0.2%=30만, 1.05e8×0.35%=36.75만 → 78.75만
  eq("재산세 1주택 9억 과표", r.taxBase, 405000000);
  eq("재산세 1주택 9억 본세(특례)", r.mainTax, 787500);
  eq("재산세 도시지역분", r.urbanTax, Math.round(405000000 * 0.0014));
  eq("재산세 지방교육세", r.eduTax, Math.round(787500 * 0.2));
  ok("특례세율 적용됨", r.useSpecialRate === true);

  // 다주택(일반): 공시 17.978억 → 과표 10.7868억 → 표준: 6천만×0.1%+9천만×0.15%+1.5억×0.25%+7.7868억×0.4%
  const r2 = R.PropertyTax.compute({ year: 2026, publicPrice: 1797800000, isOneHomeHousehold: false, lawMode: "CURRENT" });
  const base2 = Math.round(1797800000 * 0.6);
  const expect2 = Math.round(6e7 * 0.001) + Math.round(9e7 * 0.0015) + Math.round(1.5e8 * 0.0025) + Math.round((base2 - 3e8) * 0.004);
  eq("재산세 흑석 2026 본세", r2.mainTax, expect2);
  ok("흑석 2026 재산세 합계 > 500만", r2.total > 5e6);

  // 과표상한제: 전년 과표 10억 → 올해 상한 10.5억
  const r3 = R.PropertyTax.compute({ year: 2027, publicPrice: 2e9, isOneHomeHousehold: false, prevTaxBase: 1e9, lawMode: "CURRENT" });
  eq("과표상한 5% 적용", r3.taxBase, 1.05e9);
}

/* =========================================================
 * 5. 종부세 엔진 (PART 14) — 수기 검산 케이스
 * ========================================================= */
{
  // 단독명의 2주택: 흑석 17.978억 + 개포 28.09억 = 46.068억
  const holdings = [
    { propertyId: "a", publicPrice: 1797800000, share: 1, isRegulated: true, isResidence: true },
    { propertyId: "b", publicPrice: 2809000000, share: 1, isRegulated: true, isResidence: false }
  ];
  const j = R.Jongbuse.computeForTaxpayer({
    year: 2026, lawMode: "CURRENT", holdings, houseCount: 2,
    isHouseholdOneHome: false, age: 55, holdingYears: 0, prevYearEquivalent: null
  });
  eq("종부세 합산 공시가격", j.sumPublic, 4606800000);
  eq("종부세 기본공제 9억", j.deduction, 9e8);
  eq("종부세 과표 = (46.068-9)억×60%", j.taxBase, Math.round((4606800000 - 9e8) * 0.6));
  // 산출세액 수기검산: 과표 22.2408억 → 3억×0.5%+3억×0.7%+6억×1.0%+10.2408억×1.3%
  const expectGross = Math.round(3e8 * 0.005) + Math.round(3e8 * 0.007) + Math.round(6e8 * 0.01) + Math.round((j.taxBase - 12e8) * 0.013);
  eq("종부세 산출세액(일반세율 2주택)", j.grossTax, expectGross);
  ok("재산세 중복공제 > 0", j.propertyTaxCredit > 0);
  ok("재산세 공제 ≤ 산출세액", j.propertyTaxCredit <= j.grossTax);
  eq("농특세 = 종부세×20%", j.ruralTax, Math.round(j.tax * 0.2));
  console.log(`  [검산] 2026 단독명의 2주택 종부세: ${U.fmt(j.tax)}원 + 농특세 ${U.fmt(j.ruralTax)}원`);

  // 3주택 중과세율
  const holdings3 = holdings.concat([{ propertyId: "c", publicPrice: 15e8, share: 1, isRegulated: true }]);
  const j3 = R.Jongbuse.computeForTaxpayer({
    year: 2026, lawMode: "CURRENT", holdings: holdings3, houseCount: 3,
    isHouseholdOneHome: false, prevYearEquivalent: null
  });
  ok("3주택 산출세액 > 2주택 (중과세율)", j3.grossTax > j.grossTax);

  // 50:50 공동명의: 각자 공제 9억 → 합계가 단독명의보다 작아야 함
  const half = holdings.map(h => Object.assign({}, h, { share: 0.5 }));
  const jh = R.Jongbuse.computeForTaxpayer({
    year: 2026, lawMode: "CURRENT", holdings: half, houseCount: 2,
    isHouseholdOneHome: false, prevYearEquivalent: null
  });
  ok("공동명의 1인분 세액 × 2 < 단독명의 세액", jh.tax * 2 < j.tax);

  // 1세대1주택 12억 공제 + 세액공제
  const one = [{ propertyId: "a", publicPrice: 18e8, share: 1, isRegulated: true, isResidence: true }];
  const j1 = R.Jongbuse.computeForTaxpayer({
    year: 2026, lawMode: "CURRENT", holdings: one, houseCount: 1,
    isHouseholdOneHome: true, age: 66, holdingYears: 11, prevYearEquivalent: null
  });
  eq("1세대1주택 공제 12억", j1.deduction, 12e8);
  ok("고령(30%)+장기(40%) 세액공제 적용", j1.credit > 0);

  // 세부담상한 150%
  const jc = R.Jongbuse.computeForTaxpayer({
    year: 2026, lawMode: "CURRENT", holdings, houseCount: 2,
    isHouseholdOneHome: false, prevYearEquivalent: 10e6
  });
  ok("세부담상한 적용", jc.capApplied === true);
  ok("상한 적용 시 (재산세상당+종부세) ≤ 전년×1.5", jc.equivalentForNextYearCap <= 15e6 + 1);
}

/* =========================================================
 * 6. 종부세 — 2026 개편안(PROPOSED) 모드 (PART 47, 110)
 * ========================================================= */
{
  const holdings = [
    { propertyId: "a", publicPrice: 1797800000, share: 1, isRegulated: true, isResidence: true },
    { propertyId: "b", publicPrice: 2809000000, share: 1, isRegulated: true, isResidence: false }
  ];
  // 2026년은 개편안 시행 전 → PROPOSED 모드여도 현행법과 동일해야 함
  const cur26 = R.Jongbuse.computeForTaxpayer({ year: 2026, lawMode: "CURRENT", holdings, houseCount: 2, isHouseholdOneHome: false });
  const pro26 = R.Jongbuse.computeForTaxpayer({ year: 2026, lawMode: "PROPOSED", holdings, houseCount: 2, isHouseholdOneHome: false });
  eq("2026: PROPOSED 모드 = 현행법 (시행 전)", pro26.tax, cur26.tax);

  // 2027년: 개편안 — 다주택 공제 = 4억 + 5억×(17.978/46.068), FMV 70%
  const pro27 = R.Jongbuse.computeForTaxpayer({ year: 2027, lawMode: "PROPOSED", holdings, houseCount: 2, isHouseholdOneHome: false });
  const expectedDeduction = 4e8 + Math.round(5e8 * (1797800000 / 4606800000));
  eq("2027 개편안 다주택 공제 (4억+거주비중)", pro27.deduction, expectedDeduction);
  eq("2027 개편안 FMV 70%", pro27.fmvRatio, 0.70);
  const cur27 = R.Jongbuse.computeForTaxpayer({ year: 2027, lawMode: "CURRENT", holdings, houseCount: 2, isHouseholdOneHome: false });
  ok("2027 개편안 종부세 > 현행법 (공제축소+FMV인상)", pro27.tax > cur27.tax);
  console.log(`  [검산] 2027 종부세 현행 ${U.fmt(cur27.tax)} vs 개편안 ${U.fmt(pro27.tax)}`);

  // 2028년: FMV 80% (조정지역 보유), 가액기준 일원화 세율
  const pro28 = R.Jongbuse.computeForTaxpayer({ year: 2028, lawMode: "PROPOSED", holdings, houseCount: 2, isHouseholdOneHome: false });
  eq("2028 개편안 FMV 80% (조정지역 보유)", pro28.fmvRatio, 0.80);
  ok("2028 일원화 세율 적용 (과표 12억 초과 중과 수준)", pro28.grossTax > pro27.grossTax);
}

/* =========================================================
 * 7. 양도세 엔진 (PART 16, 18, 81)
 * ========================================================= */
{
  // (a) 1세대1주택 12억 이하 비과세
  const a = R.CGT.compute({
    saleDate: "2027-09-30", salePrice: 11e8, acquisitionDate: "2015-01-01", acquisitionPrice: 6e8,
    residenceYears: 5, householdCountAtSale: 1, isRegulatedAtSale: true, acquiredWhileRegulated: false, lawMode: "CURRENT"
  });
  eq("1주택 12억 이하 비과세 → 세금 0", a.total, 0);
  ok("비과세 플래그", a.exempt === true);

  // (b) 1세대1주택 고가주택(20억): 12억 초과분 안분 + 표2 장특공제
  const b = R.CGT.compute({
    saleDate: "2027-09-30", salePrice: 20e8, acquisitionDate: "2015-01-01", acquisitionPrice: 10e8,
    residenceYears: 10, householdCountAtSale: 1, isRegulatedAtSale: true, acquiredWhileRegulated: false, lawMode: "CURRENT"
  });
  // 차익 10억 × (20-12)/20 = 4억 과세대상; 보유 12년→40%(10년 cap) + 거주 10년→40% = 80% 공제 → 8천만
  eq("고가주택 과세대상 차익 4억", b.taxableGain, 4e8);
  eq("표2 장특공제 80%", b.ltsd, 3.2e8);
  // 과표 = 4억 − 3.2억 − 250만 = 7,750만 → 24% − 576만 = 1,284만
  eq("고가 1주택 양도세", b.nationalTax, Math.round(77500000 * 0.24 - 5760000));
  eq("지방소득세 10%", b.localTax, Math.round(b.nationalTax * 0.1));

  // (c) 중과 유예 경계: 2026-05-09(유예 마지막날) vs 2026-05-10(중과 재개)
  const mk = d => R.CGT.compute({
    saleDate: d, salePrice: 30e8, acquisitionDate: "2016-05-01", acquisitionPrice: 14e8,
    residenceYears: 0, householdCountAtSale: 2, isRegulatedAtSale: true, lawMode: "CURRENT"
  });
  const c1 = mk("2026-05-09"), c2 = mk("2026-05-10");
  ok("2026-05-09 양도: 중과 배제(유예)", c1.surcharged === false);
  ok("2026-05-09 양도: 장특공제 적용", c1.ltsd > 0);
  ok("2026-05-10 양도: 중과 적용(+20%p)", c2.surcharged === true && c2.rateInfo.surchargeRate === 0.20);
  ok("2026-05-10 양도: 장특공제 배제", c2.ltsd === 0);
  ok("중과 재개로 세금 급증", c2.total > c1.total * 1.3);
  console.log(`  [검산] 개포 2026-05-09 매도 CGT ${U.fmt(c1.total)} vs 05-10 매도 ${U.fmt(c2.total)}`);

  // (d) PROPOSED: 2027 양도 +5%p, 2028 +10%p, 2029 +20%p
  const d27 = R.CGT.compute({ saleDate: "2027-09-30", salePrice: 30e8, acquisitionDate: "2016-05-01",
    acquisitionPrice: 14e8, householdCountAtSale: 2, isRegulatedAtSale: true, lawMode: "PROPOSED" });
  const d28 = R.CGT.compute({ saleDate: "2028-09-30", salePrice: 30e8, acquisitionDate: "2016-05-01",
    acquisitionPrice: 14e8, householdCountAtSale: 2, isRegulatedAtSale: true, lawMode: "PROPOSED" });
  const d29 = R.CGT.compute({ saleDate: "2029-09-30", salePrice: 30e8, acquisitionDate: "2016-05-01",
    acquisitionPrice: 14e8, householdCountAtSale: 2, isRegulatedAtSale: true, lawMode: "PROPOSED" });
  eq("개편안 2027 중과 +5%p", d27.rateInfo.surchargeRate, 0.05);
  eq("개편안 2028 중과 +10%p", d28.rateInfo.surchargeRate, 0.10);
  eq("개편안 2029 중과 +20%p (원상복귀)", d29.rateInfo.surchargeRate, 0.20);
  ok("2027 양도가 2029 양도보다 유리 (동일가격)", d27.total < d29.total);

  // (e) 비조정지역: 중과 없음
  const e1 = R.CGT.compute({ saleDate: "2027-09-30", salePrice: 30e8, acquisitionDate: "2016-05-01",
    acquisitionPrice: 14e8, householdCountAtSale: 2, isRegulatedAtSale: false, lawMode: "CURRENT" });
  ok("비조정지역 2주택: 중과 없음 + 장특공제", e1.surcharged === false && e1.ltsd > 0);

  // (f) 단기양도 70%
  const f1 = R.CGT.compute({ saleDate: "2026-12-01", salePrice: 11e8, acquisitionDate: "2026-03-01",
    acquisitionPrice: 10e8, householdCountAtSale: 2, isRegulatedAtSale: true, lawMode: "CURRENT" });
  eq("1년 미만 단기세율 70%", f1.rateInfo.rate, 0.70);

  // (g) 양도차손 → 0
  const g1 = R.CGT.compute({ saleDate: "2027-09-30", salePrice: 10e8, acquisitionDate: "2020-01-01",
    acquisitionPrice: 12e8, householdCountAtSale: 2, isRegulatedAtSale: true, lawMode: "CURRENT" });
  eq("양도차손 → 세금 0", g1.total, 0);
}

/* =========================================================
 * 8. Holding 오케스트레이터 + 실제 포트폴리오 회귀 (PART 11, 82~84)
 * ========================================================= */
{
  const pf = R.State.defaultPortfolio();
  const held = pf.properties.map(p => ({ property: p, publicPrice: p.publicPriceByYear[2026] }));
  const res = R.Holding.computeYear({
    year: 2026, lawMode: "CURRENT", household: pf.household, held, prevState: null
  });
  ok("2026 재산세 2건 산출", res.perProperty.length === 2);
  ok("2026 종부세 납세의무자 1인", res.perTaxpayer.length === 1);
  const total = res.totals.total;
  console.log("\n  ===== REGRESSION: 2026년 실제 포트폴리오 (단독명의 가정, CURRENT LAW) =====");
  console.log(`  재산세 합계: ${U.fmt(res.totals.propertyTax)}원`);
  console.log(`  종부세:      ${U.fmt(res.totals.jongbuse)}원`);
  console.log(`  농특세:      ${U.fmt(res.totals.ruralTax)}원`);
  console.log(`  총 보유세:   ${U.fmt(total)}원`);
  const ref = pf.screenshotReference;
  console.log(`  ---- DISCREPANCY REPORT (vs 기존 계산기 screenshot, 정답 아님) ----`);
  console.log(`  기존 계산기 총보유세: ${U.fmt(ref.totalHoldingTax)}원 / 차이: ${U.fmt(total - ref.totalHoldingTax)}원`);
  console.log(`  기존 계산기 종부세:   ${U.fmt(ref.jongbuse)}원 / 차이: ${U.fmt(res.totals.jongbuse + res.totals.ruralTax - ref.jongbuse)}원`);
  console.log(`  차이 원인 후보: 명의/지분, 공정시장가액비율 가정, 세부담상한 전년값, 재산세 공제 산식`);
  ok("2026 총 보유세가 합리적 범위(2천만~7천만)", total > 2e7 && total < 7e7);
}

/* =========================================================
 * 9. 전략 시뮬레이션 (PART 28~34, 45, 54)
 * ========================================================= */
{
  const pf = R.State.defaultPortfolio();
  const A = { startYear: 2026, endYear: 2032, lawMode: "CURRENT", scenarioKey: "BASE",
              cashReturn: 0.03, discountRate: 0.03, liquidateAtEnd: true };

  const hold = R.Strategy.simulate(pf, { name: "hold", sales: [] }, A);
  ok("HOLD 시뮬레이션 연도 수", hold.years.length === 7);
  ok("HOLD: 청산가정 시 잔여주택 전량 매도 기록", hold.saleRecords.length === 2);
  ok("누적 보유세 단조 증가", hold.years.every((r, i) => i === 0 || r.cumHoldingTax >= hold.years[i - 1].cumHoldingTax));
  ok("Terminal Wealth 유한", Number.isFinite(hold.terminalWealth));
  ok("NPV 유한", Number.isFinite(hold.npv));
  ok("Break-even rate 계산됨", hold.years[0].breakEvenRate != null && hold.years[0].breakEvenRate > 0);

  // 6/1 전후 매도 비교: 5/15 매도는 그 해 보유세에서 해당 주택 제외
  const sellMay = R.Strategy.simulate(pf, { name: "m", sales: [{ propertyId: "gaepo", date: "2027-05-15" }] }, A);
  const sellSep = R.Strategy.simulate(pf, { name: "s", sales: [{ propertyId: "gaepo", date: "2027-09-30" }] }, A);
  const may27 = sellMay.years.find(r => r.year === 2027);
  const sep27 = sellSep.years.find(r => r.year === 2027);
  ok("5/15 매도 시 2027 보유세 < 9/30 매도 시", may27.holdingTax < sep27.holdingTax);

  // 매도 후 잔여 1주택 → 이후 연도 종부세 12억 공제·1주택 특례 체계로 재계산 (PART 31)
  const after = sellMay.years.find(r => r.year === 2028);
  const holdSameYear = hold.years.find(r => r.year === 2028);
  ok("매도 후 잔여 1주택 보유세 < 2주택 계속 보유 보유세", after.holdingTax < holdSameYear.holdingTax * 0.5);

  // 전략 전수 평가
  const results = R.Strategy.evaluateAll(pf, A);
  ok("전략 후보 30개 이상 생성", results.length >= 30);
  ok("순위 정렬 (TW 내림차순)", results.every((r, i) => i === 0 || r.terminalWealth <= results[i - 1].terminalWealth));
  console.log(`\n  ===== 전략 TOP 5 (BASE, CURRENT LAW, ~2032 청산) =====`);
  results.slice(0, 5).forEach((r, i) =>
    console.log(`  ${i + 1}위 ${r.strategy.name}: TW ${U.fmtEok(r.terminalWealth)}, CGT ${U.fmtEok(r.totalCGT)}, 보유세 ${U.fmtEok(r.totalHoldingTax)}`));

  // Exit-year curve
  const curve = R.Strategy.exitYearCurve(pf, "heukseok", A);
  ok("Exit-year curve 산출", curve.length >= 5 && curve.every(c => Number.isFinite(c.terminalWealth)));

  // Reversal point: 보유 vs 흑석 즉시 매도
  const rev = R.Strategy.findReversalPoint(pf,
    { name: "hold", sales: [] },
    { name: "sell", sales: [{ propertyId: "heukseok", date: "2027-09-30" }] }, A);
  ok("Reversal point 탐색 완료 (null 허용)", rev === null || (rev > -0.05 && rev < 0.12));
  if (rev != null) console.log(`  [검산] 보유 vs 흑석 2027 매도 역전 상승률: 연 ${(rev * 100).toFixed(2)}%`);

  // 민감도 매트릭스
  const sm = R.Strategy.sensitivityMatrix(pf, "heukseok", A, [0, 0.03, 0.06]);
  ok("민감도 매트릭스 크기", sm.cells.length === 3 && sm.cells[0].length === sm.years.length);

  // CURRENT vs PROPOSED 비교
  const holdP = R.Strategy.simulate(pf, { name: "hold", sales: [] }, Object.assign({}, A, { lawMode: "PROPOSED" }));
  ok("개편안 모드 누적보유세 ≠ 현행 (2027+ 차이 발생)", holdP.totalHoldingTax !== hold.totalHoldingTax);
  console.log(`  [검산] ~2032 누적보유세 현행 ${U.fmtEok(hold.totalHoldingTax)} vs 개편안 ${U.fmtEok(holdP.totalHoldingTax)}`);

  // 공시가격 하락 시나리오
  const bear = R.Strategy.simulate(pf, { name: "hold", sales: [] },
    Object.assign({}, A, { scenarioKey: "BEAR" }));
  ok("BEAR 시나리오 TW < BASE TW", bear.terminalWealth < hold.terminalWealth);
}

/* =========================================================
 * 10. 시장 엔진 (PART 21~26)
 * ========================================================= */
{
  const M = R.Market;
  const s = M.projectSeries(1e9, 2026, 2030, 0.05);
  near("고정 성장률 2030", s[2030], Math.round(1e9 * Math.pow(1.05, 4)), 5);
  const s2 = M.projectSeries(1e9, 2026, 2030, { 2027: 0.07, 2028: 0.05, 2029: 0.03, 2030: -0.02 });
  near("연도별 성장률", s2[2030], Math.round(1e9 * 1.07 * 1.05 * 1.03 * 0.98), 5);
  eq("성장률 폴백(마지막 값 유지)", M.growthFor({ 2027: 0.07 }, 2030), 0.07);
}

/* =========================================================
 * 11. LAW UPDATE — 원격 법령 DB 병합 (PART 3~4, 96~97)
 * ========================================================= */
{
  require(path.join(base, "js/app/lawmonitor.js"));
  const Reg = R.Registry;
  const before = Reg.getRule("COMPREHENSIVE_TAX", "2026-06-01", "CURRENT").params.basicDeduction;
  eq("업데이트 전 기본공제 9억", before, 9e8);
  // 가상의 법 개정: 종부세 기본공제 9억 → 10억, 개편안 국회통과(PROMULGATED)
  const changed = Reg.applyUpdates({
    registryVersion: "1.0.1",
    updatedAt: "2026-12-15T10:00:00+09:00",
    changelog: [{ date: "2026-12-15T10:00:00+09:00", version: "1.0.1", summary: "테스트 개정" }],
    ruleOverrides: [
      { ruleId: "CRT-2023-STD", params: { basicDeduction: 10e8 } },
      { ruleId: "CRT-2026REFORM", status: "PROMULGATED", verifiedAt: "2026-12-15" }
    ]
  });
  eq("변경 규칙 2건 감지", changed.length, 2);
  eq("기본공제 10억으로 갱신", Reg.getRule("COMPREHENSIVE_TAX", "2026-06-01", "CURRENT").params.basicDeduction, 10e8);
  eq("개편안 상태 PROMULGATED", Reg.RULES.find(r => r.ruleId === "CRT-2026REFORM").status, "PROMULGATED");
  eq("레지스트리 버전 갱신", Reg.lawUpdateState.registryVersion, "1.0.1");
  eq("업데이트 시각 기록", Reg.lawUpdateState.updatedAt, "2026-12-15T10:00:00+09:00");
  ok("갱신된 규칙에 updatedAt 표시", Reg.RULES.find(r => r.ruleId === "CRT-2023-STD").updatedAt === "2026-12-15T10:00:00+09:00");
  // PROMULGATED 상태는 PROPOSED 모드에서 계속 선택되어야 함
  const rule27 = Reg.getRule("COMPREHENSIVE_TAX", "2027-06-01", "PROPOSED");
  eq("PROMULGATED 규칙이 2027 PROPOSED 모드에 적용", rule27.ruleId, "CRT-2026REFORM");
  // 구버전(1.0.0) 문서는 낮은 버전이므로 monitor가 적용하지 않음 — cmpVersion 확인
  ok("버전 비교: 1.0.0 < 1.0.1", Reg.cmpVersion("1.0.0", "1.0.1") < 0);
  // 원상복구 (이후 테스트 영향 방지 — 이 블록이 마지막이므로 생략 가능하지만 명시)
  Reg.applyUpdates({ registryVersion: "1.0.1", ruleOverrides: [{ ruleId: "CRT-2023-STD", params: { basicDeduction: 9e8 } }] });
}

/* =========================================================
 * 결과
 * ========================================================= */
console.log(`\n========================================`);
console.log(`TESTS: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nFAILURES:");
  failures.forEach(f => console.log("  ✗ " + f + "\n"));
  process.exit(1);
} else {
  console.log("ALL PASS ✅");
}
