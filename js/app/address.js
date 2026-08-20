/* =========================================================
 * ADDRESS SEARCH + 공시가격 조회 지원 (PART 6~7, 63~64)
 *
 * - 주소 검색: 카카오(다음) 우편번호 서비스 — API 키 불필요, 무료.
 *   스크립트 로드 실패(오프라인/CSP 차단) 시 수동입력으로 자연스럽게 폴백.
 * - 공시가격: 정부 공동주택 공시가격 API(data.go.kr)는 브라우저 직접 호출을
 *   차단(CORS)하므로, ① 부동산공시가격알리미 바로열기 ② 입력값을
 *   주소+동+호 키로 로컬 캐시 → 재입력 시 자동 채움 (API→CACHE→MANUAL).
 * - 주소 검색어는 카카오 서버로 전송된다(주소 검색 사용 시에만).
 *   그 외 모든 데이터는 이 브라우저를 벗어나지 않는다.
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.Address = (function () {
  const POSTCODE_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
  const CACHE_KEY = "retax.pubprice.cache.v1";

  /* ---------- 자치구 → 조정대상지역 판정용 district 매핑 ---------- */
  function districtFromJuso(sido, sigungu) {
    const si = (sido || "").trim(), gu = (sigungu || "").trim();
    if (si.startsWith("서울")) {
      for (const g of ["강남구", "서초구", "송파구", "용산구"]) if (gu.includes(g)) return g;
      // 등록된 자치구 외 서울 전역
      if (gu.endsWith("구")) return gu.includes("동작구") ? "동작구" : "기타 서울";
      return "기타 서울";
    }
    return "비규제지역"; // 서울 외 지역: v1 레지스트리에 이력 없음 — 직접 확인 필요
  }

  /* ---------- 카카오 우편번호 스크립트 로드 ---------- */
  let loading = null;
  function loadScript() {
    if (globalThis.daum && globalThis.daum.Postcode) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = POSTCODE_SRC;
      s.onload = () => resolve();
      s.onerror = () => { loading = null; reject(new Error("postcode script load failed")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  /** 주소 검색 팝업. onSelect({roadAddress, jibunAddress, buildingName, sido, sigungu, district, bcode}) */
  async function openSearch(onSelect) {
    try {
      await loadScript();
    } catch (e) {
      alert("주소검색 서비스를 불러올 수 없습니다 (오프라인이거나 이 환경에서 외부 스크립트가 차단됨).\n주소를 직접 입력해 주세요.");
      return false;
    }
    new globalThis.daum.Postcode({
      oncomplete: data => onSelect({
        roadAddress: data.roadAddress || data.address,
        jibunAddress: data.jibunAddress || "",
        buildingName: data.buildingName || "",
        sido: data.sido, sigungu: data.sigungu,
        bcode: data.bcode || "",
        district: districtFromJuso(data.sido, data.sigungu)
      })
    }).open();
    return true;
  }

  /* ---------- 공시가격 로컬 캐시 (주소+동+호 → {연도: 가격}) ---------- */
  function cacheKeyOf(address, dong, ho) {
    return [String(address || "").trim(), String(dong || "").trim(), String(ho || "").trim()].join("|");
  }
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch (e) { return {}; }
  }
  function getCachedPrice(address, dong, ho, year) {
    const c = readCache()[cacheKeyOf(address, dong, ho)];
    return c && c.prices && c.prices[year] != null
      ? { price: c.prices[year], savedAt: c.savedAt } : null;
  }
  function saveCachedPrice(address, dong, ho, year, price) {
    if (!address || !price) return;
    try {
      const all = readCache();
      const k = cacheKeyOf(address, dong, ho);
      all[k] = all[k] || { prices: {} };
      all[k].prices[year] = price;
      all[k].savedAt = new Date().toISOString();
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (e) { /* 무시 */ }
  }

  /** 부동산공시가격알리미 공동주택 조회 페이지 열기 */
  function openRealtyPrice() {
    window.open("https://www.realtyprice.kr/notice/gsstandard/search.htm", "_blank", "noopener");
  }

  return { districtFromJuso, openSearch, getCachedPrice, saveCachedPrice, openRealtyPrice };
})();

if (typeof module !== "undefined") module.exports = RETAX.Address;
