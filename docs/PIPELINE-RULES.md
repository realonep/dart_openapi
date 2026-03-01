# Pipeline Rules

이 문서는 `html_dart` 프로젝트의 데이터 수집 파이프라인 구현 규칙입니다.
코드 변경 시 이 문서를 기준으로 설계/구현하고, 규칙이 바뀌면 문서도 함께 갱신합니다.

## 1) 변경 원칙

- 파이프라인 로직 변경 시, 구현과 문서를 함께 수정한다.
- 데이터 스키마가 바뀌면 `data/DATA-FIELDS.md`도 반드시 함께 갱신한다.
- 비정형/정형 로직은 분리 유지한다.
- DART 파이프라인과 외부 웹 스크래핑 파이프라인(예: NAVER 컨센서스)은 장애 전파를 막기 위해 분리 유지한다.

## 2) 비정형 파이프라인 공통 규칙

- 공시 목록 수집은 `scripts/sync-all.js`의 `fetchUnstructuredDisclosuresIntegrated`를 단일 진입점으로 사용한다.
- 비정형 파이프라인(guidance/treasury/향후 추가)은 같은 `list.json` 페이지 순회를 공유한다.
- 페이지 순회 중 즉시 분류하고, 각 파이프라인의 종료 조건을 만족하면 조기 종료한다.
- `rcept_no` 기준 중복 제거를 유지한다.
- 기본 조회 범위는 최근 1년(`bgn_de`)이며, 파이프라인별 보조 컷오프를 병행한다.

### 2-1) 통합 페이저(Integrated Pager) 종료 규칙

- 통합 페이저는 "가장 오래 탐색이 필요한 파이프라인" 기준으로 전체 페이지 깊이가 결정된다.
- guidance 종료 조건:
  - 실적형 제목 필터를 통과한 공시만 후보로 본다.
  - 최신 재무 기간(`financials.json` 기반)보다 과거/동일 기간 공시를 만나면 guidance 탐색을 종료한다.
- treasury 종료 조건:
  - 배당 표시 연도와 맞추기 위해 `dividends.json` 최소 연도보다 과거 연도로 내려가면 종료한다.
  - 추가로 접수일 컷오프(최근 N개월, 현재 기본 18개월)보다 과거이면 종료한다.
- 신규 비정형 파이프라인도 위와 같은 "자기 종료 조건 + 공유 페이지 순회" 패턴을 따른다.

## 3) guidance.json 규칙

- `guidance.json`은 guidance 비정형 파이프라인만 사용한다.
- 최신 건수는 현재 `MAX_GUIDANCE_ITEMS = 2`를 따른다.
- LLM 추출 대상은 후보 상한 내에서 수행하고, 동일 `period_label`이 중복되면 최신 `rcept_dt` 1건만 유지한다.
- 로직 버전(`LLM_LOGIC_VERSION`)이 같고 `--force-llm`이 아니면 재파싱을 스킵한다.

## 4) 정형 재무 파이프라인 규칙

- 연간(`annual`)과 분기(`quarters`)를 분리해서 수집한다.
- `annual`은 결산이 기대되는 연도 중심으로 수집한다.
- 분기 수집은 최근 2개 연도만 대상으로 한다.
- 분기는 연도별 탑다운(3Q -> 2Q -> 1Q)으로 최소 호출만 수행한다.
- `quarters`에는 최신 실적 연도의 최신 분기 1개 누적값만 저장한다.
- CFS/OFS 정책:
  - CFS가 하나라도 있으면 기업 정책은 CFS
  - 없으면 OFS

## 5) 호출/로그 규칙

- 주요 API 호출에는 표준 로그 포맷을 남긴다.
  - JSON API: `[Tag/API] corp=... year=... reprt=... fs_div=... page=... status=... count=...`
  - Binary API: `[Tag/API] corp=... rcept_no=... status=... bytes=...`
- 불필요한 페이지/연도/분기 호출을 줄이는 방향으로 개선한다.
- 실행 마지막에는 `[ALL DONE]` 로그를 남기고, 종료 지연(keep-alive 꼬리)을 줄이기 위해 성공 시 명시적 종료(`process.exit(0)`)를 사용한다.

## 6) 확장 규칙 (향후 비정형 추가)

