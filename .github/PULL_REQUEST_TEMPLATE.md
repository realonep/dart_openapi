## Summary
- 변경 목적과 배경을 1~3줄로 작성

## Changes
- 주요 코드 변경사항 요약
- 데이터/파이프라인 영향 범위 요약

## Checklist
- [ ] `docs/PIPELINE-RULES.md` 확인 후 구현했다
- [ ] 파이프라인 로직 변경 시 `docs/PIPELINE-RULES.md`를 함께 갱신했다
- [ ] JSON 스키마 변경(필드 추가/삭제/이름 변경/신규 파일) 시 `data/DATA-FIELDS.md`를 함께 갱신했다
- [ ] 비정형 파이프라인 변경 시 통합 페이저(shared list.json) 원칙을 유지했다
- [ ] 조회 범위 제한(예: 최근 N개월)이 있다면 UI 안내 문구/메타(`fetch_policy`)와 일치한다
- [ ] 샘플 corp 재수집(`node -r dotenv/config scripts/sync-all.js --force-llm`)으로 결과를 확인했다

## Test Plan
- [ ] 로컬 실행/화면 확인 완료
- [ ] 주요 로그 확인 완료 (`[DisclosureList/API]`, `[Treasury/Policy]`, `[ALL DONE]`)
