/* =========================================================
 * TAX RULE REGISTRY
 * 세법 규칙을 코드에 하드코딩하지 않고 메타데이터와 함께 등록한다.
 * status: CURRENT | PROPOSED | PASSED | PROMULGATED | FUTURE_EFFECTIVE | EXPIRED | SUPERSEDED
 * lawMode: 'CURRENT' | 'PROPOSED' | 'CUSTOM'
 *  - CURRENT  : 시행 중인 법률만 적용
 *  - PROPOSED : 정부 2026 세제개편안(2026-08-03 발표, 국회 미확정)을 시행 가정으로 적용
 *  - CUSTOM   : 사용자가 파라미터를 직접 덮어씀 (customOverrides)
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.Registry = (function () {
  const U = RETAX.Util;

  const APP_VERSION = "1.0";
  const BUILTIN_REGISTRY_VERSION = "1.0.0";   // 내장 법령 DB 버전
  const META_VERIFIED_AT = "2026-08-20";

  /* =========================================================
   * 1. 재산세 (지방세법)
   * ========================================================= */
  const RULES = [];

  RULES.push({
    ruleId: "PTX-2024-STD",
    taxType: "PROPERTY_TAX",
    jurisdiction: "KR-LOCAL",
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    status: "CURRENT",
    lawVersion: "지방세법 제110~113조, 시행령 제109조",
    sourceAuthority: "행정안전부 / 국가법령정보센터",
    sourceTitle: "지방세법(주택분 재산세)",
    sourceUrl: "https://www.law.go.kr/법령/지방세법",
    verifiedAt: META_VERIFIED_AT,
    calculationLogicVersion: "1.0.0",
    notes: "2024년부터 주택 세부담상한제 폐지, 과세표준상한제(연 5% 이내) 적용. 지역자원시설세(건축물분)는 건물시가표준액이 필요하여 기본 계산에서 제외(수동입력 시 반영).",
    params: {
      fmvRatio: 0.60,                          // 공정시장가액비율(다주택/일반)
      fmvRatioOneHome: [                       // 1세대 1주택 특례 비율 (공시가격 기준)
        { upTo: 3e8, ratio: 0.43 },
        { upTo: 6e8, ratio: 0.44 },
        { upTo: Infinity, ratio: 0.45 }
      ],
      standardBrackets: [                      // 표준세율 (과세표준 기준)
        { upTo: 6e7, rate: 0.001 },
        { upTo: 1.5e8, rate: 0.0015 },
        { upTo: 3e8, rate: 0.0025 },
        { upTo: Infinity, rate: 0.004 }
      ],
      specialOneHomeBrackets: [                // 1주택 공시 9억 이하 특례세율
        { upTo: 6e7, rate: 0.0005 },
        { upTo: 1.5e8, rate: 0.001 },
        { upTo: 3e8, rate: 0.002 },
        { upTo: Infinity, rate: 0.0035 }
      ],
      specialOneHomePriceCap: 9e8,             // 특례세율 적용 공시가격 상한
      urbanAreaRate: 0.0014,                   // 도시지역분
      localEducationRate: 0.20,                // 지방교육세 (재산세 본세의 20%)
      taxBaseCapGrowth: 0.05                   // 과세표준상한율 (전년 대비 최대 +5%)
    }
  });

  /* =========================================================
   * 2. 종합부동산세 — 현행
   * ========================================================= */
  RULES.push({
    ruleId: "CRT-2023-STD",
    taxType: "COMPREHENSIVE_TAX",
    jurisdiction: "KR-NATIONAL",
    effectiveFrom: "2023-01-01",
    effectiveTo: null,
    status: "CURRENT",
    lawVersion: "종합부동산세법 제8~10조, 시행령(공정시장가액비율 60%)",
    sourceAuthority: "기획재정부 / 국세청 / 국가법령정보센터",
    sourceTitle: "종합부동산세법(주택분)",
    sourceUrl: "https://www.law.go.kr/법령/종합부동산세법",
    verifiedAt: META_VERIFIED_AT,
    calculationLogicVersion: "1.0.0",
    notes: "기본공제 9억, 1세대1주택 단독명의 12억. 3주택 이상 & 과표 12억 초과분 중과세율. 세부담상한 150%.",
    params: {
      basicDeduction: 9e8,
      oneHomeDeduction: 12e8,
      fmvRatio: 0.60,
      generalBrackets: [                       // 2주택 이하
        { upTo: 3e8, rate: 0.005 },
        { upTo: 6e8, rate: 0.007 },
        { upTo: 12e8, rate: 0.010 },
        { upTo: 25e8, rate: 0.013 },
        { upTo: 50e8, rate: 0.015 },
        { upTo: 94e8, rate: 0.020 },
        { upTo: Infinity, rate: 0.027 }
      ],
      multiBrackets: [                         // 3주택 이상 (과표 12억 초과분부터 중과)
        { upTo: 3e8, rate: 0.005 },
        { upTo: 6e8, rate: 0.007 },
        { upTo: 12e8, rate: 0.010 },
        { upTo: 25e8, rate: 0.020 },
        { upTo: 50e8, rate: 0.030 },
        { upTo: 94e8, rate: 0.040 },
        { upTo: Infinity, rate: 0.050 }
      ],
      burdenCapRatio: 1.50,                    // 세부담상한 (전년 재산세+종부세 상당액의 150%)
      ruralSurtaxRate: 0.20,                   // 농어촌특별세
      ageCredits: [ { minAge: 70, credit: 0.40 }, { minAge: 65, credit: 0.30 }, { minAge: 60, credit: 0.20 } ],
      holdCredits: [ { minYears: 15, credit: 0.50 }, { minYears: 10, credit: 0.40 }, { minYears: 5, credit: 0.20 } ],
      creditCap: 0.80                          // 고령자+장기보유 합산 한도
    }
  });

  /* =========================================================
   * 3. 종합부동산세 — 2026 세제개편안 (PROPOSED, 국회 미확정)
   *    2027-01-01 이후 납세의무 성립분(=2027년 6/1 기준)부터 적용 예정
   * ========================================================= */
  RULES.push({
    ruleId: "CRT-2026REFORM",
    taxType: "COMPREHENSIVE_TAX",
    jurisdiction: "KR-NATIONAL",
    effectiveFrom: "2027-01-01",
    effectiveTo: null,
    status: "PROPOSED",
    lawVersion: "2026 세제개편안 (기획재정부, 2026-08-03 발표)",
    sourceAuthority: "기획재정부",
    sourceTitle: "2026년 세제개편안 — 종합부동산세 개편",
    sourceUrl: "https://www.moef.go.kr",
    sourcePublishedDate: "2026-08-03",
    verifiedAt: META_VERIFIED_AT,
    calculationLogicVersion: "1.0.0",
    notes: [
      "국회 심의 전 정부안. 확정 법률이 아니며 변경될 수 있음.",
      "1세대1주택: 실거주 시 공제 14억 / 비거주 시 9억.",
      "다주택자 등: 공제 = 4억 + 5억 × (거주주택 공시가격 ÷ 전체 공시가격 합계).",
      "공정시장가액비율: 2027년 70%, 2028년부터 3주택 이상 또는 조정대상지역 주택 보유자는 80%.",
      "세율: 주택가액 기준 일원화 — 2028년 이후 주택수와 무관하게 과표 12억 초과분에 현행 중과세율 수준 적용.",
      "[UNVERIFIED] 2027년 과도기 세율표의 세부 수치는 정부안 상세본으로 재검증 필요."
    ].join(" "),
    params: {
      oneHomeResidingDeduction: 14e8,
      oneHomeNonResidingDeduction: 9e8,
      multiBaseDeduction: 4e8,
      multiResidenceBonusMax: 5e8,             // × (거주주택 공시 / 총공시)
      fmvRatioByYear: function (year, isHighGroup) {
        if (year <= 2026) return 0.60;
        if (year === 2027) return 0.70;
        return isHighGroup ? 0.80 : 0.70;      // 2028~: 3주택+ 또는 조정지역 보유자 80%
      },
      // 2027: 현행 이원화 세율 유지(과도기, UNVERIFIED), 2028~: 가액 기준 일원화
      unifiedFromYear: 2028,
      unifiedThreshold: 12e8,
      burdenCapRatio: 1.50,
      ruralSurtaxRate: 0.20,
      ageCredits: [ { minAge: 70, credit: 0.40 }, { minAge: 65, credit: 0.30 }, { minAge: 60, credit: 0.20 } ],
      holdCredits: [ { minYears: 15, credit: 0.50 }, { minYears: 10, credit: 0.40 }, { minYears: 5, credit: 0.20 } ],
      creditCap: 0.80
    }
  });

  /* =========================================================
   * 4. 양도소득세 — 기본세율 (소득세법 제55조, 2023~)
   * ========================================================= */
  RULES.push({
    ruleId: "CGT-2023-BASIC",
    taxType: "CGT_BASIC",
    jurisdiction: "KR-NATIONAL",
    effectiveFrom: "2023-01-01",
    effectiveTo: null,
    status: "CURRENT",
    lawVersion: "소득세법 제55조, 제95조, 제104조",
    sourceAuthority: "국세청 / 국가법령정보센터",
    sourceTitle: "소득세법(양도소득세)",
    sourceUrl: "https://www.law.go.kr/법령/소득세법",
    verifiedAt: META_VERIFIED_AT,
    calculationLogicVersion: "1.0.0",
    notes: "기본세율 6~45%. 주택 단기양도: 1년 미만 70%, 2년 미만 60%. 기본공제 연 250만.",
    params: {
      basicBrackets: [
        { upTo: 1.4e7, rate: 0.06, deduction: 0 },
        { upTo: 5.0e7, rate: 0.15, deduction: 1.26e6 },
        { upTo: 8.8e7, rate: 0.24, deduction: 5.76e6 },
        { upTo: 1.5e8, rate: 0.35, deduction: 1.544e7 },
        { upTo: 3.0e8, rate: 0.38, deduction: 1.994e7 },
        { upTo: 5.0e8, rate: 0.40, deduction: 2.594e7 },
        { upTo: 1.0e9, rate: 0.42, deduction: 3.594e7 },
        { upTo: Infinity, rate: 0.45, deduction: 6.594e7 }
      ],
      shortTermUnder1yr: 0.70,
      shortTermUnder2yr: 0.60,
      annualBasicDeduction: 2.5e6,
      highPriceExemptionThreshold: 12e8,       // 1세대1주택 비과세 고가주택 기준
      ltsdGeneralPerYear: 0.02,                // 장기보유특별공제 일반: 3년 이상, 연 2%, 최대 30%
      ltsdGeneralMax: 0.30,
      ltsdGeneralMinYears: 3,
      ltsdOneHomeHoldPerYear: 0.04,            // 1세대1주택 표2: 보유 연 4% + 거주 연 4%, 최대 80%
      ltsdOneHomeResidePerYear: 0.04,
      ltsdOneHomeMax: 0.80,
      ltsdOneHomeMinResideYears: 2,
      localIncomeTaxRate: 0.10                 // 지방소득세 = 양도세의 10%
    }
  });

  /* =========================================================
   * 5. 다주택 중과 — 이력 관리 (조정대상지역 내 주택 양도)
   *    양도일이 어느 규칙 구간에 속하는지로 판정한다.
   * ========================================================= */
  RULES.push({
    ruleId: "CGT-SUR-BASE",
    taxType: "CGT_SURCHARGE",
    jurisdiction: "KR-NATIONAL",
    effectiveFrom: "2021-06-01",
    effectiveTo: "2022-05-09",
    status: "EXPIRED",
    lawVersion: "소득세법 제104조 제7항",
    sourceAuthority: "국세청",
    sourceTitle: "다주택자 조정대상지역 양도세 중과",
    sourceUrl: "https://www.nts.go.kr",
    verifiedAt: META_VERIFIED_AT,
    notes: "2주택 +20%p, 3주택 이상 +30%p, 장기보유특별공제 배제.",
    params: { twoHome: 0.20, threeHome: 0.30, ltsdExcluded: true, active: true }
  });
  RULES.push({
    ruleId: "CGT-SUR-SUSPEND",
    taxType: "CGT_SURCHARGE",
    jurisdiction: "KR-NATIONAL",
    effectiveFrom: "2022-05-10",
    effectiveTo: "2026-05-09",
    status: "EXPIRED",
    lawVersion: "소득세법 시행령 제167조의3 (중과배제 한시 유예)",
    sourceAuthority: "기획재정부 / 국세청",
    sourceTitle: "다주택자 양도세 중과 한시 배제 (수차례 연장 후 2026-05-09 종료)",
    sourceUrl: "https://www.nts.go.kr",
    verifiedAt: META_VERIFIED_AT,
    notes: "유예기간 내 양도분은 중과 배제 + 장기보유특별공제 적용. 2026-05-09 예정대로 종료됨(2026-02 정부 발표 확인). 경과조치: 2026-05-09까지 계약+계약금 증빙 시 일정기간 내 잔금 조건부 인정(본 엔진 미반영, 수동 판단 필요).",
    params: { twoHome: 0, threeHome: 0, ltsdExcluded: false, active: false }
  });
  RULES.push({
    ruleId: "CGT-SUR-2026RESUME",
    taxType: "CGT_SURCHARGE",
    jurisdiction: "KR-NATIONAL",
    effectiveFrom: "2026-05-10",
    effectiveTo: null,
    status: "CURRENT",
    lawVersion: "소득세법 제104조 제7항 (유예 종료로 중과 재개)",
    sourceAuthority: "국세청",
    sourceTitle: "다주택자 조정대상지역 양도세 중과 재개",
    sourceUrl: "https://www.nts.go.kr",
    verifiedAt: META_VERIFIED_AT,
    notes: "2026-05-10 이후 양도분부터 조정대상지역 2주택 +20%p, 3주택 이상 +30%p, 장특공제 배제.",
    params: { twoHome: 0.20, threeHome: 0.30, ltsdExcluded: true, active: true }
  });
  // PROPOSED: 2026 세제개편안 — 한시 완화 (2027/2028 양도분), 2029~ 원상복귀
  RULES.push({
    ruleId: "CGT-SUR-REFORM-2027",
    taxType: "CGT_SURCHARGE",
    jurisdiction: "KR-NATIONAL",
    effectiveFrom: "2027-01-01",
    effectiveTo: "2027-12-31",
    status: "PROPOSED",
    lawVersion: "2026 세제개편안 (2026-08-03 발표)",
    sourceAuthority: "기획재정부",
    sourceTitle: "다주택 양도세 중과 한시 완화 — 2027년 양도분",
    sourceUrl: "https://www.moef.go.kr",
    sourcePublishedDate: "2026-08-03",
    verifiedAt: META_VERIFIED_AT,
    notes: "2027년 양도분: 2주택 +5%p, 3주택 이상 +10%p. [UNVERIFIED] 장특공제 배제 유지 여부는 상세본 확인 필요 — 보수적으로 배제 유지로 계산.",
    params: { twoHome: 0.05, threeHome: 0.10, ltsdExcluded: true, active: true }
  });
  RULES.push({
    ruleId: "CGT-SUR-REFORM-2028",
    taxType: "CGT_SURCHARGE",
    jurisdiction: "KR-NATIONAL",
    effectiveFrom: "2028-01-01",
    effectiveTo: "2028-12-31",
    status: "PROPOSED",
    lawVersion: "2026 세제개편안 (2026-08-03 발표)",
    sourceAuthority: "기획재정부",
    sourceTitle: "다주택 양도세 중과 한시 완화 — 2028년 양도분 (현행의 절반 수준)",
    sourceUrl: "https://www.moef.go.kr",
    sourcePublishedDate: "2026-08-03",
    verifiedAt: META_VERIFIED_AT,
    notes: "2028년 양도분: 2주택 +10%p, 3주택 이상 +15%p (현행 대비 절반 수준).",
    params: { twoHome: 0.10, threeHome: 0.15, ltsdExcluded: true, active: true }
  });
  RULES.push({
    ruleId: "CGT-SUR-REFORM-2029",
    taxType: "CGT_SURCHARGE",
    jurisdiction: "KR-NATIONAL",
    effectiveFrom: "2029-01-01",
    effectiveTo: null,
    status: "PROPOSED",
    lawVersion: "2026 세제개편안 (2026-08-03 발표)",
    sourceAuthority: "기획재정부",
    sourceTitle: "다주택 양도세 중과 — 2029년 양도분부터 원상복귀",
    sourceUrl: "https://www.moef.go.kr",
    sourcePublishedDate: "2026-08-03",
    verifiedAt: META_VERIFIED_AT,
    notes: "2029년 이후 양도분: 2주택 +20%p, 3주택 이상 +30%p로 복귀.",
    params: { twoHome: 0.20, threeHome: 0.30, ltsdExcluded: true, active: true }
  });

  /* =========================================================
   * 6. 조정대상지역 이력 (Regulated Area History)
   * ========================================================= */
  const REGULATED_AREAS = [
    { region: "서울 강남구", effectiveFrom: "2016-11-03", effectiveTo: null, status: "CURRENT",
      officialSource: "국토교통부 고시 (2023-01-05 해제 대상에서 제외, 계속 지정)" },
    { region: "서울 서초구", effectiveFrom: "2016-11-03", effectiveTo: null, status: "CURRENT",
      officialSource: "국토교통부 고시" },
    { region: "서울 송파구", effectiveFrom: "2016-11-03", effectiveTo: null, status: "CURRENT",
      officialSource: "국토교통부 고시" },
    { region: "서울 용산구", effectiveFrom: "2016-11-03", effectiveTo: null, status: "CURRENT",
      officialSource: "국토교통부 고시" },
    // 서울 그 외 자치구(동작구 포함): 2016-11-03 지정 → 2023-01-05 해제 → 2025-10-16 재지정(10·15 대책)
    { region: "서울 기타 자치구(동작구 포함) 1차", regionKey: "서울 기타", effectiveFrom: "2016-11-03", effectiveTo: "2023-01-04",
      status: "EXPIRED", officialSource: "국토교통부 고시 (2023-01-05 해제)" },
    { region: "서울 기타 자치구(동작구 포함) 재지정", regionKey: "서울 기타", effectiveFrom: "2025-10-16", effectiveTo: null,
      status: "CURRENT", officialSource: "국토교통부 10·15 대책 (2025-10-16 시행) — 서울 전역 조정대상지역" }
  ];

  const ALWAYS_REGULATED_GU = ["강남구", "서초구", "송파구", "용산구"];

  /** 양도/기준일 당시 조정대상지역 여부 (서울 자치구 기준) */
  function isRegulatedAt(district, dateStr) {
    const d = (district || "").trim();
    if (!d) return false;
    const isCoreGu = ALWAYS_REGULATED_GU.some(g => d.includes(g));
    for (const a of REGULATED_AREAS) {
      const match = isCoreGu
        ? ALWAYS_REGULATED_GU.some(g => d.includes(g) && a.region.includes(g))
        : a.regionKey === "서울 기타";
      if (match && RETAX.Util.inRange(dateStr, a.effectiveFrom, a.effectiveTo)) return true;
    }
    return false;
  }

  /* =========================================================
   * 조회 API
   * ========================================================= */
  function findRules(taxType) { return RULES.filter(r => r.taxType === taxType); }

  /** lawMode에 따라 특정 날짜에 적용할 규칙을 고른다.
   *  PROPOSED 모드: 해당 날짜에 유효한 PROPOSED 규칙이 있으면 우선, 없으면 CURRENT로 폴백.
   *  CURRENT 모드: status가 CURRENT/EXPIRED(이력) 규칙 중 날짜 매칭. */
  function getRule(taxType, dateStr, lawMode) {
    const candidates = findRules(taxType).filter(r => U.inRange(dateStr, r.effectiveFrom, r.effectiveTo));
    const proposed = candidates.filter(r => r.status === "PROPOSED" || r.status === "PASSED" ||
      r.status === "PROMULGATED" || r.status === "FUTURE_EFFECTIVE");
    const enacted = candidates.filter(r => r.status === "CURRENT" || r.status === "EXPIRED");
    if (lawMode === "PROPOSED" && proposed.length) return proposed[proposed.length - 1];
    if (enacted.length) return enacted[enacted.length - 1];
    // 미래 연도에 시행법이 없으면: 현행법 유지 가정 (Hold Current Law Constant)
    const all = findRules(taxType).filter(r => r.status === "CURRENT");
    return all.length ? all[all.length - 1] : null;
  }

  /* =========================================================
   * LAW UPDATE — 원격 법령 DB(law-updates.json) 반영
   * updateDoc = { registryVersion, updatedAt, changelog[], ruleOverrides[], regulatedAreaOverrides[] }
   * ruleOverride: ruleId로 기존 규칙을 찾아 필드 병합, 없으면 신규 규칙으로 추가.
   * 반환: 변경된 ruleId 목록
   * ========================================================= */
  const lawUpdateState = {
    registryVersion: BUILTIN_REGISTRY_VERSION,
    updatedAt: null,            // 마지막 법령 DB 업데이트 시각 (원격 문서 기준)
    changelog: [],
    changedRuleIds: [],
    source: "BUILTIN"
  };

  function cmpVersion(a, b) {
    const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
    return 0;
  }

  function applyUpdates(doc) {
    if (!doc || typeof doc !== "object") return [];
    const changed = [];
    for (const ov of doc.ruleOverrides || []) {
      if (!ov.ruleId) continue;
      const existing = RULES.find(r => r.ruleId === ov.ruleId);
      if (existing) {
        const before = JSON.stringify({ s: existing.status, p: existing.params,
          f: existing.effectiveFrom, t: existing.effectiveTo });
        for (const k of ["status", "effectiveFrom", "effectiveTo", "lawVersion", "notes",
                          "sourceUrl", "sourceTitle", "verifiedAt", "sourcePublishedDate"])
          if (ov[k] !== undefined) existing[k] = ov[k];
        if (ov.params) Object.assign(existing.params, ov.params);
        existing.updatedAt = doc.updatedAt || null;
        const after = JSON.stringify({ s: existing.status, p: existing.params,
          f: existing.effectiveFrom, t: existing.effectiveTo });
        if (before !== after) changed.push(ov.ruleId);
      } else {
        RULES.push(Object.assign({ updatedAt: doc.updatedAt || null }, ov));
        changed.push(ov.ruleId);
      }
    }
    for (const av of doc.regulatedAreaOverrides || []) {
      const ex = REGULATED_AREAS.find(a => a.region === av.region && a.effectiveFrom === av.effectiveFrom);
      if (ex) Object.assign(ex, av); else REGULATED_AREAS.push(av);
      changed.push("AREA:" + av.region);
    }
    if (doc.registryVersion && cmpVersion(doc.registryVersion, lawUpdateState.registryVersion) > 0)
      lawUpdateState.registryVersion = doc.registryVersion;
    if (doc.updatedAt) lawUpdateState.updatedAt = doc.updatedAt;
    if (Array.isArray(doc.changelog)) lawUpdateState.changelog = doc.changelog;
    lawUpdateState.changedRuleIds = changed;
    lawUpdateState.source = "REMOTE";
    return changed;
  }

  return { RULES, REGULATED_AREAS, findRules, getRule, isRegulatedAt,
           META_VERIFIED_AT, APP_VERSION, BUILTIN_REGISTRY_VERSION,
           applyUpdates, cmpVersion, lawUpdateState };
})();

if (typeof module !== "undefined") module.exports = RETAX.Registry;
