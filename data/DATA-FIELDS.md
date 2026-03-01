# Open DART 수집 데이터 필드 설명

`data/corp/{corp_code}/` 아래에 저장되는 JSON 파일들의 항목 구조와 필드 의미를 정리한 문서입니다.

> **유지보수:** `data/corp/` 관련 JSON 파일의 **구조가 바뀌거나**, **새 JSON 파일이 추가될 때**는 반드시 이 문서(DATA-FIELDS.md)를 함께 수정해야 합니다. 필드 추가·삭제·이름 변경, 새 섹션, 새 파일 설명을 반영해 주세요.

---


## 1. overview.json (기업 개황)

Open DART **company.json** API 응답을 그대로 저장한 파일입니다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `status` | string | API 응답 상태 코드 (`000`: 정상) |
| `message` | string | API 응답 메시지 |
| `corp_code` | string | 공시대상회사 고유번호(8자리) |
| `corp_name` | string | 회사 정식명칭 |
| `corp_name_eng` | string | 회사 영문명칭 |
| `stock_name` | string | 종목명(상장사) 또는 약식명칭 |
| `stock_code` | string | 종목코드(6자리, 상장사) |
| `ceo_nm` | string | 대표이사명 |
| `corp_cls` | string | 법인구분 (Y: 유가증권, K: 코스닥, N: 코넥스, E: 기타) |
| `jurir_no` | string | 법인등록번호 |
| `bizr_no` | string | 사업자등록번호 |
| `adres` | string | 주소 |
| `hm_url` | string | 홈페이지 URL |
| `ir_url` | string | IR 페이지 URL |
| `phn_no` | string | 대표전화 |
| `fax_no` | string | 팩스 |
| `induty_code` | string | 업종코드 |
| `est_dt` | string | 설립일자(YYYYMMDD) |
| `acc_mt` | string | 결산월(MM) |
| `last_updated_at` | string | 데이터 최종 수집일(YYYY-MM-DD) |

---

## 2. financials.json (재무제표·분기 실적)

연도별 **연간(annual)** 과 **분기별(quarters)** 재무 지표를 담습니다.  
연간은 각 연도의 **사업보고서(결산)** 만 정확히 사용하고, 분기 데이터는 **가장 최신 실적이 존재하는 연도에 대해서만** 1분기·반기·3분기·사업보고서에서 가져온 **가장 최신 분기 1개 누적값 스냅샷**만을 저장합니다. (그 이전 연도는 annual만 유지하고 quarters는 비웁니다.)

### 루트 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `corp_code` | string | 공시대상회사 고유번호(8자리) |
| `financials_fs_policy` | string | `"CFS"`(연결 우선) \| `"OFS"`(개별만 사용). 기업이 연결 재무제표를 한 건이라도 제출하면 `CFS` |
| `items` | array | 연도별 재무 항목 배열(연도 내림차순) |
| `last_updated_at` | string | 데이터 최종 수집일 |

### items[]. 연도별 항목

| 필드 | 타입 | 설명 |
|------|------|------|
| `year` | number | 사업연도 |
| `annual` | object \| null | 연간 실적(사업보고서 또는 잠정 실적 Fallback). 없으면 `null` |
| `quarters` | object | 분기별 누적 스냅샷. **가장 최신 실적 연도에만 존재**하며, `"1Q"`, `"2Q"`, `"3Q"`, `"4Q"` 중 **가장 최신 분기 1개만** 포함 |
| `status` | string | `confirmed`(정기보고 확정), `partial`(분기만 있음), `preliminary`(잠정 반영) |
| `source` | string | `Annual Report`, `Quarterly`, `Disclosure` 등 |

### annual / quarters.1Q~4Q 내 공통 지표

| 필드 | 타입 | 설명 |
|------|------|------|
| `year` | number | 사업연도 |
| `quarter` | string \| null | 분기 식별(`"1Q"`~`"4Q"`). annual이면 `null` |
| `revenue` | number \| null | 매출액(원) |
| `op_income` | number \| null | 영업이익(원) |
| `net_income` | number \| null | 당기순이익(원) |
| `equity` | number \| null | 자본총계(원) |
| `total_assets` | number \| null | 자산총계(원) |
| `debt` | number \| null | 부채총계(원) |
| `operating_cf` | number \| null | 영업활동현금흐름(원). 분기 보고서는 누적값 우선(`thstrm_add_amount`) |
| `non_cash_adjustments` | number \| null | 비현금 조정 합계(원). 손익→영업현금흐름 조정 항목 |
| `working_capital_change` | number \| null | 운전자본 변동(원). 영업활동 자산·부채 증감 항목 |
| `capex_ppe` | number \| null | 유형자산 취득 관련 CapEx(원, 원본 부호 유지) |
| `capex_intangible` | number \| null | 무형자산 취득 관련 CapEx(원, 원본 부호 유지) |
| `capex_total` | number \| null | 총 CapEx(원). `abs(capex_ppe)+abs(capex_intangible)` |
| `fcf` | number \| null | 잉여현금흐름(원). `operating_cf - capex_total` |
| `roe` | number \| null | 자기자본이익률(%) |
| `roa` | number \| null | 총자산이익률(%) |
| `debt_ratio` | number \| null | 부채비율(%) |
| `status` | string | (있을 경우) `confirmed`, `preliminary` |
| `source` | string | (있을 경우) 출처 |
| `fs_div` | string \| null | 해당 수치의 재무제표 구분. `"CFS"`(연결), `"OFS"`(개별). 없으면 생략 또는 `null` |
| `report_type` | string \| (없음) | 분기 항목만. 현재 버전에서는 항상 `"cumulative"`로, 보고서에 공시된 누적 실적 스냅샷이라는 의미입니다. |

