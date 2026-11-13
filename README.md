# 실크로드 메뉴얼 웹 (샘플)

HWPX 메뉴얼을 정적 HTML로 변환해 웹에서 열람하고, 버전별로 보관한다.

## 사용법

```bash
npm install
# 변환 (같은 --id 로 --version 만 바꿔 다시 실행하면 새 버전이 추가됨)
node tools/convert.mjs "01 Project - 수정완료.hwpx" --id project --title "프로젝트 (Project)" --version 1.0 --note "변경 내용"
# 로컬 미리보기
npm run serve      # http://127.0.0.1:5173
```

## 구조

- `tools/hwpx.mjs` HWPX → HTML 변환기 (스타일·번호·표·그림 처리)
- `tools/convert.mjs` 변환 실행, 그림 WebP 압축, 버전 폴더·`site/data/manuals.json` 갱신
- `site/` 배포 대상 정적 사이트 (`m/<id>/<version>/` 에 버전별 결과 저장)

## 새 버전 업로드 (로컬 관리 화면)

```bash
npm run admin      # http://127.0.0.1:5174 (이 PC에서만 열림)
npm run serve      # 열람 사이트 미리보기 http://127.0.0.1:5173
```

관리 화면에서 수정한 HWPX를 올리고, 문서·버전·변경 내용을 입력해 등록한다. 등록 후 `site/` 폴더를 배포하면 반영된다.

## 문서 병합

관리 화면의 **문서 병합**에서 등록된 문서와 버전을 골라 순서를 정하면(≡ 끌기 또는 ▲▼), 하나의 HWPX로 합쳐 사이트에 새 문서로 등록한다. 병합본은 열람 화면의 [원본(HWPX) 다운로드]로 받는다.

- `tools/merge.mjs` 가 한글 프로그램 없이 HWPX(XML)를 직접 합친다. 각 문서의 서식 번호·그림 번호를 겹치지 않게 다시 매기고, 본문은 문서마다 별도 구역(새 쪽)으로 이어 붙인다.
- 장 번호는 문서별로 1.부터 다시 시작한다 (원본 번호 유지).
- 같은 이름의 스타일은 첫 문서의 스타일을 같이 쓴다. 문단마다 글자·문단 모양을 직접 갖고 있어 보이는 모양은 그대로다.

## 100MB가 넘는 원본 (통합본 등)

GitHub는 100MB가 넘는 파일을 받지 않는다. 등록 후 커밋 전에 아래를 실행하면, 큰 원본 HWPX를 GitHub 릴리스 첨부파일로 올리고 다운로드 버튼이 그 주소를 쓰도록 바꾼다 (해당 파일은 `.gitignore`에 자동 추가).

```bash
npm run release-large
```
