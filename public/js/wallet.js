// ============================================================
// wallet.js — Balance Simulation Module
// ============================================================

const Wallet = (() => {
  const STORAGE_KEY = 'wallet_balance';
  const DEFAULT_BALANCE = 500;
  const BASE_FARE = 30;
  const PER_KM_RATE = 12;

  function getBalance() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      localStorage.setItem(STORAGE_KEY, String(DEFAULT_BALANCE));
      return DEFAULT_BALANCE;
    }
    return parseFloat(stored);
  }

  function setBalance(amount) {
    localStorage.setItem(STORAGE_KEY, String(Math.round(amount)));
    updateUI();
  }

  function calculateFare(distanceKm) {
    return Math.round(BASE_FARE + distanceKm * PER_KM_RATE);
  }

  function deduct(amount) {
    const current = getBalance();
    if (current < amount) return false;
    setBalance(current - amount);
    return true;
  }

  function canAfford(amount) {
    return getBalance() >= amount;
  }

  function updateUI() {
    const el = document.getElementById('wallet-amount');
    if (el) el.textContent = getBalance();

    const badge = document.getElementById('wallet-badge');
    if (badge) {
      badge.classList.add('deducted');
      setTimeout(() => badge.classList.remove('deducted'), 600);
    }
  }

  function reset() {
    setBalance(DEFAULT_BALANCE);
  }

  // Initialize UI on load
  function init() {
    const el = document.getElementById('wallet-amount');
    if (el) el.textContent = getBalance();
  }

  return { getBalance, setBalance, calculateFare, deduct, canAfford, updateUI, reset, init };
})();
