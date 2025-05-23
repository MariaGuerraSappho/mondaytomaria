// Constants for the application
const APP_VERSION = "2.24.4 (build 343)";

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

// FIXED: Enhanced distributeCard to prevent premature distribution
const distributeCard = async (player, deckData, distributionMode, players, minTimerSeconds, maxTimerSeconds) => {
  try {
    console.log(`[${APP_VERSION}] Distributing card to player ${player.id} (${player.name})`);
    
    // STRICT CHECK: Ensure player is truly ready for a new card
    // First, check if player already has an active card with remaining time
    if (player.current_card && player.current_card !== 'END' && player.card_start_time && player.card_duration) {
      const cardStartTime = new Date(player.card_start_time).getTime();
      const cardEndTime = cardStartTime + (player.card_duration * 1000);
      const now = Date.now();
      
      // Add a buffer to ensure we don't distribute before the previous card is truly finished
      const bufferMs = 2000; // 2 seconds buffer
      
      // If card still has time remaining (with buffer), don't distribute a new one
      if (now < (cardEndTime + bufferMs)) {
        console.log(`[${APP_VERSION}] STRICT CHECK: Player ${player.name} still has an active card with ${Math.ceil((cardEndTime - now)/1000)}s remaining (+${bufferMs/1000}s buffer)`);
        return {
          success: false,
          reason: 'CARD_STILL_ACTIVE',
          timeRemaining: Math.ceil((cardEndTime - now)/1000)
        };
      }
    }
    
    // ADDITIONAL CHECK: Verify player is explicitly marked as ready for a card
    if (player.ready_for_card !== true) {
      console.log(`[${APP_VERSION}] Player ${player.name} is not explicitly marked as ready for a card`);
      return {
        success: false,
        reason: 'PLAYER_NOT_READY'
      };
    }
    
    // Random duration between min and max
    const randomDuration = Math.floor(
      Math.random() * (maxTimerSeconds - minTimerSeconds + 1) + minTimerSeconds
    );
    
    let selectedCard;
    let selectedDeckName = deckData.name;
    let selectedDeckId = deckData.id;
    
    // Choose card based on distribution mode
    if (distributionMode === 'unison') {
      // Use existing active card if available
      const activeUnison = players.find(p => 
        p.current_card && p.current_card !== 'END' && 
        p.id !== player.id && 
        new Date(p.card_start_time).getTime() + (p.card_duration * 1000) > Date.now()
      );
      
      if (activeUnison && activeUnison.current_card) {
        selectedCard = activeUnison.current_card;
        selectedDeckName = activeUnison.current_deck_name;
        selectedDeckId = activeUnison.current_deck_id;
        console.log(`[${APP_VERSION}] Using unison card: ${selectedCard}`);
      } else {
        // Select a new card for everyone
        const cards = deckData.cards;
        const randomIndex = Math.floor(Math.random() * cards.length);
        selectedCard = cards[randomIndex];
        console.log(`[${APP_VERSION}] Selected new unison card: ${selectedCard}`);
      }
    } else if (distributionMode === 'unique') {
      // Find a card that no other player currently has
      const cards = deckData.cards;
      const activePlayerCards = players
        .filter(p => p.current_card && p.current_card !== 'END' && p.id !== player.id)
        .map(p => p.current_card);
      
      const availableCards = cards.filter(card => !activePlayerCards.includes(card));
      
      if (availableCards.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableCards.length);
        selectedCard = availableCards[randomIndex];
        console.log(`[${APP_VERSION}] Selected unique card: ${selectedCard}`);
      } else {
        const randomIndex = Math.floor(Math.random() * cards.length);
        selectedCard = cards[randomIndex];
        console.log(`[${APP_VERSION}] No unique cards available, selected: ${selectedCard}`);
      }
    } else {
      // For random mode, just pick a random card from the deck
      const cards = deckData.cards;
      const randomIndex = Math.floor(Math.random() * cards.length);
      selectedCard = cards[randomIndex];
      console.log(`[${APP_VERSION}] Selected random card: ${selectedCard}`);
    }
    
    // Current time with millisecond precision for exact timing
    const preciseStartTime = new Date();
    
    // Create update data with absolute millisecond precision timestamps
    const updateData = {
      current_card: selectedCard,
      current_deck_name: selectedDeckName,
      current_deck_id: selectedDeckId,
      card_duration: randomDuration,
      card_start_time: preciseStartTime.toISOString(),
      ready_for_card: false, // CRITICAL: Mark as not ready for next card until current finishes
      card_received: false
    };
    
    console.log(`[${APP_VERSION}] Player update data:`, JSON.stringify(updateData));
    
    // Perform update with retry
    await safeOperation(() => 
      room.collection('player').update(player.id, updateData)
    );
    
    console.log(`[${APP_VERSION}] Card successfully sent to player ${player.id} for ${randomDuration}s starting at ${preciseStartTime.toISOString()}`);
    
    return {
      success: true,
      card: selectedCard,
      deckName: selectedDeckName,
      deckId: selectedDeckId,
      duration: randomDuration,
      startTime: preciseStartTime
    };
  } catch (error) {
    console.error(`[${APP_VERSION}] Error distributing card:`, error);
    return { success: false, error: error.message };
  }
};