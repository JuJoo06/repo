// 구글 시트 연동 (Apps Script 방식 권장)
//
// ① APPS_SCRIPT_URL 설정 시 (권장, 시트 공개 불필요):
//    - GET  → "sites" 탭의 유적지 설명을 JSON으로 받아 적용
//    - POST → 퀴즈 결과를 "log" 탭에 기록
//    시트에 붙여넣을 코드는 프로젝트의 apps-script.gs 파일 참고.
//
// ② SHEET_ID만 설정 시 (대안): 시트를 "링크가 있는 모든 사용자(뷰어)"로
//    공유해야 하며, gviz 엔드포인트로 sites 탭을 읽습니다.
//
// 퀴즈 문제는 항상 js/data.js 에 내장된 것을 사용합니다.

function applySiteRows(rows, sites) {
  const byId = {};
  sites.forEach((s) => (byId[s.id] = s));
  let applied = 0;
  rows.forEach((row) => {
    const s = byId[row.site_id];
    if (!s) return;
    if (row.name) s.name = row.name;
    if (row.history) s.history = row.history;
    applied++;
  });
  return applied;
}

// Apps Script 웹 앱에서 sites 데이터 읽기
async function fetchFromAppsScript(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Apps Script 응답 오류 (${res.status})`);
  const json = await res.json();
  if (!json || !Array.isArray(json.sites)) throw new Error("Apps Script 응답 형식이 올바르지 않습니다.");
  return json.sites;
}

// gviz 엔드포인트에서 sites 탭 읽기 (시트가 링크 공유되어 있어야 함)
async function fetchFromGviz(sheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=sites`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sites 시트를 불러오지 못했습니다 (${res.status})`);
  const text = await res.text();
  const json = JSON.parse(text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const cols = json.table.cols.map((c) => (c.label || "").trim());
  let rows = json.table.rows.map((r) => (r.c || []).map((c) => (c && c.v != null ? String(c.v).trim() : "")));
  let header = cols;
  if (cols.every((c) => c === "") && rows.length > 0) {
    header = rows[0].map((v) => v.trim());
    rows = rows.slice(1);
  }
  const idx = {};
  header.forEach((h, i) => (idx[h.toLowerCase()] = i));
  return rows
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => ({
      site_id: r[idx.site_id] ?? "",
      name: r[idx.name] ?? "",
      history: r[idx.history] ?? "",
    }));
}

// 시트의 이름·설명을 기본 SITES 배열에 병합
export async function loadFromSheets(config, sites) {
  if (!config.APPS_SCRIPT_URL && !config.SHEET_ID) return { loaded: false };

  let rows = null;
  let via = "";
  if (config.APPS_SCRIPT_URL) {
    try {
      rows = await fetchFromAppsScript(config.APPS_SCRIPT_URL);
      via = "Apps Script";
      if (rows.length === 0) {
        console.warn("[sheets] Apps Script가 빈 목록을 반환해 시트 직접 읽기로 전환합니다.");
        rows = null;
      }
    } catch (e) {
      console.warn("[sheets] Apps Script 읽기 실패:", e.message);
    }
  }
  if (!rows && config.SHEET_ID) {
    try {
      rows = await fetchFromGviz(config.SHEET_ID);
      via = "시트 공유 링크";
    } catch (e) {
      console.warn("[sheets] gviz 읽기 실패:", e.message);
    }
  }
  if (!rows) {
    return { loaded: false, error: "시트를 읽지 못했습니다. Apps Script 배포(액세스: 모든 사용자)와 sites 탭을 확인하세요." };
  }

  const applied = applySiteRows(rows, sites);
  if (applied === 0) {
    return { loaded: false, error: "sites 탭에서 유효한 행을 찾지 못했습니다. site_id 값을 확인하세요." };
  }
  return { loaded: true, siteCount: applied, via };
}

// 퀴즈 결과 기록 (Apps Script 웹 앱)
export function logResult(config, data) {
  if (!config.APPS_SCRIPT_URL) return;
  try {
    fetch(config.APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data),
    });
  } catch (e) {
    console.warn("[sheets] 결과 기록 실패:", e);
  }
}
