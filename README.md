## 프로젝트 개요

Open DART API를 활용하여 **상장사의 기업 개황 · 주요 재무 지표 · 배당 현황**을 시각화하는 웹 대시보드입니다.

- **Frontend**: 순수 HTML + JS (GitHub Pages에서 정적 호스팅)
- **Backend 역할**: GitHub Actions + Node 스크립트가 Open DART API를 호출해 `/data/*.json` 생성
- **보안/아키텍처**
  - 브라우저에서는 Open DART를 직접 호출하지 않고, 리포지토리에 커밋된 `data/*.json` 만 조회
  - Open DART 인증키는 GitHub Secrets(`OPENDART_API_KEY`)에 저장되어, 코드/브라우저에 노출되지 않음

## 기술 문서(항상 참조)

- 파이프라인 규칙: `docs/PIPELINE-RULES.md`
- 데이터 스키마: `data/DATA-FIELDS.md`
- DB 스키마·JSON 매핑: `docs/DB-SCHEMA.md`

개발 시 위 문서들을 구현 기준으로 사용합니다. 로직/스키마가 변경되면 코드와 함께 문서를 같은 PR/커밋에서 갱신합니다.

## 주요 폴더 구조

- `index.html`: GitHub Pages 진입점
- `assets/css`: 기본 스타일 및 다크 테마
- `assets/js`: 검색바, 기업 개황, 재무/배당 섹션, 간단한 상태 관리 및 라우터
- `data/`: 수집·캐시용 JSON. `data/meta/`: 검색용 상장사 목록(corp-code-list.json 등)
- `scripts/`: Open DART 호출용 Node 스크립트 (GitHub Actions/로컬 서버에서 실행)
- `.github/workflows/dart-data-sync.yml`: 데이터 동기화 CI

## GitHub Pages 배포

1. 이 폴더(`html_dart`)를 GitHub 리포지토리 루트로 푸시합니다.
2. 리포지토리에서 **Settings → Pages** 로 이동합니다.
3. **Source** 를 `Deploy from a branch`, Branch `main`, Folder `/ (root)` 로 설정합니다.
4. GitHub가 `index.html` 과 정적 자산을 페이지로 서빙합니다.

접속 URL 예시:

- `https://<github-username>.github.io/<repository-name>/`

## Open DART 인증키 설정

1. Open DART 홈페이지에서 오픈API 인증키를 발급받습니다.
2. GitHub 리포지토리에서 **Settings → Secrets and variables → Actions → New repository secret** 을 선택합니다.
3. 이름을 `OPENDART_API_KEY`, 값에 발급받은 키를 입력 후 저장합니다.

## GitHub Actions 동작

- 워크플로우 파일: `.github/workflows/dart-data-sync.yml`
- 트리거:
  - 수동 실행만 지원 (`workflow_dispatch`)
- 목적:
  - 온디맨드 운영에 필요한 초기 검색 목록(`corp-code-list.json`) 갱신
- 입력값:
  - `write_corp_master` (기본 `false`): `true`일 때 `corp_master` DB 적재 시도(실패해도 목록 JSON은 유지)
- 특징:
  - `fetch:all`/`db:migrate`/`db:sync-remote` 같은 배치 동기화는 이 워크플로우에서 실행하지 않음
  - 레거시 자동 스케줄/푸시 기반 전체 갱신은 제거됨

## 로컬에서 실행 (실행 방법)

1. **Node.js** 설치 후 프로젝트 루트에서:

```bash
npm install
```

2. **환경 변수**: `.env` 파일에 `OPENDART_API_KEY`가 있어야 수집 스크립트가 동작합니다.  
   (Windows PowerShell: `$env:OPENDART_API_KEY="발급받은키"`)

3. **검색용 목록(필수)**: DART 상장사 목록(종목코드 있는 법인만)을 받아 두어야 검색이 동작합니다.  
   `npm run fetch:corp-code-list` 또는 거래일 1회 `npm run fetch:corp-code-list:daily`.

4. **로컬 서버 실행(온디맨드 수집)**: UI에서 기업을 선택하면 서버가 해당 기업을 **1건 수집**합니다.

```bash
npm run serve
```

5. **브라우저**: `http://localhost:4173` (또는 터미널에 찍힌 주소)로 접속합니다.

6. **온디맨드 수집 동작**:
   - 검색에서 기업을 선택하거나 `#corp=...` 로 진입
   - 데이터가 없으면 UI가 `POST /api/fetch-one`을 호출해 **해당 기업만 백그라운드 수집**
   - 잠시 후 새로고침하면 데이터가 채워집니다.

7. **(선택) 배치 수집(여러 기업 한 번에 갱신)**: 특정 기업들을 미리 정해 두고 주기적으로 돌리고 싶을 때만 사용합니다.
   - 대상: `data/meta/companies-config.json`의 `target_corps` 또는 DB `sync_targets`
   - 실행 예:

```bash
# 최초 1회 (companies-config.json → DB sync_targets 반영)
npm run db:seed-targets
# 대상 기업 전부 수집 (시간 오래 걸 수 있음)
npm run fetch:all
```

## 데이터 백엔드 분기점(롤백 안전장치)

하이브리드 DB 전환을 위해 서버 데이터 백엔드를 환경 변수로 분기할 수 있습니다.

- `DATA_BACKEND=json` (기본값): 현재와 동일한 JSON 파일 기반
- `DATA_BACKEND=db`: DB 백엔드 시도
- `DATA_BACKEND_STRICT=true`: DB 초기화 실패 시 즉시 에러로 중단
- `DATABASE_URL`: libSQL 연결 URL (`file:local.db` 또는 `libsql://...`)
- `DATABASE_AUTH_TOKEN`: Turso 원격 연결 시 필수

