# DB 스키마 및 JSON 매핑

하이브리드 DB(SQLite/Turso) 테이블 정의와 기존 JSON 파일 매핑 요약입니다. 상세 필드 의미는 `data/DATA-FIELDS.md`를 참고하세요.

---

## 테이블 ↔ JSON 매핑

| JSON 파일 | DB 테이블 | 비고 |
|-----------|-----------|------|
| `corp-index.json` | `corp_index` | 1:1 행 매핑 |
| `corp/{code}/overview.json` | `corp_overview` | 전체 JSON은 `payload_json`, 검색용 `stock_code`·`corp_name` 컬럼 |
| `corp/{code}/financials.json` | `corp_financial_meta`, `corp_financial_year_status`, `corp_financial_records` | meta=정책·갱신일, year_status=연도별 상태, records=annual/quarters 행 |
| `corp/{code}/dividends.json` | `corp_dividend_meta`, `corp_dividend_yearly`, `corp_dividend_details` | meta=갱신일, yearly=연도별 요약, details=회차별 상세 |
| `corp/{code}/guidance.json` | `corp_guidance_meta`, `corp_guidance_items` | meta=logic_version·갱신일, items=공시별+values |
| `corp/{code}/treasury.json` | `corp_treasury_meta`, `corp_treasury_items`, `corp_treasury_yearly_summary`, `corp_treasury_fetch_policy` | 이벤트·연도 요약·fetch_policy 분리 |
| `corp/{code}/consensus.json` | `corp_consensus_meta`, `corp_consensus_items` | meta=출처·TTL·갱신일, items=연도별 컨센서스 |
| (동기화 로그) | `sync_runs` | 로컬→Turso sync 실행 이력 |

---

## 테이블 목록 및 PK

| 테이블 | PK | 용도 |
|--------|-----|------|
| `schema_migrations` | version | 마이그레이션 버전 |
| `corp_index` | corp_code | 기업 검색 인덱스 |
| `corp_overview` | corp_code | 기업 개황(원문 payload_json) |
| `corp_financial_meta` | corp_code | 재무 정책·last_updated_at |
| `corp_financial_year_status` | (corp_code, year) | 연도별 상태·출처 |
| `corp_financial_records` | (corp_code, year, period_key) | annual/1Q~4Q 지표 |
| `corp_dividend_meta` | corp_code | 배당 갱신일 |
| `corp_dividend_yearly` | (corp_code, year) | 연도별 배당 요약 |
| `corp_dividend_details` | (corp_code, year, detail_idx) | 회차별 배당 상세 |
| `corp_guidance_meta` | corp_code | logic_version·갱신일 |
| `corp_guidance_items` | (corp_code, rcept_no) | 가이던스 공시+values |
| `corp_treasury_meta` | corp_code | logic_version·갱신일 |
| `corp_treasury_items` | (corp_code, rcept_no) | 자사주 소각 이벤트 |
| `corp_treasury_yearly_summary` | (corp_code, year) | 연도별 소각 요약 |
| `corp_treasury_fetch_policy` | corp_code | lookback_months·cutoff 등 |
| `corp_consensus_meta` | corp_code | 출처·TTL·fetched_at |
| `corp_consensus_items` | (corp_code, year_label) | 연도별 컨센서스 수치 |
| `sync_runs` | id | 원격 sync 실행 로그 |

---

## 스키마 적용

- 정의: `scripts/db/schema.js` (`ensureSchema`, `SYNCABLE_TABLES`)
- 적용 시점: `migrate-json-to-db.js` 실행 시 대상 DB에 `ensureSchema` 호출, `sync-to-remote.js` 실행 시 타깃 DB에 `ensureSchema` 호출
