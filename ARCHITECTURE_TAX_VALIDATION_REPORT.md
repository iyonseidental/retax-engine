# ARCHITECTURE & TAX VALIDATION REPORT
Korea Real Estate Tax & Exit Strategy Engine — v1
작성일: 2026-08-20 · 법령 검증일: 2026-08-20

---

## 1. Existing architecture (Repository Audit)
`C:\연세클로드`에는 무관한 프로젝트(ucat-question-bank, chaerim-math 등)만 존재 → **신규 프로젝트** `retax-engine/`로 생성.

## 2. Proposed architecture
빌드 도구 없는 순수 JS(브라우저+Node 겸용, UMD-스타일 전역 네임스페이스 `RETAX`).
```
retax-engine/
  index.html  css/style.css  server.js(개발용)
  js/core/util.js          정수 KRW 연산, 누진세, 날짜(6/1 기준일)
  js/rules/registry.js     TAX RULE REGISTRY (메타데이터 포함 11개 규칙 + 조정대상지역 이력)
  js/engine/propertyTax.js 재산세
  js/engine/jongbuse.js    종합부동산세
  js/engine/cgt.js         양도소득세 + 지방소득세
  js/engine/holding.js     연도별 세대 보유세 오케스트레이터
  js/engine/market.js      시장/공시 가격 시나리오 (분리 변수)
  js/engine/strategy.js    HOLD/SELL 시뮬레이터, 전수평가, Break-even, Reversal, 민감도
  js/app/state.js charts.js ui.js   local-first 상태·SVG차트·화면
  tests/run-tests.js       80개 회귀 테스트
```
원칙 준수: 세금은 100% deterministic engine이 계산, 화면의 ANALYSIS 문구는 엔진 숫자를 넣는 규칙 기반 템플릿(PART 78~79).

## 3. Property data model
`{id, name, district, address, exclusiveArea, owners[{taxpayerId, share}], publicPriceByYear{연도:값+등급}, marketValue, acquisitionDate/Price, necessaryExpenses, residence{isCurrentResidence, residenceYears}, loan{balance, rate}, rental{type, netAnnualIncome}, maintenanceAnnual, sellingCostRate, reconstruction{charge, chargeYear}, assumptions[]}`

## 4. Ownership / Household model
PROPERTY / TAXPAYER / HOUSEHOLD 3계층 분리(PART 9).
재산세=물건별 산출 후 지분 안분, 종부세=인별 합산(각자 기본공제), 양도세=소유자별 지분 계산(누진세율 인별 적용), 1세대1주택 판정=세대 기준.

## 5. Tax Rule Registry
규칙마다 `ruleId, taxType, effectiveFrom/To, status(CURRENT/PROPOSED/EXPIRED…), lawVersion, sourceAuthority/Title/Url, verifiedAt, notes, params`.
법령 모드: MODE A(현행법) / MODE B(2026 개편안, 화면에 미확정 경고 상시 표시) / MODE C(CUSTOM 시나리오 파라미터).

## 6. Current tax-law verification (2026-08-20 웹 검증 완료)
| 항목 | 현행 (검증됨) |
|---|---|
| 종부세 기본공제 | 9억 (1세대1주택 단독명의 12억) |
| 종부세 공정시장가액비율 | 60% |
| 종부세 세율 | 2주택 이하 0.5~2.7% / 3주택+ 과표 12억 초과 중과 최대 5.0% |
| 재산세 | 표준 0.1~0.4%, 1주택 9억 이하 특례세율, FMV 60%(1주택 43~45%), 과표상한제 5% |
| **다주택 양도세 중과** | **유예 2026-05-09 종료 → 2026-05-10부터 조정지역 2주택 +20%p / 3주택 +30%p 재개, 장특공제 배제** |
| 조정대상지역 | 강남·서초·송파·용산(계속) + 서울 전역 재지정(2025-10-16, 10·15 대책) — 이력(history)로 관리 |

## 7. 2026 tax-reform status verification
2026-08-03 기획재정부 발표 — **status: PROPOSED (국회 미확정)**.
- 종부세: 1주택 실거주 공제 14억/비거주 9억, 다주택 공제 = 4억+5억×(거주주택 공시/총공시), FMV 2027년 70% → 2028년~ 3주택+/조정지역 80%, 세율 가액 기준 일원화(2028~ 과표 12억 초과 시 중과 수준), 2027-01-01 납세의무 성립분부터.
- 양도세 중과 한시 완화: 2027 양도 +5/+10%p → 2028 +10/+15%p → 2029~ +20/+30%p 복귀.
- [UNVERIFIED]로 표시한 항목: 2027년 종부세 과도기 세율표 세부, 중과 완화 시 장특공제 배제 유지 여부(보수적으로 배제 유지 가정).

## 8~11. 데이터 소스 아키텍처 (Address / Public price / Market)
v1은 **local-first + 수동입력** (API 키·서버 프록시 불필요, 개인정보 외부 전송 없음).
설계된 fallback: `공공 API → 로컬 캐시 → 수동입력`. 확장 시: 도로명주소 API(juso.go.kr), 부동산공시가격알리미, 국토부 실거래가 OpenAPI, R-ONE — 모두 serverless proxy 뒤에 두고 `.env.local`로 키 관리(PART 63). 값마다 등급 표시(EXACT/USER_INPUT/ASSUMPTION/SCENARIO).

