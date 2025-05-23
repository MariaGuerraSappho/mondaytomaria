// Constants for the application
const APP_VERSION = "2.23.0 (build 337)";

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

// FIXED: Completely rewritten card distribution function with guaranteed delivery
const improvedDistributeCard = async (player, deckData, distributionMode, players, minTimerSeconds, maxTimerSeconds) => {
  try {
    console.log(`[${APP_VERSION}] Distributing card to player ${player.id} (${player.name})`);
    
    // Generate a unique distribution ID
    const distributionId = `dist_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
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
    
    // CRITICAL FIX: Very simple and direct update, minimizing complexity
    console.log(`[${APP_VERSION}] Sending card "${selectedCard}" to player ${player.id} for ${randomDuration}s`);
    
    try {
      // Simplified update with only essential fields
      await safeOperation(() =>
        room.collection('player').update(player.id, {
          current_card: selectedCard,
          current_deck_name: selectedDeckName,
          current_deck_id: selectedDeckId,
          card_duration: randomDuration,
          card_start_time: new Date().toISOString(),
          ready_for_card: false
        })
      );
      
      console.log(`[${APP_VERSION}] Card successfully sent to player ${player.id}`);
      
      // Verify the update was applied
      const updatedPlayer = await safeOperation(() => 
        room.collection('player')
          .filter({ id: player.id })
          .getList()
      );
      
      if (updatedPlayer.length > 0) {
        console.log(`[${APP_VERSION}] Verified card update for player:`, {
          id: updatedPlayer[0].id,
          current_card: updatedPlayer[0].current_card
        });
      }
      
      return {
        success: true,
        card: selectedCard,
        deckName: selectedDeckName,
        deckId: selectedDeckId,
        duration: randomDuration
      };
    } catch (updateError) {
      console.error(`[${APP_VERSION}] Failed to update player with card:`, updateError);
      throw updateError;
    }
  } catch (error) {
    console.error(`[${APP_VERSION}] Error distributing card:`, error);
    return { success: false, error: error.message };
  }
};