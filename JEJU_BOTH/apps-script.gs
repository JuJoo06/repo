// ═══════════════════════════════════════════════════════════════
// 제주 역사 탐험 — 구글 시트 연동 Apps Script (v2: 탭 이름 무관)
// 시트의 [확장 프로그램 → Apps Script]에 이 코드 전체를 붙여넣고 저장한 뒤,
// [배포 → 배포 관리 → ✏️ 수정 → 버전: 새 버전 → 배포] 하면
// 기존 웹 앱 URL이 그대로 유지됩니다. (새 배포를 하면 URL이 바뀝니다)
//
// 역할 1) GET  : 모든 탭에서 유적지 행(A열이 site_id)을 찾아 JSON으로 반환
// 역할 2) POST : 퀴즈 완료 결과를 "log" 탭에 한 줄씩 기록
//
// 시트 작성법(아무 탭이나): A열 site_id / B열 name / C열 history
//   site_id 는 jocheon, haenyeo, alddreu, peace43 중 하나
// ═══════════════════════════════════════════════════════════════

const KNOWN_IDS = ["jocheon", "haenyeo", "alddreu", "peace43"];
const LOG_SHEET = "log"; // 자동 생성됨

// 게임이 유적지 설명을 읽어갈 때 호출됩니다.
function doGet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sites = [];
  const seen = {};
  ss.getSheets().forEach(function (sh) {
    if (sh.getName() === LOG_SHEET) return;
    sh.getDataRange().getValues().forEach(function (row) {
      const id = String(row[0] || "").trim().toLowerCase();
      if (KNOWN_IDS.indexOf(id) === -1 || seen[id]) return;
      seen[id] = true;
      sites.push({
        site_id: id,
        name: String(row[1] || "").trim(),
        history: String(row[2] || "").trim(),
      });
    });
  });
  return ContentService.createTextOutput(JSON.stringify({ sites: sites }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 게임이 퀴즈 결과를 보낼 때 호출됩니다.
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["기록시각", "플레이어", "유적지ID", "유적지명", "결과", "오답횟수"]);
  }
  const p = e.parameter;
  sh.appendRow([new Date(), p.player, p.site_id, p.site_name, p.result, p.wrong_count]);
  return ContentService.createTextOutput("ok");
}
