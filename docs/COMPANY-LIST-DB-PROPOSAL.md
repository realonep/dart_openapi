# 회사 목록·관리 DB화 제안

## 1. 현황

| 구분 | 저장소 | 용도 | 사용처 |
|------|--------|------|--------|
| **수집 대상** | `data/meta/companies-config.json` (target_corps) | 어떤 기업을 sync할지 | sync-all, fetch-*, POST /api/target-corps |
| **수집된 기업 인덱스** | DB `corp_index` | 앱 검색·대시보드 목록 | /api/corp-index, 검색 바 "수집된 기업" |
| **전체 상장사 목록** | `data/meta/corp-code-list.json` | 전체 상장사 검색·추가 | /api/search-corps, "전체 상장사 (추가)" |

- 수집 대상과 전체 상장사 목록은 **파일**이라 백업·버전·조회 조건이 DB보다 불리함.
- 회사 관련 데이터를 **한 곳(DB)**에서 관리하면 일관성·백업·API 확장에 유리함.

---

## 2. DB화 대상 정리

| 대상 | 현재 | 제안 | 비고 |
|------|------|------|------|
| 수집 대상 (target_corps) | JSON 배열 | 테이블 `sync_targets` | 수집 대상 추가/삭제/순서, 메모 등 확장 가능 |
| 전체 상장사 목록 | corp-code-list.json | 테이블 `corp_master` | DART corpCode 동기화 후 검색·필터를 DB로 |
| 수집된 기업 인덱스 | DB `corp_index` | 유지 | 이미 DB, 변경 없음 |

---

## 3. 제안 스키마

### 3.1 수집 대상: `sync_targets`

수집할 기업(corp_code) 목록. UI "수집 대상에 추가" = INSERT, 삭제/비활성도 가능하게 설계.

```sql
CREATE TABLE IF NOT EXISTS sync_targets (
  corp_code TEXT PRIMARY KEY,
  added_at TEXT NOT NULL,           -- ISO 시각
  memo TEXT,                        -- 선택: 비고
  is_active INTEGER NOT NULL DEFAULT 1  -- 1=수집 대상, 0=비활성(수집 제외)
);
```

- **sync-all.js**: `SELECT corp_code FROM sync_targets WHERE is_active = 1 ORDER BY added_at` 로 수집 대상 조회. (기존 `getConfig().target_corps` 대체)
- **POST /api/target-corps**: `INSERT OR REPLACE INTO sync_targets (corp_code, added_at, is_active) VALUES (?, ?, 1)`.
- **선택**: GET /api/target-corps → 목록 반환, DELETE /api/target-corps/:corp_code → is_active=0 또는 DELETE.

### 3.2 전체 상장사 목록: `corp_master`

DART 공시대상회사 전체. fetch-corp-code-list 시 DB에 적재, 검색은 DB에서.

```sql
CREATE TABLE IF NOT EXISTS corp_master (
  corp_code TEXT PRIMARY KEY,
  corp_name TEXT,
  stock_code TEXT,
  modify_date TEXT,                 -- DART 기준 변경일 (YYYYMMDD)
  updated_at TEXT NOT NULL         -- 우리 쪽 동기화 시각 (ISO)
);
```

- **fetch-corp-code-list.js**: DART ZIP 파싱 후 `DELETE FROM corp_master` → bulk INSERT (또는 UPSERT). 기존에는 `data/meta/corp-code-list.json` 쓰기 대신/추가로 DB에 기록.
- **GET /api/search-corps?q=**: `SELECT corp_code, corp_name, stock_code FROM corp_master WHERE corp_name LIKE ? OR stock_code LIKE ? OR corp_code LIKE ? LIMIT 50` (파라미터 이스케이프·바인딩 필수).
- **Turso sync**: `corp_master`는 데이터 크기·갱신 주기 따라 sync 대상 포함 여부만 정하면 됨 (로컬 전용으로 둘 수도 있음).

---

## 4. 데이터 흐름 요약