기본 동작은 안전하게 설계되어 있어, `DATA_BACKEND=db`여도 DB 준비가 안 되어 있으면 JSON 모드로 자동 fallback 됩니다.
운영 장애 시에는 환경 변수만 `DATA_BACKEND=json`으로 되돌리면 즉시 기존 구조로 복귀할 수 있습니다.

`DATA_BACKEND=db`일 때 서버는 corp-index·상세(overview/financials/dividends/guidance/treasury/consensus)를 DB에서 읽고, **마켓 데이터**는 DB 우선·실패 시 파일 fallback으로 온디맨드 수집 후 `market_cache`에 적재합니다.

예시:

```bash
# 로컬 SQLite
set DATA_BACKEND=db
set DATABASE_URL=file:local.db
npm run db:migrate
npm run serve
```

### Turso 동기화 (Phase A)

로컬 DB를 Turso 클라우드로 올리려면:

1. [Turso](https://turso.tech) 가입 후 DB 생성, URL·토큰 발급
2. 환경 변수 설정:
   - `SOURCE_DATABASE_URL`: 소스 DB (기본값 `file:local.db`)
   - `DATABASE_URL`: Turso URL (`libsql://...`)
   - `DATABASE_AUTH_TOKEN`: Turso 인증 토큰
3. 순서: `npm run db:migrate` → `npm run db:sync-remote`

Turso를 설정하지 않았으면 `npm run db:sync-remote`는 아무 작업 없이 종료됩니다.

수집 후 곧바로 로컬 DB에 반영하려면 `WRITE_TO_DB=1 npm run fetch:all`을 사용합니다. (PIPELINE-RULES.md §8 참고.)

### 상장사 목록 (검색용)

- **소스**: DART corpCode 전량 수신 후 **종목코드가 있는 상장사만** 필터해 `data/meta/corp-code-list.json`에 저장 (코스피·코스닥·코넥스 포함, 별도 제외 없음).
- **실행**: `npm run fetch:corp-code-list` 또는 거래일 1회 `npm run fetch:corp-code-list:daily`.
- **기본값으로 DB(corp_master)에는 적재하지 않음.** DB에 넣으려면 `WRITE_CORP_MASTER=1` 설정 후 실행. corp_master만 비우려면 `npm run db:clear-corp-master`.
- **검색**: 서버는 corp_master DB 우선, 없으면 corp-code-list.json으로 검색. 자세한 구조는 `docs/SEARCH-AND-LIST-MANAGEMENT.md` 참고.

### JSON vs DB 회귀 검증

DB 재구성 결과가 기존 JSON 계약과 맞는지 점검하려면:

```bash
npm run db:migrate
npm run db:verify
```

특정 기업만 검증할 때:

```bash
node scripts/verify-db-vs-json.js 00126380
```

**Golden 스냅샷 (C-2)**: 검증 통과 시점의 요약을 저장해 두고, 이후 `db:verify`에서 DB가 이 스냅샷과도 일치하는지 비교합니다. 스키마/재구성 로직 변경 후 의도된 변경이면 golden만 갱신하면 됩니다.

```bash
# 현재 JSON+DB 일치 상태를 golden으로 저장 (scripts/fixtures/db-contract-golden.json)
npm run db:update-golden
```

## 환경 변수·실행 순서 요약

| 용도 | 환경 변수 | 기본값/비고 |
|------|-----------|-------------|
| 데이터 소스 | `DATA_BACKEND` | `json` \| `db` |
| DB 연결 | `DATABASE_URL` | `file:local.db` \| `libsql://...` |
| Turso 인증 | `DATABASE_AUTH_TOKEN` | 원격 시 필수 |
| DB 소스(동기화) | `SOURCE_DATABASE_URL` | `file:local.db` |
| 수집 후 DB 반영 | `WRITE_TO_DB` | `1`/`true` 시 수집 후 migrate 실행 |
| DB 전용 수집 | `DB_ONLY` | `1`/`true` 시 JSON 미생성, DB에만 기록(이때 migrate 미실행) |
| 부분 실패 마켓 캐시 TTL | `MARKET_CACHE_TTL_PARTIAL_HOURS` | 기본 `0.5`시간. 시총 null 등 partial 데이터의 재시도 간격 제어 |
| 상장사 목록 DB 적재 | `WRITE_CORP_MASTER` | 기본값 미설정(DB 미적재). `1`/`true` 시 `fetch:corp-code-list`가 corp_master에 적재 |
| DART API | `OPENDART_API_KEY` | 수집 스크립트 필수 |

부분 실패(`market_cap=null`, 일봉 누락 등) 마켓 캐시를 강제로 재수집하려면:

```bash
npm run db:refresh-partial-market
```

**실행 순서 권장(온디맨드 중심)**  
검색용: `npm run fetch:corp-code-list` (또는 `fetch:corp-code-list:daily`) → `npm run serve`. UI에서 기업 선택 시 해당 기업만 `fetch-one`으로 수집.

**실행 순서 권장(배치 수집)**: 최초 1회 `npm run db:seed-targets`(companies-config → sync_targets) → 수집(`npm run fetch:all`) → (선택) `WRITE_TO_DB=1` 포함 시 자동 DB 적재 → (선택) `npm run db:migrate` 수동 적재 → (Turso 사용 시) `npm run db:sync-remote`.

CI에서 온디맨드 초기화를 실행하려면 `workflow_dispatch`를 실행하고, 최소 Secrets(`OPENDART_API_KEY`)를 등록해야 합니다.

