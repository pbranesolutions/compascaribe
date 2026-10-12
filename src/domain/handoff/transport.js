// Transport into Decision Channel.
//
// The prototype has no backend and no Decision Channel API, so the only
// implementation is a local simulation that returns a clearly-labeled receipt.
// It never claims a network request happened. The production implementation
// will POST the payload to the Decision Channel intake endpoint and return the
// real project reference.

const wait = ms => new Promise(r => setTimeout(r, ms))

/**
 * @typedef {Object} HandoffReceipt
 * @property {'simulated'} status
 * @property {string} receiptId
 * @property {string} note
 */

/**
 * @param {Object} payload
 * @param {{latency?: boolean}} [options]
 * @returns {Promise<HandoffReceipt>}
 */
export async function sendToDecisionChannel(payload, options = {}) {
  if (options.latency !== false) await wait(1100)
  const stamp = Date.now().toString(36).toUpperCase().slice(-6)
  return {
    status: 'simulated',
    receiptId: `DC-SIM-${stamp}`,
    note: 'Prototype: the handoff was prepared locally and not transmitted. No account or project was created.',
  }
}
