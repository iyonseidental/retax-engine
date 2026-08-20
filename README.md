# 부동산 보유·매도 전략 엔진 (Korea Real Estate Tax & Exit Strategy Engine)

보유세(재산세·종부세)·양도세를 deterministic rule engine으로 계산하고,
"언제·어느 집을 팔아야 세후 최종자산이 최대인가"를 전수 시뮬레이션으로 분석하는 로컬 우선(local-first) 도구.

## 실행

```
# 웹 UI (개발 서버)
node server.js          # → http://localhost:8734
# 또는 index.html을 브라우저로 직접 열기 (더블클릭으로도 동작)

# 테스트 (80개)
node tests/run-tests.js
```

## 핵심 화면
| 탭 | 내용 |
|---|---|
| 대시보드 | 요약 카드, 핵심 5질문 답, 비교 매트릭스, SELL REVIEW SIGNAL, ANALYSIS |
| 보유주택 입력 | 주택/세대/지분/취득/거주/대출/임대/재건축 분담금 입력 |
| 보유세 상세 | 연도별 표·차트, 계산과정 감사(audit), 현행 vs 개편안 영향 |
| 양도세 | 매도연도별 양도세 (현행/개편안), 계산 상세 |
| 전략 비교 | 전략 전수평가 순위, 매도연도 최적화 곡선, REVERSAL POINT |
| 민감도·스트레스 | 매도연도 × 상승률 히트맵, 스트레스 프리셋 |
| 세법 레지스트리 | Tax Rule Registry 전체, 조정대상지역 이력, 공식 소스 링크 |
| 스냅샷 | 분석 저장/비교, JSON 내보내기 |

## 원칙
- 세금 계산 = deterministic engine (AI는 설명만) · 법령은 Rule Registry로 관리 (effectiveFrom/To, status, source)
- CURRENT LAW와 2026 세제개편안(PROPOSED)을 절대 혼합하지 않음 — 화면에 배지·경고 상시 표시
- 미확인 입력값은 ASSUMPTION 배지 표시 · 개인정보는 브라우저(localStorage) 밖으로 전송하지 않음
- **법령 검증일: 2026-08-20** — 실행 당시 공식 법령이 항상 우선. `ARCHITECTURE_TAX_VALIDATION_REPORT.md` 참조.

## 면책
본 프로그램은 의사결정용 시뮬레이션 도구이며 실제 신고세액과 다를 수 있습니다.
중요한 매매·신고 전 반드시 세무전문가 확인이 필요합니다.
