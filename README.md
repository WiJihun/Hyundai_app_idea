# Hyundai App Idea

현대차 앱 공모전 팀 레포지토리.

## 팀원
- @WiJihun (관리자)
- @Onjunhwi
- @jeonghasang
- @qortmdcjf

## 폴더 구조
| 폴더 | 내용 |
|---|---|
| [`story/`](story) | 기획 · 스토리 · 시나리오 · 발표 자료 |
| [`frontend/`](frontend) | 앱 화면(UI) |
| [`backend/`](backend) | 서버 · API · DB |

## 시작하기
```bash
git clone https://github.com/WiJihun/Hyundai_app_idea.git
cd Hyundai_app_idea
```

## 작업 규칙
1. `main`에 직접 push 하지 않는다. 항상 브랜치를 만들어 작업한다.
   ```bash
   git switch main
   git pull
   git switch -c feature/작업이름
   ```
2. 작업 후 커밋 → push → GitHub에서 Pull Request(PR) 생성.
   ```bash
   git add .
   git commit -m "feat: 무엇을 했는지"
   git push -u origin feature/작업이름
   ```
3. 팀원 1명 이상 확인 후 `main`에 merge.
4. merge 후 다른 팀원은 `git switch main && git pull`로 최신화.

### 브랜치 이름
- `feature/…` 새 기능 · `fix/…` 버그 수정 · `docs/…` 문서/기획

### 커밋 메시지
- `feat:` 기능 추가 · `fix:` 버그 수정 · `docs:` 문서 · `design:` 디자인/UI