## 12. Holding-tax calculation architecture
연 단위 체인 계산: 재산세(과표상한 5% 체인) → 종부세(재산세 중복분 공제 = 부과 재산세 × [종부세 과표×재산세FMV의 표준세율 상당액 ÷ 주택별 표준세율 상당액 합], 1세대1주택 고령·장기 세액공제 80% 한도, 세부담상한 150% 체인) → 농특세 20%. 6/1 과세기준일: 매도일 > 6/1이면 매도인 부담.

## 13. Capital-gains-tax architecture
양도일 기준 유효 규칙 적용. 1세대1주택 비과세(12억 초과 안분), 장특공제 일반(연2%, max30%)/표2(보유+거주 각 연4%, max80%), 조정지역 취득 시 거주 2년 요건, 단기양도 70/60%, 중과 이력(유예 종료 반영), 기본공제 250만/인, 지방소득세 10%.

## 14. Law-update-monitor architecture
v1: 세법 레지스트리 탭에 규칙 전체 + 검증일 + 공식 소스 바로가기(법령정보센터/기재부/국세청/의안정보시스템). LAW CHANGE IMPACT는 CURRENT vs PROPOSED 비교표(연도별 영향 + 5년 누적 + 전략 순위 변화 경고)로 구현. 서버 배포 시 주간 크롤 체크로 확장 가능한 구조.

## 15. Strategy simulation architecture
전략 자동 생성(모두 보유 / 각 주택 × 연도 × 6/1 전후 2개 날짜 / 2채 순차 매도 그리드) → 전수 시뮬레이션 → 세후 최종자산 순위. 매도 후 잔여 주택은 1주택 체계(12억 공제·특례세율·비과세 가능성)로 자동 재계산. 매도대금은 cashReturn으로 운용(기회수익), 종료연도 청산 가정(잔여 주택 양도세 포함)으로 공정 비교. NPV는 비재투자 현금흐름 할인.

## 16. Break-even methodology
`Break-even rate = (보유세+이자+유지비 − 순임대수익) ÷ 시장가치` 연도별 산출.
SELL REVIEW POINT = (기대수익 < 보유비용) AND (매도 TW > 보유 TW) 동시 성립 연도 — 자동 매도 권고가 아닌 재검토 신호로만 표시(PART 37~38).
STRATEGY REVERSAL POINT = 시장상승률 이분탐색으로 전략 우위가 뒤집히는 경계값(-5%~+12% 구간).

## 17. Current two-property regression case (기본 가정, CURRENT LAW)
공시 46.068억(흑석 17.978 + 개포 28.09), 단독명의 가정:
- 2026 재산세 15,625,296원 / 종부세 18,205,248원 / 농특세 3,641,050원 → **총 37,471,594원**
- 2027 개편안 가정 시 종부세 25,012,977원(현행 18,205,248원 대비 +37%)
- ~2035 누적보유세: 현행 4.41억 vs 개편안 8.39억

## 18. Screenshot discrepancy analysis (PART 83~84)
| 항목 | 기존 계산기 | 본 엔진 | 차이 |
|---|---|---|---|
| 2026 총보유세 | 42,990,000 | 37,471,594 | -5,518,406 |
| 종부세(농특 포함 추정) | 30,170,000 | 21,846,298 | -8,323,702 |
원인 후보: ① 재산세 중복분 공제 산식 차이(기존 계산기가 공제 축소/미반영 가능성) ② 공정시장가액비율 가정(60% vs 80%) ③ 세부담상한 전년값 유무 ④ 명의/지분 가정. → 기존 계산기는 정답으로 사용하지 않음.

## 19. Test plan / 결과
`node tests/run-tests.js` — **80 passed, 0 failed.**
커버: 누진계산, 6/1 경계(5/31·6/1·6/2), 조정지역 이력(동작구 해제→재지정), 재산세(특례세율·과표상한), 종부세(2주택/3주택 중과/공동명의/1주택 12억+세액공제/세부담상한/개편안 2026·2027·2028), 양도세(비과세·고가안분·표2 장특 80%·유예경계 2026-05-09/10·개편안 2027/28/29 중과·비조정·단기·차손), 전략(6/1 전후 보유세, 매도 후 1주택 재계산, 전수평가 정렬, exit curve, reversal, 민감도, BEAR<BASE, CURRENT≠PROPOSED). 브라우저 8개 탭 + 모드 전환/입력 적용/스냅샷/스트레스 프리셋 수동검증, 콘솔 오류 0.

## 20. Development phases
- 완료: PHASE 0~11 상당(감사→룰 레지스트리→3대 세목 엔진→시장→전략→차트/대시보드→실제 포트폴리오→회귀 테스트)
- 잔여 위험/다음 단계: ① 공시가격·실거래 공공 API 연동(프록시 서버) ② 2026 개편안의 국회 확정 시 레지스트리 상태 갱신(PROPOSED→PROMULGATED) ③ 부부공동명의 1주택 특례(12억 합산 선택) 미구현 ④ 지역자원시설세(건물분) 수동입력만 ⑤ 일시적 2주택·상속·혼인 특례 미구현(입력 필드만 설계) ⑥ Monte Carlo(구조만 확장 가능).

### BLOCKER 여부: 없음 — 치명적 구조 문제 없이 구현 완료.