- **연간(annual)**: 각 연도 `사업보고서(11011)`의 결산 수치를 그대로 사용합니다.
- **분기(quarters)**: **가장 최신 실적 연도에 대해서만** `1Q`(1분기보고서 11013), `2Q`(반기보고서 11012), `3Q`(3분기보고서 11014), `4Q`(사업보고서 11011) 중 **가장 최신 분기 1개**의 누적 실적을 스냅샷으로 담습니다. 예: 3분기까지 나왔으면 해당 연도의 `quarters`에는 `"3Q"`만 존재합니다.
- **잠정 실적 Fallback**: 해당 연도 사업보고서가 없을 때, guidance에서 파싱한 잠정 실적이 `annual` 및 `quarters["4Q"]`에 채워질 수 있으며, 이때 `status: 'preliminary'`가 붙습니다.

---

## 3. dividends.json (배당)

연도별 **총 주당 현금배당금**과 **분기/중간/결산별 상세**를 계층 구조로 저장합니다.

### 루트 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `corp_code` | string | 공시대상회사 고유번호(8자리) |
| `items` | array | 연도별 배당 요약 배열(연도 내림차순) |
| `last_updated_at` | string | 데이터 최종 수집일 |

### items[]. 연도별 요약

| 필드 | 타입 | 설명 |
|------|------|------|
| `year` | number | 사업연도 |
| `total_cash_dividend_per_share` | number | 해당 연도 주당 현금배당금 합계(원). 분기+중간+결산 합산 |
| `dividend_yield_expect` | number \| null | 기대 배당수익률(%). 주가가 있을 때 (총배당/주가)×100 |
| `payout_ratio` | number \| null | 배당성향(%) |
| `dividend_yield` | number \| null | 배당수익률(%). 사업보고서 기준 |
| `details` | array | 해당 연도 분기·중간·결산별 배당 상세 |

### items[].details[]. 상세 1건

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | string | 배당 주기: `분기`, `중간`, `결산` |
| `label` | string | 표시용: `1분기`, `2분기`, `3분기`, `결산` 등 |
| `cash_dividend_per_share` | number \| null | 해당 회차 주당 현금배당금(원) |
| `rcept_no` | string | (수시공시인 경우) 접수번호 |
| `report_nm` | string | (수시공시인 경우) 공시보고서명 |
| `rcept_dt` | string | (수시공시인 경우) 접수일자 |
| `status` | string | `confirmed` |
| `source` | string | `Disclosure`(수시공시), `Annual Report`(사업보고서) |

---

## 4. guidance.json (가이던스)

최근 **1년** 공시 중, 영업실적 전망·잠정실적·공정공시에 해당하는 guidance 공시를 **최신 2건**만 모아, document 본문을 **태그 제거 후 LLM**으로 추출한 수치를 저장합니다. (V3: 비정형 파이프라인)

### 루트 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `corp_code` | string | 공시대상회사 고유번호(8자리) |
| `logic_version` | string | 비정형 LLM 파싱 로직 버전. 현재 코드의 `LLM_LOGIC_VERSION` 값 |
| `items` | array | 공시 목록(최대 2건). `rcept_dt` 최신 순 |
| `last_updated_at` | string | 데이터 최종 수집일 |

### items[]. 공시 1건

| 필드 | 타입 | 설명 |
|------|------|------|
| `rcept_no` | string | 접수번호 |
| `report_nm` | string | 공시보고서명 |
| `rcept_dt` | string | 접수일자(YYYYMMDD) |
| `status` | string | `preliminary`(수시공시 기반) |
| `source` | string | `Disclosure` |
| `report_kind` | string | 현재 버전에서는 항상 `guidance` |
| `period_label` | string \| (없음) | LLM 추출 성공 시 해당 공시의 분기 라벨(예: `2025.4Q`) |
| `values` | object \| (없음) | LLM으로 추출한 수치. 없으면 필드 자체가 없을 수 있음 |

### items[].values (있을 경우)

| 필드 | 타입 | 설명 |
|------|------|------|
| `revenue` | number \| null | 매출액(원) |
| `op_income` | number \| null | 영업이익(원) |
| `net_income` | number \| null | 당기순이익(원) |
| `cash_dividend_per_share` | number \| null | 주당 현금배당금(원) |

