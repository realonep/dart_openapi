# 하이브리드 DB 다음 단계 계획

현재 완료된 것: 롤백 분기점, libSQL 연결, JSON→DB 마이그레이션, 서버 DB 조회(상세/인덱스) + JSON fallback.

---

## Phase A: Turso 동기화 (로컬 → 클라우드) ✅

**목표**: 로컬에서 수집/정제된 데이터를 Turso로 안전하게 업로드·동기화하는 프로세스 확보.

| 순서 | 작업 | 설명 |
|------|------|------|
| A-1 | sync 스크립트 골격 | `scripts/sync-local-to-turso.js` (또는 `scripts/db/sync-to-remote.js`) 추가. 로컬 `file:local.db`를 소스, `DATABASE_URL`/`DATABASE_AUTH_TOKEN`으로 지정한 Turso를 타깃으로 사용. |
| A-2 | Idempotent 업로드 | 기존 마이그레이션과 동일한 upsert 로직으로 테이블별 배치 실행. `last_updated_at` 또는 `ingested_at` 기준으로 “변경분만” 옵션을 두면 향후 증분 sync에 유리. |
| A-3 | sync 실행 로그 | `sync_runs` 테이블(실행 시각, 소스/타깃, 성공·실패 건수, 에러 요약) 기록. 실패 시 재시도 가능하도록 설계. |
| A-4 | npm 스크립트 | `package.json`에 `db:sync-remote` 등 추가. README에 Turso URL/토큰 설정 방법과 실행 순서(수집 → migrate → sync-remote) 명시. |

**완료 기준**: 로컬에서 `npm run db:migrate` 후 `npm run db:sync-remote`로 Turso에 동일 데이터 반영되고, 서버를 `DATA_BACKEND=db` + Turso URL로 띄워서 동일 응답이 나오는 것.

---

## Phase B: 수집 파이프라인과 DB 연동 ✅

**목표**: JSON만 갱신되던 흐름을 유지하면서, 선택적으로 DB에도 반영되게 함. (기존 JSON 생성은 유지 → 롤백 안전.)

| 순서 | 작업 | 설명 |
|------|------|------|
| B-1 | sync-all 종료 후 DB 반영 옵션 | `sync-all.js` 완료 시, 환경 변수(예: `WRITE_TO_DB=1`)가 있으면 같은 `dataRoot` 기준으로 `migrate-json-to-db.js`와 동일한 “JSON → DB 적재” 로직을 한 번 실행하거나, `migrate-json-to-db.js`를 자식 프로세스로 호출. |
| B-2 | GitHub Actions 연동(선택) | `dart-data-sync.yml`에서 수집 후 `WRITE_TO_DB=1` + `DATABASE_URL`(Turso) 등으로 DB 적재 단계 추가. Secrets에 `DATABASE_URL`, `DATABASE_AUTH_TOKEN` 저장. |
| B-3 | 문서화 | PIPELINE-RULES.md에 “수집 후 DB 반영” 정책(선택 사항, 환경 변수, 실행 순서) 추가. |

**완료 기준**: 로컬에서 `npm run fetch:all` 후 `WRITE_TO_DB=1 npm run fetch:all`(또는 별도 한 번의 migrate)으로 DB가 갱신되고, 기존 JSON 기반 동작은 그대로 유지되는 것.

---

## Phase C: 회귀 방지 및 검증 (진행 중)

**목표**: JSON 대비 DB 응답 shape·값이 어긋나지 않도록 검증 체계를 만든다.

| 순서 | 작업 | 설명 | 상태 |
|------|------|------|------|
| C-1 | Contract 테스트 | 대표 기업 1~2곳에 대해, 같은 `corp_code`로 JSON 기반 응답 vs DB 기반 응답을 비교(필드 존재 여부, 배열 길이, 핵심 수치 일치). 스크립트: `scripts/verify-db-vs-json.js`. | ✅ |
| C-2 | Snapshot/Golden | 검증 통과한 응답을 `scripts/fixtures/db-contract-golden.json`에 저장. `npm run db:update-golden`으로 갱신, `db:verify` 시 DB가 golden과도 일치하는지 비교. | ✅ |
| C-3 | 파이프라인 규칙 검증 | PIPELINE-RULES §10 DB 재구성 검증 체크리스트 추가. | ✅ |

**완료 기준**: `verify-db-vs-json.js` 실행 시 비교 대상 필드가 일치하고, 문서화된 체크리스트에 따라 수동/자동 검증이 가능한 상태.

---

## Phase D: API·DAL 정리 및 성능

**목표**: 프론트가 참조하는 데이터 경로를 모두 API·DAL로 통일하고, 필요한 만큼만 조회하도록 정리.

| 순서 | 작업 | 설명 |
|------|------|------|
| D-1 | 프론트 데이터 소스 통일 | 이미 `getCorpIndex`는 API 우선. `getCorpOverview`, `getCorpFinancials`, `getCorpDividends`, `getCorpGuidance`, `getCorpTreasury`, `getCorpConsensus` 등이 아직 정적 JSON 또는 `/api/corp/.../detail`에만 의존하는지 확인 후, “상세는 전부 `/api/corp/:id/detail` 한 번에” 같은 현재 설계를 유지할지, 필요 시 엔드포인트 분리(예: 탭별 lazy load) 검토. |
| D-2 | 서버 consensus from DB | DB 모드일 때 상세 API가 consensus를 DB에서 조회해 응답에 포함. 없으면 getConsensusOnDemand. | ✅ |
| D-3 | Select 최소화 | DB 쿼리에서 “상세 페이지에 필요한 컬럼만” 선택하도록 정리. 인덱스는 이미 `corp_code`, `(corp_code, year)` 등 적용된 상태이므로, 불필요한 SELECT * 제거 위주. |

**완료 기준**: 모든 기업 상세 데이터가 API 한 경로(및 필요 시 보조 경로)에서만 오고, DB 모드에서도 consensus 등이 기대대로 포함되며, 쿼리가 필요한 필드만 조회하는 형태로 정리된 상태.

---

## Phase E: 문서 및 운영 정리

| 순서 | 작업 | 설명 |
|------|------|------|
| E-1 | DATA-FIELDS.md | DB 테이블·컬럼과 기존 JSON 필드 매핑 요약 추가. (또는 별도 `docs/DB-SCHEMA.md`.) |
| E-2 | README | Turso 설정, `db:migrate`, `db:sync-remote`, `WRITE_TO_DB` 등 환경 변수와 실행 순서를 한곳에 정리. |
| E-3 | PIPELINE-RULES.md | “수집 → JSON 유지 + 선택적 DB 반영”, “Turso sync는 수집·migrate 이후 수동/CI” 규칙 명시. |

---

## 권장 진행 순서

1. **Phase A** → Turso에 데이터가 올라가고, 배포 환경에서 DB 백엔드로 서빙 가능한지 확인.
2. **Phase C** → DB 응답이 JSON과 동일한지 검증해 두고, 이후 변경 시 회귀 방지.
3. **Phase B** → 수집 파이프라인에 DB 반영을 붙여서 “한 번 수집하면 JSON + DB 동시 갱신” 흐름 완성.
4. **Phase D** → API/DAL·쿼리 정리 및 consensus 등 누락 구간 점검.
5. **Phase E** → 위 내용을 문서에 반영해 다음 단계(또는 인수인계)에 대비.

이 문서는 다음 단계 진행 시 기준으로 사용하고, 완료된 항목은 체크리스트로 표시해 두면 좋다.
