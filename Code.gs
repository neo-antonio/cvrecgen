/**
 * trackello portfolio sync — Google Apps Script Web App
 * ------------------------------------------------------
 * doPost: receives purchase items flagged "Record to portfolio" from the app and:
 *   1. Saves any attached photo to a Drive folder (uploads/camera photos only —
 *      pasted image links are stored as-is).
 *   2. Appends one row per item to a Google Sheet.
 * doGet: lets the Portfolio page in the app read those rows back (item, cost,
 *   date, photo) so it can show the collection, guarded by the same SECRET.
 *
 * SETUP
 * 1. Create a Google Sheet. Add a header row:
 *      Timestamp | Date | Seller | Bought by | Item | Cost | Photo | Notes
 * 2. In the Sheet: Extensions > Apps Script. Delete the sample code and paste this file in.
 * 3. Create a Drive folder for item photos and copy its ID from the URL.
 * 4. Fill in SHEET_ID, SHEET_NAME, DRIVE_FOLDER_ID and SECRET below.
 *    SECRET can be any random string — it just has to match CONFIG.portfolio.secret in config.js.
 * 5. Deploy > New deployment > type "Web app".
 *      Execute as: Me
 *      Who has access: Anyone
 *    Click Deploy, authorize it, and copy the Web app URL.
 * 6. Paste that URL into CONFIG.portfolio.endpoint in config.js, and the same SECRET
 *    into CONFIG.portfolio.secret.
 * 7. Whenever you edit this script, you must create a NEW deployment version
 *    (or "Manage deployments" > edit > new version) for changes to go live —
 *    that includes adding doGet below to an existing deployment.
 */

const SHEET_ID = '1It4a7gEvyxr-gz4SL6gClC84o6mfxjr9Ooho_DxjL9o';
const SHEET_NAME = 'Backend';
const DRIVE_FOLDER_ID = '1CYJ4iiiulbWoxY-4gn809_EFyD_XvC00';
const SECRET = 'courtvision_$0819';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });

    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

    (body.items || []).forEach(it => {
      let photoUrl = '';
      if (it.photo && it.photo.src) {
        photoUrl = it.photo.kind === 'link' ? it.photo.src : saveImage_(it.photo.src, it.name, folder);
      }
      sheet.appendRow([
        new Date(), body.date || '', body.seller || '', body.people || '',
        it.name || '', it.cost || 0, photoUrl, body.notes || ''
      ]);
    });

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * GET .../exec?secret=...  -> { ok:true, items:[{date,name,cost,photo}, ...] }
 * Most recent first. `photo` is rewritten to a URL an <img> tag can load
 * directly (Drive share links aren't hotlinkable as-is).
 */
function doGet(e) {
  try {
    if ((e.parameter.secret || '') !== SECRET) return json_({ ok: false, error: 'unauthorized' });

    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const rows = sheet.getDataRange().getValues();
    rows.shift(); // drop header row: Timestamp | Date | Seller | Bought by | Item | Cost | Photo | Notes

    const items = rows
      .filter(r => r[4]) // has an item name
      .map(r => ({
        date: r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[1] || ''),
        name: String(r[4]),
        cost: Number(r[5]) || 0,
        photo: toDisplayUrl_(r[6])
      }))
      .reverse();

    return json_({ ok: true, items });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function toDisplayUrl_(url) {
  if (!url) return '';
  url = String(url);
  if (/drive\.google\.com/.test(url)) {
    const m = url.match(/[-\w]{25,}/); // Drive file ID
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[0] + '&sz=w600';
  }
  return url; // pasted external links are already hotlinkable
}

function saveImage_(dataUrl, name, folder) {
  const m = String(dataUrl).match(/^data:(.+);base64,(.*)$/);
  if (!m) return '';
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], (name || 'item').replace(/[^\w.-]+/g, '_') + '.jpg');
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