- 새로운 비정형 파이프라인 추가 시, 통합 페이저에 "분류 조건"과 "종료 조건"을 추가하는 방식으로 확장한다.
- 파이프라인별로 별도 `list.json` 루프를 만들지 않는다.
- 목적 데이터에 필요 없는 분류/후처리는 비활성으로 두고, 공통 순회 비용을 공유한다.

## 6-0) 마켓 데이터 캐시 (DB + 파일 Fallback)

- 마켓(주가/시총 등)은 **DB 우선**, 실패 또는 미적재 시 **파일** fallback으로 서빙한다.
- 수집: 기존과 동일하게 서버 온디맨드 시 Python(`fetch-market-data.py`)으로 `data/market/{ticker}.json` 생성 후, 서버가 해당 1건을 `market_cache` 테이블에 upsert한다.
- `market_cache`는 Turso sync 대상에서 제외(로컬 전용). 필요 시 `npm run db:sync-market`으로 기존 `data/market/*.json` 전체를 DB에 동기화할 수 있다.

## 6-1) NAVER 컨센서스 파이프라인 규칙

- NAVER 컨센서스 수집은 DART `sync-all.js`와 분리된 서버 온디맨드 파이프라인으로 운영한다.
- 수집 실패 시 DART 데이터 응답은 항상 유지하고, 컨센서스는 null 또는 stale cache로 fallback한다.
- 캐시 TTL을 적용하고, `consensus.json`에 fetch 정책(`fetch_policy`)을 저장한다.

## 7) UI 표시/투명성 규칙

- 데이터 조회 범위를 제한한 경우(예: treasury 최근 18개월), UI에 조회 정책을 명시한다.
- 현재 정책:
  - 배당 패널 자사주 소각 섹션에 "최근 18개월 조회(기준일 포함)" 안내 문구 노출
  - `treasury.json`에 `fetch_policy` 메타(`lookback_months`, `cutoff_rcept_dt`) 저장
- UI 문구와 실제 수집 정책이 어긋나지 않도록 코드/문서를 함께 갱신한다.

## 8) 수집 후 DB 반영 (선택)

- 수집 파이프라인(`sync-all.js`)은 기본적으로 **JSON 파일만** 갱신한다. 기존 동작과 롤백 안전장치를 유지한다.
- 환경 변수 `WRITE_TO_DB=1`(또는 `true`/`yes`/`y`)이 설정된 경우에만, `[ALL DONE]` 이후 **JSON → DB 마이그레이션**을 한 번 실행한다.
- **`DB_ONLY=1`**: 수집 시 **DB에만** 기록하고 JSON 파일을 생성하지 않는다. 이때는 마이그레이션을 실행하지 않는다. 기업별 overview/financials/dividends/guidance/treasury는 수집 직후 DB에 upsert되며, guidance/treasury 기존 데이터는 DB에서 읽어 스킵·범위 판단에 사용한다.
- 실행 순서: `sync-all.js`로 `/data` JSON 갱신(또는 DB_ONLY 시 DB 직접 기록) → (WRITE_TO_DB이고 DB_ONLY가 아닐 때만) `migrate-json-to-db.js`로 로컬 SQLite/Turso 적재.
- DB 적재 실패 시 전체 run은 실패로 종료한다(CI에서 DB 반영을 요구할 때 활용).
- Turso 원격 동기화는 **수집·migrate 이후** 별도 단계로, `npm run db:sync-remote`를 수동 또는 CI에서 실행한다. (수집 → JSON 유지 + 선택적 DB 반영; Turso sync는 그 이후.)

## 9) 유지보수 체크리스트

- 코드 변경
- `docs/PIPELINE-RULES.md` 갱신
- 필요한 경우 `data/DATA-FIELDS.md` 갱신
- 샘플 corp 재수집으로 결과 검증

## 10) DB 재구성 검증 체크리스트 (Phase C-3)

DB 모드에서 서빙할 때, 다음이 JSON 기반 응답과 동일하게 동작하는지 확인한다.

- **정형 분리**: 연간(annual)과 분기(quarters)가 재무 항목에서 분리되어 재구성되는가.
- **비정형 분리**: guidance·treasury가 각각 종료 조건(최신 재무 기간, dividends 최소 연도·lookback)을 반영한 결과와 일치하는가.
- **계약 검증**: `npm run db:verify` 통과. (필요 시 `npm run db:update-golden` 후 재검증.)
- **consensus**: DB에 이식된 consensus가 상세 API에 포함되는가. (없으면 서버가 기존처럼 온디맨드 fallback.)
