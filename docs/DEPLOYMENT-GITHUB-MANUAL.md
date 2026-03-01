# GitHub 수동 배포/동기화 가이드

이 문서는 `html_dart` 프로젝트를 로컬에서 GitHub로 반영하고, GitHub Actions 수동 실행(`DART On-Demand Bootstrap (Manual)`)으로 온디맨드 운영에 필요한 초기 검색 목록을 갱신하는 표준 절차를 설명합니다.

## 0) 사전 조건

- 로컬 경로: `c:\Users\realone\Desktop\html_dart`
- GitHub 저장소 접근 권한 보유
- GitHub Actions 시크릿 등록 완료:
  - `OPENDART_API_KEY`

## 1) 작업 디렉터리 이동

```powershell
cd "c:\Users\realone\Desktop\html_dart"
```

## 2) 민감정보(.env) Git 제외 확인

```powershell
git check-ignore -v .env
git status --short
```

- `git check-ignore` 결과에 `.env` 규칙이 보여야 합니다.
- `git status --short`에 `.env`가 나타나면 안 됩니다.

## 3) 변경사항 확인

```powershell
git status
```

- 반영 대상 파일(예: `.github/workflows/dart-data-sync.yml`, `README.md`)이 포함되어 있는지 확인합니다.

필수 반영 파일이 변경 목록에 있는지 빠르게 확인:

```powershell
git status --short ".github/workflows/dart-data-sync.yml" "README.md"
```

- 둘 중 하나라도 출력이 비어 있으면, 해당 파일이 아직 수정/추적되지 않았을 수 있으니 다시 확인합니다.

## 4) 원격 최신 동기화 (충돌 예방)

현재 브랜치 확인:

```powershell
git branch --show-current
```

브랜치가 `master`인 경우:

```powershell
git fetch origin
git pull --rebase origin master
```

브랜치가 `main`인 경우:

```powershell
git fetch origin
git pull --rebase origin main
```

충돌 시:

1. 파일 수정
2. `git add <해결한파일>`
3. `git rebase --continue`

## 5) 스테이징

전체 반영:

```powershell
git add .
```

선택 반영(예시):

```powershell
git add ".github/workflows/dart-data-sync.yml" "README.md"
```

## 6) 커밋 전 최종 검증

```powershell
git diff --cached --name-only
git diff --cached
```

다음 항목이 포함되지 않았는지 반드시 확인:

- `.env`
- `local.db`
- 민감 토큰/키가 담긴 파일

필수 파일이 실제로 staged 되었는지 확인:

```powershell
git diff --cached --name-only -- ".github/workflows/dart-data-sync.yml" "README.md"
```

- 두 파일 경로가 출력되어야 이번 배포 변경사항에 포함됩니다.

## 7) 커밋

```powershell
git commit -m "chore: switch sync workflow to manual-safe mode and update runbook"
```

## 8) 푸시

브랜치가 `master`인 경우:

```powershell
git push origin master
```

브랜치가 `main`인 경우:

```powershell
git push origin main
```

처음 푸시하는 브랜치:

```powershell
git push -u origin <브랜치명>
```

## 9) GitHub Variables 등록

`Settings -> Secrets and variables -> Actions -> Variables`

권장값:

- (선택) `WRITE_CORP_MASTER=true`
  - 기본값은 `false` 권장
  - `true`일 때 `corp-code-list.json` 생성 후 `corp_master` DB 적재를 시도합니다.

## 10) GitHub Actions 수동 실행

1. `Actions` 탭 이동
2. `DART On-Demand Bootstrap (Manual)` 선택
3. `Run workflow` 클릭
4. 입력값:
   - `write_corp_master=false` (기본 권장)
   - 실행 브랜치 선택

## 11) Actions 로그 성공 기준

아래 단계가 모두 성공(초록)이어야 합니다.

- `Validate required secret`
- `Refresh corp code list for on-demand search`

## 12) 최종 동작 확인

브라우저에서:

1. 종목 검색/선택 가능 여부 확인
2. 대표 종목 1~2개 조회
3. 재수집 1회 테스트
4. `수집중 -> 완료` 상태 전이 확인
5. 재무/주주/임원/시총 표시 확인

## 13) 작업 종료 후 안전 복귀

추가 복구 작업은 없습니다. (`write_corp_master`를 `false`로 유지하면 안전 모드입니다.)

## 14) 실패 시 점검 포인트

- `Validate required secret` 실패: `OPENDART_API_KEY` 누락/오타
- `Refresh corp code list for on-demand search` 실패: DART 키/호출 제한/네트워크
- 목록 갱신 후 검색 반영 지연: 브라우저 새로고침 후 `data/meta/corp-code-list.json` 최신 여부 확인

