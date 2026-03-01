# 상장사 검색·목록 관리 구조 제안

## 목표

- **UI**: 회사이름만 입력해서 한 번에 검색 (모드 전환 없이)
- **데이터**: 상장사 목록은 **거래일 기준 하루 1회**만 갱신하고, **목록에 날짜(list_date)**를 붙여 휴일이 아니고 오늘과 다를 때만 갱신

---

## 1. 추천 구조 요약

| 구분 | 내용 |
|------|------|
| **검색** | 단일 검색창 → **통합 검색 API** 한 번 호출 → 수집된 기업 + 전체 상장사 결과를 한 리스트로 표시 |
| **목록 갱신** | **거래일 기준 하루 1회**. 목록에 `list_date`(YYYY-MM-DD) 저장 → **휴일이 아니고** `list_date`가 **오늘과 다를 때만** DART에서 다시 받아서 갱신 |
| **수집 대상** | UI에서 선택 시 `sync_targets`에 추가, 수집은 `npm run fetch:all`로 실행 |

---

## 2. 통합 검색 (회사이름 하나로 검색)

### 2.1 현재

- 검색 모드 2개: "수집된 기업" / "전체 상장사" → 사용자가 매번 전환해야 함.
- 수집된 기업은 `/api/corp-index` 로드 후 클라이언트에서 필터, 전체 상장사는 `/api/search-corps?q=...` 호출.

### 2.2 제안: 통합 검색 API + 단일 검색창

**API**

- **GET /api/search?q=삼성** (신규 또는 기존 search-corps 확장)
  - 응답: `{ collected: [...], all: [...] }`
    - `collected`: `corp_index`에서 q로 검색 (수집된 기업, 대시보드 바로 가능)
    - `all`: `corp_master`에서 q로 검색 (전체 상장사, 클릭 시 수집 대상 추가 후 보기)
  - 또는 한 리스트로 합쳐서 `{ items: [{ corp_code, corp_name, stock_code, is_collected }] }` 형태로 반환.

**UI**

- **모드 버튼 제거**, 검색창 하나만 두기.
- placeholder: **"회사명으로 검색"**
- 입력 시 위 통합 API 한 번만 호출.
- 결과:
  - **한 리스트**로 표시하고, 각 행에 뱃지 표시:
    - `수집됨` → 클릭 시 바로 대시보드
    - `추가 후 보기` → 클릭 시 수집 대상 추가 + 대시보드 이동 (기존 전체 상장사 동작)
  - 또는 **두 섹션**으로 나누어 표시: "수집된 기업 (n)" / "전체 상장사 (n)" (같은 API 응답 사용).

**구현 포인트**

- 서버: `corp_index`(수집된)와 `corp_master`(전체)를 각각 q로 검색해 합치거나, `collected`/`all`로 구분해 반환.
- 프론트: 검색 시 `/api/search?q=...` 한 번만 호출하고, `collected`/`all` 또는 `items[].is_collected` 기준으로 렌더링.

---

## 3. 상장사 목록 갱신 (거래일 기준 하루 1회 + 날짜 관리)

`corp_master`는 DART 공시대상회사 전체라 신규 상장·폐지 등으로 바뀌므로, **거래일 기준으로 하루 한 번만** 갱신하고 **목록에 날짜를 붙여** 휴일이 아니고 오늘과 다를 때만 갱신하는 구조를 씁니다.

### 3.1 규칙

- **list_date**: 목록을 받아온 기준일(YYYY-MM-DD, KST). `corp-code-list.json`에 `list_date` 필드로 저장.
- **갱신 조건**: (오늘이 **거래일**) 이고 (**list_date가 없음** 또는 **list_date &lt; 오늘**) 일 때만 DART에서 다시 받아서 갱신.
- **휴일**: 현재는 **토·일만** 비거래일로 처리. (공휴일은 추후 확장 가능.)

### 3.2 스크립트

