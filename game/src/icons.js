const PATHS = {
  house: '<path d="m5 18 15-11 15 11"/><path d="M8 17v16h24V17M17 33V23h7v10"/><path d="M27 12V7h4v9"/><path d="M11 22h5v5h-5z"/>',
  well: '<path d="M8 17h24M11 17V9m18 8V9M6 10l14-6 14 6H6Z"/><path d="M11 22c0 8 2 11 9 11s9-3 9-11H11Z"/><path d="M14 26h12M20 11v12m-4-3h8l-1 5h-6l-1-5Z"/>',
  farm: '<path d="m5 20 11-8 11 8v13H5V20Z"/><path d="M10 33V23h12v10M16 23v10M8 15V8h6v4"/><path d="M30 33V16m0 5c-4 0-5-3-5-5 4 0 5 2 5 5Zm0 6c4 0 5-3 5-5 4 0 5 2 5 5Z"/>',
  workshop: '<path d="M5 33V15h21v18H5Z"/><path d="m3 15 6-7h16l5 7H3Z"/><path d="M10 33V21h9v12M22 12V5h5v10M22 25h4M8 18h16"/>',
  market: '<path d="M7 16h26l-3-9H10l-3 9Z"/><path d="M7 16c0 4 6 4 6 0 0 4 7 4 7 0 0 4 7 4 7 0 0 4 6 4 6 0M10 19v14h20V19"/><path d="M14 33v-8h12v8M5 33h30M13 12h14"/>',
  path: '<path d="M8 30h7v-5H8v5Zm12-8h7v-5h-7v5Zm12-8h7V9h-7v5Z"/><path d="M5 34h30M6 16l4-3m17 16 5 3"/>',
  park: '<path d="M20 34V20"/><path d="M20 23c-8 0-11-5-9-11 1-5 5-8 9-8s8 3 9 8c2 6-1 11-9 11Z"/><path d="M20 17c-3 0-5-2-5-5m5 9c4 0 6-2 6-5M7 34h26M10 34v-5m20 5v-5"/>',
  road: '<path d="M10 4h20l6 30H4L10 4Z"/><path d="M20 7v5m0 5v5m0 5v5M8 9l-2 4m26-4 2 4M5 23l-2 4m32-4 2 4"/>',
  generator: '<path d="M5 33V17h19v16H5Z"/><path d="m5 17 5-6 5 6 5-6 4 6M9 33V23h7v10M26 33V8h7v25M26 12h7"/><path d="M29 8V5h4v3M11 20h8"/>',
  factory: '<path d="M4 34V16h24v18H4Z"/><path d="m4 16 6-7 6 7 6-7 6 7M9 34V23h8v11M26 34V6h6v28M26 10h6"/><path d="M11 19h9M29 3v3"/>',
  warehouse: '<path d="m4 15 16-9 16 9v19H4V15Z"/><path d="M8 34V20h24v14M14 34V24h12v10M4 15h32M11 19h5m3 0h5"/>',
  water_plant: '<path d="M10 8h20v14H10V8Z"/><path d="M8 8h24M14 22v10m12-10v10M8 32h24M15 32v3m10-3v3"/><path d="M20 11c-3 4-4 5-4 7a4 4 0 0 0 8 0c0-2-1-3-4-7Z"/>',
  river_quay: '<path d="M5 15h21v17H5V15Z"/><path d="M8 15V8h12v7M6 32h22M9 24h10M26 8l4 4-4 4M30 12H17M23 20v13M8 36l4-4 4 4 4-4 4 4 4-4 4 4"/><path d="M12 20h7v6h-7z"/>',
  tower: '<path d="M9 36V5h22v31H9Z"/><path d="M7 36h26M13 10h4v4h-4zm10 0h4v4h-4zm-10 8h4v4h-4zm10 0h4v4h-4zm-10 8h4v4h-4zm10 0h4v4h-4zM7 14h4m20 8h4M13 34h14"/>',
  depot: '<path d="m7 18 13-8 13 8v16H7V18Z"/><path d="M11 34V22h18v12M17 34v-7h6v7M7 18h26M12 15h5m3 0h5"/><path d="M4 34h32"/>',
  tram: '<path d="M6 34h28M8 38h24M10 30V12h20v18H10Z"/><path d="M13 16h14M13 22h4m6 0h4M14 30v4m12-4v4M7 12h26M16 8h8"/>',
  maint_center: '<path d="M5 33V16h22v17H5Z"/><path d="m4 16 7-7h15l5 7H4Z"/><path d="m22 7 9 9m-4-9 4 4-9 9-4-4 9-9ZM10 34V24h8v10M14 19h8"/>',
  greenhouse: '<path d="M5 33V17L20 5l15 12v16H5Z"/><path d="M20 5v28M5 20h30M10 33V20m20 13V20M8 33h24"/><path d="M20 28c-5 0-7-3-7-6 5 0 7 2 7 6Zm0 0c5 0 7-3 7-6-5 0-7 2-7 6Z"/>',
  recycler: '<path d="M6 33V17h22v16H6Z"/><path d="m5 17 6-7h15l5 7H5Z"/><path d="m14 12 6-4 6 4M14 12l-3 6m9-6 3 6M12 26l4 4 4-4m-4 4v-8M23 24l4-4-4-4m4 4h-8"/>',
  commons: '<path d="M5 33V17l15-9 15 9v16H5Z"/><path d="M11 33V21h18v12M17 33v-8h6v8M4 17h32M20 8V3m-4 3h8"/><path d="M29 12c4 0 6-3 6-6-4 0-6 2-6 6Z"/>'
};

const UI_PATHS = {
  focus: '<circle cx="20" cy="20" r="7"/><path d="M20 4v7m0 18v7M4 20h7m18 0h7"/>',
  close: '<path d="m10 10 20 20M30 10 10 30"/>',
  display: '<path d="M5 11h30M5 20h30M5 29h30"/><circle cx="13" cy="11" r="3"/><circle cx="27" cy="20" r="3"/><circle cx="17" cy="29" r="3"/>',
  camera: '<path d="M5 13h8l3-5h8l3 5h8v20H5V13Z"/><circle cx="20" cy="22" r="6"/>',
  panels: '<path d="M7 5h26v30H7V5Z"/><path d="M22 5v30M11 12h6m-6 7h6m-6 7h6"/>',
  roof: '<path d="m4 20 16-12 16 12M8 18v15h24V18"/><path d="m9 27 22-13"/>',
  sun: '<circle cx="20" cy="20" r="7"/><path d="M20 3v5m0 24v5M3 20h5m24 0h5M8 8l4 4m16 16 4 4m0-24-4 4M12 28l-4 4"/>',
};

export function buildingIcon(id) {
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${PATHS[id] || PATHS.house}</svg>`;
}

export function uiIcon(id) {
  return `<svg class="ui-icon" viewBox="0 0 40 40" aria-hidden="true">${UI_PATHS[id] || UI_PATHS.display}</svg>`;
}
