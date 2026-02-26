## 프로젝트 개요

Open DART API를 활용하여 **상장사의 기업 개황 · 주요 재무 지표 · 배당 현황**을 시각화하는 웹 대시보드입니다.

- **Frontend**: 순수 HTML + JS (GitHub Pages에서 정적 호스팅)
- **Backend 역할**: GitHub Actions + Node 스크립트가 Open DART API를 호출해 `/data/*.json` 생성
- **보안/아키텍처**
  - 브라우저에서는 Open DART를 직접 호출하지 않고, 리포지토리에 커밋된 `data/*.json` 만 조회
  - Open DART 인증키는 GitHub Secrets(`OPENDART_API_KEY`)에 저장되어, 코드/브라우저에 노출되지 않음

## 주요 폴더 구조

- `index.html`: GitHub Pages 진입점
- `assets/css`: 기본 스타일 및 다크 테마
- `assets/js`: 검색바, 기업 개황, 재무/배당 섹션, 간단한 상태 관리 및 라우터
- `data/`: GitHub Actions가 생성/갱신하는 정적 JSON
- `scripts/`: Open DART 호출용 Node 스크립트 (Actions에서만 실행)
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
  - 매일 KST 01:00 (`cron: '0 16 * * *'`)
  - 수동 실행 (`workflow_dispatch`)
- 작업:
  - Node 설치 → `npm install`
  - `scripts/fetch-*.js` 스크립트 실행으로 `/data` 갱신
  - 변경된 `/data`를 `main` 브랜치에 커밋/푸시

> `fetch-corp-overview.js`, `fetch-financials.js`, `fetch-dividends.js` 는 Open DART 공식 문서를 참고해 세부 파라미터/파싱 로직을 구현해야 합니다. 현재는 뼈대 및 예시 수준입니다.

## 로컬에서 테스트

1. Node.js 설치
2. 프로젝트 루트에서:

```bash
npm install
# (선택) 데이터 동기화를 수동으로 실행
set OPENDART_API_KEY=YOUR_KEY_HERE # Windows PowerShell 예시는 $env:OPENDART_API_KEY="KEY"
npm run fetch:all
```

3. VS Code의 Live Server 확장 또는 간단한 HTTP 서버로 `index.html` 을 열어 UI를 확인합니다.

