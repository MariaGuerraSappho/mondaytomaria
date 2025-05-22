// Constants for the application
const APP_VERSION = "2.19.0 (build 329)";

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

// Improved card distribution function with extra reliability
const improvedDistributeCard = async (player, deckData, distributionMode, players, minTimerSeconds, maxTimerSeconds) => {
  try {
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
      } else {
        // Select a new card for everyone
        const cards = deckData.cards;
        const randomIndex = Math.floor(Math.random() * cards.length);
        selectedCard = cards[randomIndex];
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
      } else {
        const randomIndex = Math.floor(Math.random() * cards.length);
        selectedCard = cards[randomIndex];
      }
    } else if (distributionMode === 'random') {
      // Get all cards from all decks
      // For simplicity here, we're just using the provided deck
      const cards = deckData.cards;
      const randomIndex = Math.floor(Math.random() * cards.length);
      selectedCard = cards[randomIndex];
    }
    
    // First, clear current card state completely
    await safeOperation(() =>
      room.collection('player').update(player.id, {
        current_card: null, 
        card_start_time: null,
        card_duration: null,
        card_received: false,
        ready_for_card: true,
        waiting_for_player_ack: false,
        distribution_pending: true,
        distribution_id: distributionId,
        reset_timestamp: Date.now(),
      })
    );
    
    // Small delay for client processing
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Send the new card
    await safeOperation(() =>
      room.collection('player').update(player.id, {
        current_card: selectedCard,
        current_deck_name: selectedDeckName,
        current_deck_id: selectedDeckId,
        card_duration: randomDuration,
        distribution_pending: false,
        distribution_id: distributionId,
        ready_for_card: false,
        waiting_for_player_ack: true,
        card_sent_at: new Date().toISOString(),
        force_render: Date.now(),
      })
    );
    
    return {
      success: true,
      card: selectedCard,
      deckName: selectedDeckName,
      deckId: selectedDeckId,
      duration: randomDuration
    };
  } catch (error) {
    console.error(`Error distributing card:`, error);
    return { success: false, error };
  }
};