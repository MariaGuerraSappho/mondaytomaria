// Constants for the application
const APP_VERSION = "2.24.7 (build 346)";

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

// Card distribution function with strict mode enforcement
const distributeCard = async (player, deckData, distributionMode, players, minTimerSeconds, maxTimerSeconds, sharedCard = null) => {
  try {
    // Check if session is ended for this player first
    if (player.session_ended === true) {
      console.log(`[${APP_VERSION}] SKIPPED: Player ${player.name} is in an ended session state`);
      return {
        success: false,
        reason: 'SESSION_ENDED'
      };
    }
    
    console.log(`[${APP_VERSION}] Distributing card to player ${player.id} (${player.name}) in mode: ${distributionMode}`);
    
    // First, check if player already has an active card with remaining time
    if (player.current_card && player.current_card !== 'END' && player.card_start_time && player.card_duration) {
      const cardStartTime = new Date(player.card_start_time).getTime();
      const cardEndTime = cardStartTime + (player.card_duration * 1000);
      const now = Date.now();
      
      // If card still has time remaining, don't distribute a new one
      if (now < cardEndTime) {
        console.log(`[${APP_VERSION}] SKIPPED: Player ${player.name} already has an active card with ${Math.ceil((cardEndTime - now)/1000)}s remaining`);
        return {
          success: false,
          reason: 'CARD_STILL_ACTIVE',
          timeRemaining: Math.ceil((cardEndTime - now)/1000)
        };
      }
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
      // FIXED: Unison mode - if a sharedCard is provided, use it, otherwise select a new card
      if (sharedCard) {
        selectedCard = sharedCard;
        console.log(`[${APP_VERSION}] Using provided unison card: ${selectedCard}`);
      } else {
        // No shared card provided, select a new one
        const cards = deckData.cards;
        const randomIndex = Math.floor(Math.random() * cards.length);
        selectedCard = cards[randomIndex];
        console.log(`[${APP_VERSION}] Selected new unison card: ${selectedCard}`);
      }
    } else if (distributionMode === 'unique') {
      // Find a card that no other player currently has
      const cards = deckData.cards;
      const activePlayerCards = players
        .filter(p => p.active && p.current_card && p.current_card !== 'END' && p.id !== player.id)
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
    } else if (distributionMode === 'random') {
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
      ready_for_card: false,
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

// Distribute card to a player
const distributeCardToPlayer = async (player, sharedCard = null) => {
  try {
    // Assuming we have deckData, distributionMode, players, minTimerSeconds, maxTimerSeconds
    const deckData = decks.find(d => d.id === selectedDeck);
    const distributionMode = 'unison'; // replace with actual distribution mode
    const minTimerSeconds = 10; // replace with actual min timer seconds
    const maxTimerSeconds = 60; // replace with actual max timer seconds
    
    return await distributeCard(player, deckData, distributionMode, players, minTimerSeconds, maxTimerSeconds, sharedCard);
  } catch (error) {
    console.error(`[${APP_VERSION}] Error distributing card to player:`, error);
    return { success: false, error: error.message };
  }
};

// Modify the distributeCardsToAllPlayers function to ensure unison mode works correctly
const distributeCardsToAllPlayers = async (mode = 'unison') => {
  if (!sessionId || !selectedDeck || players.length === 0) {
    setError('No players or deck selected');
    return;
  }

  try {
    console.log(`[${APP_VERSION}] Distributing cards to all players in ${mode} mode`);
    
    // Force all players to be ready
    for (const player of players) {
      if (player.active) {
        await safeOperation(() =>
          room.collection('player').update(player.id, {
            ready_for_card: true
          })
        );
      }
    }
    
    // Brief delay to allow updates to process
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // For unison mode, select one card for all players
    let sharedCard = null;
    let selectedDeckData = null;
    
    if (mode === 'unison') {
      selectedDeckData = decks.find(d => d.id === selectedDeck);
      if (selectedDeckData && selectedDeckData.cards && selectedDeckData.cards.length > 0) {
        const randomIndex = Math.floor(Math.random() * selectedDeckData.cards.length);
        sharedCard = selectedDeckData.cards[randomIndex];
        console.log(`[${APP_VERSION}] Selected shared unison card: "${sharedCard}" for ALL players`);
      }
    }
    
    // For unison mode, do a single update to all players at once for consistency
    if (mode === 'unison' && sharedCard !== null) {
      const randomDuration = Math.floor(
        Math.random() * (60 - 10 + 1) + 10
      );
      
      const preciseStartTime = new Date();
      
      // Update all active players with the same card in one batch
      const updatePromises = players
        .filter(player => player.active)
        .map(player => {
          const updateData = {
            current_card: sharedCard,
            current_deck_name: selectedDeckData.name,
            current_deck_id: selectedDeckData.id,
            card_duration: randomDuration,
            card_start_time: preciseStartTime.toISOString(),
            ready_for_card: false,
            card_received: false
          };
          
          console.log(`[${APP_VERSION}] Updating player ${player.name} with unison card: "${sharedCard}"`);
          return safeOperation(() => 
            room.collection('player').update(player.id, updateData)
          );
        });
      
      await Promise.all(updatePromises);
      console.log(`[${APP_VERSION}] Successfully distributed unison card "${sharedCard}" to all players`);
    } else {
      // For non-unison modes, distribute individually
      for (const player of players) {
        if (player.active) {
          if (mode === 'unison') {
            await distributeCardToPlayer(player, sharedCard);
          } else {
            await distributeCardToPlayer(player);
          }
          // Add delay between distributions
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }
    }
    
    // Refresh player list
    setTimeout(refreshPlayerList, 2000);
    
  } catch (error) {
    console.error(`[${APP_VERSION}] Error distributing cards to all players:`, error);
    throw error;
  }
};