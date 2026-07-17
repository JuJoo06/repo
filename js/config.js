// ── 구글 시트 연동 설정 (Apps Script 방식 권장) ──────────────────────
//
// APPS_SCRIPT_URL (권장): 시트를 공개하지 않아도 됩니다.
//   1. 구글 시트에 "sites" 탭 작성: site_id | name | history (1행 헤더)
//   2. 시트에서 [확장 프로그램 → Apps Script] 열고
//      프로젝트의 apps-script.gs 코드를 전부 붙여넣고 저장
//   3. [배포 → 새 배포 → 웹 앱] 선택
//      - 실행 계정: 나 / 액세스 권한: 모든 사용자
//   4. 배포된 웹 앱 URL(https://script.google.com/macros/s/.../exec)을
//      아래 APPS_SCRIPT_URL 에 붙여넣기
//   → 유적지 설명을 시트에서 읽고, 퀴즈 결과도 log 탭에 자동 기록됩니다.
//
// SHEET_ID (대안): Apps Script 없이 읽기만 할 때.
//   시트를 "링크가 있는 모든 사용자 - 뷰어"로 공유하고
//   URL 중 /d/ 와 /edit 사이 문자열을 넣으세요. (기록 기능은 안 됨)
//
// 둘 다 비워두면 게임에 내장된 기본 설명을 사용합니다.
// 퀴즈 문제는 항상 js/data.js 에 내장된 것을 사용합니다.

export const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycby9gbJ06J6hdMsxneCoIuzU1cf3tumJirCCdc_tGpZKzayaelH-IpACcputtdzRIpVEkA/exec",
  SHEET_ID: "1JZnbL7RJOPyXKN99du3VvZQ7kpk3rFrjbKCdKKOh1go",
};
