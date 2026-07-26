chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);
  
  if (message.action === "start_mapping") {
    injectScraper(message.tabId);
  }
  
  // NEW: Handle a broken or permission-locked page
  if (message.action === "page_failed") {
    chrome.storage.local.get(["urlQueue", "queueIndex"], async (data) => {
      const nextIndex = (data.queueIndex || 0) + 1;
      const queue = data.urlQueue || [];
      
      await chrome.storage.local.set({ queueIndex: nextIndex });
      
      if (nextIndex < queue.length) {
        console.log(`Skipping failed page. Redirecting tab to: ${queue[nextIndex]}`);
        chrome.tabs.update(sender.tab.id, { url: queue[nextIndex] });
      } else {
        chrome.runtime.sendMessage({ action: "mapping_complete" });
      }
    });
  }
  
  // NEW: Catch completion message and trigger download
  if (message.action === "mapping_complete") {
    chrome.storage.local.get(["results"], (data) => {
      const jsonString = JSON.stringify(data.results, null, 2);
      
      // Convert JSON to a base64 Data URL so the downloads API can read it
      const dataUrl = "data:application/json;base64," + btoa(unescape(encodeURIComponent(jsonString)));
      
      chrome.downloads.download({
        url: dataUrl,
        filename: `cloudli_features_${new Date().toISOString().slice(0,10)}.json`,
        saveAs: false // Set to true if you want Chrome to prompt you where to save it
      });

      // Reset mapping state
      chrome.storage.local.set({ isMapping: false });
      console.log("File downloaded successfully!");
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only inject when the page is fully loaded and we are still in "Mapping Mode"
  if (changeInfo.status === 'complete' && tab.url?.includes("connect.cloudli.com")) {
    chrome.storage.local.get(["isMapping"], (data) => {
      if (data.isMapping) {
        console.log("Page refreshed, re-injecting worker...");
        injectScraper(tabId);
      }
    });
  }
});

function injectScraper(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ["content.js"]
  }).catch(err => console.error("Injection failed:", err));
}