| 스크립트 | 용도 |
|----------|------|
| **npm run fetch:corp-code-list** | 무조건 DART에서 받아서 `corp-code-list.json` + `corp_master` 갱신. `list_date` = 오늘(KST) 기록. |
| **npm run fetch:corp-code-list:daily** | **일일 갱신용**. 오늘이 거래일인지, 현재 `list_date`가 오늘과 다른지 확인 후, 필요할 때만 `fetch:corp-code-list` 실행. cron/Actions에서 **하루 1회** 호출용. |

### 3.3 실행 구조

1. **자동 (권장)**  
   - **cron** (로컬/서버): 매일 1회, 예를 들어 한국 시간 새벽/아침에 실행.  
     ```bash
     # 매일 06:00 KST (예: 서버 TZ=UTC면 21:00 UTC 전날)
     0 21 * * * cd /path/to/html_dart && npm run fetch:corp-code-list:daily
     ```
   - **GitHub Actions**: `schedule`로 매일 1회 job 실행.  
     - 단계: `npm run fetch:corp-code-list:daily`  
     - `fetch:corp-code-list:daily` 안에서 휴일·list_date 판단 후, 필요 시에만 실제 다운로드.

2. **수동**  
   - 강제로 최신 목록 받기: `npm run fetch:corp-code-list`  
   - “오늘 거래일인데 아직 안 받았을 때”만 받기: `npm run fetch:corp-code-list:daily`

3. **목록 날짜 확인**  
   - `data/meta/corp-code-list.json`의 `list_date`로 “이 목록이 어느 날짜 기준인지” 확인 가능.

---

## 4. 전체 실행 흐름 정리

```
[전체 상장사 목록]
  매일 1회: npm run fetch:corp-code-list:daily
    → 오늘 거래일? list_date < 오늘? → 예면 fetch:corp-code-list 실행
    → corp-code-list.json (list_date=오늘) + corp_master(DB)

  수동 강제 갱신: npm run fetch:corp-code-list

[검색]
  UI: "회사명으로 검색" 한 칸
    → GET /api/search?q=...
    → 서버: corp_index(수집된) + corp_master(전체) 검색
    → 응답: collected / all 또는 items + is_collected

[수집 대상]
  UI에서 "추가 후 보기" 클릭
    → POST /api/target-corps
    → sync_targets(DB) + companies-config.json

[실제 수집]
  npm run fetch:all
    → 수집 대상: sync_targets(DB) 우선, 없으면 JSON
    → 수집 결과 → corp_index·corp_overview 등 갱신
```

---

## 5. 구현 체크리스트 (통합 검색 적용 시)

- [ ] 서버: **GET /api/search?q=** 추가 (또는 기존 /api/search-corps 확장)
  - corp_index에서 q 검색 → `collected`
  - corp_master에서 q 검색 → `all`
  - 응답: `{ collected: [...], all: [...] }` 또는 `{ items: [{ ... is_collected }] }`
- [ ] 프론트: 모드 버튼("수집된 기업" / "전체 상장사") 제거, 검색창 하나 + placeholder "회사명으로 검색"
- [ ] 프론트: 검색 시 /api/search 한 번만 호출, 결과를 한 리스트(또는 두 섹션)로 표시, 뱃지로 "수집됨" vs "추가 후 보기" 구분
- [ ] 문서: 상장사 목록 갱신 주기·방법(cron/Actions/수동) 및 실행 순서 정리

---

## 6. 요약

- **회사이름 하나로 검색**: 통합 검색 API 한 번 + 단일 검색창 + 결과에 "수집됨"/"추가 후 보기"만 구분하면 됨.
- **상장사 목록 관리**: **거래일 기준 하루 1회**. 목록에 **list_date** 붙여 두고, **휴일이 아니고 오늘과 다를 때만** 갱신. `fetch:corp-code-list:daily`를 cron/Actions에서 매일 1회 실행하면 됨.
- **실행 구조**: 매일 `fetch:corp-code-list:daily` → (필요 시) 목록 갱신 → 검색(API) → 수집 대상 추가(UI) → 수집(fetch:all).
