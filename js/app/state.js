/* =========================================================
 * APP STATE — 포트폴리오, 가정, 스냅샷 (local-first, localStorage)
 * 기본값은 누구나 쓸 수 있는 범용 예시(1주택)이며,
 * 예시값은 전부 ASSUMPTION으로 표시하고 수정 가능하다.
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.State = (function () {

  const STORAGE_KEY = "retax.portfolio.v1";
  const SNAPSHOT_KEY = "retax.snapshots.v1";
  const START_YEAR = 2026;

  function blankProperty(n) {
    return {
      id: "prop" + n + "_" + Date.now(),
      name: "주택 " + n,
      district: "기타 서울",
      address: "",
      exclusiveArea: null,
      owners: [{ taxpayerId: "tp1", share: 1.0 }],
      publicPriceByYear: { [START_YEAR]: 0 },
      publicPriceGrade: {},
      marketValue: 0,
      marketValueYear: START_YEAR,
      acquisitionDate: "2020-01-01",
      acquisitionPrice: 0,
      necessaryExpenses: 0,
      residence: { isCurrentResidence: false, residenceYears: 0 },
      loan: { balance: 0, rate: 0.04 },
      rental: { type: "실거주", netAnnualIncome: 0 },
      maintenanceAnnual: 0,
      sellingCostRate: 0.007,
      assumptions: ["신규 입력 필요 — 공시가격·시세·취득 정보를 입력하세요"]
    };
  }

  function defaultAssumptions() {
    return {
      startYear: START_YEAR,
      endYear: 2035,
      lawMode: "CURRENT",
      scenarioKey: "BASE",
      cashReturn: 0.03,
      discountRate: 0.03,
      liquidateAtEnd: true,
      customScenario: { marketGrowth: 0.03, publicGrowth: 0.025 }
    };
  }

  /** 초기 상태: 범용 예시 1주택 (특정인 데이터 없음) */
  function defaultPortfolio() {
    const p = blankProperty(1);
    // 화면이 비어 보이지 않도록 중립적 예시값 (ASSUMPTION 표시)
    p.publicPriceByYear[START_YEAR] = 700000000;
    p.marketValue = 1000000000;
    p.acquisitionDate = "2018-06-01";
    p.acquisitionPrice = 600000000;
    p.necessaryExpenses = 25000000;
    p.residence = { isCurrentResidence: true, residenceYears: 5 };
    p.assumptions = [
      "예시값입니다 — 「보유주택 입력」 탭에서 실제 공시가격·시세·취득 정보로 수정하세요",
      "공시가격 7억 / 시세 10억 / 2018년 취득 6억 (가상의 예시)"
    ];
    return {
      version: 2,
      household: { taxpayers: [{ id: "tp1", name: "본인", age: null }] },
      properties: [p],
      assumptions: defaultAssumptions()
    };
  }

  /** 2주택 예시 (범용 가상 데이터) — 다주택 기능 시연용 */
  function sampleTwoHomePortfolio() {
    const a = blankProperty(1), b = blankProperty(2);
    a.name = "주택 A (실거주)"; a.district = "기타 서울";
    a.publicPriceByYear[START_YEAR] = 900000000; a.marketValue = 1400000000;
    a.acquisitionDate = "2015-05-01"; a.acquisitionPrice = 700000000; a.necessaryExpenses = 30000000;
    a.residence = { isCurrentResidence: true, residenceYears: 8 };
    a.assumptions = ["가상의 예시 데이터 — 실제 값으로 수정하세요"];
    b.name = "주택 B (전세)"; b.district = "강남구";
    b.publicPriceByYear[START_YEAR] = 1500000000; b.marketValue = 2200000000;
    b.acquisitionDate = "2019-03-01"; b.acquisitionPrice = 1300000000; b.necessaryExpenses = 50000000;
    b.residence = { isCurrentResidence: false, residenceYears: 0 };
    b.rental = { type: "전세", netAnnualIncome: 0 };
    b.assumptions = ["가상의 예시 데이터 — 실제 값으로 수정하세요"];
    return {
      version: 2,
      household: { taxpayers: [{ id: "tp1", name: "본인", age: null }] },
      properties: [a, b],
      assumptions: defaultAssumptions()
    };
  }

  function hasStorage() {
    try { return typeof localStorage !== "undefined"; } catch (e) { return false; }
  }

  function load() {
    if (hasStorage()) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* 손상 시 기본값 */ }
    }
    return defaultPortfolio();
  }

  function save(portfolio) {
    if (hasStorage()) localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
  }

  function reset() {
    if (hasStorage()) localStorage.removeItem(STORAGE_KEY);
    return defaultPortfolio();
  }

  /* ---------- DATA SNAPSHOT (PART 60) ---------- */
  function listSnapshots() {
    if (!hasStorage()) return [];
    try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveSnapshot(portfolio, summary) {
    const snaps = listSnapshots();
    snaps.push({
      savedAt: new Date().toISOString(),
      lawRegistryVerifiedAt: RETAX.Registry.META_VERIFIED_AT,
      portfolio: JSON.parse(JSON.stringify(portfolio)),
      summary: summary || null
    });
    if (hasStorage()) localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snaps));
    return snaps.length - 1;
  }
  function deleteSnapshot(idx) {
    const snaps = listSnapshots();
    snaps.splice(idx, 1);
    if (hasStorage()) localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snaps));
  }

  return { defaultPortfolio, sampleTwoHomePortfolio, blankProperty,
           load, save, reset, listSnapshots, saveSnapshot, deleteSnapshot };
})();

if (typeof module !== "undefined") module.exports = RETAX.State;
