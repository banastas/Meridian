/* Meridian — Service Worker */

'use strict';

chrome.runtime.onInstalled.addListener(() => {
  // Create an alarm to keep time updates ticking
  chrome.alarms.create('meridian-tick', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'meridian-tick') {
    // Send a tick message to any open new tab pages
    chrome.runtime.sendMessage({ type: 'tick' }).catch(() => {
      // No listeners — that's fine, tab might not be open
    });
  }
});
