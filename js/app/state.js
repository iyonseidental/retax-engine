/* =========================================================
 * APP STATE — 포트폴리오, 가정, 스냅샷 (local-first, localStorage)
 * 기본값은 사용자 실제 테스트 케이스(PART 11)이며,
 * 미확인 값은 전부 ASSUMPTION으로 표시하고 수정 가능하다.
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.State = (function () {

  const STORAGE_KEY = "retax.portfolio.v1";
  const SNAPSHOT_KEY = "retax.snapshots.v1";

  function defaultPortfolio() {
    return {
      version: 1,
      household: {
        taxpayers: [
          { id: "tp1", name: "본인", age: 55 }   // ASSUMPTION: 연령 미확인 (종부세 고령자공제 판정용)
        ]
      },
      properties: [
        {
          id: "heukseok",
          name: "흑석한강푸르지오",
          district: "동작구",
          address: "서울 동작구 흑석동 (동·호 미입력)",
          exclusiveArea: null,
          owners: [{ taxpayerId: "tp1", share: 1.0 }],       // ASSUMPTION: 단독명의 100%
          publicPriceByYear: { 2026: 1797800000 },            // 사용자 제공 참고값 (공식 DB 대조 필요)
          publicPriceGrade: { 2026: "USER_INPUT" },
          marketValue: 2600000000,                            // ASSUMPTION: 시세 미확인 — 실거래가 확인 후 수정
          marketValueYear: 2026,
          acquisitionDate: "2013-05-01",                      // ASSUMPTION
          acquisitionPrice: 900000000,                        // ASSUMPTION
          necessaryExpenses: 40000000,                        // ASSUMPTION: 취득세+중개+수리 등
          residence: { isCurrentResidence: true, residenceYears: 10 }, // ASSUMPTION: 실거주 주택
          loan: { balance: 0, rate: 0.04 },
          rental: { type: "실거주", netAnnualIncome: 0 },
          maintenanceAnnual: 0,
          sellingCostRate: 0.007,
          assumptions: [
            "소유자/지분: 단독명의 100% 가정",
            "취득일 2013-05-01, 취득가 9억, 필요경비 4천만원 가정",
            "현재 시세 26억 가정 (실거래가 확인 필요)",
            "실거주 10년 가정",
            "2026 공시가격 17.978억은 사용자 제공값 (부동산공시가격알리미 대조 필요)"
          ]
        },
        {
          id: "gaepo",
          name: "개포경남아파트",
          district: "강남구",
          address: "서울 강남구 개포동 (동·호 미입력)",
          exclusiveArea: null,
          owners: [{ taxpayerId: "tp1", share: 1.0 }],        // ASSUMPTION
          publicPriceByYear: { 2026: 2809000000 },
          publicPriceGrade: { 2026: "USER_INPUT" },
          marketValue: 4000000000,                            // ASSUMPTION
          marketValueYear: 2026,
          acquisitionDate: "2016-05-01",                      // ASSUMPTION
          acquisitionPrice: 1400000000,                       // ASSUMPTION
          necessaryExpenses: 60000000,                        // ASSUMPTION
          residence: { isCurrentResidence: false, residenceYears: 0 },
          loan: { balance: 0, rate: 0.04 },
          rental: { type: "전세", netAnnualIncome: 0 },
          maintenanceAnnual: 0,
          sellingCostRate: 0.007,
          reconstruction: {
            enabled: true, stage: "조합설립 추진",             // ASSUMPTION: 정비사업 단계 미확인
            charge: 0, chargeYear: null,
            note: "개포경남·우성3차·현대1차 통합 재건축 추진 단지 — 분담금/일정 미확정"
          },
          assumptions: [
            "소유자/지분: 단독명의 100% 가정",
            "취득일 2016-05-01, 취득가 14억, 필요경비 6천만원 가정",
            "현재 시세 40억 가정 (재건축 기대 반영, 실거래가 확인 필요)",
            "전세(보증금 운용수익 미반영), 거주 이력 없음 가정",
            "2026 공시가격 28.09억은 사용자 제공값 (공식 DB 대조 필요)"
          ]
        }
      ],
      assumptions: {
        startYear: 2026,
        endYear: 2035,
        lawMode: "CURRENT",
        scenarioKey: "BASE",
        cashReturn: 0.03,
        discountRate: 0.03,
        liquidateAtEnd: true,
        customScenario: { marketGrowth: 0.03, publicGrowth: 0.025 }
      },
      screenshotReference: {
        note: "사용자 제공 기존 계산기 결과 — 비교용, 정답 아님 (PART 83)",
        year: 2026,
        totalHoldingTax: 42990000,
        jongbuse: 30170000
      }
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

  return { defaultPortfolio, load, save, reset, listSnapshots, saveSnapshot, deleteSnapshot };
})();

if (typeof module !== "undefined") module.exports = RETAX.State;