```
[수집 대상]
  sync_targets (DB)  ←  POST /api/target-corps, (선택) 관리 UI
       ↓
  sync-all.js: 수집 대상 읽기 → 수집 → corp_index·corp_overview 등 갱신

[전체 상장사]
  DART corpCode.xml  →  fetch-corp-code-list  →  corp_master (DB)
       ↓
  GET /api/search-corps  →  검색 바 "전체 상장사 (추가)" →  추가 시 sync_targets INSERT

[수집된 기업]
  수집 결과  →  corp_index (DB)  →  /api/corp-index, 검색 바 "수집된 기업"
```

---

## 5. 마이그레이션·호환

- **sync_targets**
  - 최초 반영: `companies-config.json`의 `target_corps`를 읽어서 `sync_targets`에 INSERT.
  - 이후 sync-all은 **DB 우선**: `sync_targets` 있으면 DB에서 읽고, 없으면(또는 env로 fallback) 기존처럼 JSON 읽기.
  - POST /api/target-corps는 DB에 INSERT하고, 선택적으로 JSON도 갱신해 두면 롤백 시 유리.

- **corp_master**
  - `npm run fetch:corp-code-list` 실행 시 기존처럼 JSON 생성 + **DB에도 적재** (한 번에 적용 시 JSON 생성 생략 가능).
  - /api/search-corps는 **DB 우선**: `corp_master`에 행이 있으면 DB 조회, 없으면 기존 corp-code-list.json fallback.

- **파일 유지 여부**
  - 점진적 전환: DB 쓰면서 기존 JSON도 일정 기간 동기 유지.
  - 완전 전환: DB만 사용하고 JSON은 더 이상 읽지 않음 (설정/문서에서 제거).

---

## 6. 구현 체크리스트

- [x] `schema.js`에 `sync_targets`, `corp_master` 테이블 추가.
- [x] sync-all.js: 수집 대상 읽기를 `sync_targets` (DB) 우선, fallback으로 companies-config.json.
- [x] fetch-corp-code-list.js: 파싱 결과를 `corp_master`에 적재 + JSON 유지.
- [x] 서버: GET /api/search-corps를 `corp_master` 우선 조회 (fallback: corp-code-list.json).
- [x] 서버: POST /api/target-corps를 `sync_targets` INSERT + companies-config.json 동기 유지.
- [ ] (선택) GET /api/target-corps: 수집 대상 목록 반환.
- [x] 마이그레이션 스크립트: `npm run db:seed-targets` (companies-config.json → sync_targets).

---

## 7. 요약

| 항목 | 내용 |
|------|------|
| **sync_targets** | 수집 대상(corp_code) 관리. 추가/비활성/메모. sync-all이 여기서 대상 조회. |
| **corp_master** | DART 전체 상장사. fetch-corp-code-list로 채우고, 검색 API는 DB 조회. |
| **corp_index** | 기존 유지. 수집된 기업만의 인덱스(검색·대시보드용). |
| **효과** | 회사 목록·관리 전반을 DB로 통일, 백업·버전·검색 조건 확장이 쉬워짐. |

이 구조로 가면 "회사 목록 관리"와 "회사 관련" 데이터가 모두 DB로 정리됩니다.

---

## 8. 문제 예측 (구현 시 유의점)

### 8.1 수집 대상(sync_targets) 관련

| 문제 | 설명 | 대응 |
|------|------|------|
| **CI에 DB 없음** | GitHub Actions는 `npm run fetch:all`만 실행. DB를 쓰지 않으면 `sync_targets`가 없음. | sync-all은 **DB 우선**, 비어 있거나 실패 시 **반드시 companies-config.json fallback**. CI는 DB 없이 돌려도 JSON만으로 동작하도록 유지. |
| **최초 전환 시 빈 테이블** | 마이그레이션 전에 sync_targets만 쓰면 수집 대상이 0건이 됨. | 최초 1회: companies-config.json → sync_targets 적재 스크립트 실행. 또는 sync-all 기동 시 "sync_targets 0건이고 JSON 있으면 자동 import" 선택 적용. |
| **레거시 스크립트** | fetch-corp-overview.js, fetch-financials.js, fetch-dividends.js는 여전히 **companies-config.json**만 읽음. | 전환 기간에는 POST /api/target-corps가 **DB + JSON 동시 갱신**하도록 두면, 이 스크립트들도 새로 추가한 corp를 그대로 인식. 장기적으로는 이 스크립트들도 DB fallback 추가 또는 sync-all만 사용하도록 정리. |
| **추가 순서** | JSON은 배열 순서가 있음. DB는 ORDER BY added_at으로만 순서 보장. | 마이그레이션 시 added_at을 순서대로 부여(예: 1분 간격)해 기존 순서 유지. |

