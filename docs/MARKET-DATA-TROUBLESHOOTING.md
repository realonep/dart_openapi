# 시장 데이터(일봉) 미표시 원인 분석

## 현상
- 039420 등 종목 조회 시 `data/market/*.json` 파일이 생성되지 않음
- UI: "시장 데이터가 없어 라인차트를 표시할 수 없습니다."

## 데이터 흐름
1. **클라이언트**: 기업 선택 시 `selectedCorp`에 `corp_code`, `stock_code`(종목코드) 저장 → 상세 API 호출 시 `?ticker={종목코드}` 전달
2. **서버**: `ticker`로 DB/파일 캐시 확인 → 없으면 `fetch-market-data.py` 실행 → `data/market/{ticker}.json` 생성
3. **일봉**은 KRX **6자리 종목코드** 기준으로만 수집됨 (예: 005930, 039420). **8자리 고유번호(corp_code)** 로는 수집 불가

## 원인 1: URL 해시에 종목코드 미포함 (주요)
- 검색에서 기업을 선택하면 `DartRouter.update({ corp: corpCode, tab })` 만 호출되어 해시에 **corp(고유번호)** 만 들어감
- 새로고침·북마크·직접 URL 진입 시 `main.js`의 `syncStateFromHash()`가 `params.corp`만 읽어  
  `State.setSelectedCorp({ corp_code: params.corp, code: params.corp })` 로 설정
- 이때 **stock_code**가 없어서 `stockCode = state.selectedCorp.stock_code || state.selectedCorp.code` → **corp_code(8자리)** 가 그대로 ticker로 전달됨
- 서버가 **ticker=00246620**(corp_code)으로 마켓 수집을 시도 → KRX는 6자리만 인식 → 스크립트 실패/데이터 없음 → 파일 미생성 → 시장 데이터 null

## 원인 2: 서버에서 8자리 ticker 방어 부재
- 8자리 숫자는 종목코드가 아니라 고유번호(corp_code)인데, 그대로 Python에 넘겨 실행함
- FinanceDataReader/KRX는 6자리 종목코드만 사용하므로 항상 실패

## 조치 (구현됨)
1. **서버**: ticker가 8자리 숫자면 종목코드로 보정 시도  
   - `corp-code-list.json`(또는 corp_master)에서 해당 corp_code의 `stock_code` 조회 후, 그 값으로 일봉 수집
2. **서버**: 6자리 종목코드가 아닌 값으로는 Python 호출하지 않고 스킵
3. **클라이언트**: 기업 선택 시 URL 해시에 `stock={종목코드}` 포함 → 새로고침 시에도 `stock_code` 유지

---

# 시가총액만 안 나오는 경우 (일봉은 정상)

## 현상
- 일봉 차트는 나오는데 **시가총액** 필드만 비어 있음 (`market_cap: null`).

## 데이터 소스 차이
| 항목 | 출처 | FinanceDataReader |
|------|------|-------------------|
| **시가총액** | KRX(data.krx.co.kr) | `fdr.StockListing("KRX")` → 종목 목록에서 Marcap |
| **일봉** | 네이버 금융 등 | `fdr.DataReader(종목코드, 시작, 종료)` |

시가총액은 **KRX 한 곳**에서만 가져오고, 일봉은 다른 API를 쓰기 때문에 KRX가 실패해도 일봉은 들어올 수 있음.

## 시가총액을 못 읽는 이유

### 1. KRX가 JSON 대신 HTML/빈 응답을 줌
- `StockListing("KRX")`는 내부적으로 `data.krx.co.kr`에 HTTP 요청을 보냄.
- 응답이 **JSON이 아니면** (빈 문자열, HTML 오류 페이지, 차단 페이지 등) `json.loads(response.text)`에서  
  **`JSONDecodeError: Expecting value: line 1 column 1 (char 0)`** 발생.
- 우리 스크립트는 이 예외를 잡아서 시가총액만 `None`으로 두고 일봉 수집은 계속함 → 그래서 **일봉만 들어오고 시가총액은 비어 있음**.

### 2. KRX 측 요구 사항: Referer 헤더
- KRX 서버는 **Referer 헤더**가 없으면 요청을 거부하거나 HTML을 돌려주는 경우가 있음.
- FinanceDataReader **0.9.91 이상**에서 이 헤더를 넣도록 수정됨.  
  **라이브러리가 오래됐으면** (`pip install` 직후 한 번도 안 올렸거나 구버전) Referer 미포함 → KRX가 JSON 대신 HTML 반환 → 위와 같은 JSONDecodeError.