- guidance 후보는 비정형 통합 페이저에서 수집되며, 최신 재무 기간보다 최신인 공시만 유지합니다.
- 동일 `period_label`이 여러 건이면 가장 최신 `rcept_dt` 1건만 남기고 중복 제거합니다.
- LLM 추출은 후보 상한 내에서 수행되며, 추출에 성공한 경우에만 `values`·`period_label`이 붙습니다.
- 실적값(`revenue`, `op_income`, `net_income`)은 문서 내 `누계/누적 실적`을 우선 사용하며, `당해실적`은 사용하지 않습니다.
- 이 수치는 재무 연도에 **annual**이 없을 때 `financials.json`의 잠정 실적 Fallback으로도 사용됩니다.
- 모든 금액은 **원(KRW) 절대 금액**(Number). null인 필드는 UI에서 렌더링 방어 필요.

---

## 5. treasury.json (자사주 소각)

자기주식/자사주 소각 관련 수시공시를 문서 본문에서 파싱해 이벤트와 연도 요약을 저장합니다.

### 루트 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `corp_code` | string | 공시대상회사 고유번호(8자리) |
| `logic_version` | string | 비정형 파싱 로직 버전 (`LLM_LOGIC_VERSION`) |
| `items` | array | 자사주 소각 이벤트 목록 |
| `yearly_summary` | array | 연도별 소각 합계 요약 |
| `fetch_policy` | object | 조회 범위 정책 메타(최근 N개월 컷오프 등) |
| `last_updated_at` | string | 데이터 최종 수집일 |

### fetch_policy. 조회 정책 메타

| 필드 | 타입 | 설명 |
|------|------|------|
| `lookback_months` | number | 접수일 기준 조회 개월 수(현재 기본 18) |
| `cutoff_rcept_dt` | string \| null | 접수일 컷오프(YYYYMMDD). 이 날짜보다 과거 공시는 조회 대상에서 제외 |
| `source` | string | 정책 생성 경로(현재 `integrated-list-fetch`) |

### items[]. 이벤트 1건

| 필드 | 타입 | 설명 |
|------|------|------|
| `year` | number | 사업연도 |
| `rcept_no` | string | 접수번호 |
| `report_nm` | string | 공시보고서명 |
| `rcept_dt` | string | 접수일자(YYYYMMDD) |
| `event_type` | string | `decision`(소각 결정) \| `completion`(소각 완료/결과) |
| `retired_shares` | number \| null | 소각 주식수(주) |
| `retired_amount` | number \| null | 소각 금액(원) |
| `status` | string | `confirmed` |
| `source` | string | `Disclosure` |
| `confidence` | string | 추출 신뢰도(`low`/`medium`/`high`) |

### yearly_summary[]. 연도별 요약

| 필드 | 타입 | 설명 |
|------|------|------|
| `year` | number | 사업연도 |
| `retired_shares_total` | number \| null | 연도 합산 소각 주식수(주) |
| `retired_amount_total` | number \| null | 연도 합산 소각 금액(원) |
| `event_count` | number | 합산에 반영된 이벤트 수 |
| `basis` | string | 합산 기준(`completion` 우선, 없으면 `decision`) |

---

## 6. consensus.json (네이버 컨센서스)

NAVER 증권의 기업실적분석 표에서 연도별 컨센서스(예상치)를 수집한 데이터입니다.  
수집은 DART 파이프라인과 분리된 서버 온디맨드 방식으로 동작합니다.

### 루트 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `corp_code` | string | 공시대상회사 고유번호(8자리) |
| `stock_code` | string | 종목코드(6자리) |
| `source` | string | 데이터 출처(현재 `naver`) |
| `unit` | string | 값 단위(현재 `억원`) |
| `items` | array | 연도별 컨센서스 항목 |
| `source_url` | string \| null | 원본 수집 URL |
| `fetch_policy` | object | 캐시 정책 메타 |
| `last_updated_at` | string | 데이터 최종 수집일(YYYY-MM-DD) |
| `fetched_at` | string | 수집 시각(ISO datetime) |

### fetch_policy. 조회 정책 메타

| 필드 | 타입 | 설명 |
|------|------|------|
| `ttl_hours` | number | 온디맨드 캐시 TTL 시간 |

### items[]. 연도별 컨센서스

| 필드 | 타입 | 설명 |
|------|------|------|
| `year_label` | string | 연도 라벨(예: `2026E`) |
| `is_estimate` | boolean | 예상치 여부 |
| `revenue` | number \| null | 매출액(억원) |
| `op_income` | number \| null | 영업이익(억원) |
| `net_income` | number \| null | 당기순이익(억원) |
| `roe` | number \| null | ROE(%) |

---

## 파일 위치 요약

```
data/
  corp-index.json          # 회사 검색용 인덱스(별도 수집)
  corp/
    {corp_code}/
      overview.json        # 기업 개황
      financials.json      # 재무·분기(annual + quarters)
      dividends.json       # 배당(연도별 합산 + details)
      guidance.json        # 가이던스·잠정·배당결정(최대 2건)
      treasury.json        # 자사주 소각(이벤트 + 연도 요약)
      consensus.json       # NAVER 컨센서스(온디맨드 캐시)
```

데이터 출처: 금융감독원 Open DART API. 수집 스크립트: `scripts/sync-all.js`.
