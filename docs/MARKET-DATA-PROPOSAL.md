# 마켓 데이터 저장 방식 제시안

## 1. 현황 요약

| 구분 | 저장소 | 수집 주체 | 서버 조회 |
|------|--------|-----------|-----------|
| Corp(기업) | DB (DB_ONLY=1) | Node (sync-all.js) | DATA_BACKEND=db → libsql |
| 마켓(주가/시총 등) | 파일 `data/market/{ticker}.json` | Python (fetch-market-data.py) | 온디맨드: 파일 캐시 + TTL 후 Python 재호출 |

- 마켓은 **요청 시점**에 캐시 없거나 TTL 만료면 Python을 실행해 파일을 갱신한 뒤 응답한다.
- JSON 구조: `stock_code`, `market_cap`, `estimated_shares_outstanding`, `year_end_*`, `daily_chart[]`.

---

## 2. 이슈 정리: JSON이든 DB든 공통 vs DB만 해당

### 2.1 JSON/파일이든 DB든 동일하게 있는 이슈

| 이슈 | 설명 | JSON | DB |
|------|------|------|-----|
| 파이프라인 이질성 | Corp는 Node, 마켓은 Python | 동일 | 동일 |
| 수집 실패 시 스테일 | 이전 데이터 유지 후 서빙 | 파일 유지 | 이전 행 유지 |
| 동시성 | 같은 ticker 동시 수집 시 | 마지막 쓰기 승리 | upsert로 마지막 승리 |
| TTL | 오래된 데이터 재수집 | mtime 기준 | fetched_at 기준 |

→ **마켓을 DB로 옮긴다고 해서 “새로 생기는” 문제가 아님.**

### 2.2 DB로 옮길 때 추가로 고려할 부분

| 이슈 | 설명 | 완화 방안 |
|------|------|-----------|
| 저장소 단일 실패 | DB 장애 시 마켓까지 응답 불가 | **파일 fallback** 유지(DB 실패 시 기존 파일 읽기) |
| Turso 제한 | 마켓까지 원격 쓰기 시 row/대역폭 | 마켓은 **로컬 DB 전용**, sync 제외 또는 별도 정책 |
| 스키마/마이그레이션 | 테이블 추가·변경 시 버전 관리 | 단일 테이블 + payload_json 위주로 최소 스키마 |

---

## 3. 옵션 비교

### 옵션 A: 현행 유지 (마켓 = 파일만)

- **내용**: 마켓은 계속 `data/market/{ticker}.json` + 온디맨드 Python.
- **장점**: 변경 없음, DB 장애와 무관, 구현/운영 단순.
- **단점**: 데이터 저장소가 DB(corp) + 파일(마켓)으로 나뉨, 백업/배포 시 두 경로 신경 써야 함.

### 옵션 B: 마켓 DB 도입 + 파일 Fallback (권장)

- **내용**:
  - 마켓 전용 테이블 추가, **쓰기**: Python은 기존처럼 JSON 파일만 생성 → **Node 스크립트가 주기/이벤트로 파일 → DB 동기화**.
  - **읽기**: 서버는 **DB 우선 조회**, 실패 또는 미적재 시 **기존 파일**로 fallback.
  - TTL: DB 행의 `fetched_at`(또는 `last_updated_at`)으로 판단, 만료 시 서버가 Python 호출 → 파일 갱신 → (선택) 동기화 스크립트로 DB 갱신.
- **장점**: 저장소 통일(주 데이터는 DB), DB 장애 시에도 파일로 서비스 가능, 롤백 시 서버만 “파일만 읽기”로 되돌리면 됨.
- **단점**: 파일→DB 동기화 로직/스케줄 필요, 코드 경로가 DB/파일 두 갈래.

### 옵션 C: 마켓 완전 DB 전용 (파일 제거)

- **내용**: Python이 직접 DB에 쓰거나, Python은 파일만 쓰고 Node만 DB에 쓰고 파일은 삭제. 서버는 DB만 읽음.
- **장점**: 저장소 완전 단일화.
- **단점**: DB 장애 시 마켓 응답 전부 불가, Turso 사용 시 쓰기/읽기 제한 리스크, 롤백 시 스키마/데이터 되돌리기 부담.

---

## 4. 권장안: 옵션 B (마켓 DB + 파일 Fallback)

- **이유**
  - 지금 논의한 “공통 이슈”는 JSON이든 DB든 비슷하므로, **추가 리스크(저장소 단일 실패, Turso, 스키마)만 완화**하면 됨.
  - Fallback을 두면 **DB 장애 시에도 마켓은 파일로 서빙** 가능.
  - **Turso**: 마켓 테이블을 sync 대상에서 제외하거나, “마켓은 로컬만” 정책으로 쓰기/row 제한을 피할 수 있음.
  - 기존 파일 기반 동작을 유지하므로 **단계적 전환·롤백**이 수월함.