### 8.2 전체 상장사(corp_master) 관련

| 문제 | 설명 | 대응 |
|------|------|------|
| **행 수·용량** | DART 공시대상은 3만 건 이상. Turso sync 대상에 넣으면 row/대역폭 부담. | **corp_master는 SYNCABLE_TABLES에서 제외**(로컬 전용). market_cache와 동일 정책. |
| **fetch-corp-code-list 실행 조건** | DB 없이 실행하는 환경(예: 일부 CI)이 있을 수 있음. | 스크립트는 **DB 있으면 corp_master 적재, 없거나 실패 시 기존처럼 JSON만 생성**. 서버 /api/search-corps는 **DB 우선 → 없으면 JSON fallback**. |
| **검색 쿼리 안전성** | 사용자 입력 q를 그대로 SQL에 넣으면 위험. | **항상 파라미터 바인딩**. `LIKE '%' || ? || '%'` 형태로 q를 바인드. 문자열 연결로 SQL 조합 금지. |

### 8.3 공통·운영

| 문제 | 설명 | 대응 |
|------|------|------|
| **이중 저장 일시적 불일치** | DB와 JSON을 동시에 쓰는 동안 한쪽만 갱신되는 버그가 있으면 불일치. | POST /api/target-corps는 한 트랜잭션/함수 안에서 DB INSERT 후 JSON 갱신. 삭제 API도 동일하게 DB·JSON 순서 명확히. |
| **롤백** | DB 전환 후 문제 시 되돌리기. | "수집 대상 읽기"를 **항상 JSON fallback** 가능하게 두고, env(예: `USE_SYNC_TARGETS_DB=0`)로 DB 비활성화 옵션 두면 롤백 시 설정만 바꿔 복귀 가능. |

---

## 9. 제안사항 (구현 시 권장)

1. **Fallback 순서 고정**  
   수집 대상: **sync_targets(DB) 먼저** → 0건이거나 DB 오류 시 **companies-config.json**. README·PIPELINE-RULES에 명시.

2. **전환 기간 이중 기록**  
   POST /api/target-corps는 **DB INSERT + companies-config.json 갱신** 둘 다 수행. 레거시 fetch-* 및 DB 없는 CI와 호환.

3. **corp_master는 Turso 제외**  
   SYNCABLE_TABLES에 넣지 않음. 로컬 SQLite·로컬 Turso만 사용.

4. **마이그레이션 스크립트 제공**  
   `npm run db:seed-targets`: companies-config.json의 target_corps를 읽어 sync_targets에 INSERT. 최초 1회 수동 실행 권장. (이미 있는 corp_code는 스킵 또는 REPLACE.)

5. **CI는 변경 최소화**  
   workflow는 DB를 만들지 않고 기존처럼 JSON만 있어도 동작하도록. sync-all이 "DB 없음 → JSON에서 대상 읽기"로 fallback하면 CI 수정 불필요.

6. **검색 API**  
   /api/search-corps에서 corp_master 조회 시 `LIKE '%' || ? || '%'` 형태로만 검색. 파라미터는 반드시 바인딩.

7. **문서 반영**  
   - README: 수집 대상이 sync_targets(DB) 우선·JSON fallback임을 안내.  
   - PIPELINE-RULES: 수집 대상 읽기 규칙(DB → JSON fallback) 추가.  
   - COMPANY-LIST-DB-PROPOSAL: 본 §8·§9를 구현 시 참고하도록 유지.
