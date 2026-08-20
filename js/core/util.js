/* =========================================================
 * RETAX core utilities
 * - 모든 금액은 KRW 정수(Number, < 2^53)로 처리한다.
 * - 부동소수점 오차를 피하기 위해 곱셈 직후 정해진 지점에서만 반올림한다.
 * ========================================================= */
"use strict";
globalThis.RETAX = globalThis.RETAX || {};

RETAX.Util = (function () {

  /** KRW 정수 반올림 (원 단위) */
  function won(x) { return Math.round(x); }

  /** 원 단위 절사(10원 미만 버림 등 필요 시) */
  function floor10(x) { return Math.floor(x / 10) * 10; }

  /** 누진 브래킷 계산.
   * brackets: [{upTo, rate}] (upTo는 상한, 마지막은 Infinity)
   * 반환: {tax, steps:[{from,to,base,rate,amount}]}
   */
  function progressiveTax(base, brackets) {
    let tax = 0, prev = 0;
    const steps = [];
    for (const b of brackets) {
      if (base <= prev) break;
      const upper = Math.min(base, b.upTo);
      const portion = upper - prev;
      const amount = won(portion * b.rate);
      tax += amount;
      steps.push({ from: prev, to: upper, base: portion, rate: b.rate, amount });
      prev = b.upTo;
    }
    return { tax: won(tax), steps };
  }

  /** 누진공제 방식: base*rate - deduction. table: [{upTo, rate, deduction}] */
  function bracketRateOf(base, table) {
    for (const t of table) if (base <= t.upTo) return t;
    return table[table.length - 1];
  }

  /* ---------- 날짜 유틸 (문자열 'YYYY-MM-DD' 기반, 시간대 이슈 회피) ---------- */
  function dstr(y, m, d) {
    return String(y).padStart(4, "0") + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  function cmpDate(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function yearOf(dateStr) { return parseInt(dateStr.slice(0, 4), 10); }
  /** dateStr이 [from, to] 구간(문자열, to는 null이면 무한) 안인가 */
  function inRange(dateStr, from, to) {
    if (from && dateStr < from) return false;
    if (to && dateStr > to) return false;
    return true;
  }
  /** 두 날짜 사이 경과 연수(만 나이 방식, 소수 없음) */
  function fullYearsBetween(fromStr, toStr) {
    if (!fromStr || !toStr || toStr < fromStr) return 0;
    const fy = yearOf(fromStr), ty = yearOf(toStr);
    let years = ty - fy;
    if (toStr.slice(5) < fromStr.slice(5)) years -= 1;
    return Math.max(0, years);
  }
  /** 해당 연도 재산세·종부세 과세기준일 */
  function assessmentDate(year) { return dstr(year, 6, 1); }
  /** 매도인이 해당 연도 보유세를 부담하는가 (6/1 잔금이면 취득자=매수인이 납세의무자) */
  function sellerOwesHoldingTax(saleDateStr, year) {
    if (!saleDateStr) return true;
    return saleDateStr > assessmentDate(year);
  }

  /* ---------- 숫자 포맷 ---------- */
  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    return Math.round(n).toLocaleString("ko-KR");
  }
  function fmtWon(n) { return fmt(n) + "원"; }
  /** 억 단위 표기: 46.07억 / 4,299만 */
  function fmtEok(n) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    const sign = n < 0 ? "-" : "";
    const a = Math.abs(n);
    if (a >= 1e8) return sign + (a / 1e8).toFixed(a >= 1e10 ? 1 : 2).replace(/\.?0+$/, "") + "억";
    if (a >= 1e4) return sign + Math.round(a / 1e4).toLocaleString("ko-KR") + "만";
    return sign + Math.round(a).toLocaleString("ko-KR") + "원";
  }
  function pct(x, digits) { return (x * 100).toFixed(digits === undefined ? 1 : digits) + "%"; }

  return {
    won, floor10, progressiveTax, bracketRateOf,
    dstr, cmpDate, yearOf, inRange, fullYearsBetween,
    assessmentDate, sellerOwesHoldingTax,
    fmt, fmtWon, fmtEok, pct
  };
})();

if (typeof module !== "undefined") module.exports = RETAX.Util;
