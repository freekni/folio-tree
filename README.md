# Folio Tree

브라우저에서 로컬 프로젝트 폴더를 열어 트리와 서식 문서로 관리하고, 필요할 때만 GitHub에 백업하는 도구입니다.

## 사용 흐름

1. Edge 또는 Chrome에서 앱을 엽니다.
2. `프로젝트 폴더 열기`를 눌러 로컬 폴더를 선택합니다.
3. 왼쪽 트리 항목을 오른쪽 클릭해 하위 항목을 추가합니다.
4. 오른쪽 편집기에서 내용을 작성합니다. 각 폴더의 내용은 `content.html`로 자동 저장됩니다.
5. 설정에 비공개 데이터 저장소 주소와 브랜치를 입력합니다.
6. 필요할 때 `GitHub에 백업`을 누르고, Contents 읽기/쓰기 권한을 가진 세분화된 토큰을 입력합니다.

GitHub 토큰은 메모리에만 존재하며 저장되지 않습니다. 앱의 GitHub Pages 저장소와 실제 프로젝트 데이터 저장소는 분리해서 사용하세요.

## 로컬 실행

```bash
npm install
npm run dev
```

## GitHub Pages

`main` 브랜치에 푸시하면 포함된 GitHub Actions 워크플로가 정적 앱을 빌드해 Pages에 배포합니다. 저장소의 **Settings → Pages → Source**에서 **GitHub Actions**를 선택해야 합니다.
