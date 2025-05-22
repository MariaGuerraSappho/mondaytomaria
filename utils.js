// Constants for the application
const APP_VERSION = "2.18.0 (build 328)";

// Initialize WebsimSocket
let room;
try {
  room = new WebsimSocket();
  console.log(`[${APP_VERSION}] WebsimSocket initialized`);
} catch (err) {
  console.error(`[${APP_VERSION}] WebsimSocket initialization error:`, err);
  room = new WebsimSocketFallback();
  console.log(`[${APP_VERSION}] Using fallback socket`);
}

// Share React hooks globally
const { useState, useEffect, useRef, useCallback, useSyncExternalStore } = React;
const { createRoot } = ReactDOM;

// Card Check Intervals
const CARD_RECEIVED_CHECK_INTERVAL = 250; // ms

// Helper Functions
const generatePin = () => Math.floor(100000 + Math.random() * 900000).toString();

const safeOperation = async (operation, retries = 3) => {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`Operation failed (attempt ${attempt + 1}/${retries}):`, error);
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError || new Error('Operation failed');
};