### 3. KRX 일시 장애 / 접속 제한
- 거래소 사이트 점검, 일시적 오류, IP/요청 제한 등으로 같은 요청이 특정 환경에서만 실패할 수 있음.
- 이 경우 라이브러리를 최신으로 올려도 **그 시점에는** 시가총액이 비어 있을 수 있음.

## 권장 조치
1. **FinanceDataReader 최신 버전 사용**  
   ```bash
   pip install -U finance-datareader
   ```  
   (0.9.91+ 에서 KRX Referer 처리 포함.)
2. **그래도 시가총액이 null이면**  
   KRX 일시 오류 또는 접근 제한 가능성. 시간을 두고 재시도하거나, 네트워크/방화벽 환경을 확인.
3. **대안(구현됨)**  
   KRX 시총 실패 시 **yfinance**에서 **발행주식수**만 조회해, **일봉 최신 종가 × 발행주식수**로 시총을 계산합니다.  
   시총·연말 시총 추정은 이렇게 한 번이라도 채워지면 계산됩니다.  
   yfinance 설치(선택): `pip install yfinance`

---

## 권장조치(업그레이드) 시 로직 전반 영향 및 수정 필요 여부

### 적용하는 조치
- **`pip install -U finance-datareader`**  
  로컬 Python 환경에서만 라이브러리 버전을 올리는 것. 프로젝트 레포 안의 코드를 바꾸는 게 아님.

### 영향받는 범위
| 구분 | 영향 여부 | 설명 |
|------|-----------|------|
| **fetch-market-data.py** | 간접 | FDR을 import해서 `StockListing("KRX")`, `DataReader(...)` 만 호출. 업그레이드는 이 함수들의 **내부 동작**(예: KRX 요청 시 Referer 추가)만 바꿀 뿐, **반환 형태**(DataFrame 컬럼명·타입)는 0.9.x 대에서 유지됨. |
| **서버(server.js)** | 없음 | Python 스크립트를 실행하고, **exit code**와 **출력 파일**만 봄. FDR 버전을 알 수 없고, 버전에 따른 분기도 없음. |
| **DB / market_cache** | 없음 | 스크립트가 쓴 JSON을 그대로 저장. JSON 구조는 우리 스크립트가 정의하므로 FDR 버전과 무관. |
| **프론트(UI)** | 없음 | API가 주는 `market_data`(market_cap, daily_chart 등) 구조만 사용. 이 구조 역시 우리 스크립트 출력 기준. |

### 우리 스크립트가 FDR에 의존하는 부분
- **시가총액**: `fdr.StockListing("KRX")` → `listing["Code"]`, `row["Marcap"]` 사용.
- **일봉**: `fdr.DataReader(...)` → `row["Open"]`, `"High"`, `"Low"`, `"Close"`, `"Volume"` 사용.

0.9.91~0.9.93 수준의 패치에서는 위 **컬럼명/반환 형식이 바뀐 이력이 없음**. 따라서 **업그레이드만 하면 되고, 스크립트 코드 수정은 필요 없음**.

### 수정이 필요한 경우
- **지금 단계**: 없음. `pip install -U` 만 하면 됨.
- **나중에**: FinanceDataReader를 **메이저 업데이트**(예: 1.x)로 올릴 때, 라이브러리가 DataFrame 컬럼명이나 API를 바꾸면 그때 `fetch-market-data.py`에서 컬럼명/호출 방식을 맞춰 줄 수 있음. 현재 권장은 최신 0.9.x 이므로 해당 가능성은 낮음.
- **버전 고정이 필요하면**: 프로젝트에 `requirements.txt`가 없으므로, 재현 환경을 맞추고 싶다면 예를 들어 `requirements.txt`에 `finance-datareader>=0.9.91` 등을 두고 `pip install -r requirements.txt` 로 설치하는 방식은 선택 사항.

### 정리
- **다른 로직/서버/프론트에는 영향 없음.**  
- **수정 필요:** **없음.**  
- 업그레이드는 “KRX가 요구하는 Referer를 보내도록 라이브러리 내부가 바뀌는 것”이라, 우리 코드 변경 없이 시가총액 수집만 성공할 가능성이 높아짐.
