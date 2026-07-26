document.getElementById('startBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // WIPE ALL OLD STATE CLEAN
  await chrome.storage.local.set({ 
    isMapping: true, 
    results: [], 
    queueIndex: 0,   // Reset the pointer to the first link
    urlQueue: []     // Clear out the old list of URLs
  });

  // Wake up the background script
  chrome.runtime.sendMessage({ action: "start_mapping", tabId: tab.id });
  
  document.getElementById('status').innerText = "Mapping started! Watch the pages change...";
});