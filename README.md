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
