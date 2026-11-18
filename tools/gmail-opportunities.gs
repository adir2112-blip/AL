// "הזדמנויות" feed: runs in the owner's Gmail (Google Apps Script).
// Every 15 minutes it takes new Facebook notification emails (posts in the
// groups and pages he follows), sends them to the social-opportunities edge
// function, and labels them so they are sent once. It only READS email; it
// never touches Facebook.
//
// Setup (once):
//   1. script.google.com -> New project -> paste this file.
//   2. Project Settings -> Script properties -> add OPPS_KEY = the value of
//      the OPPS_INGEST_SECRET secret in Supabase (AL project).
//   3. Run setup() once and approve the Gmail permission.
//   4. In each Facebook group worth watching: Notifications -> All posts.

const ENDPOINT = 'https://iwixjlfbifsbxtyppvqb.supabase.co/functions/v1/social-opportunities';
const QUERY = 'from:(facebookmail.com) newer_than:2d';
const LABEL = 'AL-הזדמנויות';

function scan() {
  const key = PropertiesService.getScriptProperties().getProperty('OPPS_KEY');
  if (!key) throw new Error('OPPS_KEY missing in Script properties');
  const label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  const threads = GmailApp.search(QUERY + ' -label:' + LABEL, 0, 25);
  for (let i = 0; i < threads.length; i += 5) {
    const batch = threads.slice(i, i + 5);
    const emails = batch.map(function (t) {
      const m = t.getMessages().pop();
      return { id: m.getId(), subject: m.getSubject(), body: m.getPlainBody().slice(0, 8000) };
    });
    const res = UrlFetchApp.fetch(ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-opps-key': key },
      payload: JSON.stringify({ action: 'email', emails: emails }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.error('social-opportunities ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
      return; // try again next run
    }
    batch.forEach(function (t) { t.addLabel(label); });
    console.log(res.getContentText());
  }
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scan') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scan').timeBased().everyMinutes(15).create();
  scan();
}
