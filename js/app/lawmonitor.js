/* =========================================================
 * TAX LAW WATCH — 법령 DB 자동 업데이트 (PART 3, 96~97)
 *
 * 동작 방식 (정적 웹앱용):
 *  - 앱이 열릴 때마다 law-updates.json을 자동으로 확인한다.
 *    1순위: 같은 저장소의 data/law-updates.json (GitHub Pages/로컬 서버)
 *    2순위: GitHub raw URL (다운로드한 단일파일에서도 동작)
 *  - 내장 법령 DB 버전보다 새 버전이면 규칙을 병합(applyUpdates)하고
 *    전체 재계산 후 "LAW UPDATE" 배너에 업데이트 시각을 표시한다.
 *  - 세법 레지스트리 탭의 "세법 최신 확인" 버튼으로 수동 확인도 가능.
 *
 * 법령 DB를 갱신하려면 저장소의 data/law-updates.json만 수정하면 된다
 * — 모든 사용자(웹/다운로드판)가 다음 접속 시 자동으로 새 규칙을 받는다.
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.LawMonitor = (function () {
  const Reg = RETAX.Registry;
  const STORE_KEY = "retax.lawcheck.v1";

  // 원격 법령 DB 위치 (배포 저장소 기준)
  const SOURCES = [
    "data/law-updates.json",
    "https://raw.githubusercontent.com/iyonseidental/retax-engine/master/data/law-updates.json"
  ];

  const state = {
    lastCheckedAt: null,     // 마지막 확인 시각 (이 브라우저)
    lastResult: null,        // "UPDATED" | "UP_TO_DATE" | "OFFLINE"
    appliedVersion: Reg.BUILTIN_REGISTRY_VERSION,
    appliedAt: null,         // 법령 DB 업데이트 시각 (원격 문서의 updatedAt)
    changedRuleIds: [],
    changelog: [],
    error: null
  };

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        state.lastCheckedAt = s.lastCheckedAt || null;
      }
    } catch (e) { /* 무시 */ }
  }
  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ lastCheckedAt: state.lastCheckedAt }));
    } catch (e) { /* 무시 */ }
  }

  function fmtTime(iso) {
    if (!iso) return "-";
    try { return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { return iso; }
  }

  async function fetchFirst() {
    let lastErr = null;
    for (const url of SOURCES) {
      if (url.includes("GITHUB_OWNER")) continue; // 저장소 미설정 시 스킵
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) { lastErr = new Error(url + " HTTP " + res.status); continue; }
        return { doc: await res.json(), url };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("no source");
  }

  /** 법령 DB 확인·적용. 반환: state (UI 표시용) */
  async function check() {
    state.lastCheckedAt = new Date().toISOString();
    saveStore();
    try {
      const { doc } = await fetchFirst();
      const isNewer = doc.registryVersion &&
        Reg.cmpVersion(doc.registryVersion, state.appliedVersion) > 0;
      state.changelog = Array.isArray(doc.changelog) ? doc.changelog : [];
      if (isNewer) {
        const changed = Reg.applyUpdates(doc);
        state.appliedVersion = Reg.lawUpdateState.registryVersion;
        state.appliedAt = doc.updatedAt || null;
        state.changedRuleIds = changed;
        state.lastResult = changed.length ? "UPDATED" : "UP_TO_DATE";
      } else {
        state.appliedAt = state.appliedAt || doc.updatedAt || null;
        state.lastResult = "UP_TO_DATE";
      }
      state.error = null;
    } catch (e) {
      state.lastResult = "OFFLINE";
      state.error = String(e && e.message || e);
    }
    return state;
  }

  loadStore();

  return { check, state, fmtTime, SOURCES };
})();

if (typeof module !== "undefined") module.exports = RETAX.LawMonitor;