---

## 5. 옵션 B 상세 설계

### 5.1 스키마 (최소)

- 테이블 1개로 “ticker당 최신 1건”만 유지 (이력은 보지 않음).

```sql
CREATE TABLE IF NOT EXISTS market_cache (
  ticker TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
```

- `payload_json`: 현재 `fetch-market-data.py` 출력 JSON 전체를 그대로 저장 (기존 API 응답 shape 유지).

### 5.2 쓰기 경로 (파일 → DB)

- **Python**: 변경 없음. 기존처럼 `--output`으로 `data/market/{ticker}.json` 생성.
- **Node**:
  - `scripts/db/sync-market-to-db.js` (신규): `data/market/*.json`을 읽어 `market_cache`에 upsert (`ticker`, `payload_json`, `fetched_at` = 파일 mtime 또는 현재 시각).
  - 실행 시점:
    - **A)** 서버에서 마켓 캐시 미스로 Python 실행 후, 같은 요청 처리 중에 “파일 쓰기 완료” 뒤 곧바로 이 스크립트를 호출(또는 내부 함수로 DB에 한 건 upsert),  
    - **B)** cron 등으로 주기 실행: `node scripts/db/sync-market-to-db.js`.
  - 권장: 우선 **A)** 서버가 “Python으로 파일 갱신 직후, 해당 1건만 DB에 upsert”로 하면, 별도 스케줄 없이도 DB가 채워짐.

### 5.3 읽기 경로 (서버)

- `getMarketDataOnDemand(ticker)` 수정:
  1. **DB 사용 가능 시**: `market_cache`에서 `ticker` 조회.
     - 행이 있고 `fetched_at`이 TTL 이내면 → 해당 `payload_json` 파싱 후 반환 (캐시 hit).
     - 행이 없거나 TTL 만료 → 2로.
  2. **기존 로직**: 파일 경로 확인 → 유효하면 파일 반환 (파일 hit).
  3. **캐시/파일 모두 없거나 만료**: Python 실행 → 파일 저장 → (옵션 B 권장대로) 해당 ticker 1건 DB upsert → 새로 저장한 파일(또는 방금 넣은 DB 행)으로 응답.

- **DB 실패 시**: 예외 잡아서 **파일만** 읽는 경로로 fallback (기존 `getMarketCachePath` + `readJsonSafe`). 응답 shape는 동일하게 유지.

### 5.4 TTL

- 기존과 동일: `resolveMarketTtlHours(now)` (장중/장외 시간에 따라 다른 시간).
- DB 행은 `fetched_at`으로 “저장 시점”만 보면 되고, “만료 여부”는 서버에서 `fetched_at`과 현재 시각으로 계산.

### 5.5 Turso / 원격 sync

- `sync-to-remote.js`의 `SYNCABLE_TABLES`에 **`market_cache`를 넣지 않음** (마켓은 로컬 DB 전용).
- 필요해지면 나중에 포함하고, row 수·쓰기 빈도 모니터링 후 제한 이슈 있으면 다시 제외.

### 5.6 롤백

- 서버만 수정: “마켓은 항상 파일만 읽기”로 되돌리면 기존 동작과 동일.
- DB 테이블은 그대로 두어도 서비스에는 영향 없음.

---

## 6. 구현 체크리스트 (옵션 B)

- [x] `scripts/db/schema.js`에 `market_cache` 테이블 추가 및 `ensureSchema` 반영.
- [x] `scripts/db/sync-market-to-db.js`: `upsertMarketFromPayload`, `syncAllMarketFiles` (CLI: `npm run db:sync-market`).
- [x] 서버 `getMarketDataOnDemand`: DB 우선 조회 → TTL 만료/미적재 시 파일 → Python 실행 후 파일+DB 1건 upsert, DB 예외 시 파일 fallback.
- [x] `SYNCABLE_TABLES`에 `market_cache` 미포함 (로컬 전용).
- [x] 문서: PIPELINE-RULES §6-0, README에 마켓 DB 우선·파일 fallback 정리.

---

## 7. 요약

- **공통 이슈**(파이프라인 이질성, 실패 시 스테일, 동시성, TTL)는 JSON/파일이든 DB든 이미 있거나 동일한 수준으로 처리 가능.
- **DB로 옮길 때 추가 리스크**는 “저장소 단일 실패, Turso 제한, 스키마”이며, **마켓 DB + 파일 fallback(옵션 B)**로 완화하는 것을 권장한다.
- 이렇게 하면 corp는 DB 전용, 마켓은 **DB 우선 + 파일 fallback**으로 정리되어, 백업/배포 정책을 DB 중심으로 맞추면서도 장애 시 마켓만 파일로 복구할 수 있다.
